/**
 * Minimal, dependency-free YAML 1.2 subset parser.
 *
 * Scope is deliberately narrow: everything OpenAPI documents actually use.
 *   - block mappings and sequences, arbitrary nesting
 *   - flow mappings/sequences ({a: 1}, [1, 2])
 *   - single/double quoted scalars, block scalars (| > with -/+ chomping)
 *   - plain multi-line (folded) scalars
 *   - anchors, aliases and the `<<` merge key
 *   - comments, document markers, BOM, CRLF
 *
 * Out of scope: multi-document streams (first document wins), tags, complex
 * keys, YAML 1.1 boolean spellings (`yes`/`no` stay strings — the Norway bug).
 */

export class YamlError extends Error {
  constructor(message, line) {
    super(line == null ? message : `${message} (line ${line})`);
    this.name = 'YamlError';
    this.line = line;
  }
}

const BOOL = { true: true, True: true, TRUE: true, false: false, False: false, FALSE: false };
const NULLS = new Set(['', '~', 'null', 'Null', 'NULL']);
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Strip a trailing `#` comment, honouring quoted regions. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

/** Index of the mapping colon (`: ` or trailing `:`) at flow-depth zero, or -1. */
function findColon(s) {
  let quote = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ':' && depth === 0 && (i + 1 === s.length || /\s/.test(s[i + 1]))) return i;
  }
  return -1;
}

function unquote(s) {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, esc) => {
      if (esc[0] === 'u' || esc[0] === 'x') return String.fromCharCode(parseInt(esc.slice(1), 16));
      return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', 0: '\0', '\\': '\\', '"': '"', '/': '/' }[esc] ?? esc;
    });
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
  return null;
}

function scalar(raw) {
  const s = raw.trim();
  const unq = unquote(s);
  if (unq !== null) return unq;
  if (NULLS.has(s)) return null;
  if (s in BOOL) return BOOL[s];
  if (NUMBER.test(s)) return Number(s);
  return s;
}

/* ------------------------------- flow style ------------------------------ */

function skipWs(s) { while (s.i < s.src.length && /\s/.test(s.src[s.i])) s.i++; }

function parseFlow(src, line) {
  const s = { src, i: 0, line };
  const value = flowNode(s);
  skipWs(s);
  if (s.i < s.src.length) throw new YamlError(`unexpected "${s.src[s.i]}" in flow collection`, line);
  return value;
}

function flowNode(s) {
  skipWs(s);
  const c = s.src[s.i];
  if (c === '[') return flowSeq(s);
  if (c === '{') return flowMap(s);
  return scalar(flowScalar(s));
}

function flowScalar(s) {
  skipWs(s);
  const start = s.i;
  const q = s.src[s.i];
  if (q === '"' || q === "'") {
    s.i++;
    while (s.i < s.src.length) {
      if (s.src[s.i] === '\\' && q === '"') s.i += 2;
      else if (s.src[s.i] === q) { s.i++; break; }
      else s.i++;
    }
    return s.src.slice(start, s.i);
  }
  while (s.i < s.src.length) {
    const c = s.src[s.i];
    if (c === ',' || c === ']' || c === '}') break;
    // A colon only ends a plain scalar when it is followed by a separator, so
    // OAuth scope lists like [orders:read] stay intact.
    if (c === ':' && (s.i + 1 >= s.src.length || /[\s,\]}]/.test(s.src[s.i + 1]))) break;
    s.i++;
  }
  return s.src.slice(start, s.i).trim();
}

function flowSeq(s) {
  s.i++; // consume [
  const arr = [];
  skipWs(s);
  if (s.src[s.i] === ']') { s.i++; return arr; }
  for (;;) {
    arr.push(flowNode(s));
    skipWs(s);
    if (s.src[s.i] === ',') { s.i++; skipWs(s); if (s.src[s.i] === ']') { s.i++; return arr; } continue; }
    if (s.src[s.i] === ']') { s.i++; return arr; }
    throw new YamlError('expected "," or "]" in flow sequence', s.line);
  }
}

function flowMap(s) {
  s.i++; // consume {
  const obj = {};
  skipWs(s);
  if (s.src[s.i] === '}') { s.i++; return obj; }
  for (;;) {
    skipWs(s);
    const key = scalar(flowScalar(s));
    skipWs(s);
    if (s.src[s.i] !== ':') throw new YamlError('expected ":" in flow mapping', s.line);
    s.i++;
    obj[String(key)] = flowNode(s);
    skipWs(s);
    if (s.src[s.i] === ',') { s.i++; skipWs(s); if (s.src[s.i] === '}') { s.i++; return obj; } continue; }
    if (s.src[s.i] === '}') { s.i++; return obj; }
    throw new YamlError('expected "," or "}" in flow mapping', s.line);
  }
}

