import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { NodeSearchClient } from './client';
import type { EngineOptions, SearchRequest } from './types';
import { createCodeReader, codePage } from '../agentCode';
import * as path from 'node:path';

/** A stdio MCP process, with no HTTP listener or Python child process. */
export async function run(workspace: string, options: EngineOptions): Promise<void> {
    const client = new NodeSearchClient(options);
    const server = new Server({ name: 'owlspotlight-node', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
        { name: 'owlspotlight.search_code', description: 'Search complete functions/methods or Git diffs locally with ONNX, BM25, hybrid or literal keywords. Use English queries for semantic retrieval. Scores are similarities, not correctness guarantees.',
            inputSchema: { type: 'object', required: ['query'], properties: {
                query: { type: 'string' }, top_k: { type: 'integer', minimum: 1, maximum: 100 }, file_ext: { type: 'string', default: 'auto' },
                search_mode: { type: 'string', enum: ['semantic', 'hybrid', 'bm25', 'keyword'] },
                scope: { type: 'string', enum: ['all', 'changed'] }, search_target: { type: 'string', enum: ['functions', 'changed_functions', 'diff_hunks'] },
                diff_range_mode: { type: 'string', enum: ['branch', 'custom', 'working_tree'] }, diff_base_ref: { type: 'string' }, diff_head_ref: { type: 'string' },
                include_globs: { type: 'array', items: { type: 'string' } }, exclude_globs: { type: 'array', items: { type: 'string' } },
            } } },
        { name: 'owlspotlight.read_code', description: 'Read a source file within this workspace, with line numbers. For Git results pass commit_hash to read that version.',
            inputSchema: { type: 'object', required: ['file_path'], properties: { file_path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, commit_hash: { type: 'string' } } } },
    ] }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        try {
            const args = request.params.arguments || {};
            let result: unknown;
            if (request.params.name === 'owlspotlight.search_code') {
                if (typeof args.query !== 'string' || !args.query.trim()) { throw new Error('query must be a nonempty string'); }
                result = await client.search({ ...args, directory: workspace, query: args.query } as SearchRequest, () => {}, extra.signal);
            } else if (request.params.name === 'owlspotlight.read_code') {
                if (typeof args.file_path !== 'string') { throw new Error('file_path is required'); }
                const document = await createCodeReader(workspace)({ file_path: path.resolve(workspace, args.file_path),
                    commit_hash: typeof args.commit_hash === 'string' ? args.commit_hash : undefined });
                result = codePage(document, typeof args.start_line === 'number' ? args.start_line : 1);
            } else { throw new Error('Unknown tool'); }
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
    });
    server.onclose = () => { void client.dispose(); };
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.once(signal, () => { void client.dispose().then(() => server.close()); });
    }
    await server.connect(new StdioServerTransport());
}
