const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractSymbols } = require('../../out/nodeSearch/symbols');

test('a long Python function is one complete result, without the adjacent function', async () => {
    const long = ['def long_function(value):', ...Array.from({ length: 105 }, (_, i) => `    value += ${i}`), '    return value'].join('\n');
    const short = 'def next_function():\n    return "separate"';
    const symbols = await extractSymbols('example.py', `${long}\n\n${short}\n`);
    assert.deepEqual(symbols.map(s => s.name), ['long_function', 'next_function']);
    assert.equal(symbols[0].symbol_kind, 'function');
    assert.equal(symbols[0].code, long);
    assert.equal(symbols[0].end_lineno, 107);
    assert.equal(symbols[1].lineno, 109);
    assert.equal(symbols[1].code, short);
});

test('Python decorators, async methods, multiline signatures, and local functions retain identity and ranges', async () => {
    const source = [
        'class Auth:',
        '    @staticmethod',
        '    async def verify(',
        '        password: str,',
        '    ) -> bool:',
        '        """日本語 😀',
        'def not_a_function():',
        '    fake definition inside a string',
        '        """',
        '        def normalize(value):',
        '            return value.strip()',
        '        return bool(normalize(password))',
        '',
        '    def logout(self):',
        '        return None',
        '',
        'print("top-level statement")',
    ].join('\n');
    const symbols = await extractSymbols('example.py', source);
    assert.deepEqual(symbols.map(s => s.function_name), ['verify', 'normalize', 'logout']);
    assert.equal(symbols[0].class_name, 'Auth');
    assert.equal(symbols[0].symbol_kind, 'method');
    assert.equal(symbols[0].start_lineno, 2);
    assert.equal(symbols[0].lineno, 3);
    assert.equal(symbols[0].end_lineno, 12);
    assert.match(symbols[0].code, /^@staticmethod\n    async def verify/);
    assert.equal(symbols[1].class_name, undefined);
    assert.equal(symbols[1].symbol_kind, 'function');
    assert.equal(symbols[2].end_lineno, 15);
    assert.ok(symbols.every(s => !s.code.includes('print("top-level')));
});

test('JS/TS declarations, arrow functions and class methods never merge siblings', async () => {
    const source = [
        'export async function fetchUser() { return "}"; }',
        'export const save = async (value) => { return value; };',
        'const first = () => 1, second = () => 2;',
        'class Store {',
        '    load() { return { key: "{brace}" }; }',
        '    clear = () => { return null; };',
        '}',
        'items.map(item => item.id);',
    ].join('\n');
    for (const ext of ['js', 'ts']) {
        const symbols = await extractSymbols(`example.${ext}`, source);
        assert.deepEqual(symbols.map(s => s.name), ['fetchUser', 'save', 'first', 'second', 'load', 'clear']);
        assert.equal(symbols[0].code, source.split('\n')[0]);
        assert.equal(symbols[1].code, source.split('\n')[1]);
        assert.equal(symbols[2].code, 'first = () => 1');
        assert.equal(symbols[3].code, 'second = () => 2');
        assert.equal(symbols[4].class_name, 'Store');
        assert.equal(symbols[5].symbol_kind, 'method');
    }
});

test('JSX and TSX component functions retain their complete JSX body', async () => {
    for (const ext of ['jsx', 'tsx']) {
        const source = 'export function Screen() { return <div><span>Hello</span></div>; }\nconst Footer = () => <footer>Bye</footer>;';
        const symbols = await extractSymbols(`example.${ext}`, source);
        assert.deepEqual(symbols.map(s => s.name), ['Screen', 'Footer']);
        assert.equal(symbols[0].code, source.split('\n')[0]);
        assert.equal(symbols[1].code, source.split('\n')[1]);
    }
});

test('Java methods and constructors keep full bodies, annotations, and class names', async () => {
    const source = [
        'class Auth {',
        '    Auth() { }',
        '    @Override',
        '    public String toString() {',
        '        return "not a closing brace: }";',
        '    }',
        '    boolean verify(String password) { return password != null; }',
        '}',
    ].join('\n');
    const symbols = await extractSymbols('Auth.java', source);
    assert.deepEqual(symbols.map(s => s.name), ['Auth', 'toString', 'verify']);
    assert.ok(symbols.every(s => s.class_name === 'Auth' && s.symbol_kind === 'method'));
    assert.equal(symbols[1].lineno, 3);
    assert.equal(symbols[1].end_lineno, 6);
    assert.match(symbols[1].code, /^@Override/);
    assert.ok(!symbols[1].code.includes('boolean verify'));
});

test('top-level statements and invalid source do not fall back to arbitrary blocks', async () => {
    assert.deepEqual(await extractSymbols('script.py', 'import json\nvalues = [1, 2]\nprint(values)\n'), []);
    assert.deepEqual(await extractSymbols('broken.py', 'def unfinished(\n    ???\n'), []);
    assert.deepEqual(await extractSymbols('broken.ts', 'function unfinished( { return ???'), []);
});
