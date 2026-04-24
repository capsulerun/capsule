/**
 * Node.js fs polyfill for WASI environment
 * Provides both Node.js fs API
 */

import { getCwd } from './process.js';

declare const globalThis: {
    'wasi:filesystem/types': any;
    'wasi:filesystem/preopens': any;
};

interface WasiDatetime {
    seconds: bigint;
    nanoseconds: number;
}

interface DescriptorStat {
    type: string;
    linkCount: bigint;
    size: bigint;
    dataAccessTimestamp?: WasiDatetime | null;
    dataModificationTimestamp?: WasiDatetime | null;
    statusChangeTimestamp?: WasiDatetime | null;
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
    statAt(pathFlags: { symlinkFollow?: boolean }, path: string): DescriptorStat;
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
    readlinkAt(path: string): string;
    symlinkAt(oldPath: string, newPath: string): void;
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
    let p = path;

    if (p.startsWith('./')) p = p.slice(2);
    else if (p.startsWith('/')) p = p.slice(1);
    if (p.length > 1) p = p.replace(/\/+$/, '');

    return p || '.';
}

/**
 * Absolute paths pass through unchanged.
 */
function getEffectivePath(path: string): string {
    if (path.startsWith('/')) return path;

    const cwd = getCwd();
    if (cwd === '.' || cwd === '') return path;
    if (path === '.') return cwd;
    if (path.startsWith('./')) return cwd.replace(/\/+$/, '') + '/' + path.slice(2);
    return cwd.replace(/\/+$/, '') + '/' + path;
}

function resolveNormalizedPath(normalizedPath: string): { dir: Descriptor; relativePath: string } | null {
    const preopens = getPreopenedDirs();
    if (preopens.length === 0) return null;

    const sorted = [...preopens].sort((a, b) => b.guestPath.length - a.guestPath.length);

    let catchAll: { dir: Descriptor; relativePath: string } | null = null;

    for (const { descriptor, guestPath } of sorted) {
        const normalizedGuest = normalizePath(guestPath);

        if (normalizedGuest === '.' || normalizedGuest === '') {
            if (!catchAll) catchAll = { dir: descriptor, relativePath: normalizedPath };
            continue;
        }

        const guestPrefix = normalizedGuest.endsWith('/') ? normalizedGuest : normalizedGuest + '/';

        if (normalizedPath.startsWith(guestPrefix)) {
            const relativePath = normalizedPath.slice(guestPrefix.length);
            return { dir: descriptor, relativePath: relativePath || '.' };
        }

        if (normalizedPath === normalizedGuest) {
            return { dir: descriptor, relativePath: '.' };
        }
    }

    return catchAll ?? { dir: preopens[0].descriptor, relativePath: normalizedPath };
}

