from tree_sitter import Language, Parser
import tree_sitter_python

# --- クラス変数として一度だけ初期化 ---
_LANGUAGE = Language(tree_sitter_python.language())
_PARSER = Parser(_LANGUAGE)
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
    
    # クラス情報を抽出
    class_query = _LANGUAGE.query("""
    (class_definition
      name: (identifier) @class.name
      body: (block) @class.body) @class.def
    """)
    class_matches = class_query.matches(root_node)
    
    # クラス名とその範囲のマッピングを作成
    class_ranges = {}
    for _, capture_dict in class_matches:
        class_name_nodes = capture_dict.get("class.name", [])
        class_def_nodes = capture_dict.get("class.def", [])
        if class_name_nodes and class_def_nodes:
            class_name_node = class_name_nodes[0]
            class_def_node = class_def_nodes[0]
            class_name = source_bytes[class_name_node.start_byte:class_name_node.end_byte].decode('utf-8', errors='replace')
            class_ranges[class_name] = {
                'start': class_def_node.start_point,
                'end': class_def_node.end_point
            }
    
    # 関数情報を抽出
    func_query = _LANGUAGE.query("""
    (function_definition
      name: (identifier) @func.name
      body: (block) @func.body) @func.def
    """)
    func_matches = func_query.matches(root_node)

    results = []
    for _, capture_dict in func_matches:
        name_nodes = capture_dict.get("func.name", [])
        func_def_nodes = capture_dict.get("func.def", [])
        if not name_nodes or not func_def_nodes:
            continue
        name_node = name_nodes[0]
        func_def_node = func_def_nodes[0]
        func_name = source_bytes[name_node.start_byte:name_node.end_byte].decode('utf-8', errors='replace')
        func_code = source_bytes[func_def_node.start_byte:func_def_node.end_byte].decode('utf-8', errors='replace')
        
        # この関数がどのクラスに属しているかを判定
        func_start = func_def_node.start_point
        belonging_class = None
        for class_name, class_range in class_ranges.items():
            if (class_range['start'][0] <= func_start[0] <= class_range['end'][0]):
                belonging_class = class_name
                break
        
        results.append({
            'name': func_name,
            'code': func_code,
            'lineno': func_def_node.start_point[0] + 1,
            'end_lineno': func_def_node.end_point[0] + 1,
            'class_name': belonging_class  # クラス名を追加（Noneの場合はトップレベル関数）
        })
    return results
