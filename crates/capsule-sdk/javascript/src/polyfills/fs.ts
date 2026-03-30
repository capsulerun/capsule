/**
 * Node.js fs polyfill for WASI environment
 * Provides both Node.js fs API
 */

declare const globalThis: {
    'wasi:filesystem/types': any;
    'wasi:filesystem/preopens': any;
};

interface DescriptorStat {
    size: bigint;
    type?: string;
}

interface DirectoryEntry {
    name: string;
    type?: string;
}

interface DirectoryStream {
    readDirectoryEntry(): DirectoryEntry | null;
}

interface Descriptor {
    read(length: bigint, offset: bigint): [Uint8Array, boolean];
    write(buffer: Uint8Array, offset: bigint): bigint;
    stat(): DescriptorStat;
    readDirectory(): DirectoryStream;
    unlinkFileAt(path: string): void;
    removeDirectoryAt(path: string): void;
    createDirectoryAt(path: string): void;
    openAt(
        pathFlags: { symlinkFollow?: boolean },
        path: string,
        openFlags: { create?: boolean; directory?: boolean; exclusive?: boolean; truncate?: boolean },
        descriptorFlags: { read?: boolean; write?: boolean; mutateDirectory?: boolean }
    ): Descriptor;
}

interface PreopenedDir {
    descriptor: Descriptor;
    guestPath: string;
}

function getFsBindings(): { types: any; preopens: any } | null {
    try {
        const types = globalThis['wasi:filesystem/types'];
        const preopens = globalThis['wasi:filesystem/preopens'];
        if (types && preopens) {
            return { types, preopens };
        }
    } catch {}
    return null;
}

function getPreopenedDirs(): PreopenedDir[] {
    const fs = getFsBindings();
    if (!fs) return [];

    try {
        const dirs = fs.preopens.getDirectories();
        return (dirs || []).map((entry: [Descriptor, string]) => ({
            descriptor: entry[0],
            guestPath: entry[1]
        }));
    } catch {
        return [];
    }
}

function normalizePath(path: string): string {
    if (path.startsWith('./')) {
        return path.slice(2);
    }
    return path;
}

function resolvePath(path: string): { dir: Descriptor; relativePath: string } | null {
    const preopens = getPreopenedDirs();
    if (preopens.length === 0) return null;

    const normalizedPath = normalizePath(path);

    let catchAll: { dir: Descriptor; relativePath: string } | null = null;

    for (const { descriptor, guestPath } of preopens) {
        const normalizedGuest = normalizePath(guestPath);

        if (normalizedGuest === '.' || normalizedGuest === '') {
            if (!catchAll) catchAll = { dir: descriptor, relativePath: normalizedPath };
            continue;
        }

        if (normalizedPath.startsWith(normalizedGuest + '/')) {
            const relativePath = normalizedPath.slice(normalizedGuest.length + 1);
            return { dir: descriptor, relativePath };
        }

        if (normalizedPath === normalizedGuest) {
            return { dir: descriptor, relativePath: '.' };
        }
    }

    return catchAll ?? { dir: preopens[0].descriptor, relativePath: normalizedPath };
}

/**
 * Read a file as text.
 */
export async function readText(path: string): Promise<string> {
    const bytes = await readBytes(path);
    return new TextDecoder().decode(bytes);
}

/**
 * Read a file as bytes.
 */
export async function readBytes(path: string): Promise<Uint8Array> {
    const resolved = resolvePath(path);
    if (!resolved) {
        throw new Error("File not found.");
    }

    try {
        const pathFlags = { symlinkFollow: false };
        const openFlags = {};
        const descriptorFlags = { read: true };

        const fd = resolved.dir.openAt(pathFlags, resolved.relativePath, openFlags, descriptorFlags);
        const stat = fd.stat();
        const [data] = fd.read(stat.size, BigInt(0));
        return data;
    } catch (e) {
        throw new Error(`Failed to read file '${path}': ${e}`);
    }
}

/**
 * Write text content to a file.
 */
