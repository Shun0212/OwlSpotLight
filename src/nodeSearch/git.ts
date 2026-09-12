import { execFile } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { minimatch } from 'minimatch';
import { extractSymbols } from './symbols';
import ignore from 'ignore';
const formatDiffRange = (base: string, head: string) => base || head ? `${base || 'root'} → ${head || 'HEAD'}` : 'Working tree';
function validateGitRef(value?: string) {
    const ref = value?.trim() || '';
    if (ref.startsWith('-') || /[\x00-\x20]/.test(ref)) { throw new Error('Invalid Git revision.'); }
    return ref;
}
import type { DiffUnit, SearchRequest } from './types';

const exec = promisify(execFile);
export async function git(directory: string, args: string[], signal?: AbortSignal): Promise<string> {
    const { stdout } = await exec('git', ['-c', 'core.quotepath=false', ...args], {
        cwd: directory, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, signal,
    });
    return stdout;
}

export function matchesPath(file: string, patterns: string[] = []): boolean {
    return patterns.some(pattern => minimatch(file, pattern, { dot: true, matchBase: !pattern.includes('/') }));
}

// Git C-quotes control characters and can octal-escape UTF-8 bytes in paths.
function headerPath(value: string): string | null {
    let name = value;
    if (name.startsWith('"')) {
        const bytes: number[] = [];
        const quoted = name.match(/^"((?:\\.|[^"\\])*)"/);
        if (!quoted) { throw new Error('Invalid quoted Git path.'); }
        for (const part of quoted[1].match(/\\[0-7]{1,3}|\\.|[^\\]+/g) || []) {
            if (/^\\[0-7]/.test(part)) { bytes.push(parseInt(part.slice(1), 8)); }
            else {
                const escape: Record<string, string> = { '\\t': '\t', '\\n': '\n', '\\r': '\r', '\\b': '\b', '\\f': '\f', '\\v': '\v', '\\a': '\x07' };
                bytes.push(...Buffer.from(escape[part] ?? (part.startsWith('\\') ? part.slice(1) : part)));
            }
        }
        name = Buffer.from(bytes).toString('utf8');
    } else { name = name.split('\t')[0]; }
    return name === '/dev/null' ? null : name.replace(/^[ab]\//, '');
}

function addRange(ranges: number[][], line: number) {
    const last = ranges.at(-1);
    if (last && last[1] + 1 === line) { last[1] = line; }
    else if (line > 0) { ranges.push([line, line]); }
}

type Commit = { commit_hash: string; commit_subject: string; commit_message: string };
const worktree: Commit = { commit_hash: '', commit_subject: '', commit_message: '' };

export function parsePatch(patch: string, root: string, req: SearchRequest, commit: Commit = worktree): DiffUnit[] {
    const units: DiffUnit[] = [];
    let oldPath: string | null = null;
    let newPath: string | null = null;
    let header = '';
    let lines: string[] = [];
    let oldLine = 0;
    let newLine = 0;
    let newStart = 0;
    let added: number[][] = [];
    let removed: number[][] = [];
    const base = req.diff_base_ref || '';
    const head = req.branch_ref || req.diff_head_ref || '';
    const flush = () => {
        const file = newPath ?? oldPath;
        if (header && file && (added.length || removed.length)) {
            const absolute = path.resolve(root, file);
            const ext = req.file_ext || 'auto';
            const allowed = absolute.startsWith(root + path.sep)
                && (['auto', 'all', '*'].includes(ext) || file.toLowerCase().endsWith(ext.toLowerCase()))
                && (!req.include_globs?.length || matchesPath(file, req.include_globs))
                && !matchesPath(file, req.exclude_globs);
            if (allowed) {
                const diff = [header, ...lines].join('\n').trimEnd();
                const search = [`diff --git a/${oldPath ?? newPath} b/${newPath ?? oldPath}`,
                    oldPath === null ? '--- /dev/null' : `--- a/${oldPath}`,
                    newPath === null ? '+++ /dev/null' : `+++ b/${newPath}`, diff].join('\n');
                const changed = lines.filter(line => /^[+-]/.test(line)).map(line => line.slice(1)).join('\n');
                const title = `Unified diff: ${file}`;
                units.push({
                    ...commit, path: file, file_path: absolute, diff_old_path: oldPath, diff_new_path: newPath,
                    start_lineno: added[0]?.[0] ?? Math.max(1, newStart), lineno: added[0]?.[0] ?? Math.max(1, newStart), end_lineno: Math.max(1, newLine - 1),
                    name: title, function_name: title, symbol_kind: 'diff_hunk', result_type: 'diff_hunk',
                    diff_base_ref: base, diff_head_ref: head, diff_compare: formatDiffRange(base, head),
                    search_text: search, diff_code: diff, changed_code: changed, code: diff, raw_code: diff,
                    additions: added.reduce((sum, [a, b]) => sum + b - a + 1, 0),
                    deletions: removed.reduce((sum, [a, b]) => sum + b - a + 1, 0),
                    added_ranges: added, removed_ranges: removed,
                });
            }
        }
        header = ''; lines = []; added = []; removed = [];
    };
    for (const line of patch.split('\n')) {
        if (line.startsWith('diff --git ')) { flush(); oldPath = newPath = null; continue; }
        const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
            flush(); header = line; oldLine = Number(match[1]); newStart = newLine = Number(match[2]); continue;
        }
        if (!header) {
            if (line.startsWith('--- ')) { oldPath = headerPath(line.slice(4)); }
            if (line.startsWith('+++ ')) { newPath = headerPath(line.slice(4)); }
            continue;
        }
        if (line.startsWith('+')) { addRange(added, newLine++); }
        else if (line.startsWith('-')) { addRange(removed, oldLine++); }
        else if (line.startsWith(' ')) { oldLine++; newLine++; }
        else if (!line.startsWith('\\ No newline')) { continue; }
        lines.push(line);
    }
    flush();
    return units;
}

