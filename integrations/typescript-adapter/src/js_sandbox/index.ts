import fs from "fs/promises";
import { task } from "@capsule-run/sdk";
import { deserializeEnv, serializeEnv, SerializedValue } from "./serialization";


const executeCode = task(
  { name: "executeCode", compute: "LOW", ram: "256MB" },
  async (code: string, env: Record<string, unknown> = {}): Promise<unknown> => {
    const capturedOutput: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      capturedOutput.push(args.map(String).join(" "));
    };

    try {
      const proxy = new Proxy(env, {
        has(_t, _k) { return true; },
        get(t, k) { return typeof k === "string" ? (t as Record<string, unknown>)[k] : undefined; },
        set(t, k, v) { if (typeof k === "string") (t as Record<string, unknown>)[k] = v; return true; },
      });

      const fn = new Function("__env__", "__code__", "with (__env__) { return eval(__code__); }");
      const result = fn(proxy, code);

      const output = capturedOutput.join("\n");
      if (output) return result !== undefined ? `${output}\n${result}` : output;
      return result;
    } finally {
      console.log = originalLog;
    }
  }
);

const executeCodeInSession = task(
  {
    name: "executeCodeInSession",
    compute: "MEDIUM",
    ram: "256MB",
    allowedFiles: [{ path: ".capsule/sessions", mode: "read-write" }],
  },
  async (code: string, session_id: string): Promise<unknown> => {
    const env: Record<string, unknown> = {};


      const stateData = JSON.parse(await fs.readFile(`.capsule/sessions/${session_id}_state.json`, "utf-8")) as Record<string, SerializedValue>;
      deserializeEnv(stateData, env);

    const result = await executeCode(code, env);

    await fs.writeFile(`.capsule/sessions/${session_id}_state.json`, JSON.stringify(serializeEnv(env)));

    return result;
  }
);

const importFile = task(
  {
    name: "importFile",
    compute: "MEDIUM",
    allowedFiles: [{ path: ".capsule/sessions/workspace", mode: "read-write" }],
  },
  async (filePath: string, content: string): Promise<string> => {
    const fullPath = `.capsule/sessions/workspace/${filePath}`;
    await fs.writeFile(fullPath, content);
    return `Imported ${filePath}`;
  }
);

const deleteFile = task(
  {
    name: "deleteFile",
    compute: "MEDIUM",
    allowedFiles: [{ path: ".capsule/sessions/workspace", mode: "read-write" }],
  },
  async (filePath: string): Promise<string> => {
    const fullPath = `.capsule/sessions/workspace/${filePath}`;
    await fs.unlink(fullPath);
    return `Deleted ${filePath}`;
  }
);

export const main = task(
  { name: "main", compute: "LOW" },
  (action: string, ...args: string[]): Promise<unknown> => {
    if (action === "EXECUTE_CODE") {
      return executeCode(...args);

    } else if (action === "EXECUTE_CODE_IN_SESSION") {
      return executeCodeInSession(...args);

    } else if (action === "IMPORT_FILE") {
      return importFile(...args);

    } else if (action === "DELETE_FILE") {
      return deleteFile(...args);

    } else {
      throw new Error(`Invalid action: ${action}`);
    }
  }
);
