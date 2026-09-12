import sys
import ast
import math
import os
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dependency_graph import graph_neighborhood, node_id, direct_calls, align_cached_embeddings


def function(name, line, code='', owner=None, file='/repo/app.py'):
    return dict(name=name, file=file, lineno=line, end_lineno=line + 8,
                raw_code=code or f'def {name}():\n    pass', class_name=owner)


class GraphTests(unittest.TestCase):
    def test_graph_api_reuses_rescanned_embeddings_only_for_current_model(self):
        # Execute the real endpoint without loading models or starting the server.
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text(encoding='utf-8'))
        endpoint = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'dependency_graph_api')
        endpoint.decorator_list = []
        with tempfile.TemporaryDirectory() as directory:
            file = str(Path(directory) / 'app.py')
            cached = [function('run', 1, file=file)]
            config = {'model_name': 'test'}
            state = SimpleNamespace(indexer=SimpleNamespace(functions=cached), directory=directory,
                                    embeddings=np.array([[1., 0.]]), model_name='test',
                                    model_config=config, get_current_model_config=lambda: config)
            encode = Mock(return_value=np.array([[1., 0.]]))
            namespace = dict(os=os, DependencyGraphRequest=SimpleNamespace,
                             index_lock=nullcontext(), global_index_state=state,
                             build_index=lambda *args: ([dict(cached[0])], 1, None),
                             model_name='test', settings=SimpleNamespace(batch_size=1), encode_code=encode)
            exec(compile(ast.Module(body=[endpoint], type_ignores=[]), 'server.py', 'exec'), namespace)
            request = SimpleNamespace(directory=directory, file=file, line=1,
                                      file_ext='.py', query='test', similar=False)
            graph = namespace['dependency_graph_api'](request)
            self.assertEqual(graph['nodes'][0]['queryScore'], 1)
            self.assertEqual(graph['nodes'][0]['similarity'], 1)
            state.model_config = {'model_name': 'old'}
            graph = namespace['dependency_graph_api'](request)
            self.assertFalse(graph['embeddingsAvailable'])
            self.assertIsNone(graph['nodes'][0]['queryScore'])
            self.assertEqual(encode.call_count, 1)

    @unittest.skipUnless(os.name == 'nt', 'Windows path casing')
    def test_windows_graph_api_keeps_search_cache_and_resolves_same_file(self):
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text(encoding='utf-8'))
        endpoint = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'dependency_graph_api')
        endpoint.decorator_list = []
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'app.py'
            file.write_text('def run():\n    pass\n')
            search_directory = directory[0].lower() + directory[1:]
            search_file = str(file)[0].lower() + str(file)[1:]
            cached = [function('run', 1, file=search_file)]
            config = {'model_name': 'test'}
            state = SimpleNamespace(directory=search_directory, indexer=SimpleNamespace(functions=cached),
                                    embeddings=np.array([[1., 0.]]), model_name='test',
                                    model_config=config, get_current_model_config=lambda: config)
            def build(directory, *args):
                self.assertEqual(directory, search_directory, 'must use the search cache path')
                return cached, 1, state.indexer
            namespace = dict(os=os, DependencyGraphRequest=SimpleNamespace, index_lock=nullcontext(),
                             global_index_state=state, build_index=build, model_name='test',
                             settings=SimpleNamespace(batch_size=1),
                             encode_code=lambda *args, **kwargs: np.array([[1., 0.]]))
            exec(compile(ast.Module(body=[endpoint], type_ignores=[]), 'server.py', 'exec'), namespace)
            graph = namespace['dependency_graph_api'](SimpleNamespace(
                directory=os.path.realpath(directory), file=os.path.realpath(file),
                line=1, file_ext='.py', query='test', similar=False))
            self.assertTrue(graph['embeddingsAvailable'])
            self.assertEqual(graph['nodes'][0]['queryScore'], 1)
            self.assertEqual(graph['nodes'][0]['similarity'], 1)

    def test_rescanned_and_reordered_functions_keep_their_scores(self):
        cached = [function('run', 1), function('helper', 20)]
        current = [dict(cached[1], lineno=30, end_lineno=38), dict(cached[0])]
        embeddings = align_cached_embeddings(current, cached, [[1, 0], [0, 1]])
        graph = graph_neighborhood(current, current[0]['file'], 30,
                                   embeddings, [1, 0], True)
        nodes = {node['name']: node for node in graph['nodes']}
        self.assertEqual(nodes['run']['queryScore'], 1)
        self.assertEqual(nodes['helper']['queryScore'], 0)
        self.assertEqual(nodes['helper']['similarity'], 1)
        self.assertEqual(nodes['run']['similarity'], 0)

    def test_changed_new_and_invalid_cached_code_remains_unscored(self):
        cached = [function('run', 1), function('helper', 20), function('invalid', 40)]
        current = [dict(cached[0]), dict(cached[1], raw_code='def helper():\n    return 42'),
                   dict(cached[2]), function('new', 60)]
        embeddings = align_cached_embeddings(current, cached, [[1, 0], [0, 1], [math.nan, 1]])
        np.testing.assert_array_equal(embeddings, [[1, 0], [0, 0], [0, 0], [0, 0]])
        self.assertIsNone(align_cached_embeddings(current, cached, None))
        self.assertIsNone(align_cached_embeddings(current, cached, [[1, 0]]))

    def test_call_sites_preserve_indentation_unicode_and_repeated_calls(self):
        item = function('run', 10, '    def run(self):\n        x = "😀"; helper(); helper()')
        calls = direct_calls(item)
        sites = calls[0][2]
        self.assertEqual(len(sites), 2)
        self.assertEqual([s['line'] for s in sites], [11, 11])
        self.assertEqual([s['column'] for s in sites], [18, 28])
        self.assertEqual([s['endColumn'] for s in sites], [24, 34])

    def test_directions_scopes_and_unknown_calls(self):
        root = function('run', 1, 'def run(self):\n    self.save()\n    helper()\n    other.save()\n    missing()', 'Service')
        own = function('save', 20, owner='Service')
        other = function('save', 40, owner='Other')
        helper = function('helper', 60)
        graph = graph_neighborhood([root, own, other, helper], root['file'], 1)
        self.assertEqual({(e['source'], e['target']) for e in graph['edges']},
                         {(node_id(root), node_id(own)), (node_id(root), node_id(helper))})
        self.assertNotIn(node_id(other), {n['id'] for n in graph['nodes']})
        self.assertEqual(next(n for n in graph['nodes'] if n['id'] == node_id(root))['unresolved'], 2)
        incoming = graph_neighborhood([root, own, other, helper], own['file'], 20)
        self.assertIn(node_id(root), {n['id'] for n in incoming['nodes']})

    def test_nested_and_shadowed_calls_do_not_create_false_edges(self):
        root = function('run', 1, 'def run(helper):\n    def nested():\n        hidden()\n    helper()\n    nested()')
        graph = graph_neighborhood([root, function('helper', 20), function('hidden', 40)], root['file'], 1)
        self.assertEqual(graph['edges'], [])
        self.assertEqual(graph['nodes'][0]['unresolved'], 2)

    def test_same_name_in_other_file_and_ambiguous_definitions(self):
        root = function('run', 1, 'def run():\n    save()')
        graph = graph_neighborhood([root, function('save', 20), function('save', 40),
                                    function('save', 20, file='/repo/else.py')], root['file'], 1)
        self.assertEqual(graph['edges'], [])

    def test_cosine_is_independent_of_vector_norm_and_similarity_is_not_a_call(self):
        functions = [function('run', 1), function('similar', 20), function('unrelated', 40)]
        vectors = np.array([[10, 0], [4, 0], [0, 9]])
        graph = graph_neighborhood(functions, '/repo/app.py', 1, vectors, np.array([0, 3]), True)
        by_name = {n['name']: n for n in graph['nodes']}
        self.assertEqual(by_name['similar']['similarity'], 1)
        self.assertEqual(by_name['run']['queryScore'], 0)
        self.assertEqual(by_name['unrelated']['queryScore'], 1)
        self.assertTrue(all(e['kind'] == 'similar' for e in graph['edges']))
        self.assertEqual(graph['edges'][0]['target'], node_id(functions[1]))

    def test_embedding_sized_vectors_match_scalar_cosine_without_runtime_warnings(self):
        functions = [function('run', 1), function('other', 20)]
        vectors = np.random.default_rng(42).normal(size=(2, 768)).astype(np.float32)
        query = np.random.default_rng(43).normal(size=768).astype(np.float32)
        def cosine(a, b):
            a, b = list(map(float, a)), list(map(float, b))
            return math.fsum(x*y for x, y in zip(a, b)) / math.sqrt(math.fsum(x*x for x in a)*math.fsum(y*y for y in b))
        with np.errstate(divide='raise', over='raise', invalid='raise'):
            graph = graph_neighborhood(functions, '/repo/app.py', 1, vectors, query, True)
        other = next(n for n in graph['nodes'] if n['name'] == 'other')
        self.assertAlmostEqual(other['similarity'], cosine(vectors[0], vectors[1]), places=12)
        self.assertAlmostEqual(other['queryScore'], cosine(vectors[1], query), places=12)

    def test_extreme_and_invalid_vectors_do_not_warn_or_create_nan_scores(self):
        functions = [function('run', 1, 'def run():\n    bad()\n    zero()'),
                     function('same', 20), function('bad', 40), function('zero', 60)]
        for magnitude in (1e308, 1e-300):
            with np.errstate(divide='raise', over='raise', invalid='raise'):
                graph = graph_neighborhood(functions, '/repo/app.py', 1,
                    [[magnitude, magnitude], [1, 1], [np.nan, np.inf], [0, 0]],
                    [magnitude, magnitude], True)
            nodes = {n['name']: n for n in graph['nodes']}
            self.assertAlmostEqual(nodes['same']['similarity'], 1)
            self.assertAlmostEqual(nodes['run']['queryScore'], 1)
            for name in ('bad', 'zero'):
                self.assertIsNone(nodes[name]['similarity'])
                self.assertIsNone(nodes[name]['queryScore'])
            self.assertEqual([e['target'] for e in graph['edges'] if e['kind'] == 'similar'],
                             [node_id(functions[1])])

    def test_invalid_root_query_and_dimensions_remain_unscored(self):
        functions = [function('run', 1), function('other', 20)]
        with np.errstate(divide='raise', over='raise', invalid='raise'):
            for query in ([np.inf, 1], [0, 0], [1, 2, 3]):
                graph = graph_neighborhood(functions, '/repo/app.py', 1,
                    [[1, 0], [0, 1]], query, True)
                self.assertTrue(all(n['queryScore'] is None for n in graph['nodes']))
            graph = graph_neighborhood(functions, '/repo/app.py', 1,
                [[np.nan, 0], [0, 1]], [0, 1], True)
            self.assertEqual(graph['edges'], [])
            self.assertIsNone(graph['nodes'][0]['similarity'])
            for vectors in ([[1, 0]], [1, 2], [[], []], [[1], [1, 2]], [[0, 0], [np.inf, 0]]):
                graph = graph_neighborhood(functions, '/repo/app.py', 1, vectors, similar=True)
                self.assertFalse(graph['embeddingsAvailable'])
                self.assertIsNone(graph['nodes'][0]['similarity'])

    def test_missing_embeddings_and_missing_source_are_explicit(self):
        root = function('run', 1)
        graph = graph_neighborhood([root], root['file'], 1, similar=True)
        self.assertFalse(graph['embeddingsAvailable'])
        self.assertIsNone(graph['nodes'][0]['queryScore'])
        with self.assertRaisesRegex(ValueError, 'not in the current index'):
            graph_neighborhood([root], '/repo/missing.py', 1)

    def test_node_limit_and_self_recursion(self):
        calls = '\n'.join(f'    f{i}()' for i in range(100))
        root = function('run', 1, 'def run():\n    run()\n' + calls)
        functions = [root] + [function(f'f{i}', 200 + i * 10) for i in range(100)]
        graph = graph_neighborhood(functions, root['file'], 1)
        self.assertEqual(len(graph['nodes']), 60)
        self.assertTrue(graph['truncated'])
        self.assertTrue(any(e['source'] == e['target'] for e in graph['edges']))


if __name__ == '__main__':
    unittest.main()
