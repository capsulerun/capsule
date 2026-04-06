/**
 * Capsule SDK for JavaScript/TypeScript
 *
 * @example
 * ```typescript
 * import { task } from '@capsule/sdk';
 *
 * export const greet = task({
 *   name: "greet",
 *   compute: "LOW"
 * }, (name: string): string => {
 *   return `Hello, ${name}!`;
 * });
 * ```
 */

export { task, type TaskOptions } from "./task.js";
export { TaskRunner, exports, type TaskConfig } from "./app.js";
export { default as fs, promises as fsPromises } from "./polyfills/fs.js";
export { isWasmMode } from "./hostApi.js";
export { default as os } from "./polyfills/os.js";
export { default as process } from "./polyfills/process.js";


