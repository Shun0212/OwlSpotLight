"""Extract declarations from snapshots, without importing or executing user code."""
from __future__ import annotations

import ast
from pathlib import Path
from collections import Counter

from gitdiff import SearchError


def python_symbols(text: str) -> list[dict]:
    tree = ast.parse(text)
    lines = text.splitlines()
    result, scope = [], []

    class Visitor(ast.NodeVisitor):
        def visit_ClassDef(self, node):
            scope.append(node.name)
            self.generic_visit(node)
            scope.pop()

        def visit_FunctionDef(self, node):
            start = min([node.lineno] + [d.lineno for d in node.decorator_list])
            name = ".".join([*scope, node.name])
            result.append({"name": name, "start": start, "end": node.end_lineno,
                           "code": "\n".join(lines[start-1:node.end_lineno])})
            scope.append(node.name)
            self.generic_visit(node)
            scope.pop()

        visit_AsyncFunctionDef = visit_FunctionDef

    Visitor().visit(tree)
    return result


def tree_symbols(text: str, language: str) -> list[dict]:
    try:
        from tree_sitter_language_pack import get_parser
    except ImportError as error:
        raise SearchError("この言語の関数検索には「検索エンジンを準備」が必要です。") from error
    source = text.encode("utf-8")
    root = get_parser(language).parse(source).root_node
    function_types = {
        "function_definition", "function_declaration", "generator_function_declaration",
        "function_expression", "generator_function", "arrow_function",
        "method_definition", "method_declaration", "constructor_declaration",
    }
    class_types = {"class_declaration", "class_definition", "class_expression", "class"}
    binding_types = {"variable_declarator", "public_field_definition", "field_definition",
                     "property_definition", "pair", "assignment_expression"}
    result = []

    def content(node):
        return source[node.start_byte:node.end_byte].decode("utf-8") if node else ""

    def walk(node, scope):
        own_name = content(node.child_by_field_name("name"))
        next_scope = scope
        if node.type in class_types:
            next_scope = [*scope, own_name or "<class>"]
        if node.type in function_types:
            if not own_name and node.parent and node.parent.type in binding_types:
                own_name = content(node.parent.child_by_field_name("name")
                                   or node.parent.child_by_field_name("key")
                                   or node.parent.child_by_field_name("left"))
            if not own_name and node.parent and node.parent.type == "export_statement":
                own_name = "default"
            if own_name:
                declaration = node
                if node.parent and node.parent.type == "decorated_definition":
                    declaration = node.parent
                start = declaration.start_point[0] + 1
                end = node.end_point[0] + (1 if node.end_point[1] else 0)
                result.append({"name": ".".join([*scope, own_name]), "start": start,
                               "end": max(start, end), "code": content(declaration)})
                next_scope = [*scope, own_name]
        for child in node.named_children:
            walk(child, next_scope)

    walk(root, [])
    return result


def extract_symbols(text: str, filename: str) -> list[dict]:
    if not text:
        return []
    ext = Path(filename).suffix.lower()
    languages = {".py": "python", ".java": "java", ".ts": "typescript", ".tsx": "tsx",
                 ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript"}
    if ext not in languages:
        return []
    if ext == ".py":
        try:
            items = python_symbols(text)
        except SyntaxError:
            items = tree_symbols(text, "python")
    else:
        items = tree_symbols(text, languages[ext])
    # Preserve overloads and duplicate names rather than silently overwriting them.
    occurrences = Counter()
    for item in items:
        occurrences[item["name"]] += 1
        item["key"] = f'{item["name"]}#{occurrences[item["name"]]}'
    return items


def changed_functions(snapshot, hunks: list[dict]) -> list[dict]:
    before = {s["key"]: s for s in extract_symbols(snapshot.old_text, snapshot.old_path or snapshot.path)}
    after = {s["key"]: s for s in extract_symbols(snapshot.new_text, snapshot.new_path or snapshot.path)}
    removed = {line for h in hunks for line in h["removed"]}
    added = {line for h in hunks for line in h["added"]}
    results = []
    for key in dict.fromkeys([*after, *before]):
        old, new = before.get(key), after.get(key)
        old_changed = old and any(old["start"] <= line <= old["end"] for line in removed)
        new_changed = new and any(new["start"] <= line <= new["end"] for line in added)
        if not old_changed and not new_changed:
            continue
        item = new or old
        patch_text = "\n".join(h["text"] for h in hunks
            if (new and any(new["start"] <= n <= new["end"] for n in h["added"]))
            or (old and any(old["start"] <= n <= old["end"] for n in h["removed"])))
        text = f'Function: {item["name"]}\nFile: {snapshot.path}\n'
        if old:
            text += "Before:\n" + old["code"] + "\n"
        if new:
            text += "After:\n" + new["code"] + "\n"
        results.append({"title": item["name"], "text": text,
                        "code": (new or old)["code"],
                        "new_line": new["start"] if new else max(1, hunks[0]["new_line"]),
                        "old_line": old["start"] if old else 1,
                        "side": "new" if new else "old",
                        "added": sorted(added & set(range(new["start"], new["end"] + 1))) if new else [],
                        "removed": sorted(removed & set(range(old["start"], old["end"] + 1))) if old else []})
    return results
