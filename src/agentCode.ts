import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);
const MAX_BYTES = 1024 * 1024;
export type CodeDocument = { path: string; text: string; version: string; kind: 'source' | 'diff'; firstLine: number };
export type CodePage = Omit<CodeDocument, 'text' | 'firstLine'> & { startLine: number; endLine: number; totalLines: number; nextLine: number | null; lines: string[] };
export type CodeHighlight = { startLine: number; endLine: number; color: 'blue' | 'green' | 'amber' | 'purple'; label: string };

export function codePage(document: CodeDocument, startLine = document.firstLine): CodePage {
    const lines = document.text.replace(/\r\n/g, '\n').split('\n');
    const offset = startLine - document.firstLine;
    if (!Number.isInteger(startLine) || offset < 0 || offset >= lines.length) { throw new Error('Invalid code line.'); }
    const page: string[] = [];
    let chars = 0;
    for (const line of lines.slice(offset, offset + 200)) {
        // Never silently truncate a line used as evidence for a highlight.
        if (chars + line.length > 20000) { break; }
        page.push(line);
        chars += line.length + 1;
    }
    if (!page.length) { throw new Error('This line is too large to inspect.'); }
    const endLine = startLine + page.length - 1;
    return { path: document.path, version: document.version, kind: document.kind, startLine, endLine,
        totalLines: lines.length, nextLine: offset + page.length < lines.length ? endLine + 1 : null, lines: page };
}

export function verifiedHighlights(value: unknown, pages: CodePage[]): CodeHighlight[] {
    if (!Array.isArray(value)) { return []; }
    return value.filter(item => item && Number.isInteger(item.startLine) && Number.isInteger(item.endLine)
        && item.startLine > 0 && item.endLine >= item.startLine && item.endLine - item.startLine < 20
        && ['blue', 'green', 'amber', 'purple'].includes(item.color)
        && typeof item.label === 'string' && item.label.trim()
        && pages.some(page => item.startLine >= page.startLine && item.endLine <= page.endLine))
        .slice(0, 4).map(item => ({ startLine: item.startLine, endLine: item.endLine, color: item.color, label: item.label.trim().slice(0, 240) }));
}

// The agent supplies a result ID, never a path or Git command. Snapshot each file
// once so pagination and highlights refer to the same revision during this run.
export function createCodeReader(root: string) {
    const cache = new Map<string, CodeDocument>();
    return async (result: Record<string, any>, signal?: AbortSignal): Promise<CodeDocument> => {
        signal?.throwIfAborted();
        const filename = result.file_path || result.file || result.path || result.scored_file_path;
        if (typeof filename !== 'string') { throw new Error('Result has no file.'); }
        const absolute = path.resolve(root, filename);
        const relative = path.relative(root, absolute);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) { throw new Error('Result is outside the workspace.'); }
        const commit = result.commit_hash;
        const key = `${commit || 'working-tree'}:${relative}`;
        if (cache.has(key)) { return cache.get(key)!; }
        let document: CodeDocument;
        if (commit) {
            if (typeof commit !== 'string' || !/^[a-f0-9]{40,64}$/i.test(commit)) { throw new Error('Invalid commit.'); }
            const gitOptions = { cwd: root, maxBuffer: MAX_BYTES, timeout: 10000, signal };
            const prefix = (await exec('git', ['rev-parse', '--show-prefix'], gitOptions)).stdout.trim();
            const gitPath = prefix + relative.split(path.sep).join('/');
            let version = commit;
            try {
                await exec('git', ['cat-file', '-e', `${commit}:${gitPath}`], gitOptions);
            } catch {
                signal?.throwIfAborted();
                // A deleted file is available in the parent snapshot. Do not
                // fall back on a read failure (such as an oversized new file).
                version = `${commit}^`;
            }
            const text = (await exec('git', ['show', `${version}:${gitPath}`], gitOptions)).stdout;
            document = { path: relative, text, version, kind: 'source', firstLine: 1 };
        } else {
            const realRoot = await fs.realpath(root);
            const realFile = await fs.realpath(absolute);
            const realRelative = path.relative(realRoot, realFile);
            if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) { throw new Error('Result resolves outside the workspace.'); }
            const handle = await fs.open(realFile, 'r');
            let text: string;
            try {
                if (!(await handle.stat()).isFile()) { throw new Error('Result is not a file.'); }
                const buffer = Buffer.alloc(MAX_BYTES + 1);
                let bytesRead = 0;
                while (bytesRead < buffer.length) {
                    signal?.throwIfAborted();
                    const part = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
                    if (!part.bytesRead) { break; }
                    bytesRead += part.bytesRead;
                }
                if (bytesRead > MAX_BYTES) { throw new Error('File exceeds the reading limit.'); }
                text = buffer.subarray(0, bytesRead).toString('utf8');
            } finally { await handle.close(); }
            document = { path: relative, text, version: 'working-tree', kind: 'source', firstLine: 1 };
        }
        signal?.throwIfAborted();
        if (document.text.includes('\0')) { throw new Error('Binary content is not supported.'); }
        cache.set(key, document);
        return document;
    };
}
