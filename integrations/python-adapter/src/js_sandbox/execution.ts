export function _executeCode(code: string, env: Record<string, unknown>): unknown {
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
