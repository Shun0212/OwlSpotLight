import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gitdiff import Snapshot, make_hunks, matches_path, validate_ref, SearchError
from symbols import python_symbols, changed_functions, extract_symbols
from ranking import bm25_scores, rank_units, split_text, tokenize
from engine import Engine


class CoreTests(unittest.TestCase):
    def snapshot(self, before, after, name="example.py"):
        return Snapshot(name, name, before, after, "base", "head")

    def test_hunk_counts_include_lines_starting_with_diff_markers(self):
        hunks = make_hunks(self.snapshot("++old\n--old\n", "++new\n--new\n"))
        self.assertEqual(len(hunks), 1)
        self.assertEqual(hunks[0]["added"], [1, 2])
        self.assertEqual(hunks[0]["removed"], [1, 2])
        self.assertIn("+++new", hunks[0]["text"])

    def test_separate_hunks_keep_real_line_numbers(self):
        lines = [f"line {i}" for i in range(30)]
        changed = lines.copy()
        changed[1], changed[26] = "early", "late"
        hunks = make_hunks(self.snapshot("\n".join(lines), "\n".join(changed)))
        self.assertEqual([h["new_line"] for h in hunks], [2, 27])

    def test_deleted_file_has_old_side_and_real_line(self):
        snapshot = Snapshot("gone.py", None, "delete_me\n", "", "old", "new")
        result = make_hunks(snapshot)[0]
        self.assertEqual(result["side"], "old")
        self.assertEqual(result["old_line"], 1)
        self.assertIn("+++ /dev/null", result["text"])

    def test_newline_only_change_is_searchable(self):
        self.assertTrue(make_hunks(self.snapshot("value", "value\n")))

    def test_include_glob_matches_root_and_nested_paths(self):
        self.assertTrue(matches_path("root.py", "**/*.py"))
        self.assertTrue(matches_path("src/deep/main.py", "**/*.py,**/*.ts"))
        self.assertFalse(matches_path("readme.md", "**/*.py"))

    def test_camel_case_and_japanese_terms(self):
        self.assertIn("retry", tokenize("maxRetryCount"))
        self.assertTrue(bm25_scores(["認証処理を修正", "画像を処理"], "認証"))

    def test_bm25_no_match_returns_no_results(self):
        self.assertEqual(rank_units([{"text": "foo"}], "missing", "bm25", None), [])

    def test_keyword_requires_all_terms(self):
        units = [{"text": "retry request"}, {"text": "retry response"}, {"text": "REQUEST Retry"}]
        result = rank_units(units, "RETRY request", "keyword", None)
        self.assertEqual([r[0] for r in result], [0, 2])

    def test_blank_query_does_not_load_model(self):
        self.assertEqual(len(rank_units([{"text": "code"}], "", "hybrid", None)), 1)

    def test_hybrid_uses_semantic_and_lexical_evidence(self):
        class FakeDense:
            def score(self, texts, query, progress):
                return {0: 0.95, 1: 0.1}
        result = rank_units([{"text": "changed logic"}, {"text": "retry retry"}],
                            "retry", "hybrid", FakeDense())
        self.assertTrue(all(0 <= item[1] <= 1 for item in result))
        self.assertEqual(len(result), 2)

    def test_chunks_retain_tail_of_large_documents(self):
        pieces = split_text("start\n" + "x\n" * 5000 + "TAIL_SENTINEL")
        self.assertGreater(len(pieces), 1)
        self.assertTrue(pieces[-1].endswith("TAIL_SENTINEL"))
        self.assertTrue(all(len(piece) <= 4000 for piece in pieces))

    def test_only_changed_function_is_selected(self):
        before = "def first():\n    return 1\n\ndef second():\n    return 2\n"
        after = before.replace("return 2", "return 3")
        snap = self.snapshot(before, after)
        self.assertEqual([f["title"] for f in changed_functions(snap, make_hunks(snap))], ["second"])

    def test_deleted_function_is_searchable_from_old_snapshot(self):
        before = "def removed():\n    return 'obsolete'\n\ndef stable():\n    return 1\n"
        after = "def stable():\n    return 1\n"
        snap = self.snapshot(before, after)
        matches = changed_functions(snap, make_hunks(snap))
        self.assertTrue(any(m["title"] == "removed" and m["side"] == "old" for m in matches))

    def test_decorator_change_belongs_to_function(self):
        snap = self.snapshot("@old\ndef route():\n    pass\n", "@new\ndef route():\n    pass\n")
        matches = changed_functions(snap, make_hunks(snap))
        self.assertEqual(matches[0]["title"], "route")
        self.assertEqual(matches[0]["new_line"], 1)

    def test_nested_methods_have_distinct_names(self):
        source = "class A:\n    def go(self):\n        def inner():\n            pass\nclass B:\n    def go(self):\n        pass\n"
        self.assertEqual([s["name"] for s in python_symbols(source)], ["A.go", "A.go.inner", "B.go"])

    def test_ref_option_injection_is_rejected(self):
        for ref in ("-h", "HEAD --all", "HEAD\0tail"):
            with self.assertRaises(SearchError):
                validate_ref(ref)

    def test_typescript_arrow_and_method(self):
        try:
            import tree_sitter_language_pack
        except ImportError:
            self.skipTest("Parser dependency not installed")
        items = extract_symbols("export const retry = () => 3;\nclass A { run() { return 1; } }", "app.ts")
        self.assertIn("retry", [item["name"] for item in items])
        self.assertIn("A.run", [item["name"] for item in items])

    def test_java_constructor_and_method(self):
        try:
            import tree_sitter_language_pack
        except ImportError:
            self.skipTest("Parser dependency not installed")
        items = extract_symbols("class A { A() {} int run() { return 1; } }", "A.java")
        self.assertIn("A.run", [item["name"] for item in items])
        self.assertIn("A.A", [item["name"] for item in items])


