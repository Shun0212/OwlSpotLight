import * as path from 'node:path';
import type { Node as SyntaxNode } from 'web-tree-sitter' with { 'resolution-mode': 'import' };
import type { CodeSymbol } from './types';

const GRAMMARS: Record<string, string> = {
    '.py': 'python', '.java': 'java', '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'tsx',
};
export const SUPPORTED_EXTENSIONS = new Set(Object.keys(GRAMMARS));
const loadParser = async () => {
    const runtime = await import('web-tree-sitter');
    await runtime.Parser.init({ locateFile: () => require.resolve('web-tree-sitter/tree-sitter.wasm') });
    return runtime;
};
let runtime: ReturnType<typeof loadParser> | undefined;
const parsers = new Map<string, Promise<InstanceType<Awaited<ReturnType<typeof loadParser>>['Parser']>>>();

async function parserFor(grammar: string) {
    let parser = parsers.get(grammar);
    if (!parser) {
        parser = (async () => {
            const { Parser, Language } = await (runtime ??= loadParser());
            const language = await Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${grammar}.wasm`));
            const instance = new Parser();
            instance.setLanguage(language);
            return instance;
        })();
        parsers.set(grammar, parser);
        parser.catch(() => parsers.delete(grammar));
    }
    return parser;
}

const FUNCTIONS = new Set(['function_definition', 'function_declaration', 'generator_function_declaration',
    'method_definition', 'method_declaration', 'constructor_declaration', 'function_expression', 'generator_function', 'arrow_function']);
const CLASSES = new Set(['class_definition', 'class_declaration', 'class', 'enum_declaration', 'record_declaration']);

function callsIn(node: SyntaxNode): NonNullable<CodeSymbol['calls']> {
    const calls: NonNullable<CodeSymbol['calls']> = [];
    const stack = [...node.namedChildren];
    while (stack.length) {
        const child = stack.pop();
        if (!child || FUNCTIONS.has(child.type)) { continue; }
        if (['call', 'call_expression', 'method_invocation'].includes(child.type)) {
            const callee = child.childForFieldName('function')?.text || child.childForFieldName('name')?.text;
            if (callee) {
                const parts = callee.split('.');
                calls.push({ name: parts.pop()!, receiver: child.childForFieldName('object')?.text || parts.join('.') || undefined,
                    line: child.startPosition.row + 1, column: child.startPosition.column,
                    endLine: child.endPosition.row + 1, endColumn: child.endPosition.column });
            }
        }
        stack.push(...child.namedChildren);
    }
    return calls;
}

function enclosingClass(node: SyntaxNode): SyntaxNode | undefined {
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
        // A function nested in a method is a local function, not another class method.
        if (FUNCTIONS.has(ancestor.type)) { return; }
        if (CLASSES.has(ancestor.type)) { return ancestor; }
    }
}

function describeFunction(node: SyntaxNode): { name: string; range: SyntaxNode } | undefined {
    let name = node.childForFieldName('name')?.text;
    let range = node;
    const parent = node.parent;
    if (['arrow_function', 'function_expression', 'generator_function'].includes(node.type)) {
        if (parent && ['variable_declarator', 'public_field_definition', 'field_definition'].includes(parent.type)) {
            name = parent.childForFieldName('name')?.text ?? parent.childForFieldName('property')?.text ?? name;
            range = parent;
            // Include const/export only when doing so cannot pull in a sibling function.
            const declaration = parent.parent;
            if (declaration && ['lexical_declaration', 'variable_declaration'].includes(declaration.type)
                && declaration.namedChildren.filter(child => child?.type === 'variable_declarator').length === 1) {
                range = declaration;
            }
        } else if (parent?.type === 'pair') {
            name = parent.childForFieldName('key')?.text ?? name;
            range = parent;
        } else if (parent?.type === 'assignment_expression') {
            name = parent.childForFieldName('left')?.text ?? name;
            range = parent;
        }
    }
    // Unnamed inline callbacks and non-function top-level statements are not results.
    if (!name) { return; }
    if (range.parent?.type === 'decorated_definition' || range.parent?.type === 'export_statement') {
        range = range.parent;
    }
    return { name, range };
}

/** Parse whole functions/methods. Never fall back to arbitrary line windows. */
export async function extractSymbols(file: string, source: string): Promise<CodeSymbol[]> {
    const grammar = GRAMMARS[path.extname(file).toLowerCase()];
    if (!grammar) { return []; }
    const parser = await parserFor(grammar);
    const tree = parser.parse(source);
    if (!tree) { throw new Error(`Could not parse ${file}.`); }
    const symbols: CodeSymbol[] = [];
    try {
        const stack = [tree.rootNode];
        while (stack.length) {
            const node = stack.pop()!;
            if (FUNCTIONS.has(node.type) && node.childForFieldName('body') && !node.hasError) {
                const description = describeFunction(node);
                if (description) {
                    const owner = enclosingClass(node);
                    const className = owner?.childForFieldName('name')?.text;
                    const { name, range } = description;
                    symbols.push({ file_path: file, name, function_name: name,
                        class_name: className, symbol_kind: owner || node.type.startsWith('method_') ? 'method' : 'function',
                        lineno: node.startPosition.row + 1, start_lineno: range.startPosition.row + 1,
                        end_lineno: range.endPosition.row + (range.endPosition.column === 0 ? 0 : 1),
                        code: range.text, calls: callsIn(node),
                    });
                }
            }
            // Traverse nested definitions as independent symbols too.
            for (let i = node.namedChildCount - 1; i >= 0; i--) { stack.push(node.namedChild(i)!); }
        }
    } finally { tree.delete(); }
    return symbols;
}