async function collectRawHunks(req: SearchRequest, signal?: AbortSignal): Promise<DiffUnit[]> {
    const root = await realpath((await git(req.directory, ['rev-parse', '--show-toplevel'], signal)).trim());
    const base = validateGitRef(req.diff_base_ref);
    const head = validateGitRef(req.branch_ref) || validateGitRef(req.diff_head_ref);
    const recent = req.diff_range_mode === 'branch';
    if (base || head || recent) {
        const rev = base ? `${base}..${head || 'HEAD'}` : head || 'HEAD';
        const output = await git(root, ['log', '--encoding=UTF-8', '--no-show-signature', '-p', '--no-color',
            '--no-ext-diff', '--no-textconv', '--unified=3', '--root',
            '--diff-merges=first-parent', ...(req.first_parent !== false ? ['--first-parent'] : []),
            '--date-order',
            '--format=%x00%H%x00%s%x00%B%x00', rev, '--'], signal);
        const hunks: DiffUnit[] = [];
        const parts = output.split('\0');
        for (let i = 1; i + 3 < parts.length; i += 4) {
            hunks.push(...parsePatch(parts[i + 3], root, req, {
                commit_hash: parts[i], commit_subject: parts[i + 1], commit_message: parts[i + 2].trimEnd(),
            }));
        }
        return hunks;
    }
    // An unborn repository has no HEAD. Compare its index against the empty tree.
    const hasHead = await git(root, ['rev-parse', '--verify', 'HEAD'], signal).then(() => true, error => {
        if (signal?.aborted) { throw error; } return false;
    });
    let patch = await git(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3',
        ...(hasHead ? ['HEAD'] : []), '--'], signal);
    if (!hasHead) {
        patch += await git(root, ['diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3', '--'], signal);
    }
    const hunks = parsePatch(patch, root, req);
    const untracked = await git(root, ['ls-files', '-z', '--others', '--exclude-standard'], signal);
    for (const file of untracked.split('\0').filter(Boolean)) {
        signal?.throwIfAborted();
        const absolute = path.resolve(root, file);
        if (!absolute.startsWith(root + path.sep)) { continue; }
        // Never follow an untracked symlink out of the workspace.
        const stat = await lstat(absolute).catch(() => undefined);
        if (!stat?.isFile() || stat.size > 1024 * 1024) { continue; }
        const bytes = await readFile(absolute);
        if (bytes.includes(0)) { continue; }
        const lines = bytes.toString('utf8').split('\n');
        if (lines.at(-1) === '') { lines.pop(); }
        if (!lines.length) { continue; }
        hunks.push(...parsePatch([
            `diff --git ${JSON.stringify('a/' + file)} ${JSON.stringify('b/' + file)}`,
            '--- /dev/null', `+++ ${JSON.stringify('b/' + file)}`, `@@ -0,0 +1,${lines.length} @@`,
            ...lines.map(line => '+' + line),
        ].join('\n'), root, req));
    }
    return hunks;
}

