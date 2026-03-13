# Capsule TypeScript Adapter

Execute Python and JavaScript code securely inside Capsule sandboxes from your TypeScript/JavaScript applications.

## Installation

```bash
npm install @capsule-run/adapter
```

## Usage

### Execute Python Code

```typescript
import { executePython } from '@capsule-run/adapter';

const result = await executePython(`
print("Hello from Python!")
x = 5 + 3
x * 2
`);

console.log(result); // "Hello from Python!\n16"
```

### Execute JavaScript Code

```typescript
import { executeJavaScript } from '@capsule-run/adapter';

const result = await executeJavaScript(`
console.log("Hello from JavaScript!");
const x = 5 + 3;
x * 2;
`);

console.log(result); // "Hello from JavaScript!\n16"
```

### Preload Sandboxes (Optional)

The first execution of a sandbox has a cold start (~1 second). You can preload sandboxes to warm them up for faster subsequent executions (~10ms):

```typescript
import { loadSandboxes, executePython } from '@capsule-run/adapter';

// Preload both sandboxes in parallel
await loadSandboxes();

// Now executions will be faster
const result = await executePython('print("Fast!")');
```

Or preload individually:

```typescript
import { loadPythonSandbox, loadJavaScriptSandbox } from '@capsule-run/adapter';

await loadPythonSandbox();      // Warm up Python only
await loadJavaScriptSandbox();  // Warm up JavaScript only
```

## How It Works

The adapter compiles Python and JavaScript sandboxes into WebAssembly modules during the build step. When you call `executePython()` or `executeJavaScript()`, the adapter invokes these pre-built sandboxes using Capsule's runner with the code you provide.

## Building from Source

```bash
npm install
npm run build
```

This will:
1. Compile the Python sandbox (`src/python_sandbox.py`) to `dist/sandboxes/python_sandbox.wasm`
2. Compile the JavaScript sandbox (`src/js_sandbox.ts`) to `dist/sandboxes/js_sandbox.wasm`
3. Build the TypeScript adapter code to `dist/index.js`
