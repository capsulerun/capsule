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
import { normalize } from "path";
import { randomUUID } from "crypto";
import * as fs from "fs";

import { SANDBOX_PY, SANDBOX_JS, unwrapResult } from "./execution.js";

const SESSIONS_DIR = ".capsule/sessions";
const SESSIONS_STATES_DIR = ".capsule/sessions/states";

type SandboxType = "python" | "javascript";

export class Session {
  private readonly sandboxFile: string;
  private readonly id: string;
  private readonly stateFile: string;
  private readonly workspaceDir: string;

  constructor(type: SandboxType = "python") {
    this.sandboxFile = type === "python" ? SANDBOX_PY : SANDBOX_JS;
    this.id = randomUUID().replace(/-/g, "");
    this.stateFile = normalize(SESSIONS_STATES_DIR + `/${this.id}.json`);
    this.workspaceDir = normalize(SESSIONS_DIR + `/${this.id}_workspace`);
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.mkdirSync(SESSIONS_STATES_DIR, { recursive: true });
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    fs.writeFileSync(this.stateFile, "{}");
  }

  private async invoke(action: string, ...args: string[]): Promise<string> {
    const res = await run({
      file: this.sandboxFile,
      args: [action, ...args],
      mounts: [`${this.workspaceDir}::workspace`],
    });

    if (!res.success) throw new Error(`Capsule session failed: ${res.error?.message}`);
    return unwrapResult(res.result);
  }

  /** Execute code inside the session, preserving state across calls. */
  async run(code: string): Promise<string> {
    return this.invoke("EXECUTE_CODE_IN_SESSION", code, this.id);
  }

  /** Write a file into the session workspace. */
  async importFile(srcPath: string, destPath: string): Promise<string> {
    return this.invoke("IMPORT_FILE_IN_SESSION", srcPath, destPath);
  }

  /** Delete a file from the session workspace. */
  async deleteFile(path: string): Promise<string> {
    return this.invoke("DELETE_FILE_FROM_SESSION", path);
  }

  /** Clear session state, preserving workspace files. */
  reset(): void {
    fs.writeFileSync(this.stateFile, "{}");
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (fs.existsSync(this.stateFile)) {
      fs.rmSync(this.stateFile);
    }
    if (fs.existsSync(this.workspaceDir)) {
      fs.rmSync(this.workspaceDir, { recursive: true });
    }
  }
}
