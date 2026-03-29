/**
 * Persistent sandbox session backed by per-session state files.
 *
 * Each run() call is a fresh Wasm instance. State is serialized to
 * `.capsule/sessions/<id>_state.json` between calls. Workspace files live
 * under `.capsule/sessions/workspace/`.
 *
 * @example
 * await using s = new Session("python");
 * await s.run("x = 1");
 * const result = await s.run("x += 1; x"); // "2"
 *
 * @example
 * await using s = new Session("javascript");
 * await s.run("x = 1");
 * const result = await s.run("x += 1; x"); // "2"
 */

import { run } from "@capsule-run/sdk/runner";
import { resolve } from "path";
import { randomUUID } from "crypto";
import * as fs from "fs";

import { SANDBOX_PY, SANDBOX_JS, unwrapResult } from "./execution.js";

const SESSIONS_DIR = resolve(".capsule/sessions");
const WORKSPACE_DIR = resolve(SESSIONS_DIR, "workspace");

type SandboxType = "python" | "javascript";

export class Session {
  private readonly sandboxFile: string;
  private readonly id: string;
  private readonly stateFile: string;

  constructor(type: SandboxType = "python") {
    this.sandboxFile = type === "python" ? SANDBOX_PY : SANDBOX_JS;
    this.id = randomUUID().replace(/-/g, "");
    this.stateFile = resolve(SESSIONS_DIR, `${this.id}_state.json`);
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    fs.writeFileSync(this.stateFile, "{}");
  }

  private async invoke(action: string, ...args: string[]): Promise<string> {
    const res = await run({
      file: this.sandboxFile,
      args: [action, ...args],
    });
    if (!res.success) throw new Error(`Capsule session failed: ${res.error?.message}`);
    return unwrapResult(res.result);
  }

  /** Execute code inside the session, preserving state across calls. */
  async run(code: string): Promise<string> {
    return this.invoke("EXECUTE_CODE_IN_SESSION", code, this.id);
  }

  /** Write a file into the session workspace. */
  async importFile(path: string, content: string): Promise<string> {
    return this.invoke("IMPORT_FILE", path, content);
  }

  /** Delete a file from the session workspace. */
  async deleteFile(filePath: string): Promise<string> {
    return this.invoke("DELETE_FILE", filePath);
  }

  /** Clear session state, preserving workspace files. */
  reset(): void {
    fs.writeFileSync(this.stateFile, "{}");
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (fs.existsSync(this.stateFile)) {
      fs.rmSync(this.stateFile);
    }
  }
}
