const { XMLParser, XMLValidator } = require('fast-xml-parser');

// Parse the checked-in XML plist subset without fetching DTDs or accepting
// duplicate keys. XML validation alone would not detect ambiguous plist keys.
function parsePlist(source) {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source)) throw Error('不允许自定义 XML 实体');
  if (XMLValidator.validate(source) !== true) throw Error('plist XML 格式无效');
  const tree = new XMLParser({ preserveOrder: true, parseTagValue: false,
    ignoreDeclaration: true, trimValues: false }).parse(source);
  const meaningful = (nodes) => nodes.filter((node) =>
    !(Object.hasOwn(node, '#text') && !String(node['#text']).trim()));
  const text = (nodes) => nodes.map((node) => {
    if (!Object.hasOwn(node, '#text')) throw Error('plist 文本中含嵌套节点');
    return node['#text'];
  }).join('');
  const parse = (node) => {
    const tag = Object.keys(node).find((key) => key !== ':@');
    const children = node[tag];
    if (tag === 'string' || tag === 'key') return text(children);
    if (tag === 'true' || tag === 'false') {
      if (meaningful(children).length) throw Error('plist 布尔值格式无效');
      return tag === 'true';
    }
    if (tag === 'array') return meaningful(children).map(parse);
    if (tag === 'dict') {
      const entries = meaningful(children), result = Object.create(null);
      if (entries.length % 2) throw Error('plist 字典缺少值');
      for (let index = 0; index < entries.length; index += 2) {
        if (!Object.hasOwn(entries[index], 'key')) throw Error('plist 字典缺少键');
        const key = parse(entries[index]);
        if (Object.hasOwn(result, key)) throw Error('plist 字典键重复：' + key);
        result[key] = parse(entries[index + 1]);
      }
      return result;
    }
    if (tag === 'integer' || tag === 'real') {
      const number = Number(text(children));
      if (!Number.isFinite(number) || (tag === 'integer' && !Number.isSafeInteger(number)))
        throw Error('plist 数值无效');
      return number;
    }
    throw Error('检查器不支持的 plist 类型：' + tag);
  };
  const root = meaningful(tree);
  if (root.length !== 1 || !root[0].plist) throw Error('缺少单一 plist 根节点');
  const values = meaningful(root[0].plist);
  if (values.length !== 1) throw Error('plist 根值不唯一');
  return parse(values[0]);
}

// OpenStep ASCII plist reader for project.pbxproj. Fails closed on unsupported
// syntax rather than guessing target/configuration membership from regex hits.
function parsePbxProject(source) {
  const tokens = [];
  const pattern = /\s+|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|[{}()=;,]|(?:(?!\/[/*])[^\s{}()=;,"])+/gy;
  let position = 0;
  while (position < source.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(source);
    if (!match) throw Error('Xcode 工程语法无法解析，位置 ' + position);
    position = pattern.lastIndex;
    const token = match[0];
    if (/^\s|^\/\*|^\/\//.test(token)) continue;
    tokens.push(token);
  }
  let cursor = 0;
  const take = (expected) => {
    const token = tokens[cursor++];
    if (token === undefined || (expected !== undefined && token !== expected))
      throw Error('Xcode 工程结构无效，预期 ' + (expected ?? '值'));
    return token;
  };
  const scalar = () => {
    const token = take();
    if (/^[{}()=;,]$/.test(token)) throw Error('Xcode 工程标量无效');
    return token.startsWith('"') ? JSON.parse(token) : token;
  };
  const parse = () => {
    if (tokens[cursor] === '{') {
      take('{'); const result = Object.create(null);
      while (tokens[cursor] !== '}') {
        const key = scalar(); take('=');
        if (Object.hasOwn(result, key)) throw Error('Xcode 工程键重复：' + key);
        result[key] = parse(); take(';');
      }
      take('}'); return result;
    }
    if (tokens[cursor] === '(') {
      take('('); const result = [];
      while (tokens[cursor] !== ')') {
        result.push(parse());
        if (tokens[cursor] !== ')') take(',');
      }
      take(')'); return result;
    }
    return scalar();
  };
  const result = parse();
  if (cursor !== tokens.length) throw Error('Xcode 工程含多余内容');
  return result;
}

module.exports = { parsePlist, parsePbxProject };
