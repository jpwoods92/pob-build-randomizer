// Minimal parser for the Lua table literals found in Path of Building's data files.
// Supports: tables (array + hash parts), strings (all forms), numbers, booleans, nil,
// dotted identifiers (returned as strings, e.g. "SkillType.Attack") and function calls
// (returned as { call, args }). Simple numeric binary expressions are folded.

export class LuaParser {
  constructor(src, pos = 0) {
    this.src = src;
    this.pos = pos;
  }

  error(msg) {
    const line = this.src.slice(0, this.pos).split('\n').length;
    throw new Error(`Lua parse error at line ${line}: ${msg} near "${this.src.slice(this.pos, this.pos + 40)}"`);
  }

  skipWs() {
    const s = this.src;
    for (;;) {
      const c = s[this.pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        this.pos++;
      } else if (c === '-' && s[this.pos + 1] === '-') {
        this.pos += 2;
        const long = this.matchLongBracket();
        if (long !== null) {
          this.readLongString(long);
        } else {
          while (this.pos < s.length && s[this.pos] !== '\n') this.pos++;
        }
      } else {
        return;
      }
    }
  }

  // Returns the level (number of '=') if at a long bracket opener, else null.
  matchLongBracket() {
    const s = this.src;
    if (s[this.pos] !== '[') return null;
    let p = this.pos + 1;
    let level = 0;
    while (s[p] === '=') { level++; p++; }
    return s[p] === '[' ? level : null;
  }

  readLongString(level) {
    const s = this.src;
    const open = 2 + level;
    this.pos += open;
    if (s[this.pos] === '\r') this.pos++;
    if (s[this.pos] === '\n') this.pos++;
    const close = ']' + '='.repeat(level) + ']';
    const end = s.indexOf(close, this.pos);
    if (end < 0) this.error('unterminated long string');
    const str = s.slice(this.pos, end);
    this.pos = end + close.length;
    return str;
  }

  readQuoted() {
    const s = this.src;
    const q = s[this.pos++];
    let out = '';
    for (;;) {
      const c = s[this.pos++];
      if (c === undefined) this.error('unterminated string');
      if (c === q) break;
      if (c === '\\') {
        const n = s[this.pos++];
        switch (n) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case '\\': out += '\\'; break;
          case '"': out += '"'; break;
          case "'": out += "'"; break;
          case '\n': out += '\n'; break;
          default:
            if (/[0-9]/.test(n)) {
              let digits = n;
              while (digits.length < 3 && /[0-9]/.test(s[this.pos])) digits += s[this.pos++];
              out += String.fromCharCode(parseInt(digits, 10));
            } else {
              out += n;
            }
        }
      } else {
        out += c;
      }
    }
    return out;
  }

  parseValue() {
    let v = this.parseUnary();
    for (;;) {
      this.skipWs();
      const c = this.src[this.pos];
      if ((c === '+' || c === '-' || c === '*' || c === '/') && this.src[this.pos + 1] !== '-') {
        this.pos++;
        const rhs = this.parseUnary();
        if (typeof v === 'number' && typeof rhs === 'number') {
          v = c === '+' ? v + rhs : c === '-' ? v - rhs : c === '*' ? v * rhs : v / rhs;
        } else {
          v = null;
        }
      } else if (c === '.' && this.src[this.pos + 1] === '.') {
        this.pos += 2;
        const rhs = this.parseUnary();
        v = (v ?? '') + '' + (rhs ?? '');
      } else {
        return v;
      }
    }
  }

  parseUnary() {
    this.skipWs();
    const s = this.src;
    const c = s[this.pos];
    if (c === '-') {
      this.pos++;
      const v = this.parseUnary();
      return typeof v === 'number' ? -v : null;
    }
    if (c === '{') return this.parseTable();
    if (c === '"' || c === "'") return this.readQuoted();
    if (c === '[') {
      const level = this.matchLongBracket();
      if (level !== null) return this.readLongString(level);
    }
    if (c === '(') {
      this.pos++;
      const v = this.parseValue();
      this.skipWs();
      if (s[this.pos] !== ')') this.error('expected )');
      this.pos++;
      return v;
    }
    const num = /^(0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)/.exec(s.slice(this.pos, this.pos + 40));
    if (num) {
      this.pos += num[0].length;
      return Number(num[0]);
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)*/.exec(s.slice(this.pos, this.pos + 200));
    if (ident) {
      this.pos += ident[0].length;
      const name = ident[0];
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'nil') return null;
      this.skipWs();
      if (s[this.pos] === '(') {
        this.pos++;
        const args = [];
        this.skipWs();
        while (s[this.pos] !== ')') {
          args.push(this.parseValue());
          this.skipWs();
          if (s[this.pos] === ',') this.pos++;
          this.skipWs();
        }
        this.pos++;
        return { call: name, args };
      }
      if (s[this.pos] === '[') {
        // indexing like foo["bar"] -> keep as string
        this.pos++;
        const key = this.parseValue();
        this.skipWs();
        this.pos++;
        return `${name}[${key}]`;
      }
      return name;
    }
    this.error('unexpected token');
  }

  parseTable() {
    const s = this.src;
    this.pos++; // {
    const arr = [];
    const hash = {};
    let hasHash = false;
    for (;;) {
      this.skipWs();
      if (s[this.pos] === '}') { this.pos++; break; }
      if (s[this.pos] === '[' && this.matchLongBracket() === null) {
        this.pos++;
        const key = this.parseValue();
        this.skipWs();
        if (s[this.pos] !== ']') this.error('expected ]');
        this.pos++;
        this.skipWs();
        if (s[this.pos] !== '=') this.error('expected =');
        this.pos++;
        hash[key] = this.parseValue();
        hasHash = true;
      } else {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(s.slice(this.pos, this.pos + 200));
        if (m) {
          this.pos += m[0].length;
          hash[m[1]] = this.parseValue();
          hasHash = true;
        } else {
          arr.push(this.parseValue());
        }
      }
      this.skipWs();
      if (s[this.pos] === ',' || s[this.pos] === ';') this.pos++;
    }
    if (!hasHash) return arr;
    if (arr.length) hash.__array = arr;
    return hash;
  }
}

export function parseLuaValue(src, pos = 0) {
  const p = new LuaParser(src, pos);
  const value = p.parseValue();
  return { value, end: p.pos };
}

// Parses a file of the form `return <value>` (with optional leading comments).
export function parseLuaReturn(src) {
  const idx = src.search(/^return\s/m);
  if (idx < 0) throw new Error('no return statement');
  return parseLuaValue(src, idx + 'return'.length).value;
}