export function buildCommitUnits(hunks: DiffUnit[]): DiffUnit[] {
    const commits = new Map<string, DiffUnit[]>();
    for (const hunk of hunks) {
        const group = commits.get(hunk.commit_hash) ?? [];
        group.push(hunk); commits.set(hunk.commit_hash, group);
    }
    const units: DiffUnit[] = [];
    for (const commit of commits.values()) {
        const files = new Map<string, DiffUnit[]>();
        for (const hunk of commit) {
            const group = files.get(hunk.path) ?? [];
            group.push(hunk); files.set(hunk.path, group);
        }
        const entries = [...files].map(([file, group]) => ({
            path: file, file_path: group[0].file_path, lineno: group[0].lineno,
            diff_old_path: group[0].diff_old_path, diff_new_path: group[0].diff_new_path,
            additions: group.reduce((sum, h) => sum + h.additions, 0),
            deletions: group.reduce((sum, h) => sum + h.deletions, 0), hunk_count: group.length,
        }));
        for (const [file, group] of files) {
            const text = group.map(h => h.search_text).join('\n\n');
            const title = group[0].commit_subject || 'Working tree changes';
            units.push({ ...group[0], name: title, function_name: title, symbol_kind: 'diff_hunk',
                result_type: 'diff_commit', search_unit: 'diff_commit', score_unit: 'commit_file_diff',
                commit_score_aggregation: 'max_file', scored_file_path: file,
                raw_code: text, code: text, search_text: text, diff_code: text,
                changed_code: group.map(h => h.changed_code).join('\n'),
                additions: commit.reduce((sum, h) => sum + h.additions, 0),
                deletions: commit.reduce((sum, h) => sum + h.deletions, 0),
                scored_file_hunk_count: group.length, commit_file_count: files.size, commit_hunk_count: commit.length,
                commit_files: [...files.keys()], commit_hunks: entries.map(entry => ({ ...entry, is_representative: entry.path === file })),
            });
        }
    }
    return units;
}

export async function resolveRange(req: SearchRequest, signal?: AbortSignal): Promise<SearchRequest> {
    const directory = await realpath(req.directory);
    req = { ...req, directory, include_files: req.include_files?.map(file => path.resolve(directory, path.relative(req.directory, path.resolve(req.directory, file)))) };
    const resolve = (ref: string) => git(req.directory, ['rev-parse', '--verify', '--end-of-options', `${validateGitRef(ref)}^{commit}`], signal).then(text => text.trim());
    if (req.diff_range_mode === 'working_tree') { return { ...req, diff_base_ref: '', diff_head_ref: '' }; }
    if (req.diff_range_mode === 'custom') {
        if (!req.diff_base_ref?.trim()) { throw new Error('Choose a From revision for the custom range.'); }
        return { ...req, diff_base_ref: await resolve(req.diff_base_ref), diff_head_ref: await resolve(req.diff_head_ref || 'HEAD') };
    }
    return { ...req, diff_range_mode: 'branch', diff_base_ref: '', diff_head_ref: await resolve('HEAD') };
}

export async function collectHunks(request: SearchRequest, signal?: AbortSignal): Promise<DiffUnit[]> {
    const req = await resolveRange(request, signal);
    const root = (await git(req.directory, ['rev-parse', '--show-toplevel'], signal)).trim();
    const rules = ignore().add(['node_modules/', '.venv/', '__pycache__/', '.owl_index/', 'out/', 'dist/', 'build/']);
    for (const file of ['.gitignore', '.owlignore']) {
        const content = await readFile(path.join(req.directory, file), 'utf8').catch(() => '');
        rules.add(content);
    }
    const include = req.include_files ? new Set(req.include_files.map(file => path.resolve(req.directory, file))) : undefined;
    return (await collectRawHunks(req, signal)).filter(unit => {
        const rel = path.relative(req.directory, path.resolve(root, unit.path)).split(path.sep).join('/');
        return rel && rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel) && !rules.ignores(rel)
            && (!include || include.has(unit.file_path));
    });
}

export async function collectChangedSymbols(request: SearchRequest, signal?: AbortSignal) {
    const req = await resolveRange(request, signal);
    const root = (await git(req.directory, ['rev-parse', '--show-toplevel'], signal)).trim();
    const hunks = await collectHunks(req, signal);
    const files = [...new Set(hunks.map(h => h.path))];
    const result = [];
    for (const file of files) {
        signal?.throwIfAborted();
        const absolute = path.join(root, file);
        let source: string;
        try {
            if (!req.diff_head_ref && !(await lstat(absolute)).isFile()) { continue; }
            source = req.diff_head_ref ? await git(root, ['show', `${req.diff_head_ref}:${file}`], signal) : await readFile(absolute, 'utf8');
        } catch (error) { if (signal?.aborted) { throw error; } continue; } // Deleted files have no current function.
        const symbols = await extractSymbols(absolute, source);
        let changes = hunks.filter(h => h.path === file);
        if (req.diff_base_ref && req.diff_head_ref) {
            const patch = await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--unified=0', req.diff_base_ref, req.diff_head_ref, '--', file], signal);
            changes = parsePatch(patch, root, req);
        }
        for (const symbol of symbols) {
            if (req.diff_range_mode === 'branch' || changes.some(h => h.added_ranges.some(([a, b]) => a <= symbol.end_lineno && b >= symbol.start_lineno)
                || (h.deletions > 0 && h.lineno >= symbol.start_lineno && h.lineno <= symbol.end_lineno))) {
                result.push({ ...symbol, snapshot_ref: req.diff_head_ref || undefined,
                    diff_base_ref: req.diff_base_ref, diff_head_ref: req.diff_head_ref });
            }
        }
    }
    return result;
}
