"""Bounded call neighborhoods and cosine scores from an existing index snapshot."""
import ast
import hashlib
import os
import textwrap

import numpy as np


def node_id(item):
    key = f"{os.path.abspath(item['file'])}:{item['lineno']}:{item.get('name', '')}"
    return hashlib.sha256(key.encode()).hexdigest()[:24]


def align_cached_embeddings(functions, cached_functions, embeddings):
    """Reuse unchanged code by identity, regardless of list order or rescanning."""
    if embeddings is None:
        return None
    matrix, valid = normalized_rows(embeddings, len(cached_functions))
    if matrix is None:
        return None

    def key(item):
        return (os.path.normcase(os.path.realpath(item['file'])), item.get('name'),
                item.get('class_name'), item.get('symbol_kind'),
                item.get('code'), item.get('raw_code'))

    # Code is part of the key: a function edited since indexing stays unscored.
    rows = {key(item): matrix[i] for i, item in enumerate(cached_functions)
            if valid[i] and (item.get('code') or item.get('raw_code'))}
    aligned = np.zeros((len(functions), matrix.shape[1]), dtype=np.float64)
    for i, item in enumerate(functions):
        row = rows.get(key(item))
        if row is not None:
            aligned[i] = row
    return aligned


def direct_calls(item):
    """Do not attribute nested functions' calls to their enclosing function."""
    if not item['file'].endswith('.py'):
        return None
    raw_code = item.get('raw_code', item.get('code', ''))
    source = textwrap.dedent(raw_code)
    raw_lines, source_lines = raw_code.splitlines(), source.splitlines()
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    root = next((n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))), None)
    if root is None:
        return None
    calls = {}

    def record_call(name, node):
        def column(line, byte_offset):
            text = source_lines[line - 1]
            indentation = raw_lines[line - 1][:len(raw_lines[line - 1]) - len(text)]
            prefix = text.encode('utf-8')[:byte_offset].decode('utf-8')
            return len((indentation + prefix).encode('utf-16-le')) // 2
        calls.setdefault(name, []).append(dict(file=item['file'],
            line=item['lineno'] + node.lineno - 1, column=column(node.lineno, node.col_offset),
            endLine=item['lineno'] + node.end_lineno - 1, endColumn=column(node.end_lineno, node.end_col_offset)))
    shadowed = {arg.arg for arg in ast.walk(root.args) if isinstance(arg, ast.arg)}

    class Visitor(ast.NodeVisitor):
        def visit_FunctionDef(self, node):
            shadowed.add(node.name)

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_ClassDef(self, node):
            shadowed.add(node.name)

        def visit_Lambda(self, node):
            pass

        def visit_Name(self, node):
            if isinstance(node.ctx, ast.Store):
                shadowed.add(node.id)

        def visit_Import(self, node):
            shadowed.update(alias.asname or alias.name.split('.')[0] for alias in node.names)

        def visit_ImportFrom(self, node):
            shadowed.update(alias.asname or alias.name for alias in node.names)

        def visit_Call(self, node):
            if isinstance(node.func, ast.Name):
                record_call(node.func.id, node.func)
            elif isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                record_call(f'{node.func.value.id}.{node.func.attr}', node.func)
            else:
                record_call('<dynamic>', node.func)
            self.generic_visit(node)

    visitor = Visitor()
    for statement in root.body:
        visitor.visit(statement)
    return [(call, call in shadowed, calls[call]) for call in sorted(calls)]


def normalized_rows(values, count):
    """Normalize without squaring raw magnitudes; invalid rows remain unscored."""
    try:
        matrix = np.array(values, dtype=np.float64, copy=True)
    except (TypeError, ValueError, OverflowError):
        return None, None
    if matrix.ndim != 2 or matrix.shape[0] != count or matrix.shape[1] == 0:
        return None, None
    valid = np.isfinite(matrix).all(axis=1)
    matrix[~valid] = 0
    scale = np.max(np.abs(matrix), axis=1, keepdims=True)
    valid &= scale[:, 0] > 0
    np.divide(matrix, scale, out=matrix, where=scale > 0)
    lengths = np.sqrt(np.einsum('ij,ij->i', matrix, matrix, optimize=False))[:, None]
    np.divide(matrix, lengths, out=matrix, where=lengths > 0)
    return matrix, valid


