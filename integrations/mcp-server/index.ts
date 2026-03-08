#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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

const server = new McpServer({
  name: "@capsule-run/mcp-server",
  version: "0.1.0",
});

server.registerTool(
  "execute_python",
  {
    title: "Execute Python",
    description:
      "Execute Python code in a secure isolated WebAssembly sandbox. " +
      "Both standard output (print statements) and the last evaluated expression are returned. " +
      "Supports pure Python only (no C extensions like numpy/pandas).",
    inputSchema: {
      code: z
        .string()
        .describe(
          "Python code to execute. Standard output and the final expression are returned."
        ),
    },
  },
  async ({ code }) => {
    try {
      const result = await invokeSandbox(SANDBOX_PY, code);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "execute_javascript",
  {
    title: "Execute JavaScript",
    description:
      "Execute JavaScript code in a secure isolated WebAssembly sandbox. " +
      "Both standard output (console logs) and the last evaluated expression are returned.",
    inputSchema: {
      code: z
        .string()
        .describe(
          "JavaScript code to execute. Standard output and the final expression are returned."
        ),
    },
  },
  async ({ code }) => {
    try {
      const result = await invokeSandbox(SANDBOX_JS, code);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