function resolvePath(path: string): { dir: Descriptor; relativePath: string } | null {
    const preopens = getPreopenedDirs();
    if (preopens.length === 0) return null;

    const normalizedPath = normalizePath(getEffectivePath(path));

    const sorted = [...preopens].sort((a, b) => b.guestPath.length - a.guestPath.length);

    let catchAll: { dir: Descriptor; relativePath: string } | null = null;

    for (const { descriptor, guestPath } of sorted) {
        const normalizedGuest = normalizePath(guestPath);

        if (normalizedGuest === '.' || normalizedGuest === '') {
            if (!catchAll) catchAll = { dir: descriptor, relativePath: normalizedPath };
            continue;
        }

        const guestPrefix = normalizedGuest.endsWith('/') ? normalizedGuest : normalizedGuest + '/';

        if (normalizedPath.startsWith(guestPrefix)) {
            const relativePath = normalizedPath.slice(guestPrefix.length);
            return { dir: descriptor, relativePath: relativePath || '.' };
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
    flag?: string;
}

interface WriteFileOptions {
    encoding?: Encoding;
    flag?: string;
    mode?: number;
}

interface ReaddirOptions {
    encoding?: Encoding;
    withFileTypes?: boolean;
    recursive?: boolean;
}

export class Dirent {
    name: string;
    private _type: string;
    constructor(name: string, type: string) {
        this.name = name;
        this._type = type;
    }
    isFile()            { return this._type === 'regular-file'; }
    isDirectory()       { return this._type === 'directory'; }
    isSymbolicLink()    { return this._type === 'symbolic-link'; }
    isFIFO()            { return this._type === 'fifo'; }
    isBlockDevice()     { return this._type === 'block-device'; }
    isCharacterDevice() { return this._type === 'character-device'; }
    isSocket()          { return this._type === 'socket'; }
}

/**
 * Read file contents
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
 * Write file contents
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
 * Read directory contents
 */
export function readdir(
    path: string,
    optionsOrCallback: ReaddirOptions | ((err: Error | null, files?: string[] | Dirent[]) => void),
    callback?: (err: Error | null, files?: string[] | Dirent[]) => void
): void {
    const options: ReaddirOptions = typeof optionsOrCallback === 'function' ? {} : (optionsOrCallback as ReaddirOptions) ?? {};
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

    if (options.withFileTypes) {
        listWithTypes(path)
            .then((entries) => cb?.(null, entries))
            .catch((err) => cb?.(err instanceof Error ? err : new Error(String(err))));
    } else {
        list(path)
            .then((files) => cb?.(null, files))
            .catch((err) => cb?.(err instanceof Error ? err : new Error(String(err))));
    }
}

/**
 * stat callback
 */
export function stat(
    path: string,
    callback: (err: Error | null, stats?: StatResult) => void
): void {
    Promise.resolve()
        .then(() => statSync(path))
        .then((s) => callback(null, s))
        .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
}

/**
 * lstat callback
 */
export function lstat(
    path: string,
    callback: (err: Error | null, stats?: StatResult) => void
): void {
    Promise.resolve()
        .then(() => lstatSync(path))
        .then((s) => callback(null, s))
        .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
}

/**
 * appendFile callback
 */
export function appendFile(
    path: string,
    data: string | Uint8Array,
    optionsOrCallback: WriteFileOptions | Encoding | ((err: Error | null) => void),
    callback?: (err: Error | null) => void
): void {
    const cb: ((err: Error | null) => void) | undefined =
        typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
    Promise.resolve()
        .then(() => appendFileSync(path, data))
        .then(() => cb?.(null))
        .catch((err) => cb?.(err instanceof Error ? err : new Error(String(err))));
}

// ---------------------------------------------------------------------------
// Sync implementations
// ---------------------------------------------------------------------------

function enoent(path: string): Error {
    return Object.assign(
        new Error(`ENOENT: no such file or directory, open '${path}'`),
        { code: 'ENOENT' }
    );
}

/**
 * Read file contents synchronously.
 */
export function readFileSync(path: string, options?: ReadFileOptions | Encoding): string | Uint8Array {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);

    try {
        const fd = resolved.dir.openAt({ symlinkFollow: false }, resolved.relativePath, {}, { read: true });
        const stat = fd.stat();
        const [data] = fd.read(stat.size, BigInt(0));
        const encoding = typeof options === 'string' ? options : options?.encoding;
        return (encoding === 'utf8' || encoding === 'utf-8') ? new TextDecoder().decode(data) : data;
    } catch (e) {
        if (e instanceof Error && (e as any).code) throw e;
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
    }
}

/**
 * Write data to a file synchronously.
 */
export function writeFileSync(path: string, data: string | Uint8Array, _options?: WriteFileOptions | Encoding): void {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);

    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    try {
        const fd = resolved.dir.openAt(
            { symlinkFollow: false },
            resolved.relativePath,
            { create: true, truncate: true },
            { write: true, mutateDirectory: true }
        );
        fd.write(bytes, BigInt(0));
    } catch (e) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
}

