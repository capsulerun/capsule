# `Capsule` TypeScript Adapter

[![TypeScript Adapter Release](https://github.com/capsulerun/capsule/actions/workflows/typescript-adapter-release.yml/badge.svg)](https://github.com/capsulerun/capsule/actions/workflows/typescript-adapter-release.yml)

Execute Python and JavaScript code securely inside Capsule sandboxes from your TypeScript/JavaScript applications.

## Installation

```bash
npm install @capsule-run/adapter
```

## Usage

### Execute Python Code

```typescript
import { runPython } from '@capsule-run/adapter';

const result = await runPython(`
print("Hello from Python!")
x = 5 + 3
x * 2
`);

console.log(result); // "Hello from Python!\n16"
```

### Execute JavaScript Code

```typescript
import { runJavaScript } from '@capsule-run/adapter';

const result = await runJavaScript(`
console.log("Hello from JavaScript!");
const x = 5 + 3;
x * 2;
`);

console.log(result); // "Hello from JavaScript!\n16"
```

### Preload Sandboxes (Optional)

The first execution of a sandbox has a cold start (~1 second). You can preload sandboxes to warm them up for faster subsequent executions (~10ms):

```typescript
import { loadSandboxes, runPython } from '@capsule-run/adapter';

// Preload both sandboxes in parallel
await loadSandboxes();

// Now executions will be faster
const result = await runPython('print("Fast!")');
```

Or preload individually:

```typescript
import { loadPythonSandbox, loadJavaScriptSandbox } from '@capsule-run/adapter';

await loadPythonSandbox();      // Warm up Python only
await loadJavaScriptSandbox();  // Warm up JavaScript only
```

## Sessions (Persistent State)

Use `Session` to run code across multiple calls while preserving state. Each session gets an isolated workspace directory that is automatically cleaned up when the session ends.

```typescript
import { Session } from '@capsule-run/adapter';

await using s = new Session("python");
await s.run("x = 1");
const result = await s.run("x += 1; x");
console.log(result); // 2
```

JavaScript sessions work the same way:

```typescript
await using s = new Session("javascript");
await s.run("x = 1");
const result = await s.run("x += 1; x");
console.log(result); // 2
```

> `await using` automatically cleans up the session when it goes out of scope. You can also call `[Symbol.asyncDispose]()` manually if needed.

#### Import Files

Copy a file or directory from your filesystem into the session workspace. The sandbox code can then access it at the destination path under `workspace/`.

```typescript
await using s = new Session("python");

// Import a single file
await s.importFile("./notes.txt", "notes.txt");

// Import a directory
await s.importFile("./data/", "data/");

const result = await s.run(`
with open("workspace/notes.txt") as f:
    content = f.read()
content
`);
```

#### Export Files

Export file from the session workspace to your filesystem.

```typescript
await using s = new Session("python");
await s.importFile("./notes.txt", "notes.txt");

// Export a single file
await s.exportFile("notes.txt", "./exported_notes.txt");
```

#### Delete Files

Remove a file from the session workspace:

```typescript
await using s = new Session("python");
await s.importFile("./notes.txt", "notes.txt");
// ... do some work ...
await s.deleteFile("notes.txt");
```

#### Reset State

Clear the session's variable state without touching workspace files:

```typescript
await using s = new Session("python");
await s.run("x = 42");
s.reset();
const result = await s.run("x"); // throws
```


## How It Works

The adapter compiles Python and JavaScript sandboxes into WebAssembly modules during the build step. When you call `runPython()` or `runJavaScript()`, the adapter invokes these pre-built sandboxes using Capsule's runner with the code you provide.

Learn more about [Capsule](https://github.com/capsulerun/capsule).