export async function writeText(path: string, content: string): Promise<void> {
    const bytes = new TextEncoder().encode(content);
    await writeBytes(path, bytes);
}

/**
 * Write bytes to a file.
 */
export async function writeBytes(path: string, data: Uint8Array): Promise<void> {
    const resolved = resolvePath(path);
    if (!resolved) {
        throw new Error("File not found.");
    }

    try {
        const pathFlags = { symlinkFollow: false };
        const openFlags = { create: true, truncate: true };
        const descriptorFlags = { write: true, mutateDirectory: true };

        const fd = resolved.dir.openAt(pathFlags, resolved.relativePath, openFlags, descriptorFlags);
        fd.write(data, BigInt(0));
    } catch (e) {
        throw new Error(`Failed to write file '${path}': ${e}`);
    }
}

/**
 * List files/directories at a path.
 */
export async function list(path: string = "."): Promise<string[]> {
    const resolved = resolvePath(path);
    if (!resolved) {
        throw new Error("Path not found.");
    }

    try {
        let targetDir = resolved.dir;
        if (resolved.relativePath !== ".") {
            const pathFlags = { symlinkFollow: false };
            const openFlags = { directory: true };
            const descriptorFlags = { read: true };
            targetDir = resolved.dir.openAt(pathFlags, resolved.relativePath, openFlags, descriptorFlags);
        }

        const stream = targetDir.readDirectory();
        const entries: string[] = [];

        let entry;
        while ((entry = stream.readDirectoryEntry()) && entry) {
            if (entry.name) {
                entries.push(entry.name);
            }
        }

        return entries;
    } catch (e) {
        throw new Error(`Failed to list directory '${path}': ${e}`);
    }
}

/**
 * Check if a file or directory exists.
 */
export async function exists(path: string): Promise<boolean> {
    const resolved = resolvePath(path);
    if (!resolved) {
        return false;
    }

    try {
        const pathFlags = { symlinkFollow: false };
        const openFlags = {};
        const descriptorFlags = { read: true };
        resolved.dir.openAt(pathFlags, resolved.relativePath, openFlags, descriptorFlags);
        return true;
    } catch {
        return false;
    }
}

type Encoding = 'utf8' | 'utf-8' | 'buffer' | null | undefined;

interface ReadFileOptions {
    encoding?: Encoding;
}

interface WriteFileOptions {
    encoding?: Encoding;
}

/**
 * Read file contents (async/callback style)
 */
export function readFile(
    path: string,
    optionsOrCallback: ReadFileOptions | Encoding | ((err: Error | null, data?: string | Uint8Array) => void),
    callback?: (err: Error | null, data?: string | Uint8Array) => void
): void {
    let options: ReadFileOptions = {};
    let cb: ((err: Error | null, data?: string | Uint8Array) => void) | undefined;

    if (typeof optionsOrCallback === 'function') {
        cb = optionsOrCallback;
    } else if (typeof optionsOrCallback === 'string') {
        options = { encoding: optionsOrCallback as Encoding };
        cb = callback;
    } else if (optionsOrCallback) {
        options = optionsOrCallback;
        cb = callback;
    }

    const encoding = options.encoding;
    const isText = encoding === 'utf8' || encoding === 'utf-8';

    const promise = isText ? readText(path) : readBytes(path);

    promise
        .then((data) => cb?.(null, data))
        .catch((err) => cb?.(err instanceof Error ? err : new Error(String(err))));
}

/**
 * Write file contents (async/callback style)
 */
export function writeFile(
    path: string,
    data: string | Uint8Array,
    optionsOrCallback: WriteFileOptions | Encoding | ((err: Error | null) => void),
    callback?: (err: Error | null) => void
): void {
    const cb: ((err: Error | null) => void) | undefined =
        typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

    const promise = typeof data === 'string'
        ? writeText(path, data)
        : writeBytes(path, data);

    promise
        .then(() => cb?.(null))
        .catch((err) => cb?.(err instanceof Error ? err : new Error(String(err))));
}