/**
 * Append data to a file synchronously, creating it if it doesn't exist.
 */
export function appendFileSync(path: string, data: string | Uint8Array, _options?: WriteFileOptions | Encoding): void {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);

    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    try {
        const fd = resolved.dir.openAt(
            { symlinkFollow: false },
            resolved.relativePath,
            { create: true },
            { write: true, mutateDirectory: true }
        );
        const stat = fd.stat();
        fd.write(bytes, stat.size);
    } catch (e) {
        throw new Error(`Failed to append to file '${path}': ${e}`);
    }
}

/**
 * Read directory contents synchronously.
 */
async function listWithTypes(path: string): Promise<Dirent[]> {
    const resolved = resolvePath(path);
    if (!resolved) throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${path}'`), { code: 'ENOENT' });

    try {
        let targetDir = resolved.dir;
        if (resolved.relativePath !== '.') {
            targetDir = resolved.dir.openAt(
                { symlinkFollow: false },
                resolved.relativePath,
                { directory: true },
                { read: true }
            );
        }
        const stream = targetDir.readDirectory();
        const entries: Dirent[] = [];
        let entry: DirectoryEntry | null | undefined;
        while ((entry = stream.readDirectoryEntry()) && entry) {
            if (entry.name) entries.push(new Dirent(entry.name, entry.type ?? 'unknown'));
        }
        return entries;
    } catch {
        throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${path}'`), { code: 'ENOENT' });
    }
}

export function readdirSync(path: string, options?: ReaddirOptions): string[] | Dirent[] {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);

    try {
        let targetDir = resolved.dir;
        if (resolved.relativePath !== '.') {
            targetDir = resolved.dir.openAt(
                { symlinkFollow: false },
                resolved.relativePath,
                { directory: true },
                { read: true }
            );
        }
        const stream = targetDir.readDirectory();
        const names: string[] = [];
        const dirents: Dirent[] = [];
        let entry: DirectoryEntry | null | undefined;
        while ((entry = stream.readDirectoryEntry()) && entry) {
            if (!entry.name) continue;
            if (options?.withFileTypes) {
                dirents.push(new Dirent(entry.name, entry.type ?? 'unknown'));
            } else {
                names.push(entry.name);
            }
        }
        return options?.withFileTypes ? dirents : names;
    } catch {
        throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${path}'`), { code: 'ENOENT' });
    }
}

export interface StatResult {
    isFile: () => boolean;
    isDirectory: () => boolean;
    isSymbolicLink: () => boolean;
    isFIFO: () => boolean;
    isBlockDevice: () => boolean;
    isCharacterDevice: () => boolean;
    isSocket: () => boolean;
    dev: number;
    ino: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    size: number;
    blksize: number;
    blocks: number;
    // timestamp (ms)
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    // timestamp (Date) — used by glob, fast-glob, chokidar etc.
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
}

function datetimeToMs(dt: WasiDatetime | null | undefined): number {
    if (!dt) return 0;
    return Number(dt.seconds) * 1000 + Math.floor(dt.nanoseconds / 1_000_000);
}

function makeStatResult(s: DescriptorStat): StatResult {
    const isDir  = s.type === 'directory';
    const isSym  = s.type === 'symbolic-link';
    const isFile = s.type === 'regular-file';
    const mtimeMs = datetimeToMs(s.dataModificationTimestamp);
    const atimeMs = datetimeToMs(s.dataAccessTimestamp);
    const ctimeMs = datetimeToMs(s.statusChangeTimestamp);
    const size    = Number(s.size);
    return {
        isFile:            () => isFile,
        isDirectory:       () => isDir,
        isSymbolicLink:    () => isSym,
        isFIFO:            () => s.type === 'fifo',
        isBlockDevice:     () => s.type === 'block-device',
        isCharacterDevice: () => s.type === 'character-device',
        isSocket:          () => s.type === 'socket',
        dev: 0, ino: 0, nlink: isDir ? 2 : 1,
        uid: 0, gid: 0, rdev: 0,
        size,
        blksize: 4096,
        blocks: Math.ceil(size / 512),
        mode: isDir ? 0o40755 : 0o100644,
        atimeMs, mtimeMs, ctimeMs, birthtimeMs: mtimeMs,
        atime:     new Date(atimeMs),
        mtime:     new Date(mtimeMs),
        ctime:     new Date(ctimeMs),
        birthtime: new Date(mtimeMs),
    };
}

