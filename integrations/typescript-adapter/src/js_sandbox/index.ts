import fs from "fs/promises";
import { task } from "@capsule-run/sdk";
import { deserializeEnv, serializeEnv, SerializedValue } from "./serialization";
import { _executeCode } from "./execution";


const executeCode = task(
  { name: "executeCode", compute: "LOW", ram: "256MB" },
  async (code: string, env: Record<string, unknown> = {}): Promise<unknown> => {
    return _executeCode(code, env);
  }
);

const executeCodeInSession = task(
  {
    name: "executeCodeInSession",
    compute: "LOW",
    ram: "256MB",
    allowedFiles: [{ path: ".capsule/sessions", mode: "read-write" }],
  },
  async (code: string, session_id: string): Promise<unknown> => {
    const env: Record<string, unknown> = {};

    const stateData = JSON.parse(await fs.readFile(`.capsule/sessions/${session_id}_state.json`, "utf-8")) as Record<string, SerializedValue>;
    deserializeEnv(stateData, env);

    const result = _executeCode(code, env);

    await fs.writeFile(`.capsule/sessions/${session_id}_state.json`, JSON.stringify(serializeEnv(env)));

    return result;
  }
);

const importFile = task(
  {
    name: "importFile",
    compute: "MEDIUM",
    ram: "256MB",
    allowedFiles: [{ path: ".capsule/sessions", mode: "read-write" }],
  },
  async (sessionId: string, filePath: string, content: string): Promise<string> => {
    const fullPath = `.capsule/sessions/${sessionId}_workspace/${filePath}`;
    await fs.mkdir(`.capsule/sessions/${sessionId}_workspace`, { recursive: true });
    await fs.writeFile(fullPath, content);
    return `Imported ${filePath}`;
  }
);

const deleteFile = task(
  {
    name: "deleteFile",
    compute: "MEDIUM",
    ram: "256MB",
    allowedFiles: [{ path: ".capsule/sessions", mode: "read-write" }],
  },
  async (sessionId: string, filePath: string): Promise<string> => {
    const fullPath = `.capsule/sessions/${sessionId}_workspace/${filePath}`;
    await fs.unlink(fullPath);
    return `Deleted ${filePath}`;
  }
);

export const main = task(
  { name: "main", compute: "HIGH" },
  async (action: string, ...args: string[]): Promise<unknown> => {
    let response: { success: boolean; result: unknown; error: { message: string } | null };

    if (action === "EXECUTE_CODE") {
      response = await executeCode(...args as [string]);
    } else if (action === "EXECUTE_CODE_IN_SESSION") {
      response = await executeCodeInSession(...args as [string, string]);
    } else if (action === "IMPORT_FILE_IN_SESSION") {
      response = await importFile(...args as [string, string, string]);
    } else if (action === "DELETE_FILE_IN_SESSION") {
      response = await deleteFile(...args as [string, string]);
    } else {
      throw new Error(`Invalid action: ${action}`);
    }

    if (!response.success && response.error) {
      throw new Error(response.error.message);
    }

    return response.result;
  }
);
