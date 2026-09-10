// Local JSON bridge lets Python MCP endpoints reuse the same code snapshots,
// pagination and highlight validation as the Gemini search engine.
import { createCodeReader, codePage, verifiedHighlights } from './agentCode';

async function main() {
    let input = '';
    for await (const chunk of process.stdin) {
        input += chunk.toString();
        if (input.length > 2 * 1024 * 1024) { throw new Error('Input exceeds limit.'); }
    }
    const request = JSON.parse(input);
    if (request.action === 'read') {
        const document = await createCodeReader(request.root)(request.result);
        return { document, page: codePage(document, request.startLine ?? 1) };
    }
    if (request.action === 'page') { return { page: codePage(request.document, request.startLine) }; }
    if (request.action === 'highlights') { return { highlights: verifiedHighlights(request.highlights, request.pages) }; }
    throw new Error('Unknown code action.');
}
main().then(result => process.stdout.write(JSON.stringify(result))).catch(error => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
});