/**
 * Get file stats synchronously (follows symlinks).
 */
export function statSync(path: string): StatResult {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);

    try {
        if (typeof resolved.dir.statAt === 'function') {
            const s = resolved.dir.statAt({ symlinkFollow: true }, resolved.relativePath);
            return makeStatResult(s);
        }

        const fd = resolved.dir.openAt({ symlinkFollow: true }, resolved.relativePath, {}, { read: true });
        return makeStatResult(fd.stat());
    } catch {
        throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${path}'`), { code: 'ENOENT' });
    }
}

/**
 * Get file stats synchronously without following symlinks (lstat).
 */
export function lstatSync(path: string): StatResult {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);

    try {
        if (typeof resolved.dir.statAt === 'function') {
            const s = resolved.dir.statAt({ symlinkFollow: false }, resolved.relativePath);
            return makeStatResult(s);
        }

        const fd = resolved.dir.openAt({ symlinkFollow: false }, resolved.relativePath, {}, { read: true });
        return makeStatResult(fd.stat());
    } catch {
        throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), { code: 'ENOENT' });
    }
}

/**
 * Create a directory synchronously.
 */
export function mkdirSync(path: string, options?: MkdirOptions): void {
    if (options?.recursive) {
        const normalized = normalizePath(getEffectivePath(path));
        const parts = normalized.split('/').filter(Boolean);
        for (let i = 1; i <= parts.length; i++) {
            const partial = parts.slice(0, i).join('/');
            const resolved = resolveNormalizedPath(partial);
            if (!resolved) continue;
            try { resolved.dir.createDirectoryAt(resolved.relativePath); } catch { /* already exists */ }
        }
    } else {
        const resolved = resolvePath(path);
        if (!resolved) throw enoent(path);
        try {
            resolved.dir.createDirectoryAt(resolved.relativePath);
        } catch (e) {
            throw Object.assign(new Error(`EEXIST: file already exists, mkdir '${path}'`), { code: 'EEXIST' });
        }
    }
}

/**
 * Remove a directory synchronously.
 */
export function rmdirSync(path: string, _options?: RmdirOptions): void {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);
    try {
        resolved.dir.removeDirectoryAt(resolved.relativePath);
    } catch (e) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, rmdir '${path}'`), { code: 'ENOENT' });
    }
}

/**
 * Remove a file or directory synchronously.
 */
function removeRecursiveSync(path: string): void {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);

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
            removeRecursiveSync(childPath);
        } else {
            const childResolved = resolvePath(childPath);
            if (childResolved) childResolved.dir.unlinkFileAt(childResolved.relativePath);
        }
    }

    resolved.dir.removeDirectoryAt(resolved.relativePath);
}

export function rmSync(path: string, options?: RmOptions): void {
    const resolved = resolvePath(path);
    if (!resolved) {
        if (options?.force) return;
        throw enoent(path);
    }

    try {
        const s = typeof resolved.dir.statAt === 'function'
            ? resolved.dir.statAt({ symlinkFollow: false }, resolved.relativePath)
            : (() => { const fd = resolved.dir.openAt({ symlinkFollow: false }, resolved.relativePath, {}, { read: true }); return fd.stat(); })();

        if (s.type === 'directory') {
            if (!options?.recursive) {
                throw Object.assign(
                    new Error(`EISDIR: illegal operation on a directory, rm '${path}'`),
                    { code: 'EISDIR' }
                );
            }
            removeRecursiveSync(path);
        } else {
            resolved.dir.unlinkFileAt(resolved.relativePath);
        }
    } catch (e) {
        if (options?.force) return;
        if (e instanceof Error && (e as any).code) throw e;
        throw enoent(path);
    }
}

/**
 * Remove a file synchronously.
 */
export function unlinkSync(path: string): void {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);
    try {
        resolved.dir.unlinkFileAt(resolved.relativePath);
    } catch (e) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, unlink '${path}'`), { code: 'ENOENT' });
    }
}

