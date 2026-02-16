# 📌 Roadmap

This document tracks the development status of Capsule.

> [!NOTE]
> This roadmap reflects current priorities. Feature requests and ideas are welcome in [Issues](https://github.com/mavdol/capsule/issues).

---

## v0.1.0: The Python Runner

**Status:** ✅ Done

**Goal:** Validating the core Host/Guest technology and Python interoperability.

- [x] **Core:** Rust Host capable of loading Wasm Components.
- [x] **SDK (Python):** Basic `@task` decorator with JSON serialization.
- [x] **CLI:** `capsule run main.py` with JIT compilation.
- [x] **Limits:** Basic Fuel metering for CPU protection.
- [x] **Resilience:** Retry logic and real Timeout handling (Wall clock).

---

## v0.2.0: Production & Polyglot

**Status:** ✅ Done

**Goal:** Stability, security, and expanding the ecosystem.

- [x] **TypeScript SDK:** Functional wrapper support (`const t = task(...)`).
- [x] **Better Logs:** Better logging for debugging and monitoring.
- [x] **Distribution:** CI/CD for binaries and Package Registries (PyPI, npm, crates.io).

---

## v0.3.0: Data Access (Filesystem)

**Status:** ✅ Done

**Goal:** Enable agents to work with local files and datasets.

- [x] **Filesystem:** Local file mounting (`fs_access`) for reading images, CSVs, and datasets.

---

## v0.4.0: Configuration & Observability

**Status:** ✅ Done

**Goal:** Improve developer workflow with project configuration and richer task feedback.

- [x] **Config File:** `capsule.toml` for default task options.
- [x] **Structured Output:** Tasks return a detailed JSON envelope with execution metadata:

```json
{
  "success": true,
  "result": "<task return value>",
  "error": null,
  "execution": {
    "task_name": "analyze_data",
    "duration_ms": 1523,
    "retries": 0,
    "fuel_consumed": 45000
  }
}
```

On failure:

```json
{
  "success": false,
  "result": null,
  "error": {
    "type": "timeout",
    "message": "Task exceeded 30s timeout limit"
  },
  "execution": {
    "task_name": "analyze_data",
    "duration_ms": 30000,
    "retries": 1,
    "fuel_consumed": null
  }
}
```

---

## v0.5.0: Node.js Ecosystem Compatibility Extended

**Status:** ✅ Done

**Goal:** Enable natural Node.js development patterns and improve npm package compatibility in WASM.

**Polyfills needed:**

- [x] **path:** Use `path-browserify` and alias `import path from 'path'`.
- [x] **os:** Custom minimal polyfill for `import os from 'os'`.
- [x] **process:** Comprehensive `process` polyfill (env, argv, cwd, exit, nextTick) injected as a global via esbuild.
- [x] **url:** Alias Node's `import { URL } from 'url'` to native Web `URL` class.
- [x] **buffer:** Use `buffer` package to polyfill Node.js `Buffer` class → `Uint8Array`.
- [x] **events:** Use `events` package to polyfill `EventEmitter`.
- [x] **stream:** Use `readable-stream` for Node.js stream compatibility.
- [x] **stream-web:** Use `stream-web` for Node.js stream/web compatibility.
- [x] **fs:** Map `import fs from 'fs'` to WASI file operations:
  - `fs.readFile()` → Capsule's `readText()`/`readBytes()`
  - `fs.writeFile()` → Capsule's `writeText()`/`writeBytes()`
  - `fs.readdir()` → Capsule's `list()`

---

## v0.6.0: SDK Runner & Network Controls

**Status:** ✅ Done

**Goal:** Enable seamless third-party integration and basic network security.

- [x] **SDK Runner:** Add `run()` function to both SDKs for async subprocess execution.
```typescript
// JavaScript/TypeScript
import { run } from '@capsule-run/sdk/runner';

const result = await run({
  file: './capsule.ts',
  args: ['code to execute']
});
```

```python
# Python
from capsule import run

result = await run(
    file="./capsule.py",
    args=["code to execute"]
)
```
- [x] **Allowed Hosts:** Restrict outgoing HTTP requests to a whitelist of domains.

```typescript
// Allowed Hosts
export const main = task({
  name: "main",
  allowedHosts: ["api.openai.com", "*.anthropic.com"],
}, () => { ... });
```

---
