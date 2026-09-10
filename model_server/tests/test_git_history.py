"""Real merge history exercises the endpoint's patch selection and cache keys."""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import List, Optional
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from git_history import resolve_history, history_log_args


class GitHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = self.tmp.name
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.root = self.commit('root.py', 'root')
        self.git('checkout', '-b', 'side')
        self.side = self.commit('side.py', 'side')
        self.git('checkout', 'main')
        self.main = self.commit('main.py', 'main')
        self.git('merge', '--no-ff', 'side', '-m', 'merge side')
        self.merge = self.git('rev-parse', 'HEAD')
        self.tip = self.commit('tip.py', 'tip')
        names = {'sanitize_git_ref', 'normalize_glob_patterns', 'diff_signature',
                 'parse_log_patches', 'iter_commit_patches', 'git_diff_text', 'untracked_files_as_diff', 'collect_diff_hunks', 'diff_header_path',
                 'diff_file_header', 'append_line_range', 'format_line_ranges',
                 'display_diff_compare', 'short_ref'}
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'server.py').read_text())
        namespace = dict(Optional=Optional, List=List, Path=Path, re=re, subprocess=subprocess,
                         os=os, hashlib=hashlib, json=json, resolve_history=resolve_history,
                         history_log_args=history_log_args, load_gitignore_spec=lambda _: None,
                         is_ignored=lambda *args: False, path_allowed_by_globs=lambda *args: True,
                         _LOG_RECORD_SEP='\x1e', _LOG_UNIT_SEP='\x1f')
        nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
        nodes += [n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '_DIFF_HUNK_RE' for t in n.targets)]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'server.py', 'exec'), namespace)
        self.functions = namespace

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo, stderr=subprocess.DEVNULL, text=True).strip()

    def commit(self, file, content):
        Path(self.repo, file).write_text(f'{content} = 1\n')
        self.git('add', file)
        self.git('commit', '-m', content)
        return self.git('rev-parse', 'HEAD')

    def patches(self, mode='branch', first_parent=True, base='', head=''):
        base, head = resolve_history(self.repo, base, head, mode)
        return self.functions['iter_commit_patches'](self.repo, base, head, first_parent)

    def signature(self, mode='branch', first_parent=True):
        return self.functions['diff_signature'](self.repo, '.py', None, None, None, '', '', mode, first_parent)[0]

    def test_branch_includes_root_and_merge_but_skips_side_commits(self):
        patches = self.patches()
        self.assertEqual([meta['commit_hash'] for meta, _ in patches], [self.tip, self.merge, self.main, self.root])
        self.assertIn('+root = 1', patches[-1][1])
        self.assertIn('+side = 1', patches[1][1])  # merge diff versus first parent

    def test_hunk_collection_passes_history_selection(self):
        args = (self.repo, '.py', None, None, None, '', '')
        hunks, _, _, head = self.functions['collect_diff_hunks'](*args, 'branch', True)
        self.assertEqual(head, self.tip)
        self.assertEqual({h['commit_hash'] for h in hunks}, {self.root, self.main, self.merge, self.tip})
        self.assertTrue(all('First commit' in h['diff_compare'] for h in hunks))
        full, _, _, _ = self.functions['collect_diff_hunks'](*args, 'branch', False)
        self.assertIn(self.side, {h['commit_hash'] for h in full})

    def test_full_history_and_custom_exclusive_from(self):
        self.assertIn(self.side, [m['commit_hash'] for m, _ in self.patches(first_parent=False)])
        hashes = [m['commit_hash'] for m, _ in self.patches('custom', True, self.root, self.main)]
        self.assertEqual(hashes, [self.main])
        self.assertEqual(self.patches('custom', True, self.tip, self.tip), [])

    def test_cache_changes_for_traversal_and_new_tip(self):
        initial = self.signature()
        self.assertNotEqual(initial, self.signature(first_parent=False))
        self.commit('next.py', 'next')
        self.assertNotEqual(initial, self.signature())

    def test_working_tree_and_invalid_custom_range(self):
        Path(self.repo, 'tip.py').write_text('tip = 2\n')
        patches = self.patches('working_tree')
        self.assertEqual(patches[0][0]['commit_hash'], '')
        self.assertIn('+tip = 2', patches[0][1])
        with self.assertRaises(ValueError):
            resolve_history(self.repo, '', 'main', 'custom')
        with self.assertRaises(ValueError):
            resolve_history(self.repo, '--all', '', 'custom')


if __name__ == '__main__':
    unittest.main()
