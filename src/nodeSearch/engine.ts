import { readdir, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import ignore from 'ignore';
import { buildCommitUnits, collectHunks, collectChangedSymbols, matchesPath } from './git';
import { EmbeddingCache, OnnxEmbedder, cosine, hashText, type Embedder } from './embedding';
import type { CodeSymbol, EngineOptions, ReportProgress, SearchRequest, SearchResult } from './types';

import { extractSymbols, SUPPORTED_EXTENSIONS } from './symbols';
const EXCLUDED = ['.git', '.hg', '.svn', 'node_modules', '.venv', 'venv', '__pycache__', '.owl_index', 'out', 'dist', 'build'];
const MAX_BYTES = 1024 * 1024;

export async function collectSymbols(request: SearchRequest, signal?: AbortSignal): Promise<CodeSymbol[]> {
    const root = path.resolve(request.directory);
    const allowed = request.include_files === undefined ? undefined : new Set(request.include_files.map(file => path.resolve(root, file)));
    const blocks: CodeSymbol[] = [];
    type Rule = { base: string; matcher: ReturnType<typeof ignore> };
    const walk = async (directory: string, inherited: Rule[]) => {
        signal?.throwIfAborted();
        const rules = [...inherited];
        for (const filename of ['.gitignore', '.owlignore']) {
            try { rules.push({ base: directory, matcher: ignore().add(await readFile(path.join(directory, filename), 'utf8')) }); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
        }
        const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            signal?.throwIfAborted();
            if (entry.isSymbolicLink() || EXCLUDED.includes(entry.name)) { continue; }
            const file = path.join(directory, entry.name);
            if (rules.some(rule => rule.matcher.ignores(path.relative(rule.base, file).split(path.sep).join('/') + (entry.isDirectory() ? '/' : '')))) { continue; }
            if (entry.isDirectory()) { await walk(file, rules); continue; }
            const ext = path.extname(file).toLowerCase();
            const relative = path.relative(root, file).split(path.sep).join('/');
            if ((request.include_globs?.length && !matchesPath(relative, request.include_globs)) || matchesPath(relative, request.exclude_globs)) { continue; }
            if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(ext) || (request.file_ext && request.file_ext !== 'auto' && ext !== request.file_ext) || (allowed && !allowed.has(file))) { continue; }
            try {
                if ((await stat(file)).size > MAX_BYTES) { continue; }
                const source = await readFile(file, 'utf8');
                if (!source.includes('\0')) { blocks.push(...await extractSymbols(file, source)); }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
            }
        }
    };
    await walk(root, []);
    return blocks;
}

