import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import type { EngineOptions, ReportProgress, SearchRequest, SearchResult } from './types';

type SearchResponse = { results: SearchResult[]; total_symbols: number };
export class NodeSearchClient {
    private worker?: Worker;
    private pending?: { reject: (error: Error) => void };
    private stopping?: Promise<void>;
    constructor(private readonly options: EngineOptions) {}
    async search(request: SearchRequest, report: ReportProgress, signal?: AbortSignal): Promise<SearchResponse> {
        return this.request<SearchResponse>('search', request, report, signal);
    }
    async request<T>(operation: 'search' | 'graph' | 'stats' | 'prepare', request: SearchRequest, report: ReportProgress, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted();
        if (this.stopping) { await this.stopping; }
        signal?.throwIfAborted();
        if (this.pending) { throw new Error('A simple-mode search is already running.'); }
        const worker = this.worker ??= new Worker(path.join(__dirname, 'worker.js'), { workerData: this.options });
        return new Promise<T>((resolve, reject) => {
            const finish = (error?: Error, result?: T) => {
                worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit);
                signal?.removeEventListener('abort', onAbort);
                this.pending = undefined;
                if (error) { reject(error); } else { resolve(result!); }
            };
            const onMessage = (message: { progress?: Parameters<ReportProgress>[0]; error?: string; result?: T }) => {
                if (message.progress) { report(message.progress); }
                else { finish(message.error ? new Error(message.error) : undefined, message.result); }
            };
            const onError = (error: Error) => { this.worker = undefined; finish(error); };
            const onExit = (code: number) => { this.worker = undefined; finish(new Error(`ONNX worker exited (${code}).`)); };
            const onAbort = () => { void this.dispose(); };
            this.pending = { reject: error => finish(error) };
            worker.on('message', onMessage); worker.once('error', onError); worker.once('exit', onExit);
            signal?.addEventListener('abort', onAbort, { once: true });
            worker.postMessage({ operation, request });
        });
    }
    async dispose(): Promise<void> {
        if (this.stopping) { return this.stopping; }
        const worker = this.worker;
        this.worker = undefined;
        if (worker) {
            this.stopping = worker.terminate().then(() => {
                this.pending?.reject(new Error('ONNX search stopped.'));
            });
            try { await this.stopping; } finally { this.stopping = undefined; }
        } else {
            this.pending?.reject(new Error('ONNX search stopped.'));
        }
    }
}
