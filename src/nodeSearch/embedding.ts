import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { EngineOptions, ReportProgress } from './types';
import { ensureModelFiles } from './modelFiles';
import { modelProfile } from './models';

const loadRuntime = () => import('@huggingface/transformers');
type Transformers = Awaited<ReturnType<typeof loadRuntime>>;

export interface Embedder {
    namespace: string;
    dimensions: number;
    encode(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
    load?(signal?: AbortSignal): Promise<void>;
    isLoaded?(): boolean;
}

interface Tokenizer {
    encode(text: string, options?: { add_special_tokens?: boolean }): number[];
    pad_token_id: number;
}

export function tokenizeBatch(tokenizer: Tokenizer, texts: string[], maxLength = 1024) {
    const special = tokenizer.encode('');
    if (special.length !== 2) { throw new Error('The ONNX backend requires a NightOwl-compatible CLS/SEP tokenizer.'); }
    // Truncate content before adding CLS and SEP, matching the Python tokenizer.
    const rows = texts.map(text => [special[0], ...tokenizer.encode(text, { add_special_tokens: false }).slice(0, maxLength - 2), special[1]]);
    const width = Math.max(2, ...rows.map(row => row.length));
    const ids = new BigInt64Array(rows.length * width).fill(BigInt(tokenizer.pad_token_id));
    const mask = new BigInt64Array(ids.length);
    rows.forEach((row, i) => row.forEach((id, j) => { ids[i * width + j] = BigInt(id); mask[i * width + j] = 1n; }));
    return { ids, mask, dims: [rows.length, width] };
}

export function normalize(vector: Float32Array): Float32Array {
    let norm = 0;
    for (const value of vector) { norm += value * value; }
    if (!Number.isFinite(norm) || norm <= 0) { throw new Error('The model returned an invalid embedding.'); }
    norm = Math.sqrt(norm);
    return vector.map(value => value / norm);
}

export function cosine(left: Float32Array, right: Float32Array): number {
    if (left.length !== right.length) { throw new Error('Embedding dimensions do not match.'); }
    let sum = 0;
    for (let i = 0; i < left.length; i++) { sum += left[i] * right[i]; }
    return Math.max(-1, Math.min(1, sum));
}

export class OnnxEmbedder implements Embedder {
    readonly dimensions: number;
    private readonly maxLength: number;
    readonly namespace: string;
    private runtime?: Transformers;
    private tokenizer?: Tokenizer;
    private model?: Awaited<ReturnType<Transformers['AutoModel']['from_pretrained']>>;
    private loading?: Promise<void>;

    constructor(private readonly options: EngineOptions, private readonly report: ReportProgress) {
        const profile = modelProfile(options.modelName);
        this.dimensions = profile?.dimensions ?? 768;
        this.maxLength = profile?.maxLength ?? 1024;
        this.namespace = JSON.stringify(['nightowl-cls-sep-v1', options.modelName, options.revision, options.dtype, this.maxLength, this.dimensions]);
    }

    isLoaded(): boolean { return !!this.model; }

    async load(signal?: AbortSignal): Promise<void> {
        if (this.model) { return; }
        if (this.loading) { return this.loading; }
        this.loading = this.initialize(signal);
        try { await this.loading; } finally { this.loading = undefined; }
    }

    private async initialize(signal?: AbortSignal) {
        this.report({ active: true, phase: 'Loading ONNX model', current: 0, total: 1 });
        this.runtime = await loadRuntime();
        const { PreTrainedTokenizer, AutoModel, env } = this.runtime;
        const directory = await ensureModelFiles(this.options, this.report, signal);
        signal?.throwIfAborted();
        env.allowRemoteModels = false;
        env.cacheDir = path.join(this.options.cacheDir, 'models');
        this.tokenizer = new PreTrainedTokenizer(
            JSON.parse(await readFile(path.join(directory, 'tokenizer.json'), 'utf8')),
            JSON.parse(await readFile(path.join(directory, 'tokenizer_config.json'), 'utf8')),
        );
        this.report({ active: true, phase: 'Loading ONNX model', current: 0, total: 1 });
        this.model = await AutoModel.from_pretrained(directory, {
            local_files_only: true, dtype: this.options.dtype, device: 'cpu',
            session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
        });
    }

    async encode(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
        if (!texts.length) { return []; }
        signal?.throwIfAborted();
        await this.load(signal);
        signal?.throwIfAborted();
        const { Tensor } = this.runtime!;
        const batch = tokenizeBatch(this.tokenizer!, texts, this.maxLength);
        const inputs = { input_ids: new Tensor('int64', batch.ids, batch.dims), attention_mask: new Tensor('int64', batch.mask, batch.dims) };
        const output = await this.model!(inputs);
        try {
            signal?.throwIfAborted();
            const hidden = output.last_hidden_state;
            if (!hidden || hidden.dims.length !== 3 || hidden.dims[0] !== texts.length || hidden.dims[2] !== this.dimensions) {
                throw new Error(`Expected ONNX last_hidden_state with ${this.dimensions} dimensions for ${this.options.modelName}.`);
            }
            return texts.map((_, i) => {
                const offset = i * hidden.dims[1] * this.dimensions;
                return normalize(Float32Array.from(hidden.data.slice(offset, offset + this.dimensions), Number));
            });
        } finally {
            for (const tensor of Object.values(output)) {
                if (tensor instanceof Tensor) { tensor.dispose(); }
            }
            inputs.input_ids.dispose(); inputs.attention_mask.dispose();
        }
    }
}

export const hashText = (text: string) => createHash('sha256').update(text).digest('hex');

export class EmbeddingCache {
    private readonly memory = new Map<string, Float32Array>();
    readonly directory: string;
    constructor(cacheDir: string, namespace: string, private readonly dimensions: number) {
        this.directory = path.join(cacheDir, 'embeddings', hashText(namespace));
    }
    private remember(key: string, vector: Float32Array) {
        this.memory.delete(key); this.memory.set(key, vector);
        if (this.memory.size > 4096) { this.memory.delete(this.memory.keys().next().value!); }
    }
    async get(key: string): Promise<Float32Array | undefined> {
        const remembered = this.memory.get(key);
        if (remembered) { this.remember(key, remembered); return remembered; }
        try {
            const bytes = await readFile(path.join(this.directory, key + '.f32'));
            if (bytes.length !== this.dimensions * 4) { return; }
            const vector = Float32Array.from({ length: this.dimensions }, (_, i) => bytes.readFloatLE(i * 4));
            const norm = vector.reduce((sum, value) => sum + value * value, 0);
            if (!Number.isFinite(norm) || Math.abs(norm - 1) > 0.001) { return; }
            this.remember(key, vector); return vector;
        } catch { return; }
    }
    async put(key: string, vector: Float32Array): Promise<void> {
        if (vector.length !== this.dimensions) { throw new Error('Cannot cache an embedding with incorrect dimensions.'); }
        this.remember(key, vector);
        await mkdir(this.directory, { recursive: true });
        const temporary = path.join(this.directory, key + '.' + randomUUID() + '.tmp');
        const bytes = Buffer.alloc(vector.length * 4);
        vector.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
        try {
            await writeFile(temporary, bytes);
            await rename(temporary, path.join(this.directory, key + '.f32'));
        } finally { await rm(temporary, { force: true }); }
    }
}
