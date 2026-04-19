/**
 * Capsule SDK - SDK Runner
 *
 * Provides the `run` functions for running Capsule tasks
 * from third party applications.
 */

import { execFile, spawn, ChildProcess } from 'child_process';
import { resolve, extname } from 'path';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { HostRequest } from './task';

export interface RunnerOptions {
  file: string;
  args?: string[];
  mounts?: string[];
  cwd?: string;
  capsulePath?: string;
}

export interface RunnerResult {
  success: boolean;
  result: string | number | boolean | object | null;
  error: { error_type: string; message: string } | null;
  execution: {
    task_name: string;
    duration_ms: number;
    retries: number;
    fuel_consumed: number;
    ram_used: number;
    host_requests: HostRequest[];
  };
}

const WASM_EXTENSIONS = new Set(['.wasm', '.cwasm']);
const ARGS_FILE_THRESHOLD = 8 * 1024;

interface PendingRequest {
  resolve: (result: RunnerResult) => void;
  reject: (err: Error) => void;
}

const workerRegistry = new Map<string, ChildProcess>();
const pending = new Map<string, PendingRequest>();
const workerStdout = new Map<string, any>();

function workerKey(capsulePath: string, cwd: string): string {
  return `${capsulePath}|${cwd}`;
}

function getWorker(capsulePath: string, cwd: string): ChildProcess {
  const key = workerKey(capsulePath, cwd);
  const existing = workerRegistry.get(key);

  if (existing && existing.exitCode === null) {
    return existing;
  }

  if (existing) {
    existing.kill();
    workerRegistry.delete(key);
    workerStdout.delete(key);
  }

  const command = getCapsuleCommand(capsulePath);

  let child: ChildProcess;
  if (process.platform === 'win32') {
    const comspec = process.env.comspec || 'cmd.exe';
    child = spawn(comspec, ['/d', '/s', '/k', command, 'worker'], { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
  } else {
    child = spawn(command, ['worker'], { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
  }

  workerStdout.set(key, child.stdout);

  let lineBuffer = '';
  child.stdout!.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    let nl: number;

    while ((nl = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, nl);
      lineBuffer = lineBuffer.slice(nl + 1);

      let response: { id: string; output?: unknown; error?: string };

      try {
        response = JSON.parse(line);
      } catch {
        continue;
      }

      const request = pending.get(response.id);

      if (!request) continue;
      pending.delete(response.id);

      if (pending.size === 0) workerStdout.get(key)?.unref?.();

      if (response.error) {
        request.reject(new Error(response.error));
      } else {
        request.resolve(response.output as RunnerResult);
      }
    }
  });

  child.on('exit', () => {
    workerRegistry.delete(key);
    workerStdout.delete(key);
    for (const [id, req] of pending) {
      req.reject(new Error('Capsule worker process exited unexpectedly'));
      pending.delete(id);
    }
  });

  child.on('error', (err) => {
    workerRegistry.delete(key);
    workerStdout.delete(key);
    const message = (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? `Capsule CLI not found. Use 'npm install -g @capsule-run/cli' to install it.`
      : err.message;
    for (const [id, req] of pending) {
      req.reject(new Error(message));
      pending.delete(id);
    }
  });

  workerRegistry.set(key, child);
  process.once('exit', () => child.kill());

  child.unref();
  (child.stdout as any).unref();

  return child;
}

function getCapsuleCommand(capsulePath: string): string {
  if (process.platform === 'win32' && !capsulePath.endsWith('.cmd')) {
    return `${capsulePath}.cmd`;
  }
  return capsulePath;
}

function writeArgsFile(args: string[]): string {
  const path = join(tmpdir(), `capsule-args-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(args), 'utf-8');
  return path;
}

// --- run() via persistent worker ---

function runViaWorker(options: RunnerOptions): Promise<RunnerResult> {
  const { file, args = [], mounts = [], cwd, capsulePath = 'capsule' } = options;
  const resolvedCwd = cwd || process.cwd();
  const key = workerKey(capsulePath, resolvedCwd);
  const id = randomUUID();

  return new Promise((resolve, reject) => {
    const worker = getWorker(capsulePath, resolvedCwd);
    pending.set(id, { resolve, reject });

    workerStdout.get(key)?.ref?.();

    const request = JSON.stringify({ id, file, args, mounts }) + '\n';
    worker.stdin!.write(request, (err) => {
      if (err) {
        pending.delete(id);
        if (pending.size === 0) workerStdout.get(key)?.unref?.();
        reject(new Error(`Failed to send task to worker: ${err.message}`));
      }
    });
  });
}

// --- run() via subprocess (fallback) ---

function runViaSubprocess(options: RunnerOptions): Promise<RunnerResult> {
  const { file, args = [], mounts = [], cwd, capsulePath = 'capsule' } = options;
  const command = getCapsuleCommand(capsulePath);

  const resolvedFile = resolve(cwd || process.cwd(), file);
  const ext = extname(resolvedFile).toLowerCase();
  const isWasm = WASM_EXTENSIONS.has(ext);
  const subcommand = isWasm ? 'exec' : 'run';
  const mountFlags = mounts.flatMap(m => ['--mount', m]);

  const serializedArgs = JSON.stringify(args);
  const useArgsFile = Buffer.byteLength(serializedArgs, 'utf-8') > ARGS_FILE_THRESHOLD;

  let argsFilePath: string | null = null;
  let argsFlags: string[];

  if (useArgsFile) {
    argsFilePath = writeArgsFile(args);
    argsFlags = ['--args-file', argsFilePath];
  } else {
    argsFlags = args;
  }

  const cmdArgs = [subcommand, resolvedFile, '--json', ...mountFlags, ...argsFlags];

  let executable = command;
  let executionArgs = cmdArgs;

  if (process.platform === 'win32') {
    executable = process.env.comspec || 'cmd.exe';
    executionArgs = ['/d', '/s', '/c', command, ...cmdArgs];
  }

  return new Promise((resolve, reject) => {
    execFile(executable, executionArgs, { cwd, encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (argsFilePath) {
        try { unlinkSync(argsFilePath); } catch { }
      }

      if (error && !stdout) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`Capsule CLI not found. Use 'npm install -g @capsule-run/cli' to install it.`));
          return;
        }
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        const lines = stdout.trim().split('\n');
        resolve(JSON.parse(lines[lines.length - 1]));
      } catch {
        reject(new Error(`Failed to parse Capsule output: ${stdout}`));
      }
    });
  });
}

/**
 * Run a Capsule task from a third-party application.
 * Uses a persistent worker process to avoid per-call subprocess spawn overhead.
 *
 * @param options - Runner options
 * @returns Promise with the runner result
 */
export async function run(options: RunnerOptions): Promise<RunnerResult> {
  const { file, cwd } = options;

  const resolvedFile = resolve(cwd || process.cwd(), file);
  const ext = extname(resolvedFile).toLowerCase();
  const isWasm = WASM_EXTENSIONS.has(ext);

  if (!existsSync(resolvedFile)) {
    const hint = isWasm ? ` Run \`capsule build\` first to generate the .wasm artifact.` : '';
    throw new Error(`File not found: ${resolvedFile}.${hint}`);
  }

  try {
    return await runViaWorker(options);
  } catch (err) {
    const msg = (err as Error).message ?? '';

    const isTransport =
      msg.includes('worker process exited') ||
      msg.includes('CLI not found') ||
      msg.includes('Failed to send task');
    if (!isTransport) throw err;
    return runViaSubprocess(options);
  }
}
