"""Real stdio + local HTTP transport, with a deterministic search worker."""
import ast
import asyncio
import json
import os
from pathlib import Path
from queue import Queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from agent_cards import AgentCards
from operation_lock import OperationLock
import progress


class StdioTests(unittest.TestCase):
    def test_search_cards_scoped_events_and_cancellation_over_stdio(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'auth.py'
            source.write_text('def auth():\n    return True\n')
            events = [{'id': 1, 'directory': root, 'query': 'auth', 'results': [{'file': str(source), 'lineno': 1, 'code': source.read_text()}]},
                      {'id': 2, 'directory': root + '-other', 'query': 'other', 'results': []}]
            gate = OperationLock()
            started, release = threading.Event(), threading.Event()
            namespace = dict(app=FastAPI(), BaseModel=BaseModel, Optional=Optional, AgentCards=AgentCards,
                             agent_cards=AgentCards(), agent_search_events=events, agent_event_lock=threading.Lock(),
                             os=os, subprocess=subprocess, HTTPException=HTTPException)
            names = {'AgentCodeRequest', 'AgentAnnotationRequest', 'scoped_agent_event', 'find_agent_search_event',
                     'agent_read_code_api', 'agent_result_annotations_api', 'agent_search_events_api'}
            tree = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text())
            exec(compile(ast.Module(body=[node for node in tree.body if getattr(node, 'name', '') in names], type_ignores=[]), 'server.py', 'exec'), namespace)

            @gate.exclusive
            def search(req):
                if req.query == 'slow':
                    started.set()
                    while not release.wait(.02):
                        progress.raise_if_cancelled()
                return {'results': events[0]['results'], 'agent_event_id': 1}

            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *args):
                    pass

                def do_GET(self):
                    args = parse_qs(urlparse(self.path).query)
                    result = asyncio.run(namespace['agent_search_events_api'](directory=args.get('directory', [None])[0]))
                    self.respond(200, result)

                def do_POST(self):
                    data = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
                    try:
                        if self.path == '/search_functions_simple':
                            req = type('Request', (), data)()
                            result = search(req)
                        elif self.path == '/cancel_embedding':
                            result = gate.cancel(data.get('operation_id'))
                        elif self.path == '/agent_read_code':
                            result = namespace['agent_read_code_api'](namespace['AgentCodeRequest'](**data))
                        elif self.path == '/agent_result_annotations':
                            result = namespace['agent_result_annotations_api'](namespace['AgentAnnotationRequest'](**data))
                        else:
                            raise HTTPException(404, 'Unknown route')
                        self.respond(200, result)
                    except HTTPException as error:
                        self.respond(error.status_code, {'detail': error.detail})

                def respond(self, status, result):
                    data = json.dumps(result).encode()
                    self.send_response(status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)

            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f'http://127.0.0.1:{server.server_port}'
            script = Path(__file__).resolve().parents[1] / 'mcp_server.py'
            process = subprocess.Popen([sys.executable, str(script)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True, env={**os.environ, 'OWLSPOTLIGHT_WORKSPACE': root,
                                       'OWLSPOTLIGHT_SERVER_URL': url})
            messages = Queue()
            reader = threading.Thread(target=lambda: [messages.put(json.loads(line)) for line in process.stdout], daemon=True)
            reader.start()
            def send(message):
                process.stdin.write(json.dumps({'jsonrpc': '2.0', **message}) + '\n')
                process.stdin.flush()
            def call(id, name, arguments):
                send({'id': id, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}})
                response = messages.get(timeout=5)
                self.assertEqual(response['id'], id)
                return response['result']
            try:
                send({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'codex-fixture'}}})
                self.assertIn('serverInfo', messages.get(timeout=5)['result'])
                send({'id': 2, 'method': 'tools/list'})
                self.assertEqual(len(messages.get(timeout=5)['result']['tools']), 7)
                result = call(3, 'owlspotlight.search_code', {'query': 'auth', 'file_ext': '.py'})
                self.assertFalse(result['isError'])
                self.assertEqual(result['structuredContent']['resolved_arguments']['diff_range_mode'], 'branch')
                result = call(4, 'owlspotlight.read_code', {'event_id': 1, 'result_id': '1'})
                self.assertEqual(result['structuredContent']['page']['lines'][0], 'def auth():')
                result = call(5, 'owlspotlight.publish_result_annotations', {'event_id': 1, 'result_id': '1',
                              'title': '認証', 'reason': 'ここを確認', 'highlights': [{'startLine': 1, 'endLine': 2, 'color': 'green', 'label': '入口'}]})
                self.assertFalse(result['isError'])
                self.assertEqual(events[0]['results'][0]['agent_highlights'][0]['color'], 'green')
                result = call(6, 'owlspotlight.read_code', {'event_id': 2, 'result_id': '1'})
                self.assertTrue(result['isError'])
                filtered = asyncio.run(namespace['agent_search_events_api'](directory=root))
                self.assertEqual([event['id'] for event in filtered['events']], [1])
                send({'id': 7, 'method': 'tools/call', 'params': {'name': 'owlspotlight.search_code', 'arguments': {'query': 'slow', 'file_ext': '.py'}}})
                self.assertTrue(started.wait(5))
                send({'method': 'notifications/cancelled', 'params': {'requestId': 3}})  # Finished request.
                send({'id': 8, 'method': 'ping'})
                self.assertEqual(messages.get(timeout=5)['id'], 8)
                self.assertFalse(progress.is_cancelled())
                send({'method': 'notifications/cancelled', 'params': {'requestId': 7}})
                deadline = time.monotonic() + 3
                while gate.snapshot()['busy'] and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertFalse(gate.snapshot()['busy'])
                send({'id': 9, 'method': 'ping'})
                self.assertEqual(messages.get(timeout=5)['id'], 9)  # No late search result.
            finally:
                release.set()
                process.stdin.close()
                process.wait(timeout=5)
                process.stdout.close()
                process.stderr.close()
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