/**
 * Copy a file synchronously.
 */
export function copyFileSync(src: string, dest: string): void {
    const data = readFileSync(src) as Uint8Array;
    writeFileSync(dest, data);
}

/**
 * Rename a file or directory synchronously.
 */
export function renameSync(oldPath: string, newPath: string): void {
    try {
        const data = readFileSync(oldPath);
        writeFileSync(newPath, data as Uint8Array);
        unlinkSync(oldPath);
    } catch (e) {
        throw Object.assign(
            new Error(`ENOENT: no such file or directory, rename '${oldPath}' -> '${newPath}'`),
            { code: 'ENOENT' }
        );
    }
}

/**
 * Check file accessibility synchronously.
 * Throws if the path does not exist.
 */
export function accessSync(path: string, _mode?: number): void {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);
    try {
        resolved.dir.openAt({ symlinkFollow: false }, resolved.relativePath, {}, { read: true });
    } catch (e) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, access '${path}'`), { code: 'ENOENT' });
    }
}

/**
 * Check if a path exists synchronously.
 */
export function existsSync(path: string): boolean {
    const resolved = resolvePath(path);
    if (!resolved) return false;
    try {
        resolved.dir.openAt({ symlinkFollow: false }, resolved.relativePath, {}, { read: true });
        return true;
    } catch {
        return false;
    }
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
 * Read the target of a symlink synchronously.
 */
export function readlinkSync(path: string): string {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);
    try {
        if (typeof resolved.dir.readlinkAt !== 'function') {
            throw Object.assign(
                new Error(`ENOSYS: function not implemented, readlink '${path}'`),
                { code: 'ENOSYS' }
            );
        }
        return resolved.dir.readlinkAt(resolved.relativePath);
    } catch (e) {
        if (e instanceof Error && (e as any).code) throw e;
        throw Object.assign(
            new Error(`EINVAL: invalid argument, readlink '${path}'`),
            { code: 'EINVAL' }
        );
    }
}

/**
 * Read the target of a symlink asynchronously (callback style).
 */
export function readlink(
    path: string,
    callback: (err: Error | null, linkString?: string) => void
): void {
    Promise.resolve()
        .then(() => readlinkSync(path))
        .then((target) => callback(null, target))
        .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
}

/**
 * Create a symbolic link synchronously.
 * target: the link destination (relative to the sandbox — cannot escape it).
 * path:   the new symlink path.
 */
export function symlinkSync(target: string, path: string): void {
    const resolved = resolvePath(path);
    if (!resolved) throw enoent(path);
    try {
        if (typeof resolved.dir.symlinkAt !== 'function') {
            throw Object.assign(
                new Error(`ENOSYS: function not implemented, symlink '${target}' -> '${path}'`),
                { code: 'ENOSYS' }
            );
        }
        resolved.dir.symlinkAt(target, resolved.relativePath);
    } catch (e) {
        if (e instanceof Error && (e as any).code) throw e;
        throw Object.assign(
            new Error(`ENOSYS: function not implemented, symlink '${target}' -> '${path}'`),
            { code: 'ENOSYS' }
        );
    }
}

/**
 * Create a symbolic link asynchronously (callback style).
 */
export function symlink(
    target: string,
    path: string,
    callback: (err: Error | null) => void
): void {
    Promise.resolve()
        .then(() => symlinkSync(target, path))
        .then(() => callback(null))
        .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
}

/**
 * Internal helper — returns the entry type for a path without building a full StatResult.
 */
async function statPath(path: string): Promise<'file' | 'directory' | 'notfound'> {
    const resolved = resolvePath(path);
    if (!resolved) return 'notfound';

    try {
        const s = typeof resolved.dir.statAt === 'function'
            ? resolved.dir.statAt({ symlinkFollow: false }, resolved.relativePath)
            : (() => { const fd = resolved.dir.openAt({ symlinkFollow: false }, resolved.relativePath, {}, { read: true }); return fd.stat(); })();
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
        const normalized = normalizePath(getEffectivePath(path));
        const parts = normalized.split('/').filter(Boolean);
        for (let i = 1; i <= parts.length; i++) {
            const partial = parts.slice(0, i).join('/');
            const resolved = resolveNormalizedPath(partial);
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

        const destKind = await statPath(dest);
        const srcName = src.replace(/\/$/, '').split('/').pop()!;
        const effectiveDest = destKind === 'directory'
            ? dest.replace(/\/$/, '') + '/' + srcName
            : dest;

        await copyDirRecursive(src, effectiveDest);
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

    async readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]> {
        return options?.withFileTypes ? listWithTypes(path) : list(path);
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

    async stat(path: string): Promise<StatResult> {
        const resolved = resolvePath(path);
        if (!resolved) {
            throw Object.assign(
                new Error(`ENOENT: no such file or directory, stat '${path}'`),
                { code: 'ENOENT' }
            );
        }
        try {
            if (typeof resolved.dir.statAt === 'function') {
                const s = resolved.dir.statAt({ symlinkFollow: true }, resolved.relativePath);
                return makeStatResult(s);
            }

            const fd = resolved.dir.openAt({ symlinkFollow: true }, resolved.relativePath, {}, { read: true });
            return makeStatResult(fd.stat());
        } catch {
            throw Object.assign(
                new Error(`ENOENT: no such file or directory, stat '${path}'`),
                { code: 'ENOENT' }
            );
        }
    },

    async lstat(path: string): Promise<StatResult> {
        const resolved = resolvePath(path);
        if (!resolved) throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), { code: 'ENOENT' });
        try {
            if (typeof resolved.dir.statAt === 'function') {
                return makeStatResult(resolved.dir.statAt({ symlinkFollow: false }, resolved.relativePath));
            }
            const fd = resolved.dir.openAt({ symlinkFollow: false }, resolved.relativePath, {}, { read: true });
            return makeStatResult(fd.stat());
        } catch {
            throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), { code: 'ENOENT' });
        }
    },

    async readlink(path: string): Promise<string> {
        return readlinkSync(path);
    },

    async symlink(target: string, path: string): Promise<void> {
        symlinkSync(target, path);
    },

    async appendFile(path: string, data: string | Uint8Array): Promise<void> {
        appendFileSync(path, data);
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
        renameSync(oldPath, newPath);
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

export const constants = {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
    O_RDONLY: 0,
    O_WRONLY: 1,
    O_RDWR:   2,
    O_CREAT:  64,
    O_TRUNC:  512,
    O_APPEND: 1024,
};

const fs = {
    // Async / callback
    readFile,
    writeFile,
    appendFile,
    readdir,
    stat,
    lstat,
    readlink,
    symlink,
    unlink,
    rmdir,
    rm,
    mkdir,
    copyFile,
    cp,
    // Sync
    readFileSync,
    writeFileSync,
    appendFileSync,
    readdirSync,
    statSync,
    lstatSync,
    readlinkSync,
    symlinkSync,
    mkdirSync,
    rmdirSync,
    rmSync,
    unlinkSync,
    copyFileSync,
    renameSync,
    accessSync,
    existsSync,
    // Promises API
    promises,
    // Constants
    constants,
    Dirent,
};

export default fs;