@unittest.skipUnless(shutil.which("git"), "Git is required for integration tests")
class GitIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.git("init", "-q")
        self.write("app.py", "def stable():\n    return 1\n")
        self.commit("baseline")
        self.base = self.git("rev-parse", "HEAD").strip()
        self.engine = Engine()

    def tearDown(self):
        self.temporary.cleanup()

    def git(self, *args):
        return subprocess.check_output(["git", "-c", "user.name=Tests",
            "-c", "user.email=tests@example.invalid", *args], cwd=self.root,
            stderr=subprocess.STDOUT).decode("utf-8")

    def write(self, filename, value):
        target = self.root / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value, encoding="utf-8")

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-qm", message)

    def search(self, **options):
        return self.engine.search({"directory": str(self.root), "mode": "keyword",
                                   "target": "hunks", "comparison": "working", **options})

    def test_staged_unstaged_and_untracked_are_included(self):
        self.write("app.py", "def stable():\n    return 'staged'\n")
        self.git("add", ".")
        self.write("app.py", "def stable():\n    return 'unstaged'\n")
        self.write("new.py", "untracked_marker = 1\n")
        results = self.search(query="")["results"]
        self.assertEqual({r["path"] for r in results}, {"app.py", "new.py"})
        self.assertTrue(any("unstaged" in r["preview"] for r in results))
        self.assertEqual({r["path"] for r in self.search(untracked=False)["results"]}, {"app.py"})

    def test_git_ignored_untracked_file_is_excluded(self):
        self.write(".gitignore", "ignored.py\n")
        self.write("ignored.py", "secret_marker\n")
        self.write("visible.py", "secret_marker\n")
        self.assertEqual({r["path"] for r in self.search(query="secret_marker")["results"]}, {"visible.py"})

    def test_historical_comparison_does_not_read_current_file(self):
        self.write("app.py", "def stable():\n    return 'historical'\n")
        self.commit("historical update")
        head = self.git("rev-parse", "HEAD").strip()
        self.write("app.py", "current_only\n")
        response = self.search(comparison="range", base=self.base, head=head, query="historical")
        self.assertEqual(len(response["results"]), 1)
        doc = self.engine.document(response["results"][0]["id"])
        self.assertIn("historical", doc["new_text"])
        self.assertNotIn("current_only", doc["new_text"])

    def test_working_snapshot_remains_stable_after_disk_edit(self):
        self.write("app.py", "captured_marker\n")
        response = self.search(query="captured_marker")
        self.write("app.py", "later_marker\n")
        doc = self.engine.document(response["results"][0]["id"])
        self.assertIn("captured_marker", doc["new_text"])
        self.assertNotIn("later_marker", doc["new_text"])

    def test_history_finds_reverted_changes_while_endpoints_do_not(self):
        baseline = (self.root / "app.py").read_text()
        self.write("app.py", baseline + "\ndef transient():\n    return 'transient_marker'\n")
        self.commit("add temporary code")
        self.write("app.py", baseline)
        self.commit("remove temporary code")
        history = self.search(comparison="history", base=self.base, head="HEAD", query="transient_marker")
        self.assertEqual(len(history["results"]), 2)
        self.assertTrue(all(r["commit"] for r in history["results"]))
        endpoints = self.search(comparison="range", base=self.base, head="HEAD", query="transient_marker")
        self.assertEqual(endpoints["results"], [])

    def test_deleted_function_found_in_old_commit_content(self):
        self.write("app.py", "def stable():\n    return 1\n\ndef obsolete():\n    return 'OLD_TOKEN'\n")
        self.commit("old function")
        base = self.git("rev-parse", "HEAD").strip()
        self.write("app.py", "def stable():\n    return 1\n")
        self.commit("delete function")
        response = self.search(comparison="range", base=base, head="HEAD", query="OLD_TOKEN", target="functions")
        self.assertEqual(response["results"][0]["title"], "obsolete")
        self.assertEqual(response["results"][0]["side"], "old")

    def test_rename_with_content_edit_and_spaces(self):
        self.write("old name.py", "def hello():\n    return 1\n")
        self.commit("add file")
        self.git("mv", "old name.py", "新 name.py")
        self.write("新 name.py", "def hello():\n    return 1\n\nrename_marker = 2\n")
        result = self.search(query="rename_marker")["results"][0]
        self.assertEqual(result["path"], "新 name.py")
        doc = self.engine.document(result["id"])
        self.assertEqual(doc["old_path"], "old name.py")

    @unittest.skipIf(os.name == "nt", "POSIX filename and symlink test")
    def test_unusual_filename_and_outside_symlink(self):
        self.write("odd\t[x].py", "filename_marker\n")
        result = self.search(query="filename_marker")["results"]
        self.assertEqual(result[0]["path"], "odd\t[x].py")
        self.git("add", ".")
        self.git("commit", "-qm", "unusual name")
        self.write("odd\t[x].py", "filename_marker_changed\n")
        self.assertEqual(self.search(query="filename_marker_changed")["results"][0]["path"], "odd\t[x].py")
        (self.root / "link.py").symlink_to("/etc/passwd")
        response = self.search(query="root")
        self.assertFalse(any(r["path"] == "link.py" for r in response["results"]))

    def test_file_and_commit_limits_are_explicit_errors(self):
        self.write("a.py", "a\n")
        self.write("b.py", "b\n")
        with self.assertRaises(SearchError):
            self.search(query="", max_files=1)

    def test_invalid_refs_never_fall_back_to_working_tree(self):
        with self.assertRaises(SearchError):
            self.search(comparison="range", base="not-a-real-ref", head="HEAD")

    def test_unborn_repository_includes_latest_staged_file_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.check_call(["git", "init", "-q", directory])
            (root / "first.py").write_text("staged_old\n")
            subprocess.check_call(["git", "add", "."], cwd=root)
            (root / "first.py").write_text("fresh_marker\n")
            (root / "extra.py").write_text("fresh_marker\n")
            response = self.engine.search({"directory": directory, "mode": "keyword",
                                          "query": "fresh_marker", "untracked": False})
            self.assertEqual([r["path"] for r in response["results"]], ["first.py"])


if __name__ == "__main__":
    unittest.main()
