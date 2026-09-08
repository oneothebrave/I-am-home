const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

// Isolate module state per test fixture; only explicitly supplied dependencies are mocked.
exports.createLoader = (mocks = {}) => {
  const cache = new Map();
  return function load(file) {
    const filename = path.resolve(root, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
      },
      fileName: filename,
    }).outputText;
    const localRequire = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('.')) {
        const target = path.resolve(path.dirname(filename), name);
        return load(fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx');
      }
      return require(name);
    };
    new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
    return module.exports;
  };
};
