/**
 * Capsule SDK - SDK Runner
 *
 * Provides the `run` functions for running Capsule tasks
 * from third party applications.
 */

import { execFile } from 'child_process';
import { resolve, extname, join } from 'path';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
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

const WASM_EXTENSIONS = new Set(['.wasm']);
const ARGS_FILE_THRESHOLD = 8 * 1024;

/**
 * Get the appropriate capsule command for the current platform
 */
function getCapsuleCommand(capsulePath: string): string {
  if (process.platform === 'win32' && !capsulePath.endsWith('.cmd')) {
    return `${capsulePath}.cmd`;
  }
  return capsulePath;
}

/**
 * Write args to a temp file and return its path.
 * Caller is responsible for deleting it.
 */
function writeArgsFile(args: string[]): string {
  const path = join(tmpdir(), `capsule-args-${randomUUID()}.json`);
  writeFileSync(path, JSON.stringify(args), 'utf-8');
  return path;
}

/**
 * Run a Capsule task from a third-party application
 *
 * @param options - Runner options
 * @returns Promise with the runner result
 */
export function run(options: RunnerOptions): Promise<RunnerResult> {
  const { file, args = [], mounts = [], cwd, capsulePath = 'capsule' } = options;
  const command = getCapsuleCommand(capsulePath);

  const resolvedFile = resolve(cwd || process.cwd(), file);
  const ext = extname(resolvedFile).toLowerCase();
  const isWasm = WASM_EXTENSIONS.has(ext);

  if (!existsSync(resolvedFile)) {
    const hint = isWasm
      ? ` Run \`capsule build\` first to generate the .wasm artifact.`
      : '';
    return Promise.reject(new Error(`File not found: ${resolvedFile}.${hint}`));
  }

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
          reject(new Error(
            `Capsule CLI not found. Use 'npm install -g @capsule-run/cli' to install it.`
          ));
          return;
        }
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        resolve(JSON.parse(jsonLine));
      } catch {
        reject(new Error(`Failed to parse Capsule output: ${stdout}`));
      }
    });
  });
}
