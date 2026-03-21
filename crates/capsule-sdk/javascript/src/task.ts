/**
 * Capsule SDK - Task Wrapper
 *
 * Provides the `task` wrapper function for defining Capsule tasks
 * in an idiomatic TypeScript way.
 */

import { registerTask, type TaskConfig } from "./app.js";
import { isWasmMode, callHost } from "./hostApi.js";

export interface AllowedFile {
  /** Path to the directory, e.g., "./data" */
  path: string;
  /** Access mode: "read-only" / "ro" or "read-write" / "rw" (default) */
  mode?: "read-only" | "read-write" | "ro" | "rw";
}

export interface TaskOptions {
  /** Task name (required) */
  name: string;
  /** Compute level: "LOW", "MEDIUM", or "HIGH" */
  compute?: "LOW" | "MEDIUM" | "HIGH" | number;
  /** RAM limit, e.g., "512MB", "2GB" */
  ram?: string;
  /**
   * Timeout duration.
   * String format: "30s", "5m", "2h" (e.g., "10s")
   * Number format: milliseconds (e.g., 10000 for 10 seconds)
   */
  timeout?: string | number;
  /** Maximum number of retries */
  maxRetries?: number;
  /** Files/folders accessible in the sandbox, e.g., ["./data"] or [{ path: "./data", mode: "ro" }] */
  allowedFiles?: (string | AllowedFile)[];
  /** Allowed hosts for HTTP requests */
  allowedHosts?: string[];
  /** Environment variables available from your .env file for the task */
  envVariables?: string[];
}

interface TaskResult<T> {
  success: boolean;
  result: T;
  error: { error_type: string; message: string } | null;
  execution: TaskExecution;
}

interface TaskExecution {
    task_name: string;
    duration_ms: number;
    retries: number;
    fuel_consumed: number;
}

type Awaited<T> = T extends Promise<infer U> ? U : T;

type TaskReturnType<T> = T extends Promise<infer U>
  ? Promise<TaskResult<U>>
  : TaskResult<T>;

/**
 * Define a Capsule task with configuration.
 *
 * @example
 * ```typescript
 * export const greet = task({
 *   name: "greet",
 *   compute: "LOW",
 *   timeout: "10s"
 * }, (name: string): string => {
 *   return `Hello, ${name}!`;
 * });
 *
 * export const process = task({
 *   name: "process",
 *   compute: "HIGH",
 *   timeout: 30000
 * }, (data: any): any => {
 *   return processData(data);
 * });
 * ```
 *
 * In WASM mode:
 * - The function is registered in the task registry with its config
 * - When called from within a task, it schedules a new isolated instance
 * - The host creates a new Wasm instance with resource limits
 *
 * In non-WASM mode:
 * - The function executes directly
 */

/**
 * Normalize timeout to string format for the Rust host.
 *
 * @param timeout - String duration ("10s", "5m") or number (milliseconds)
 * @returns String format for host API, or undefined
 */
function normalizeTimeout(timeout?: string | number): string | undefined {
  if (!timeout) return undefined;
  if (typeof timeout === "number") {
    return `${timeout}ms`;
  }
  return timeout;
}

function normalizeAllowedFile(entry: string | AllowedFile): string {
  if (typeof entry === "string") return entry;
  switch (entry.mode) {
    case undefined:
    case "rw":
    case "read-write":
      return entry.path;
    case "ro":
    case "read-only":
      return `${entry.path}:ro`;
    default:
      throw new Error(
        `Invalid allowed_files mode '${(entry as any).mode}' for path '${entry.path}'. ` +
        `Use 'read-only' or 'read-write'.`
      );
  }
}

export function task<TArgs extends any[], TReturn>(
  options: TaskOptions,
  fn: (...args: TArgs) => TReturn
): (...args: TArgs) => TaskReturnType<TReturn> {
  const taskName = options.name;
  let compute = options.compute?.toString().toUpperCase() ?? "MEDIUM";
  let allowedHosts = options.allowedHosts ?? ["*"];

  const taskConfig: TaskConfig = {
    name: taskName,
    compute,
    ram: options.ram,
    timeout: normalizeTimeout(options.timeout),
    maxRetries: options.maxRetries,
    allowedFiles: options.allowedFiles?.map(normalizeAllowedFile),
    allowedHosts,
    envVariables: options.envVariables,
  };

  const wrapper = (...args: TArgs): TaskReturnType<TReturn> => {
    if (!isWasmMode()) {
      const result = fn(...args);

      if (result instanceof Promise) {
        return result.then((value) => ({
          success: true,
          result: value,
          error: null,
          execution: {
            task_name: taskName,
            duration_ms: 0,
            retries: 0,
            fuel_consumed: 0,
          },
        })) as TaskReturnType<TReturn>;
      }

      return {
        success: true,
        result,
        error: null,
        execution: {
          task_name: taskName,
          duration_ms: 0,
          retries: 0,
          fuel_consumed: 0,
        },
      } as TaskReturnType<TReturn>;
    }

    const resultJson = callHost(taskName, args, taskConfig);

    try {
      const result: TaskResult<Awaited<TReturn>> = JSON.parse(resultJson);
      return result as TaskReturnType<TReturn>;
    } catch (e) {
      if (e instanceof SyntaxError) {
        return resultJson as unknown as TaskReturnType<TReturn>;
      }
      throw e;
    }
  };

  registerTask(taskName, fn, taskConfig);

  return wrapper;
}
