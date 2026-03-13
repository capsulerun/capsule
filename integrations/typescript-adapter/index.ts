import { run } from "@capsule-run/sdk/runner";
import { join } from "path";

const SANDBOX_PY = join(import.meta.dirname, "sandboxes", "python_sandbox.wasm");
const SANDBOX_JS = join(import.meta.dirname, "sandboxes", "js_sandbox.wasm");

async function invokeSandbox(wasmFile: string, code: string): Promise<string> {
  const res = await run({ file: wasmFile, args: [code] });

  if (!res.success) {
    throw new Error(res.error?.message ?? "Capsule execution failed");
  }

  if (res.result == null) return "";
  if (typeof res.result === "string") return res.result;
  return JSON.stringify(res.result);
}

export async function loadJavaScriptSandbox(): Promise<void> {
  await invokeSandbox(SANDBOX_JS, "// pre-load sandbox");
}

export async function loadPythonSandbox(): Promise<void> {
  await invokeSandbox(SANDBOX_PY, "# pre-load sandbox");
}

export async function loadSandboxes(): Promise<void> {
  await Promise.all([
    loadPythonSandbox(),
    loadJavaScriptSandbox()
  ]);
}

export async function executePython(code: string): Promise<string> {
  return await invokeSandbox(SANDBOX_PY, code);
}

export async function executeJavaScript(code: string): Promise<string> {
  return await invokeSandbox(SANDBOX_JS, code);
}
