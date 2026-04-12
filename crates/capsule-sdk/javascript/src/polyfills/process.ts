/**
 * Process polyfill for WASI environment
 * Provides Node.js-compatible process object with WASI-backed values
 */

declare const globalThis: {
    'wasi:cli/environment': {
        getEnvironment(): [string, string][];
        getArguments(): string[];
        initialCwd(): string | null;
    };
    'wasi:cli/stdin': {
        getStdin(): {
            blockingRead(len: bigint): [Uint8Array, boolean];
        };
    };
    'wasi:cli/stdout': {
        getStdout(): {
            blockingWriteAndFlush(buf: Uint8Array): void;
        };
    };
};

/**
 * Internal helper to safely get the WASI environment bindings.
 */
function getEnvBindings() {
    try {
        const env = globalThis['wasi:cli/environment'];

        if (env && typeof env.getEnvironment === 'function') {
            return env;
        }
    } catch {}
    return null;
}

/**
 * Lazy-loaded environment variables from WASI
 */
function getEnv(): Record<string, string> {
    const bindings = getEnvBindings();
    if (!bindings) {
        return {};
    }

    try {
        const envPairs = bindings.getEnvironment();
        return Object.fromEntries(envPairs);
    } catch (e) {
        console.error("Failed to fetch environment variables:", e);
        return {};
    }
}

/**
 * Lazy-loaded command-line arguments from WASI
 */
function getArgv(): string[] {
    const bindings = getEnvBindings();
    if (!bindings || typeof bindings.getArguments !== 'function') {
        return ['capsule', '/main.wasm'];
    }

    try {
        return ['capsule', '/main.wasm', ...bindings.getArguments()];
    } catch {
        return ['capsule', '/main.wasm'];
    }
}

/**
 * Initialized from wasi:cli/environment initialCwd(), falls back to '/'.
 */
let _virtualCwd: string = (() => {
    try {
        const env = (globalThis as any)['wasi:cli/environment'];
        if (env && typeof env.initialCwd === 'function') {
            const initial = env.initialCwd();
            if (initial) {
                 return initial.startsWith('/') ? initial : '/' + initial;
            }
        }
    } catch {}
    return '/';
})();

/**
 * Internal setter for virtual CWD — handles relative and absolute paths safely via absolute resolution.
 */
function setCwd(directory: string): void {
    if (!directory) return;
    if (directory.startsWith('/')) {
        _virtualCwd = directory.replace(/\/+$/, '') || '/';
    } else if (directory === '..') {
        const parts = _virtualCwd.split('/').filter(Boolean);
        parts.pop();
        _virtualCwd = '/' + parts.join('/');
    } else {
        const base = _virtualCwd.endsWith('/') ? _virtualCwd : _virtualCwd + '/';
        _virtualCwd = (base + directory).replace(/\/+$/, '');
    }
}

/**
 * Returns the current virtual CWD.
 * Exported so the fs polyfill can resolve relative paths against it.
 */
export function getCwd(): string {
    return _virtualCwd;
}