/**
 * Read directory contents (async/callback style)
 */
export function readdir(
    path: string,
    optionsOrCallback: any | ((err: Error | null, files?: string[]) => void),
    callback?: (err: Error | null, files?: string[]) => void
): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

    list(path)
        .then((files) => cb?.(null, files))
        .catch((err) => cb?.(err instanceof Error ? err : new Error(String(err))));
}

/**
 * Check if file/directory exists (sync-style, limited in WASM)
 */
export function existsSync(_path: string): boolean {
    console.warn('fs.existsSync: Cannot implement true sync in WASM. Use fs.access instead.');
    return false;
}

/**
 * Delete a file.
 */
export async function unlink(path: string): Promise<void> {
    const resolved = resolvePath(path);
    if (!resolved) {
        throw new Error("File not found.");
    }

    const fs = getFsBindings();
    if (!fs) {
        throw new Error("File not found.");
    }

    try {
        resolved.dir.unlinkFileAt(resolved.relativePath);
    } catch (e) {
        throw new Error(`Failed to delete file '${path}': ${e}`);
    }
}

/**
 * Returns 'file', 'directory', or 'notfound' for a given path.
 */
async function statPath(path: string): Promise<'file' | 'directory' | 'notfound'> {
    const resolved = resolvePath(path);
    if (!resolved) return 'notfound';

    try {
        const fd = resolved.dir.openAt({ symlinkFollow: false }, resolved.relativePath, {}, { read: true });
        const s = fd.stat();
        if (s.type === 'directory') return 'directory';
        return 'file';
    } catch {
        return 'notfound';
    }
}

/**
 * Recursively delete a directory and all its contents.
 */
async function removeRecursive(path: string): Promise<void> {
    const resolved = resolvePath(path);
    if (!resolved) throw new Error(`Path not found: '${path}'`);

    const fd = resolved.dir.openAt(
        { symlinkFollow: false },
        resolved.relativePath,
        { directory: true },
        { read: true, mutateDirectory: true }
    );

    const stream = fd.readDirectory();
    let entry: DirectoryEntry | null | undefined;

    while ((entry = stream.readDirectoryEntry()) && entry) {
        if (!entry.name) continue;
        const childPath = path.replace(/\/$/, '') + '/' + entry.name;
        if (entry.type === 'directory') {
            await removeRecursive(childPath);
        } else {
            await unlink(childPath);
        }
    }

    resolved.dir.removeDirectoryAt(resolved.relativePath);
}

export interface RmdirOptions {
    recursive?: boolean;
}

/**
 * Delete a directory. Pass `{ recursive: true }` to remove it and all its contents.
 */
export async function rmdir(path: string, options?: RmdirOptions): Promise<void> {
    const resolved = resolvePath(path);
    if (!resolved) {
        throw new Error("Folder not found.");
    }

    try {
        if (options?.recursive) {
            await removeRecursive(path);
        } else {
            resolved.dir.removeDirectoryAt(resolved.relativePath);
        }
    } catch (e) {
        if (e instanceof Error && e.message.startsWith('Failed to remove')) throw e;
        throw new Error(`Failed to remove directory '${path}': ${e}`);
    }
}

export interface RmOptions {
    recursive?: boolean;
    force?: boolean;
}

/**
 * Remove a file or directory. Supports `{ recursive, force }` options.
 */
export async function rm(path: string, options?: RmOptions): Promise<void> {
    const kind = await statPath(path);

    if (kind === 'notfound') {
        if (options?.force) return;
        throw new Error(`ENOENT: no such file or directory, rm '${path}'`);
    }

    if (kind === 'directory') {
        if (!options?.recursive) {
            throw new Error(`EISDIR: illegal operation on a directory, rm '${path}' (use { recursive: true })`);
        }
        await removeRecursive(path);
    } else {
        await unlink(path);
    }
}

export interface MkdirOptions {
    recursive?: boolean;
}

/**
 * Create a directory. Pass `{ recursive: true }` to create intermediate directories.
 */
