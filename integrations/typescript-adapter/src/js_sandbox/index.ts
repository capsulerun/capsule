import fs from "fs/promises";
import path from "path";
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
    allowedFiles: [{ path: ".capsule/sessions/states", mode: "read-write" }],
  },
  async (code: string, session_id: string): Promise<unknown> => {
    const env: Record<string, unknown> = {};

    const stateData = JSON.parse(await fs.readFile(`.capsule/sessions/states/${session_id}.json`, "utf-8")) as Record<string, SerializedValue>;
    deserializeEnv(stateData, env);

    const result = _executeCode(code, env);

    await fs.writeFile(`.capsule/sessions/states/${session_id}.json`, JSON.stringify(serializeEnv(env)));

    return result;
  }
);

const importFileInSession = task(
  {
    name: "importFileInSession",
    compute: "MEDIUM",
    ram: "256MB",
    allowedFiles: [
      { path: "./", mode: "read-only" }
    ],
  },
  async (src_path: string, dest_path: string): Promise<string> => {
    const folder = path.dirname(dest_path)

    await fs.mkdir(path.normalize(`workspace/${folder}`), { recursive: true });

    await fs.cp(src_path, path.normalize(`workspace/${dest_path}`), { recursive: true });
    return `Imported ${dest_path}`;
  }
);

const deleteFileFromSession = task(
  {
    name: "deleteFileFromSession",
    compute: "MEDIUM",
    ram: "256MB",
  },
  async (path: string): Promise<string> => {
    await fs.unlink(path);
    return `Deleted ${path}`;
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
      response = await importFileInSession(...args as [string, string]);
    } else if (action === "DELETE_FILE_FROM_SESSION") {
      response = await deleteFileFromSession(...args as [string]);
    } else {
      throw new Error(`Invalid action: ${action}`);
    }

    if (!response.success && response.error) {
      throw new Error(response.error.message);
    }

    return response.result;
  }
);
