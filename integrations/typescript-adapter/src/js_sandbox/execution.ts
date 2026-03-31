function hoistDeclarations(code: string): string {
  let depth = 0;
  let i = 0;
  let out = "";
  // tracks whether the last meaningful token allows a regex to follow
  let lastTokenCanPrecedeRegex = true;

  while (i < code.length) {
    const ch = code[i];

    // Line comment — skip to end of line
    if (ch === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i);
      const end = nl === -1 ? code.length : nl + 1;
      out += code.slice(i, end);
      i = end;
      continue;
    }

    // Block comment — skip to */
    if (ch === "/" && code[i + 1] === "*") {
      const cl = code.indexOf("*/", i + 2);
      const end = cl === -1 ? code.length : cl + 2;
      out += code.slice(i, end);
      i = end;
      continue;
    }

    // Regex literal — only when / can't be division
    if (ch === "/" && lastTokenCanPrecedeRegex) {
      let j = i + 1;
      while (j < code.length && code[j] !== "/") {
        if (code[j] === "\\") j++;
        j++;
      }
      // consume flags after closing /
      j++;
      while (j < code.length && /[gimsuy]/.test(code[j])) j++;
      out += code.slice(i, j);
      i = j;
      lastTokenCanPrecedeRegex = false;
      continue;
    }

    // String literal — skip to closing quote, respecting backslash escapes
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) {
        if (code[j] === "\\") j++;
        j++;
      }
      out += code.slice(i, j + 1);
      i = j + 1;
      lastTokenCanPrecedeRegex = false;
      continue;
    }

    // Template literal — skip to closing backtick, tracking ${} nesting
    if (ch === "`") {
      let j = i + 1;
      let tmplDepth = 0;
      while (j < code.length) {
        if (code[j] === "\\" ) { j += 2; continue; }
        if (code[j] === "`" && tmplDepth === 0) { j++; break; }
        if (code[j] === "$" && code[j + 1] === "{") { tmplDepth++; j += 2; continue; }
        if (code[j] === "}" && tmplDepth > 0) { tmplDepth--; j++; continue; }
        j++;
      }
      out += code.slice(i, j);
      i = j;
      lastTokenCanPrecedeRegex = false;
      continue;
    }

    if (ch === "{" || ch === "(" || ch === "[") { depth++; lastTokenCanPrecedeRegex = true; }
    else if (ch === "}" || ch === ")" || ch === "]") { depth--; lastTokenCanPrecedeRegex = ch !== ")" && ch !== "]"; }
    else if (ch === ";" || ch === ",") { lastTokenCanPrecedeRegex = true; }
    else if (ch === "=" || ch === "+" || ch === "-" || ch === "*" || ch === "%" || ch === "!" || ch === "&" || ch === "|" || ch === "?" || ch === ":") { lastTokenCanPrecedeRegex = true; }
    else if (/[a-zA-Z0-9_$]/.test(ch)) { lastTokenCanPrecedeRegex = false; }

    // Only rewrite at top level and when not preceded by an identifier char
    if (depth === 0) {
      const prevCh = out.length > 0 ? out[out.length - 1] : "";
      const notIdent = prevCh === "" || !/[a-zA-Z0-9_$]/.test(prevCh);

      if (notIdent) {
        const rest4 = code.slice(i, i + 4);
        const rest6 = code.slice(i, i + 6);
        if (rest4 === "let " || rest4 === "let\t" || rest4 === "let\n") {
          out += "var" + code[i + 3];
          i += 4;
          lastTokenCanPrecedeRegex = true;
          continue;
        }
        if (rest6 === "const " || rest6 === "const\t" || rest6 === "const\n") {
          out += "var" + code[i + 5];
          i += 6;
          lastTokenCanPrecedeRegex = true;
          continue;
        }
        if (rest6 === "class " || rest6 === "class\t") {
          // read the class name
          let j = i + 6;
          while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
          const name = code.slice(i + 6, j);
          if (name) {
            // `class Foo ...` → `var Foo = class Foo ...`
            out += `var ${name} = class ${name}`;
            i = j;
            lastTokenCanPrecedeRegex = false;
            continue;
          }
        }
      }
    }

    out += ch;
    i++;
  }

  return out;
}

export function _executeCode(code: string, env: Record<string, unknown>): unknown {
  code = hoistDeclarations(code);
  const capturedOutput: string[] = [];
  const originalLog = console.log;

  console.log = (...args: any[]) => {
    capturedOutput.push(args.map(arg => String(arg)).join(" "));
  };

  try {
    const proxy = new Proxy(env, {
      has(_t, _k) { return true; },
      get(t, k) {
        if (typeof k !== "string") return undefined;
        if (k in t) return (t as Record<string, unknown>)[k];
        return (globalThis as any)[k];
      },
      set(t, k, v) { if (typeof k === "string") (t as Record<string, unknown>)[k] = v; return true; },
    });

    let result: unknown;
    let executed = false;

    try {
      const fn = new Function("__env__", `with (__env__) { return (${code}); }`);
      result = fn(proxy);
      executed = true;
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
    }

    if (!executed) {
      const splitAt = Math.max(code.lastIndexOf(";"), code.lastIndexOf("\n"));
      if (splitAt >= 0) {
        const last = code.slice(splitAt + 1).trim();
        if (last) {
          try {
            const before = code.slice(0, splitAt + 1);
            const fn = new Function("__env__", `with (__env__) { ${before} return (${last}); }`);
            result = fn(proxy);
            executed = true;
          } catch {}
        }
      }
    }

    if (!executed) {
      const fn = new Function("__env__", `with (__env__) { ${code} }`);
      result = fn(proxy);
    }

    const output = capturedOutput.join("\n");
    if (output) return result !== undefined ? `${output}\n${result}` : output;
    return result;
  } finally {
    console.log = originalLog;
  }
}
