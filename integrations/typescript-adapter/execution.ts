import { run } from "@capsule-run/sdk/runner";
import { join } from "path";

export const SANDBOX_PY = join(import.meta.dirname, "sandboxes", "python_sandbox.wasm");
export const SANDBOX_JS = join(import.meta.dirname, "sandboxes", "js_sandbox.wasm");

export function unwrapResult(raw: unknown): string {
  if (raw == null) return "";
  return typeof raw === "string" ? raw : String(raw);
}

async function invokeSandbox(wasmFile: string, action: string, ...args: string[]): Promise<string> {
  const res = await run({ file: wasmFile, args: [action, ...args] });
  if (!res.success) {
    throw new Error(res.error?.message ?? "Capsule execution failed");
  }
  return unwrapResult(res.result);
}

export async function loadJavaScriptSandbox(): Promise<void> {
  await invokeSandbox(SANDBOX_JS, "EXECUTE_CODE", "// pre-load sandbox");
}

export async function loadPythonSandbox(): Promise<void> {
  await invokeSandbox(SANDBOX_PY, "EXECUTE_CODE", "# pre-load sandbox");
}

export async function loadSandboxes(): Promise<void> {
  await Promise.all([loadPythonSandbox(), loadJavaScriptSandbox()]);
}

export async function runPython(code: string): Promise<string> {
  return invokeSandbox(SANDBOX_PY, "EXECUTE_CODE", code);
}

export async function runJavaScript(code: string): Promise<string> {
  return invokeSandbox(SANDBOX_JS, "EXECUTE_CODE", code);
}