def graph_neighborhood(functions, file, line, embeddings=None, query_vector=None,
                       similar=False, limit=60):
    items = [f for f in functions if f.get('symbol_kind') != 'code_block']
    file_key = os.path.normcase(os.path.realpath(file))
    matches = [f for f in items if os.path.normcase(os.path.realpath(f['file'])) == file_key
               and f['lineno'] <= line <= f.get('end_lineno', f['lineno'])]
    if not matches:
        raise ValueError('Function is not in the current index. Run a new search after edits.')
    center = min(matches, key=lambda f: f.get('end_lineno', f['lineno']) - f['lineno'])
    nodes = {}
    by_symbol = {}
    for item in items:
        ident = node_id(item)
        nodes[ident] = dict(id=ident, file=item['file'], line=item['lineno'],
                            endLine=item.get('end_lineno', item['lineno']), name=item['name'],
                            className=item.get('class_name'), symbolKind=item.get('symbol_kind') or ('method' if item.get('class_name') else 'function'), queryScore=None, similarity=None,
                            unresolved=None)
        key = (item['file'], item.get('class_name'), item['name'])
        by_symbol.setdefault(key, []).append(ident)
    edges = []
    for item in items:
        source = node_id(item)
        calls = direct_calls(item)
        if calls is None:
            continue
        unresolved = 0
        for call, shadowed, sites in calls:
            owner = None
            name = call
            if call.startswith(('self.', 'cls.')) and item.get('class_name'):
                owner, name = item['class_name'], call.split('.', 1)[1]
            elif '.' in call or shadowed:
                unresolved += 1
                continue
            targets = by_symbol.get((item['file'], owner, name), [])
            if len(targets) == 1:
                edges.append(dict(source=source, target=targets[0], kind='call', evidence='static', sites=sites))
            else:
                unresolved += 1
        nodes[source]['unresolved'] = unresolved
    center_id = node_id(center)
    selected = {center_id}
    neighbors = sorted({e['target'] if e['source'] == center_id else e['source']
                        for e in edges if center_id in (e['source'], e['target'])})
    similarity_edges = []
    matrix, valid = normalized_rows(embeddings, len(functions)) if embeddings is not None else (None, None)
    embeddings_available = matrix is not None and bool(valid.any())
    if embeddings_available:
        root_index = next(i for i, f in enumerate(functions) if node_id(f) == center_id)
        # Use NumPy's direct reduction rather than the platform BLAS matmul path.
        scores = np.einsum('ij,j->i', matrix, matrix[root_index], optimize=False) if valid[root_index] else None
        query_scores = None
        if query_vector is not None:
            try:
                query = np.asarray(query_vector, dtype=np.float64).reshape(1, -1)
            except (TypeError, ValueError, OverflowError):
                query = None
            if query is not None and query.shape[1] == matrix.shape[1]:
                vector, query_valid = normalized_rows(query, 1)
                if vector is not None and query_valid[0]:
                    query_scores = np.einsum('ij,j->i', matrix, vector[0], optimize=False)
        for i, item in enumerate(functions):
            ident = node_id(item)
            if ident in nodes and valid[i]:
                if scores is not None:
                    nodes[ident]['similarity'] = float(np.clip(scores[i], -1, 1))
                if query_scores is not None:
                    nodes[ident]['queryScore'] = float(np.clip(query_scores[i], -1, 1))
        if similar:
            ranked = sorted((ident for ident in nodes if ident != center_id and nodes[ident]['similarity'] is not None),
                            key=lambda ident: (-nodes[ident]['similarity'], ident))[:5]
            selected.update(ranked)
            similarity_edges = [dict(source=center_id, target=ident, kind='similar',
                                     evidence='embedding', score=nodes[ident]['similarity']) for ident in ranked]
    selected.update([ident for ident in neighbors if ident not in selected][:max(0, limit - len(selected))])
    return dict(center=center_id, nodes=[nodes[i] for i in sorted(selected)],
                edges=[e for e in edges if e['source'] in selected and e['target'] in selected] + similarity_edges,
                truncated=any(i not in selected for i in neighbors), embeddingsAvailable=embeddings_available)