/* ------------------------------ block style ------------------------------ */

// The indentation indicator and the chomping indicator may appear in either
// order: `|2-` and `|-2` are both legal, and real specs use both.
function isBlockScalarHeader(v) { return /^[|>](?:[-+]\d?|\d[-+]?)?$/.test(v); }

/**
 * True when a quoted scalar opens on this line but does not close on it —
 * a quoted string continued across lines, which real-world specs use freely
 * for long descriptions.
 */
function opensUnclosedQuote(s) {
  const q = s[0];
  if (q !== '"' && q !== "'") return false;
  for (let i = 1; i < s.length; i++) {
    if (q === '"' && s[i] === '\\') { i++; continue; }
    if (s[i] === q) {
      if (q === "'" && s[i + 1] === q) { i++; continue; } // '' escapes a quote
      return false;
    }
  }
  return true;
}

class Cursor {
  constructor(lines) { this.lines = lines; this.i = 0; this.anchors = new Map(); }
  peek() { return this.lines[this.i] ?? null; }
  next() { return this.lines[this.i++] ?? null; }
}

/** Skip blank lines that cannot belong to a block scalar. */
function skipBlanks(cur) { while (cur.peek() && cur.peek().blank) cur.next(); }

function parseNode(cur, minIndent) {
  skipBlanks(cur);
  const line = cur.peek();
  if (!line || line.indent < minIndent) return null;
  if (line.text === '-' || line.text.startsWith('- ')) return parseSeq(cur, line.indent);
  return parseMap(cur, line.indent);
}

/** Resolve an `&anchor` prefix on an inline value. */
function takeAnchor(text) {
  const m = /^&(\S+)\s*/.exec(text);
  return m ? { anchor: m[1], rest: text.slice(m[0].length) } : { anchor: null, rest: text };
}

function parseValue(cur, text, parentIndent, line) {
  const { anchor, rest } = takeAnchor(text);
  let value;
  if (isBlockScalarHeader(rest)) {
    value = parseBlockScalar(cur, rest, parentIndent);
  } else if (rest === '') {
    skipBlanks(cur);
    const nxt = cur.peek();
    if (nxt && nxt.indent > parentIndent) {
      const opensCollection = nxt.text === '-' || nxt.text.startsWith('- ')
        || nxt.text.startsWith('? ') || findColon(nxt.text) !== -1;
      if (opensCollection) {
        value = parseNode(cur, nxt.indent);
      } else {
        // The key carried no value, so the indented block below it is a
        // scalar whose content simply begins on the next line.
        cur.next();
        value = parseValue(cur, nxt.text, parentIndent, nxt.no);
      }
    } else if (nxt && nxt.indent === parentIndent && (nxt.text === '-' || nxt.text.startsWith('- '))) {
      value = parseSeq(cur, parentIndent);
    } else {
      value = null;
    }
  } else if (rest.startsWith('*')) {
    const name = rest.slice(1).trim();
    if (!cur.anchors.has(name)) throw new YamlError(`unknown alias *${name}`, line);
    value = cur.anchors.get(name);
  } else if (opensUnclosedQuote(rest)) {
    value = scalar(foldQuoted(cur, rest, line));
  } else if (rest[0] === '[' || rest[0] === '{') {
    value = parseFlow(rest, line);
  } else {
    value = scalar(foldPlain(cur, rest, parentIndent));
  }
  if (anchor) cur.anchors.set(anchor, value);
  return value;
}

/**
 * Absorb the continuation lines of a quoted scalar that spans several lines.
 * Line breaks fold to spaces, exactly as YAML specifies.
 */
function foldQuoted(cur, first, line) {
  let out = first;
  while (opensUnclosedQuote(out)) {
    const nxt = cur.peek();
    if (!nxt) throw new YamlError('unterminated quoted string', line);
    cur.next();
    out += nxt.blank ? '\n' : ` ${nxt.text}`;
  }
  return out;
}

/** Absorb the continuation lines of a wrapped plain scalar. */
function foldPlain(cur, first, parentIndent) {
  let out = first;
  for (;;) {
    const nxt = cur.peek();
    if (!nxt || nxt.blank || nxt.indent <= parentIndent) break;
    // The key already carries a scalar value, so a more-indented line can only
    // be a continuation of it — even one that opens with "- " or contains ": ".
    out += ' ' + nxt.text;
    cur.next();
  }
  return out;
}

