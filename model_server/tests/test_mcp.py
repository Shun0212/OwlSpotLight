"""MCP lifecycle regressions; no model downloads or external API calls."""
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mcp_server as mcp
from agent_cards import AgentCards


class MixedLanguageTests(unittest.TestCase):
    def test_auto_keeps_all_languages_and_scope_filters(self):
        with tempfile.TemporaryDirectory() as root:
            src = Path(root) / 'src'
            src.mkdir()
            for name in ('app.py', 'client.js', 'types.ts', 'notes.txt'):
                (src / name).write_text('example')
            (Path(root) / '.owlignore').write_text('src/types.ts\n')
            extension, counts = mcp.resolve_file_ext(root, 'auto', 'all')
            self.assertEqual(extension, 'auto')
            self.assertEqual(counts['.py'], 1)
            self.assertEqual(counts['.js'], 1)
            self.assertEqual({Path(f).suffix for f in mcp.source_files(root, extension)}, {'.py', '.js'})
            self.assertEqual({Path(f).suffix for f in mcp.source_files(root, '.js')}, {'.js'})
            self.assertEqual({Path(f).suffix for f in mcp.glob_filtered_files(root, extension, ['src/**'], [])}, {'.py', '.js'})


class McpTests(unittest.TestCase):
    def test_initialize_and_tools_include_provider_independent_cards(self):
        result = mcp.handle_request({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'codex'}}})
        self.assertEqual(result['result']['serverInfo']['name'], 'owlspotlight-mcp')
        names = {tool['name'] for tool in mcp.handle_request({'id': 2, 'method': 'tools/list'})['result']['tools']}
        self.assertIn('owlspotlight.read_code', names)
        self.assertIn('owlspotlight.publish_result_annotations', names)

    def test_unknown_or_finished_cancellation_does_not_reach_server(self):
        with patch.object(mcp, 'call_cancel_embedding') as cancel:
            mcp.handle_request({'method': 'notifications/cancelled', 'params': {'requestId': 'absent'}})
            cancel.assert_not_called()

    def test_active_cancellation_is_scoped_to_request_and_server(self):
        started = threading.Event()
        release = threading.Event()
        cancelled = threading.Event()
        calls = []
        def tool(name, arguments):
            started.set()
            release.wait(2)
            return {'content': []}
        def cancel(arguments):
            calls.append(arguments)
            cancelled.set()
        try:
            with patch.object(mcp, 'call_tool', tool), patch.object(mcp, 'call_cancel_embedding', cancel), patch.object(mcp, 'write_message') as output:
                mcp.handle_request({'id': 'active', 'method': 'tools/call', 'params': {
                    'name': 'owlspotlight.search_code', 'arguments': {'query': 'test', 'server_url': 'http://127.0.0.1:8999'}}})
                self.assertTrue(started.wait(1))
                state = mcp._active_requests['active']
                mcp.handle_request({'method': 'notifications/cancelled', 'params': {'requestId': 'active'}})
                self.assertTrue(cancelled.wait(1))
                self.assertEqual(calls, [{'operation_id': state['operation_id'], 'server_url': 'http://127.0.0.1:8999'}])
                release.set()
                self.assertTrue(state['done'].wait(1))
                output.assert_not_called()  # No late success after cancellation.
        finally:
            release.set()

    def test_cancelled_and_busy_are_not_empty_successful_searches(self):
        with tempfile.TemporaryDirectory() as root:
            args = {'directory': root, 'query': 'auth', 'file_ext': '.py'}
            with patch.object(mcp, 'post_json', return_value={'cancelled': True}):
                result = mcp.call_search(args)
                self.assertTrue(result['isError'])
                self.assertEqual(result['structuredContent']['status'], 'cancelled')
                self.assertNotIn('alternate queries', result['content'][0]['text'])
            with patch.object(mcp, 'post_json', side_effect=HTTPError('test', 409, 'busy', {}, io.BytesIO())):
                result = mcp.call_search(args)
                self.assertTrue(result['isError'])
                self.assertEqual(result['structuredContent']['status'], 'busy')

    def test_unscoped_mcp_stop_is_rejected(self):
        with patch.object(mcp, 'post_json') as post:
            self.assertTrue(mcp.call_cancel_embedding({})['isError'])
            post.assert_not_called()

    def test_progress_uses_client_token_and_reports_operation_id(self):
        class Done:
            def __init__(self):
                self.count = 0
            def wait(self, seconds):
                self.count += 1
                return self.count > 1
        with patch.object(mcp, 'write_message') as output:
            mcp.report_progress({'done': Done(), 'cancelled': threading.Event(), 'operation_id': 'test-operation'}, 'client-token')
            message = output.call_args.args[0]
            self.assertEqual(message['params']['progressToken'], 'client-token')
            self.assertIn('test-operation', message['params']['message'])

    def test_network_timeout_cancels_only_its_own_operation(self):
        state = {'operation_id': 'timed-out', 'cancelled': threading.Event()}
        with tempfile.TemporaryDirectory() as root:
            with patch.object(mcp._request_context, 'state', state, create=True), patch.object(mcp, 'post_json', side_effect=TimeoutError('timeout')), patch.object(mcp, 'call_cancel_embedding') as cancel:
                result = mcp.call_search({'directory': root, 'file_ext': '.py', 'query': 'auth', 'server_url': 'http://127.0.0.1:9001'})
                self.assertTrue(result['isError'])
                cancel.assert_called_once_with({'operation_id': 'timed-out', 'server_url': 'http://127.0.0.1:9001'})

    def test_cards_use_shared_snapshot_and_highlight_validation(self):
        with tempfile.TemporaryDirectory() as root:
            filename = Path(root) / 'auth.py'
            filename.write_text('def auth():\n    return True\n')
            event = {'id': 10, 'directory': root, 'results': [{'file': str(filename)}]}
            cards = AgentCards()
            with self.assertRaises(ValueError):
                cards.annotate(event, '1', 'title', 'reason', [])
            page = cards.read(event, '1')
            self.assertEqual(page['lines'][0], 'def auth():')
            filename.write_text('changed after snapshot')
            self.assertEqual(cards.read(event, '1')['lines'], page['lines'])
            result = cards.annotate(event, '1', '認証', 'ここを確認', [
                {'startLine': 1, 'endLine': 2, 'color': 'blue', 'label': '認証処理'}])
            self.assertEqual(result['agent_highlights'][0]['color'], 'blue')
            for highlight in [{'startLine': 1, 'endLine': 100, 'color': 'blue', 'label': 'bad'},
                              {'startLine': 1, 'endLine': 1, 'color': 'red;evil', 'label': 'bad'}]:
                with self.assertRaises(ValueError):
                    cards.annotate(event, '1', 'x', 'x', [highlight])
            with self.assertRaises(ValueError):
                cards.read(event, '../../secret')


if __name__ == '__main__':
    unittest.main()
