import { parentPort, workerData } from 'node:worker_threads';
import { SearchEngine } from './engine';

const engine = new SearchEngine(workerData, progress => parentPort!.postMessage({ progress }));
parentPort!.on('message', async ({ operation, request }) => {
    try { parentPort!.postMessage({ result: operation === 'graph' ? await engine.graph(request) : operation === 'stats' ? await engine.stats(request)
        : operation === 'prepare' ? await engine.prepare(request) : await engine.search(request) }); }
    catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
});
