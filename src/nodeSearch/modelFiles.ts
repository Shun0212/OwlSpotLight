import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { EngineOptions, ReportProgress } from './types';
import { modelProfile } from './models';

export function validateModelOptions(options: EngineOptions) {
    if (!/^[\w-]+\/[\w.-]+$/.test(options.modelName) || !/^[0-9a-f]{40}$/i.test(options.revision)) {
        throw new Error('Set modelName to a Hugging Face owner/repository and modelRevision to its full 40-character commit hash.');
    }
}

async function checksum(filename: string) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) { hash.update(chunk); }
    return hash.digest('hex');
}

// Resolve explicit files ourselves: Transformers.js 4.2 tokenizer discovery
// otherwise requests main even with revision/local_files_only, breaking offline use.
export async function ensureModelFiles(options: EngineOptions, report: ReportProgress, signal?: AbortSignal): Promise<string> {
    validateModelOptions(options);
    const directory = path.join(options.cacheDir, 'models', options.modelName, options.revision);
    const modelFile = options.dtype === 'q8' ? 'onnx/model_quantized.onnx' : 'onnx/model.onnx';
    for (const file of ['tokenizer.json', 'tokenizer_config.json', 'config.json', modelFile]) {
        signal?.throwIfAborted();
        const target = path.join(directory, file);
        const profile = modelProfile(options.modelName);
        const expectedHash = file === modelFile && options.revision === profile?.revision
            ? profile.checksums[options.dtype] : undefined;
        const valid = async (filename: string) => {
            try {
                if (!(await stat(filename)).size) { return false; }
                if (file.endsWith('.json')) { JSON.parse(await readFile(filename, 'utf8')); }
                return !expectedHash || await checksum(filename) === expectedHash;
            } catch { return false; }
        };
        if (await valid(target)) { continue; }
        if (options.localFilesOnly) { throw new Error(`ONNX model file is missing or corrupt: ${target}. Load the model once with network access.`); }
        await mkdir(path.dirname(target), { recursive: true });
        const temporary = target + '.' + randomUUID() + '.tmp';
        try {
            const response = await fetch(`https://huggingface.co/${options.modelName}/resolve/${options.revision}/${file}`, { signal });
            if (!response.ok || !response.body) { throw new Error(`Could not download ${file}: HTTP ${response.status}`); }
            const total = Number(response.headers.get('content-length')) || 0;
            const handle = await open(temporary, 'wx');
            const reader = response.body.getReader();
            let current = 0;
            let lastReport = 0;
            try {
                while (true) {
                    const { done, value: chunk } = await reader.read();
                    if (done) { break; }
                    signal?.throwIfAborted();
                    await handle.writeFile(chunk);
                    current += chunk.length;
                    if (Date.now() - lastReport > 150) {
                        report({ active: true, phase: `Downloading ${file}`, current: total ? Math.round(current / total * 100) : 0, total: 100 });
                        lastReport = Date.now();
                    }
                }
            } finally {
                // An aborted fetch can reject cancel() too; always close the file.
                await reader.cancel().catch(() => {});
                reader.releaseLock();
                await handle.close();
            }
            if (!await valid(temporary)) { throw new Error(`The downloaded ${file} failed validation. Load the model again.`); }
            signal?.throwIfAborted();
            await rename(temporary, target);
        } finally { await rm(temporary, { force: true }); }
    }
    return directory;
}
