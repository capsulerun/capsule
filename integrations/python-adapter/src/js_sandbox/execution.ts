import { fs, path, os, process } from "@capsule-run/sdk";

const fsPromises = fs.promises;

function hoistDeclarations(code: string): string {
  let depth = 0;
  let i = 0;
  let out = "";
  let lastTokenCanPrecedeRegex = true;

  while (i < code.length) {
    const ch = code[i];

    if (ch === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i);
      const end = nl === -1 ? code.length : nl + 1;
      out += code.slice(i, end);
      i = end;
      continue;
    }

    if (ch === "/" && code[i + 1] === "*") {
      const cl = code.indexOf("*/", i + 2);
      const end = cl === -1 ? code.length : cl + 2;
      out += code.slice(i, end);
      i = end;
      continue;
    }

    if (ch === "/" && lastTokenCanPrecedeRegex) {
      let j = i + 1;
      while (j < code.length && code[j] !== "/") {
        if (code[j] === "\\") j++;
        j++;
      }
      j++;
      while (j < code.length && /[gimsuy]/.test(code[j])) j++;
      out += code.slice(i, j);
      i = j;
      lastTokenCanPrecedeRegex = false;
      continue;
    }

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
        const atStatementStart = prevCh === "" || prevCh === "\n" || prevCh === ";" || prevCh === "}";
        if (atStatementStart) {
          if (rest6 === "class " || rest6 === "class\t") {
            let j = i + 6;
            while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
            const name = code.slice(i + 6, j);
            if (name) {
              out += `var ${name} = class ${name}`;
              i = j;
              lastTokenCanPrecedeRegex = false;
              continue;
            }
          }
          const rest9 = code.slice(i, i + 9);
          if (rest9 === "function " || rest9 === "function\t" || rest9 === "function\n") {
            let j = i + 9;
            while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
            const name = code.slice(i + 9, j);
            if (name) {
              out += `var ${name} = function ${name}`;
              i = j;
              lastTokenCanPrecedeRegex = false;
              continue;
            }
          }
        }
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Maps module names user code can import to their sandbox equivalents.
 * These are the WASI polyfills from the capsule SDK.
 */
export const MODULE_REGISTRY: Record<string, unknown> = {
  "fs":               fs,
  "fs/promises":      fsPromises,
  "node:fs":          fs,
  "node:fs/promises": fsPromises,
  "path":             path,
  "node:path":        path,
  "os":               os,
  "node:os":          os,
  "process":          process,
  "node:process":     process,
};

export const MODULE_VALUES: Set<unknown> = new Set(Object.values(MODULE_REGISTRY));
export const TRANSIENT_KEYS: Set<string> = new Set(["__require__", "require"]);


function rewriteImports(code: string): string {
  return code.replace(
    /^[ \t]*import\s+(?:(\*\s+as\s+\w+|\{[^}]*\}|\w+)\s+from\s+)?['"]([^'"]+)['"]\s*;?/gm,
    (_, binding: string | undefined, mod: string) => {
      if (!binding) return `__require__('${mod}');`;
      const normalized = binding.replace(/^\*\s+as\s+/, "");
      return `var ${normalized} = __require__('${mod}');`;
    }
  );
}

export function _executeCode(code: string, env: Record<string, unknown>): unknown {
  code = rewriteImports(hoistDeclarations(code));

  const capturedOutput: string[] = [];
  const originalLog = console.log;

  console.log = (...args: any[]) => {
    capturedOutput.push(args.map(arg => String(arg)).join(" "));
  };

  try {
    env.__require__ = (mod: string): unknown => {
      if (mod in MODULE_REGISTRY) return MODULE_REGISTRY[mod];
      throw new Error(`Cannot import '${mod}': module is not available in the sandbox`);
    };
    env.require = env.__require__;

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
      const trimmed = code.trimEnd();
      const splitAt = Math.max(trimmed.lastIndexOf(";"), trimmed.lastIndexOf("\n"));
      if (splitAt >= 0) {
        const last = trimmed.slice(splitAt + 1).trim();
        if (last) {
          try {
            const before = trimmed.slice(0, splitAt + 1);
            const fn = new Function("__env__", `with (__env__) { ${before}\n__capsule_result__ = (${last}); }`);
            fn(proxy);
            result = env.__capsule_result__;
            delete env.__capsule_result__;
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