export async function mkdir(path: string, options?: MkdirOptions): Promise<void> {
    if (options?.recursive) {
        const normalized = normalizePath(path);
        const parts = normalized.split('/').filter(Boolean);
        for (let i = 1; i <= parts.length; i++) {
            const partial = parts.slice(0, i).join('/');
            const resolved = resolvePath(partial);
            if (!resolved) continue;
            try {
                resolved.dir.createDirectoryAt(resolved.relativePath);
            } catch {
                // Directory may already exist, continue
            }
        }
    } else {
        const resolved = resolvePath(path);
        if (!resolved) throw new Error(`Cannot resolve path: '${path}'`);
        try {
            resolved.dir.createDirectoryAt(resolved.relativePath);
        } catch (e) {
            throw new Error(`Failed to create directory '${path}': ${e}`);
        }
    }
}

/**
 * Copy a file from src to dest.
 */
export async function copyFile(src: string, dest: string): Promise<void> {
    const data = await readBytes(src);
    await writeBytes(dest, data);
}

async function copyDirRecursive(src: string, dest: string): Promise<void> {
    await mkdir(dest, { recursive: true });
    const entries = await list(src);
    for (const entry of entries) {
        const srcEntry = src.replace(/\/$/, '') + '/' + entry;
        const destEntry = dest.replace(/\/$/, '') + '/' + entry;
        const kind = await statPath(srcEntry);
        if (kind === 'directory') {
            await copyDirRecursive(srcEntry, destEntry);
        } else {
            await copyFile(srcEntry, destEntry);
        }
    }
}

export interface CpOptions {
    recursive?: boolean;
}

/**
 * Copy a file or directory. Pass `{ recursive: true }` to copy directories.
 */
export async function cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const kind = await statPath(src);
    if (kind === 'notfound') {
        throw new Error(`ENOENT: no such file or directory '${src}'`);
    }
    if (kind === 'directory') {
        if (!options?.recursive) {
            throw new Error(`EISDIR: illegal operation on a directory '${src}' (use { recursive: true })`);
        }
        await copyDirRecursive(src, dest);
    } else {
        await copyFile(src, dest);
    }
}

/**
 * Promises API
 */
export const promises = {
    async readFile(path: string, options?: ReadFileOptions | Encoding): Promise<string | Uint8Array> {
        const encoding = typeof options === 'string' ? options : options?.encoding;
        const isText = encoding === 'utf8' || encoding === 'utf-8';
        return isText ? readText(path) : readBytes(path);
    },

    async writeFile(path: string, data: string | Uint8Array): Promise<void> {
        if (typeof data === 'string') {
            await writeText(path, data);
        } else {
            await writeBytes(path, data);
        }
    },

    async readdir(path: string): Promise<string[]> {
        return list(path);
    },

    async access(path: string): Promise<void> {
        const fileExists = await exists(path);
        if (!fileExists) {
            throw new Error(`ENOENT: no such file or directory, access '${path}'`);
        }
    },

    async unlink(path: string): Promise<void> {
        await unlink(path);
    },

    async stat(path: string): Promise<{ isFile: () => boolean; isDirectory: () => boolean }> {
        const kind = await statPath(path);
        if (kind === 'notfound') {
            throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
        }
        return {
            isFile: () => kind === 'file',
            isDirectory: () => kind === 'directory',
        };
    },

    async rmdir(path: string, options?: RmdirOptions): Promise<void> {
        await rmdir(path, options);
    },

    async rm(path: string, options?: RmOptions): Promise<void> {
        await rm(path, options);
    },

    async mkdir(path: string, options?: MkdirOptions): Promise<void> {
        await mkdir(path, options);
    },

    async copyFile(src: string, dest: string): Promise<void> {
        await copyFile(src, dest);
    },

    async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
        await cp(src, dest, options);
    },
};

const fs = {
    readFile,
    writeFile,
    readdir,
    existsSync,
    unlink,
    rmdir,
    rm,
    mkdir,
    copyFile,
    cp,
    promises,
};

export default fs;
