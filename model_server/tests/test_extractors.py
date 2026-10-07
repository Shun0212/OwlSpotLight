import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extractors import extract_functions


class JsTsExtractorTests(unittest.TestCase):
    def extract_from_temp_file(self, suffix: str, source: str):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / f"sample{suffix}"
            path.write_text(textwrap.dedent(source).lstrip(), encoding="utf-8")
            return extract_functions(path)

    def test_javascript_function_and_class_method(self):
        functions = self.extract_from_temp_file(
            ".js",
            """
            function validateEmail(value) {
              return value.includes("@");
            }

            class Mailer {
              sendMessage() {
                return true;
              }
            }
            """,
        )

        names = {function["name"] for function in functions}
        self.assertIn("validateEmail", names)
        self.assertIn("sendMessage", names)
        method = next(function for function in functions if function["name"] == "sendMessage")
        self.assertEqual(method["class_name"], "Mailer")

    def test_tsx_function_and_class_method(self):
        functions = self.extract_from_temp_file(
            ".tsx",
            """
            export function UserCard() {
              return <div>User</div>;
            }

            class UserPresenter {
              renderName() {
                return "name";
              }
            }
            """,
        )

        names = {function["name"] for function in functions}
        self.assertIn("UserCard", names)
        self.assertIn("renderName", names)
        method = next(function for function in functions if function["name"] == "renderName")
        self.assertEqual(method["class_name"], "UserPresenter")

    def test_python_static_metadata_and_code_blocks(self):
        functions = self.extract_from_temp_file(
            ".py",
            """
            import pathlib

            @decorator
            def load_user(path: str) -> dict:
                \"\"\"Load a user from disk.\"\"\"
                data = pathlib.Path(path).read_text()
                return {"data": data}

            config = pathlib.Path("config.toml").read_text()

            if __name__ == "__main__":
                print(load_user("user.json"))
            """,
        )

        names = {function["name"] for function in functions}
        self.assertIn("load_user", names)
        function = next(item for item in functions if item["name"] == "load_user")
        self.assertEqual(function["symbol_kind"], "function")
        self.assertIn("path: str", function["python_static"]["params"])
        self.assertEqual(function["python_static"]["returns"], "dict")
        self.assertIn("pathlib.Path", function["python_static"]["calls"])
        self.assertIn("data", function["python_static"]["assigned_names"])

        code_blocks = [item for item in functions if item.get("symbol_kind") == "code_block"]
        self.assertEqual(len(code_blocks), 1)
        self.assertTrue(code_blocks[0]["name"].startswith("CodeBlock:"))
        self.assertIn("calls=", code_blocks[0]["name"])
        self.assertIn("Assign", code_blocks[0]["python_static"]["block_types"])
        self.assertIn("If", code_blocks[0]["python_static"]["block_types"])
        self.assertIn("load_user", code_blocks[0]["python_static"]["calls"])
        self.assertIn("pathlib.Path", code_blocks[0]["python_static"]["calls"])
        self.assertIn("config", code_blocks[0]["python_static"]["assigned_names"])

    def test_python_syntax_error_falls_back_to_tree_sitter(self):
        functions = self.extract_from_temp_file(
            ".py",
            """
            def valid_before_error():
                return True

            if broken:
            """,
        )

        names = {function["name"] for function in functions}
        self.assertIn("valid_before_error", names)
        function = next(item for item in functions if item["name"] == "valid_before_error")
        self.assertEqual(function["python_static"]["fallback"], "tree_sitter")

    def test_python_framework_and_call_graph_metadata(self):
        functions = self.extract_from_temp_file(
            ".py",
            """
            from fastapi import FastAPI
            import pytest

            app = FastAPI()

            def helper():
                return "ok"

            @app.get("/users/{user_id}")
            def read_user(user_id: str):
                return helper()

            @pytest.fixture
            def user_fixture():
                return {"id": "1"}

            def test_read_user(user_fixture):
                assert read_user("1")
            """,
        )

        read_user = next(item for item in functions if item["name"] == "read_user")
        self.assertIn("fastapi_route", read_user["python_static"]["framework_tags"])
        self.assertEqual(read_user["python_static"]["routes"][0]["path"], "/users/{user_id}")
        self.assertIn("helper", read_user["python_static"]["local_calls"])

        test_func = next(item for item in functions if item["name"] == "test_read_user")
        self.assertIn("pytest", test_func["python_static"]["framework_tags"])
        self.assertIn("read_user", test_func["python_static"]["local_calls"])


if __name__ == "__main__":
    unittest.main()


class GenericExtractorTests(unittest.TestCase):
    def extract_from_temp_file(self, suffix: str, source: str):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / f"sample{suffix}"
            path.write_text(textwrap.dedent(source).lstrip(), encoding="utf-8")
            return extract_functions(path)

    def summarize(self, functions):
        return [(f["name"], f["class_name"], f["lineno"]) for f in functions]

    def test_rust_functions_impl_and_trait_methods(self):
        functions = self.extract_from_temp_file(
            ".rs",
            """
            /// Parse a config file.
            fn parse_config(path: &str) -> Config {
                todo!()
            }

            impl<T> Cache<T> {
                fn get(&self, key: &str) -> Option<&T> { None }
            }

            trait Store {
                fn save(&self) {}
                fn load(&self);
            }

            mod util {
                pub fn helper() {}
            }
            """,
        )
        self.assertEqual(
            self.summarize(functions),
            [
                ("parse_config", None, 2),
                ("get", "Cache", 7),
                ("save", "Store", 11),
                ("helper", None, 16),
            ],
        )
        self.assertEqual(functions[0]["docstring"], "Parse a config file.")

    def test_go_functions_and_methods(self):
        functions = self.extract_from_temp_file(
            ".go",
            """
            package main

            // Run starts the server.
            func Run() {}

            func (s *Server) Handle(w Writer) {}
            """,
        )
        self.assertEqual(self.summarize(functions), [("Run", None, 4), ("Handle", "Server", 6)])
        self.assertEqual(functions[0]["docstring"], "Run starts the server.")

    def test_c_and_cpp_functions(self):
        c_functions = self.extract_from_temp_file(".c", "static int *make_buffer(int n) { return 0; }\n")
        self.assertEqual(self.summarize(c_functions), [("make_buffer", None, 1)])

        cpp_functions = self.extract_from_temp_file(
            ".cpp",
            """
            class Widget {
              void draw() {}
            };

            void Widget::resize(int w) {}

            namespace ns { int compute() { return 1; } }
            """,
        )
        self.assertEqual(
            self.summarize(cpp_functions),
            [("draw", "Widget", 2), ("resize", "Widget", 5), ("compute", None, 7)],
        )
