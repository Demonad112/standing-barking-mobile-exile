// Minimal parser for the data-only Lua files exported by Path of Building
// (`return { ... }` with string/number/boolean values and nested tables).
// Not a general Lua parser: no expressions, functions or long strings.

export type LuaValue = string | number | boolean | LuaTable;
export type LuaTable = { [key: string]: LuaValue } & { __array?: LuaValue[] };

export function parseLuaTable(src: string): LuaValue {
  let i = 0;

  const skip = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i]!)) i++;
      if (src.startsWith("--", i)) {
        while (i < src.length && src[i] !== "\n") i++;
      } else return;
    }
  };

  const parseString = (): string => {
    const q = src[i++]!;
    let out = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") {
        i++;
        const c = src[i++]!;
        out += c === "n" ? "\n" : c === "t" ? "\t" : c;
      } else out += src[i++];
    }
    if (src[i] !== q) throw new Error("Unterminated Lua string");
    i++;
    return out;
  };

  const parseValue = (): LuaValue => {
    skip();
    const c = src[i]!;
    if (c === "{") return parseTable();
    if (c === '"' || c === "'") return parseString();
    const m = /^(-?\d+(\.\d+)?([eE][-+]?\d+)?|true|false)/.exec(src.slice(i, i + 32));
    if (!m) throw new Error(`Unexpected Lua token at ${i}: ${src.slice(i, i + 20)}`);
    i += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : Number(m[0]);
  };

  const parseTable = (): LuaTable => {
    i++; // {
    const obj: LuaTable = {};
    const arr: LuaValue[] = [];
    for (;;) {
      skip();
      if (src[i] === "}") { i++; break; }
      if (src[i] === "[") {
        i++;
        skip();
        const key = src[i] === '"' || src[i] === "'" ? parseString() : String(parseValue());
        skip();
        if (src[i++] !== "]") throw new Error(`Expected ] at ${i}`);
        skip();
        if (src[i++] !== "=") throw new Error(`Expected = at ${i}`);
        obj[key] = parseValue();
      } else {
        const id = /^[A-Za-z_]\w*/.exec(src.slice(i, i + 64));
        if (id && /^\s*=/.test(src.slice(i + id[0].length, i + id[0].length + 8))) {
          i += id[0].length;
          skip();
          i++; // =
          obj[id[0]] = parseValue();
        } else arr.push(parseValue());
      }
      skip();
      if (src[i] === "," || src[i] === ";") i++;
    }
    if (arr.length) obj.__array = arr;
    return obj;
  };

  skip();
  if (src.startsWith("return", i)) i += 6;
  return parseValue();
}
