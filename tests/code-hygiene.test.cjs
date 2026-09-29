const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function sources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}
const files = [path.join(root, 'App.tsx'), ...sources(path.join(root, 'src'))];
const parsed = new Map(files.map((file) => [file,
  ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)]));

test('every application module is reachable from the real App entry point', () => {
  const visited = new Set();
  function walk(file) {
    if (visited.has(file)) return;
    visited.add(file);
    for (const node of parsed.get(file).statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node))) continue;
      const specifier = node.moduleSpecifier?.text;
      if (!specifier?.startsWith('.')) continue;
      const base = path.resolve(path.dirname(file), specifier);
      const target = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
        .map((suffix) => path.normalize(base + suffix)).find((candidate) => parsed.has(candidate));
      if (target) walk(target);
    }
  }
  walk(files[0]);
  assert.deepEqual(files.filter((file) => !visited.has(file)).map((file) => path.relative(root, file)), []);
});

test('shared style definitions have no missing or unused static references', () => {
  const styleFile = path.join(root, 'src/styles/appStyles.ts');
  const declaration = parsed.get(styleFile).statements.find(ts.isVariableStatement)
    .declarationList.declarations[0].initializer.arguments[0];
  const defined = new Set(declaration.properties.map((property) => property.name.text));
  const used = new Set();
  for (const [file, tree] of parsed) {
    if (file === styleFile) continue;
    function visit(node) {
      if (ts.isPropertyAccessExpression(node) && node.expression.getText(tree) === 'styles')
        used.add(node.name.text);
      if (ts.isElementAccessExpression(node) && node.expression.getText(tree) === 'styles')
        assert.fail('Update this check before introducing dynamic style references');
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  assert.deepEqual([...used].filter((name) => !defined.has(name)), [], 'missing styles');
  assert.deepEqual([...defined].filter((name) => !used.has(name)), [], 'unused styles');
});
