from tree_sitter import Language, Parser
import tree_sitter_python

# --- クラス変数として一度だけ初期化 ---
_LANGUAGE = Language(tree_sitter_python.language())
_PARSER = Parser(_LANGUAGE)
_QUERY_STRING = """
(function_definition
  name: (identifier) @func.name
  body: (block) @func.body) @func.def
"""
_QUERY = _LANGUAGE.query(_QUERY_STRING)
# ------------------------------------

def extract_functions(file_path):
    file_path_str = str(file_path)
    try:
        with open(file_path_str, 'r', encoding='utf-8', errors='replace') as f:
            source_code_as_text = f.read()
    except Exception as e:
        print(f"Error reading {file_path_str}: {e}")
        return []

    source_bytes = source_code_as_text.encode("utf-8")
    tree = _PARSER.parse(source_bytes)
    root_node = tree.root_node
    matches = _QUERY.matches(root_node)

    results = []
    for _, capture_dict in matches:
        name_nodes = capture_dict.get("func.name", [])
        func_def_nodes = capture_dict.get("func.def", [])
        if not name_nodes or not func_def_nodes:
            continue
        name_node = name_nodes[0]
        func_def_node = func_def_nodes[0]
        func_name = source_bytes[name_node.start_byte:name_node.end_byte].decode('utf-8', errors='replace')
        func_code = source_bytes[func_def_node.start_byte:func_def_node.end_byte].decode('utf-8', errors='replace')
        results.append({
            'name': func_name,
            'code': func_code,
            'lineno': func_def_node.start_point[0] + 1,
            'end_lineno': func_def_node.end_point[0] + 1
        })
    return results