const process = {
    /**
     * Environment variables
     */
    get env(): Record<string, string> {
        return getEnv();
    },

    /**
     * Command-line arguments
     */
    get argv(): string[] {
        return getArgv();
    },

    /**
     * Returns the current virtual working directory.
     * Backed by in-process state, same as CPython's WASI libc.
     */
    cwd(): string {
        return getCwd();
    },

    /**
     * Change the virtual working directory.
     * Affects all relative path resolution in the fs polyfill.
     * Does not perform any real syscall — mirrors CPython WASI behaviour.
     */
    chdir(directory: string): void {
        setCwd(directory);
    },

    /**
     * Platform identifier
     */
    get platform(): 'linux' {
        return 'linux';
    },

    /**
     * Architecture identifier
     */
    get arch(): 'wasm32' {
        return 'wasm32';
    },

    /**
     * Process ID (not available in WASI)
     */
    get pid(): number {
        return 1;
    },

    /**
     * Parent process ID (not available in WASI)
     */
    get ppid(): number {
        return 0;
    },

    /**
     * Process uptime in seconds
     */
    uptime(): number {
        return 0;
    },

    /**
     * Node.js version (WASI doesn't have Node.js)
     */
    get version(): string {
        return 'v0.0.0-wasi';
    },

    /**
     * Node.js versions object
     */
    get versions(): Record<string, string> {
        return {
            wasi: '0.2.0',
        };
    },

    /**
     * Exit the process (not fully supported in WASI)
     */
    exit(code?: number): never {
        throw new Error(`Process exit requested with code ${code ?? 0}`);
    },

    /**
     * Abort the process
     */
    abort(): never {
        throw new Error('Process aborted');
    },

    /**
     * Queue a microtask (uses native queueMicrotask)
     */
    nextTick(callback: (...args: any[]) => void, ...args: any[]): void {
        queueMicrotask(() => callback(...args));
    },

    /**
     * Standard input — backed by wasi:cli/stdin@0.2.0.
     * Exposes a minimal EventEmitter-compatible Readable so that
     * MCP's StdioServerTransport can call stdin.on('data', ...).
     */
    get stdin(): any {
        const listeners: Array<(chunk: Uint8Array | string) => void> = [];
        let reading = false;

        function startReading() {
            if (reading) return;
            reading = true;
            (async () => {
                try {
                    const api = globalThis['wasi:cli/stdin'];
                    if (!api) return;
                    const stream = api.getStdin();
                    while (true) {
                        const [chunk, done] = stream.blockingRead(BigInt(4096));
                        if (chunk && chunk.length > 0) {
                            const buf = chunk;
                            listeners.forEach(fn => fn(buf));
                        }
                        if (done) {
                            endListeners.forEach(fn => fn());
                            break;
                        }
                    }
                } catch { /* stdin not available */ }
            })();
        }

        const endListeners: Array<() => void> = [];

        return {
            isTTY: false,
            readable: true,
            on(event: string, fn: (...args: any[]) => void) {
                if (event === 'data') { listeners.push(fn); startReading(); }
                if (event === 'end') { endListeners.push(fn); }
                return this;
            },
            once(event: string, fn: (...args: any[]) => void) {
                return this.on(event, fn);
            },
            pause() { return this; },
            resume() { startReading(); return this; },
            pipe(dest: any) { return dest; },
            setEncoding(_enc: string) { return this; },
        };
    },

    /**
     * Standard output — backed by wasi:cli/stdout@0.2.0.
     */
    get stdout(): any {
        return {
            isTTY: false,
            write(data: string | Uint8Array, _enc?: string, cb?: () => void): boolean {
                try {
                    const api = globalThis['wasi:cli/stdout'];
                    if (api) {
                        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
                        api.getStdout().blockingWriteAndFlush(bytes);
                    } else {
                        console.log(typeof data === 'string' ? data : new TextDecoder().decode(data));
                    }
                } catch {
                    console.log(typeof data === 'string' ? data : new TextDecoder().decode(data));
                }
                cb?.();
                return true;
            },
            end(data?: string | Uint8Array, cb?: () => void): void {
                if (data) this.write(data);
                cb?.();
            },
        };
    },

    get stderr(): any {
        return {
            write: (data: string) => console.error(data),
            isTTY: false,
        };
    },

    /**
     * Memory usage (not available in WASI)
     */
    memoryUsage(): {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
        arrayBuffers: number;
    } {
        return {
            rss: 0,
            heapTotal: 0,
            heapUsed: 0,
            external: 0,
            arrayBuffers: 0,
        };
    },

    /**
     * CPU usage (not available in WASI)
     */
    cpuUsage(previousValue?: { user: number; system: number }): {
        user: number;
        system: number;
    } {
        return {
            user: 0,
            system: 0,
        };
    },

    /**
     * High-resolution time
     */
    hrtime: {
        bigint(): bigint {
            return BigInt(Date.now() * 1000000);
        },
    },

    /**
     * Execute path
     */
    get execPath(): string {
        return '/usr/bin/capsule';
    },

    /**
     * Execution arguments
     */
    get execArgv(): string[] {
        return [];
    },

    /**
     * Title (not settable in WASI)
     */
    get title(): string {
        return 'capsule';
    },

};

export default process;

export const {
    env,
    argv,
    cwd,
    platform,
    arch,
    pid,
    ppid,
    version,
    versions,
    exit,
    nextTick,
    stdout,
    stderr,
    stdin,
} = process;

(globalThis as any).process = process;