function parseBlockScalar(cur, header, parentIndent) {
  const style = header[0];
  const chomp = /[-+]/.test(header) ? header.match(/[-+]/)[0] : 'clip';
  const explicit = header.match(/\d/) ? Number(header.match(/\d/)[0]) : null;
  const raw = [];
  let indent = explicit ? parentIndent + explicit : null;
  for (;;) {
    const nxt = cur.peek();
    if (!nxt) break;
    if (nxt.blank) { raw.push(''); cur.next(); continue; }
    if (nxt.indent <= parentIndent) break;
    if (indent === null) indent = nxt.indent;
    raw.push(nxt.raw.slice(indent));
    cur.next();
  }
  while (raw.length && raw[raw.length - 1] === '') raw.pop();
  let body;
  if (style === '|') {
    body = raw.join('\n');
  } else {
    body = '';
    for (let i = 0; i < raw.length; i++) {
      if (i === 0) body = raw[i];
      else if (raw[i] === '' || raw[i - 1] === '') body += '\n' + raw[i];
      else body += ' ' + raw[i];
    }
  }
  if (chomp === '-') return body;
  return body + '\n';
}

function parseMap(cur, indent) {
  const obj = {};
  for (;;) {
    skipBlanks(cur);
    const line = cur.peek();
    if (!line || line.indent !== indent) break;
    if (line.text === '-' || line.text.startsWith('- ')) break;

    // Explicit key syntax: "? <key>" on one line, ": <value>" on the next.
    // Emitters fall back to it when a key is too long to be an implicit one.
    if (line.text.startsWith('? ')) {
      const key = String(scalar(line.text.slice(2)));
      cur.next();
      const valueLine = cur.peek();
      if (!valueLine || valueLine.indent !== indent || (valueLine.text !== ':' && !valueLine.text.startsWith(': '))) {
        throw new YamlError(`explicit key "${key}" has no ":" value line`, line.no);
      }
      const inner = valueLine.text === ':' ? '' : valueLine.text.slice(2);
      if (inner === '') {
        cur.next();
        obj[key] = parseNode(cur, indent + 1);
      } else {
        // Treat the ": " as indentation, so the value's own block starts here.
        const offset = indent + 2;
        valueLine.raw = ' '.repeat(offset) + inner;
        valueLine.text = inner;
        valueLine.indent = offset;
        obj[key] = parseNode(cur, offset);
      }
      continue;
    }

    const colon = findColon(line.text);
    if (colon === -1) throw new YamlError(`expected "key:" but found "${line.text}"`, line.no);
    const key = String(scalar(line.text.slice(0, colon).trim()));
    const rest = line.text.slice(colon + 1).trim();
    cur.next();
    const value = parseValue(cur, rest, indent, line.no);
    if (key === '<<') Object.assign(obj, value && typeof value === 'object' ? value : {});
    else obj[key] = value;
  }
  return obj;
}

function parseSeq(cur, indent) {
  const arr = [];
  for (;;) {
    skipBlanks(cur);
    const line = cur.peek();
    if (!line || line.indent !== indent) break;
    if (line.text !== '-' && !line.text.startsWith('- ')) break;
    if (line.text === '-') {
      cur.next();
      skipBlanks(cur);
      const nxt = cur.peek();
      arr.push(nxt && nxt.indent > indent ? parseNode(cur, nxt.indent) : null);
      continue;
    }
    const offset = line.indent + 2;
    const inner = line.text.slice(2);
    if (findColon(inner) !== -1 || inner.startsWith('- ')) {
      // Rewrite the line as if the dash were indentation: the nested collection
      // starts on this line and continues on the following ones.
      line.raw = ' '.repeat(offset) + inner;
      line.text = inner;
      line.indent = offset;
      arr.push(parseNode(cur, offset));
    } else {
      cur.next();
      arr.push(parseValue(cur, inner, indent, line.no));
    }
  }
  return arr;
}

export function parse(input) {
  const src = String(input).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = [];
  let started = false;
  let stop = false;
  src.split('\n').forEach((raw, idx) => {
    if (stop) return;
    const text = stripComment(raw).replace(/\s+$/, '');
    if (/^---\s*$/.test(text)) {
      if (started) { stop = true; return; }
      started = true;
      return;
    }
    if (/^\.\.\.\s*$/.test(text)) { stop = true; return; }
    if (text.trim() === '') { lines.push({ raw, text: '', indent: 0, blank: true, no: idx + 1 }); return; }
    const trimmed = text.trimStart();
    lines.push({ raw: text, text: trimmed, indent: text.length - trimmed.length, blank: false, no: idx + 1 });
  });
  const cur = new Cursor(lines);
  skipBlanks(cur);
  if (!cur.peek()) return null;
  const value = parseNode(cur, cur.peek().indent);
  skipBlanks(cur);
  if (cur.peek()) throw new YamlError(`unexpected content "${cur.peek().text}"`, cur.peek().no);
  return value;
}
