/**
 * Capsule SDK - SDK Runner
 *
 * Provides the `run` functions for running Capsule tasks
 * from third party applications.
 */

import { execFile } from 'child_process';
import { resolve, extname } from 'path';
import { existsSync } from 'fs';

export interface RunnerOptions {
  file: string;
  args?: string[];
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
  };
}

const WASM_EXTENSIONS = new Set(['.wasm']);

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
 * Run a Capsule task from a third-party application
 *
 * @param options - Runner options
 * @returns Promise with the runner result
 */
export function run(options: RunnerOptions): Promise<RunnerResult> {
  const { file, args = [], cwd, capsulePath = 'capsule' } = options;
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

  return new Promise((resolve, reject) => {
    const cmdArgs = [subcommand, resolvedFile, '--json', ...args];

    let executable = command;
    let executionArgs = cmdArgs;

    if (process.platform === 'win32') {
      executable = process.env.comspec || 'cmd.exe';
      executionArgs = ['/d', '/s', '/c', command, ...cmdArgs];
    }

    execFile(executable, executionArgs, { cwd, encoding: 'utf-8' }, (error, stdout, stderr) => {
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
