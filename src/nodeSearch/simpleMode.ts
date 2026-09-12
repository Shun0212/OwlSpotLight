import * as vscode from 'vscode';
import { searchBackend } from '../searchBackend';
import * as path from 'node:path';
import { rm } from 'node:fs/promises';
import { NodeSearchClient } from './client';
import { MODEL_PROFILES, modelProfile } from './models';
import type { SearchRequest, ReportProgress } from './types';

export function isSimpleMode(): boolean {
    return searchBackend() === 'node-onnx';
}

export class SimpleMode {
    private client?: NodeSearchClient;
    private key?: string;
    private busy = false;
    constructor(private readonly context: vscode.ExtensionContext) {
        context.subscriptions.push({ dispose: () => { void this.stop(); } });
    }
    settings() {
        const config = vscode.workspace.getConfiguration('owlspotlight');
        return { type: 'backendSettings', backend: searchBackend(),
            model: config.get('onnxModel', MODEL_PROFILES[1].id), dtype: config.get('onnxDtype', 'q8') };
    }
    engineOptions() {
        const config = vscode.workspace.getConfiguration('owlspotlight');
        const profile = modelProfile(config.get('onnxModel', MODEL_PROFILES[1].id)) || MODEL_PROFILES[1];
        return { cacheDir: this.cacheDir, modelName: profile.id, revision: profile.revision,
            dtype: config.get<'q8' | 'fp32'>('onnxDtype', 'q8'), batchSize: 2,
            localFilesOnly: config.get<boolean>('onnxLocalFilesOnly', false) };
    }
    async search(request: SearchRequest, report: ReportProgress, signal?: AbortSignal, operation: 'search' | 'graph' | 'stats' | 'prepare' = 'search'): Promise<any> {
        if (this.busy) { throw new Error('A simple-mode search is already running.'); }
        this.busy = true;
        try { return await this.runSearch(request, report, signal, operation); }
        finally { this.busy = false; }
    }
    private async runSearch(request: SearchRequest, report: ReportProgress, signal: AbortSignal | undefined, operation: 'search' | 'graph' | 'stats' | 'prepare') {
        const config = vscode.workspace.getConfiguration('owlspotlight');
        const profile = modelProfile(config.get('onnxModel', MODEL_PROFILES[1].id));
        if (!profile) { throw new Error('Select a supported ONNX model in OwlSpotlight Settings.'); }
        const dtype = config.get<string>('onnxDtype', 'q8');
        if (dtype !== 'q8' && dtype !== 'fp32') { throw new Error('ONNX precision must be q8 or fp32.'); }
        const options = { cacheDir: this.cacheDir, modelName: profile.id, revision: profile.revision, dtype,
            batchSize: 2, localFilesOnly: config.get<boolean>('onnxLocalFilesOnly', false) } as const;
        const key = JSON.stringify(options);
        if (key !== this.key || !this.client) {
            await this.stop();
            this.client = new NodeSearchClient(options); this.key = key;
        }
        return this.client.request(operation, request, report, signal);
    }
    private get cacheDir() { return path.join(this.context.globalStorageUri.fsPath, 'node-onnx'); }
    async clearCache() {
        await this.stop();
        await rm(path.join(this.cacheDir, 'embeddings'), { recursive: true, force: true });
    }
    async stop() { const client = this.client; this.client = undefined; await client?.dispose(); }
}
