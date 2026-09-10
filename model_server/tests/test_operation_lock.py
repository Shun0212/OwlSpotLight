"""Exercise the real endpoint bodies without downloading/loading an ML model."""
import ast
import asyncio
import json
from pathlib import Path
import sys
from threading import Event, Lock
import unittest
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel
import progress
from operation_lock import OperationLock


class OperationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.gate = OperationLock()
        self.started = Event()
        self.release = Event()
        self.fail = False

        def build(*args, **kwargs):
            self.started.set()
            if not self.release.wait(3):
                raise RuntimeError('Worker was not released')
            if self.fail:
                raise ValueError('test failure')
            progress.raise_if_cancelled()
            return [], 0, None

        self.app = FastAPI()
        namespace = dict(app=self.app, operations=self.gate, progress=progress,
                         BaseModel=BaseModel, Body=Body, HTTPException=HTTPException, List=List, Optional=Optional, index_lock=Lock(), build_index=build,
                         print=lambda *args: None)
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text())
        names = {'BuildIndexRequest', 'build_index_api', 'cancel_embedding', 'index_progress',
                 'EmbedRequest', 'embed', 'PrepareDiffSearchRequest', 'prepare_diff_search_api',
                 'SearchFunctionsSimpleRequest', 'search_functions_simple_api'}
        nodes = [n for n in tree.body if getattr(n, 'name', '') in names]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'server.py', 'exec'), namespace)
        self.build = namespace['build_index_api']
        self.request = namespace['BuildIndexRequest'](directory='/test')

    async def request_api(self, path, body=None):
        messages = []
        async def receive():
            return {'type': 'http.request', 'body': json.dumps(body or {}).encode(), 'more_body': False}
        async def send(message):
            messages.append(message)
        await self.app({'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1',
                        'method': 'GET' if path == '/index_progress' else 'POST',
                        'scheme': 'http', 'path': path, 'raw_path': path.encode(),
                        'query_string': b'', 'headers': [(b'content-type', b'application/json')],
                        'server': ('test', 80), 'client': ('test', 1), 'root_path': ''}, receive, send)
        status = next(m['status'] for m in messages if m['type'] == 'http.response.start')
        data = b''.join(m.get('body', b'') for m in messages if m['type'] == 'http.response.body')
        return status, json.loads(data)

    async def test_duplicate_progress_and_cancel_remain_responsive(self):
        running = asyncio.create_task(self.request_api('/build_index', {'directory': '/test'}))
        try:
            self.assertTrue(await asyncio.to_thread(self.started.wait, 2))
            code, data = await asyncio.wait_for(self.request_api('/build_index', {'directory': '/test'}), 1)
            self.assertEqual(code, 409)
            self.assertTrue(data['detail']['busy'])
            for path, body in [('/embed', {'texts': ['test']}),
                               ('/prepare_diff_search', {'directory': '/test'}),
                               ('/search_functions_simple', {'directory': '/test', 'query': 'test'})]:
                code, _ = await asyncio.wait_for(self.request_api(path, body), 1)
                self.assertEqual(code, 409, path)
            code, data = await asyncio.wait_for(self.request_api('/index_progress'), 1)
            self.assertTrue(data['busy'])
            await asyncio.wait_for(self.request_api('/cancel_embedding'), 1)
            self.assertTrue(progress.is_cancelled())
            # Rejected operations must not erase cancellation.
            code, _ = await self.request_api('/build_index', {'directory': '/test'})
            self.assertEqual(code, 409)
            self.assertTrue(progress.is_cancelled())
        finally:
            self.release.set()
            code, data = await running
        self.assertTrue(data['cancelled'])
        self.assertFalse(self.gate.snapshot()['busy'])
        code, data = await self.request_api('/build_index', {'directory': '/test'})
        self.assertEqual(code, 200)
        self.assertNotIn('cancelled', data)

    async def test_stop_during_final_step_discards_result_and_recovers(self):
        @self.gate.exclusive
        def search():
            progress.request_cancel()
            return {"results": ["late result"]}
        result = search()
        self.assertTrue(result["cancelled"])
        self.assertNotIn("results", result)
        self.assertFalse(self.gate.snapshot()["busy"])
        @self.gate.exclusive
        def next_search():
            return {"results": ["new result"]}
        self.assertEqual(next_search()["results"], ["new result"])

    async def test_scoped_cancel_does_not_stop_other_operation(self):
        running = asyncio.create_task(self.request_api('/build_index', {'directory': '/test', 'operation_id': 'sidebar'}))
        try:
            self.assertTrue(await asyncio.to_thread(self.started.wait, 2))
            _, data = await self.request_api('/cancel_embedding', {'operation_id': 'old-codex-request'})
            self.assertFalse(data['cancel_requested'])
            self.assertFalse(progress.is_cancelled())
            _, data = await self.request_api('/cancel_embedding', {'operation_id': 'sidebar'})
            self.assertTrue(data['cancel_requested'])
            self.assertTrue(progress.is_cancelled())
        finally:
            self.release.set()
            await running

    async def test_cancel_before_search_arrives_is_not_lost(self):
        await self.request_api('/cancel_embedding', {'operation_id': 'early'})
        self.release.set()
        _, result = await self.request_api('/build_index', {'directory': '/test', 'operation_id': 'early'})
        self.assertTrue(result['cancelled'])
        self.assertFalse(self.started.is_set())
        _, result = await self.request_api('/build_index', {'directory': '/test', 'operation_id': 'next'})
        self.assertNotIn('cancelled', result)

    async def test_failure_releases_lock(self):
        self.release.set()
        self.fail = True
        with self.assertRaises(ValueError):
            await asyncio.to_thread(self.build, self.request)
        self.assertFalse(self.gate.snapshot()['busy'])
        self.fail = False
        self.assertEqual((await self.request_api('/build_index', {'directory': '/test'}))[0], 200)

    async def test_different_operations_share_gate(self):
        @self.gate.exclusive
        def other():
            return 'ok'
        running = asyncio.create_task(asyncio.to_thread(self.build, self.request))
        try:
            self.assertTrue(await asyncio.to_thread(self.started.wait, 2))
            with self.assertRaises(HTTPException) as error:
                other()
            self.assertEqual(error.exception.status_code, 409)
        finally:
            self.release.set()
            await running
        self.assertEqual(other(), 'ok')


if __name__ == '__main__':
    unittest.main()