const tokens = (text: string) => (text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
export function bm25(documents: string[], query: string): number[] {
    const terms = [...new Set(tokens(query))];
    const rows = documents.map(tokens);
    const average = rows.reduce((sum, row) => sum + row.length, 0) / (rows.length || 1) || 1;
    const frequencies = rows.map(row => {
        const counts = new Map<string, number>();
        for (const token of row) { counts.set(token, (counts.get(token) || 0) + 1); }
        return counts;
    });
    const df = terms.map(term => frequencies.filter(row => row.has(term)).length);
    return rows.map((row, index) => terms.reduce((score, term, j) => {
        const count = frequencies[index].get(term) || 0;
        return score + Math.log(1 + (rows.length - df[j] + 0.5) / (df[j] + 0.5)) * count * 2.2 /
            (count + 1.2 * (0.25 + 0.75 * row.length / average));
    }, 0));
}

export class SearchEngine {
    private readonly embedder: Embedder;
    private readonly cache: EmbeddingCache;
    constructor(private readonly options: EngineOptions, private readonly report: ReportProgress, embedder?: Embedder) {
        this.embedder = embedder ?? new OnnxEmbedder(options, report);
        this.cache = new EmbeddingCache(options.cacheDir, 'symbols-v1:' + this.embedder.namespace, this.embedder.dimensions);
    }
    async prepare(request: SearchRequest, signal?: AbortSignal) {
        const hunks = await collectHunks(request, signal);
        return { num_diff_hunks: hunks.length, num_files: new Set(hunks.map(h => h.file_path)).size,
            num_commits: new Set(hunks.map(h => h.commit_hash)).size, message: 'Git changes are ready. Embeddings are built on search.' };
    }
    async stats(request: SearchRequest, signal?: AbortSignal) {
        const symbols = await collectSymbols(request, signal);
        const ranked = request.query.trim() ? (await this.search({ ...request, scope: 'all', top_k: 100 }, signal)).results : [];
        const classes = new Map<string, { name: string; file_path: string; methods: Array<CodeSymbol & { search_rank: number | null }> }>();
        const standalone = [];
        for (const symbol of symbols) {
            const position = ranked.findIndex(row => row.file_path === symbol.file_path && row.lineno === symbol.lineno);
            const item = { ...symbol, search_rank: position < 0 ? null : position + 1 };
            if (!symbol.class_name) { standalone.push(item); continue; }
            const key = `${symbol.file_path}:${symbol.class_name}`;
            const group = classes.get(key) || { name: symbol.class_name, file_path: symbol.file_path, methods: [] };
            group.methods.push(item); classes.set(key, group);
        }
        return { classes: [...classes.values()].map(group => {
            const ranks = group.methods.flatMap(method => method.search_rank ? [method.search_rank] : []);
            const weighted = ranks.reduce((sum, rank) => sum + 1 / rank, 0);
            const proportion = ranks.length / group.methods.length;
            return { ...group, method_count: group.methods.length, search_hits: ranks.length, all_ranks: ranks,
                weighted_score: weighted, proportion, composite_score: weighted * (1 + proportion) / 2, best_rank: ranks.length ? Math.min(...ranks) : null };
        }).sort((a, b) => b.composite_score - a.composite_score), standalone_functions: standalone.sort((a, b) => (a.search_rank ?? Infinity) - (b.search_rank ?? Infinity)), total_functions: symbols.length, total_classes: classes.size, total_standalone_functions: standalone.length, search_query: request.query };
    }
    async graph(request: SearchRequest, signal?: AbortSignal) {
        const symbols = await collectSymbols({ ...request, scope: 'all' }, signal);
        const center = symbols.filter(symbol => path.resolve(symbol.file_path) === path.resolve(request.file || '')
            && symbol.start_lineno <= (request.line || 1) && symbol.end_lineno >= (request.line || 1))
            .sort((a, b) => (a.end_lineno - a.start_lineno) - (b.end_lineno - b.start_lineno))[0];
        if (!center) { throw new Error('No function or method found at this location.'); }
        const id = (symbol: CodeSymbol) => `${symbol.file_path}:${symbol.lineno}`;
        const edges: Array<{ source: string; target: string; kind: 'call' | 'similar'; evidence: 'static' | 'embedding'; score?: number; sites?: unknown[] }> = [];
        const neighborhood = new Map([[id(center), center]]);
        for (const caller of symbols) {
            for (const call of caller.calls || []) {
                const matches = symbols.filter(target => target.name === call.name && (call.receiver
                    ? ['self', 'cls', 'this'].includes(call.receiver) ? target.class_name === caller.class_name && target.file_path === caller.file_path
                        : target.class_name === call.receiver
                    : !target.class_name));
                const local = matches.filter(target => target.file_path === caller.file_path);
                const candidates = local.length ? local : matches;
                if (candidates.length !== 1) { continue; }
                const target = candidates[0];
                if (id(caller) !== id(center) && id(target) !== id(center)) { continue; }
                if (neighborhood.size >= 80 && (!neighborhood.has(id(caller)) || !neighborhood.has(id(target)))) { continue; }
                neighborhood.set(id(caller), caller); neighborhood.set(id(target), target);
                edges.push({ source: id(caller), target: id(target), kind: 'call', evidence: 'static', sites: [{ file: caller.file_path, ...call }] });
            }
        }
        const similar = request.similar ? (await this.search({ directory: request.directory, query: center.code, file_ext: request.file_ext, top_k: 6 }, signal)).results : [];
        for (const match of similar.filter(row => id(row) !== id(center)).slice(0, 5)) {
            if (neighborhood.size >= 80) { break; }
            neighborhood.set(id(match), match);
            edges.push({ source: id(center), target: id(match), kind: 'similar', evidence: 'embedding', score: match.similarity });
        }
        const queryMatches = request.query.trim() && this.embedder.isLoaded?.()
            ? (await this.search({ directory: request.directory, query: request.query, file_ext: request.file_ext, top_k: 100 }, signal)).results : [];
        return { center: id(center), nodes: [...neighborhood.values()].map(symbol => ({ id: id(symbol), file: symbol.file_path,
            line: symbol.lineno, endLine: symbol.end_lineno, name: symbol.name, className: symbol.class_name, symbolKind: symbol.symbol_kind,
            queryScore: queryMatches.find(row => id(row) === id(symbol))?.similarity ?? null, similarity: similar.find(row => id(row) === id(symbol))?.similarity ?? null, unresolved: null })),
            edges, truncated: neighborhood.size >= 80, embeddingsAvailable: this.embedder.isLoaded?.() === true };
    }
    async search(request: SearchRequest, signal?: AbortSignal): Promise<{ results: SearchResult[]; total_symbols: number }> {
        if (!request.query.trim()) { throw new Error('Enter a search query.'); }
        const mode = request.search_mode ?? 'semantic';
        this.report({ active: true, phase: 'Parsing functions and methods', current: 0, total: 0 });
        const blocks = request.scope === 'changed' ? request.search_target === 'diff_hunks'
            ? buildCommitUnits(await collectHunks(request, signal)) : await collectChangedSymbols(request, signal)
            : await collectSymbols(request, signal);
        if (!blocks.length) { return { results: [], total_symbols: 0 }; }
        const texts = blocks.map(block => block.search_text || `${path.relative(request.directory, block.file_path)}\n${block.class_name ? block.class_name + '.' : ''}${block.function_name}\n${block.code}`);
        const lexical = bm25(texts, request.query);
        const semantic = new Array<number>(blocks.length).fill(0);
        if (mode === 'semantic' || mode === 'hybrid') {
            const [query] = await this.embedder.encode([request.query], signal);
            const batchSize = Math.max(1, Math.min(16, Math.floor(this.options.batchSize) || 2));
            for (let start = 0; start < blocks.length; start += batchSize) {
                signal?.throwIfAborted();
                const batch = texts.slice(start, start + batchSize);
                const keys = batch.map(hashText);
                const vectors = await Promise.all(keys.map(key => this.cache.get(key)));
                const missing = batch.map((_, i) => i).filter(i => !vectors[i]);
                const encoded = await this.embedder.encode(missing.map(i => batch[i]), signal);
                for (let j = 0; j < missing.length; j++) {
                    vectors[missing[j]] = encoded[j];
                    await this.cache.put(keys[missing[j]], encoded[j]);
                }
                vectors.forEach((vector, i) => { semantic[start + i] = cosine(query, vector!); });
                this.report({ active: true, phase: 'Embedding functions and methods', current: Math.min(start + batchSize, blocks.length), total: blocks.length });
            }
        }
        const ranks = (values: number[]) => {
            const ranked = values.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score || a.index - b.index);
            const result = new Array<number>(values.length);
            ranked.forEach((item, i) => { result[item.index] = 1 / (60 + i + 1); });
            return result;
        };
        const sr = ranks(semantic), lr = ranks(lexical);
        const results = blocks.map((block, i): SearchResult => ({ ...block, search_mode: mode,
            similarity: mode === 'semantic' || mode === 'hybrid' ? semantic[i] : undefined,
            bm25_score: lexical[i], score: mode === 'semantic' ? semantic[i] : mode === 'hybrid' ? sr[i] + (lexical[i] > 0 ? lr[i] : 0) : mode === 'keyword' ? (block.code.toLowerCase().includes(request.query.toLowerCase()) ? 1 : 0) : lexical[i]
        })).filter(row => (mode !== 'bm25' && mode !== 'keyword') || row.score > 0)
            .sort((a, b) => b.score - a.score || a.file_path.localeCompare(b.file_path) || a.lineno - b.lineno)
            ;
        const deduplicated = request.search_target === 'diff_hunks' ? results.filter((item, i) => results.findIndex(other => other.commit_hash === item.commit_hash) === i) : results;
        const limited = deduplicated.slice(0, Math.max(1, Math.min(100, request.top_k ?? 30)));
        signal?.throwIfAborted();
        return { results: limited, total_symbols: blocks.length };
    }
}
