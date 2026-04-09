<div align="center">

# ```Capsule```

**A secure, durable runtime for AI agents**

[![CI](https://github.com/mavdol/capsule/actions/workflows/ci.yml/badge.svg)](https://github.com/mavdol/capsule/actions/workflows/ci.yml)

[Getting Started](#getting-started) • [Documentation](#documentation) • [Contributing](#contributing)

</div>

---

## Overview

```Capsule``` is a runtime for coordinating AI agent tasks in isolated environments. It is designed to handle untrusted code execution, long-running workflows, large-scale processing, or even multi-agent systems.

Each task runs inside its own WebAssembly sandbox, providing:

- **Isolated execution**: Each task runs isolated from your host system
- **Resource limits**: Set CPU, memory, and timeout limits per task
- **Automatic retries**: Handle failures without manual intervention
- **Lifecycle tracking**: Monitor which tasks are running, completed, or failed

This enables safe task-level execution of untrusted code within AI agent systems.

## How It Works

### With Python

Simply annotate your Python functions with the `@task` decorator:

```python
from capsule import task

@task(name="analyze_data", compute="MEDIUM", ram="512MB", timeout="30s", max_retries=1)
def analyze_data(dataset: list) -> dict:
    """Process data in an isolated, resource-controlled environment."""
    # Your code runs safely in a Wasm sandbox
    return {"processed": len(dataset), "status": "complete"}
```

### With TypeScript / JavaScript

Use the `task()` wrapper function with full access to the npm ecosystem:

```typescript
import { task } from "@capsule-run/sdk";

export const analyzeData = task({
  name: "analyze_data",
  compute: "MEDIUM",
  ram: "512MB",
  timeout: "30s",
  maxRetries: 1
}, (dataset: number[]): object => {
  // Your code runs safely in a Wasm sandbox
  return { processed: dataset.length, status: "complete" };
});

// The "main" task is required as the entrypoint
export const main = task({
    name: "main",
    compute: "HIGH"
}, () => {
  return analyzeData([1, 2, 3, 4, 5]);
});

```

> [!NOTE]
> The runtime requires a task named `"main"` as the entry point. Python will create one automatically if none is defined, but it's recommended to set it explicitly.

When you run `capsule run main.py` (or `main.ts`), your code is compiled into a WebAssembly module and executed in isolated sandboxes.

Each task operates within its own sandbox with configurable resource limits, ensuring that failures are contained and don't cascade to other parts of your workflow. The host system controls every aspect of execution, from CPU allocation via Wasm fuel metering to memory constraints and timeout enforcement.

## Getting Started

### Python

```bash
pip install capsule-run
```

Create `hello.py`:

```python
from capsule import task

@task(name="main", compute="LOW", ram="64MB")
def main() -> str:
    return "Hello from Capsule!"
```

Run it:

```bash
capsule run hello.py
```

### TypeScript / JavaScript

```bash
npm install -g @capsule-run/cli
npm install @capsule-run/sdk
```

Create `hello.ts`:

```typescript
import { task } from "@capsule-run/sdk";

export const main = task({
  name: "main",
  compute: "LOW",
  ram: "64MB"
}, (): string => {
  return "Hello from Capsule!";
});
```

Run it:

```bash
capsule run hello.ts
```

> [!TIP]
> Add `--verbose` to see real-time task execution details.

## Run From Your Code

The `run()` function lets you execute tasks programmatically from your code instead of using the CLI. The `args` are automatically forwarded as parameters to the `main` task.

### Python

```python
from capsule import run

result = await run(
    file="./sandbox.py",
    args=["code to execute"]
)
```

Create `sandbox.py`:

```python
from capsule import task

@task(name="main", compute="LOW", ram="64MB")
def main(code: str) -> str:
    return eval(code)
```

### TypeScript / JavaScript

> [!IMPORTANT]
> You need `@capsule-run/cli` in your dependencies to use the runner functions in TypeScript.

```typescript
import { run } from '@capsule-run/sdk/runner';

const result = await run({
  file: './sandbox.ts',
  args: ['code to execute']
});
```

Create `sandbox.ts`:

```typescript
import { task } from "@capsule-run/sdk";

export const main = task({
  name: "main",
  compute: "LOW",
  ram: "64MB"
}, (code: string): string => {
  return eval(code);
});
```

> [!TIP]
> If you're looking for a pre-configured, ready-to-use solution, check out the [Python adapter](https://github.com/mavdol/capsule/tree/main/integrations/python-adapter) or [TypeScript adapter](https://github.com/mavdol/capsule/tree/main/integrations/typescript-adapter).

## Documentation

### Task Configuration Options

Configure your tasks with these parameters:

| Parameter | Description | Type | Default | Example |
|-----------|-------------|------|---------|---------|
| `name` | Task identifier | `str` | function name (Python) / *required* (TS) | `"process_data"` |
| `compute` | CPU allocation level: `"LOW"`, `"MEDIUM"`, or `"HIGH"` | `str` | `"MEDIUM"` | `"HIGH"` |
| `ram` | Memory limit for the task | `str` | unlimited | `"512MB"`, `"2GB"` |
| `timeout` | Maximum execution time | `str` | unlimited | `"30s"`, `"5m"`, `"1h"` |
| `max_retries` / `maxRetries` | Number of retry attempts on failure | `int` | `0` | `3` |
| `allowed_files` / `allowedFiles` | Folders accessible in the sandbox (with optional access mode) | `list` | `[]` | `["./data"]`, `[{"path": "./data", "mode": "ro"}]` |
| `allowed_hosts` / `allowedHosts` | Domains accessible in the sandbox | `list` | `[]` | `["api.openai.com", "*.anthropic.com"]` |
| `env_variables` / `envVariables` | Environment variables accessible in the sandbox | `list` | `[]` | `["API_KEY"]` |

### Compute Levels

Capsule controls CPU usage through WebAssembly's **fuel mechanism**, which meters instruction execution. The compute level determines how much fuel your task receives.
- **LOW** provides minimal allocation for lightweight tasks
- **MEDIUM** offers balanced resources for typical workloads
- **HIGH** grants maximum fuel for compute-intensive operations
- **CUSTOM** to specify an exact fuel value (e.g., `compute="1000000"`) for precise control over execution limits.

### Response Format

Every task returns a structured JSON envelope containing both the result and execution metadata:
```json
{
  "success": true,
  "result": "Hello from Capsule!",
  "error": null,
  "execution": {
    "task_name": "data_processor",
    "duration_ms": 1523,
    "retries": 0,
    "fuel_consumed": 45000,
    "ram_used": 1200000,
    "host_requests": [{...}]
  }
}
```

**Response fields:**
- `success` — Boolean indicating whether the task completed successfully
- `result` — The actual return value from your task (json, string, null on failure etc.)
- `error` — Error details if the task failed (`{ error_type: string, message: string }`)
- `execution` — Performance metrics:
  - `task_name` — Name of the executed task
  - `duration_ms` — Execution time in milliseconds
  - `retries` — Number of retry attempts that occurred
  - `fuel_consumed` — CPU resources used (see [Compute Levels](#compute-levels))
  - `ram_used` — Peak memory used in bytes
  - `host_requests` — List of host requests made by the task

### Network Access

Tasks can make HTTP requests to domains specified in `allowed_hosts`. By default, no outbound requests are allowed (`[]`). Provide an allowlist of domains to grant access, or use `["*"]` to allow all domains.

#### Python

```python
import json
from capsule import task
from urllib.request import urlopen

@task(name="main", allowed_hosts=["api.openai.com", "*.anthropic.com"])
def main() -> dict:
    with urlopen("https://api.openai.com/v1/models") as response:
        return json.loads(response.read().decode("utf-8"))
```

#### TypeScript / JavaScript

```typescript
import { task } from "@capsule-run/sdk";

export const main = task({
    name: "main",
    allowedHosts: ["api.openai.com", "*.anthropic.com"]
}, async () => {
    const response = await fetch("https://api.openai.com/v1/models");
    return response.json();
});
```

### File Access

Tasks can read and write files within directories specified in `allowed_files`. Any attempt to access files outside these directories is not possible.

> [!NOTE]
> `allowed_files` supports directory paths only, not individual files.

Each entry can be a plain path (read-write by default) or a structured object with an explicit `mode`:
- `"read-only"` (or `"ro"`)
- `"read-write"` (or `"rw"`)

#### Python

Python's standard file operations work normally. Use `open()`, `os`, `pathlib`, or any file manipulation library.

```python
from capsule import task

@task(name="main", allowed_files=[
    {"path": "./data", "mode": "read-only"},
    {"path": "./output", "mode": "read-write"},
])
def main() -> str:
    with open("./data/input.txt") as f:
        content = f.read()
    with open("./output/result.txt", "w") as f:
        f.write(content)
    return content
```

Plain strings are still accepted: `allowed_files=["./output"]` defaults to read-write.

#### TypeScript / JavaScript

Common Node.js built-ins are available. Use the standard `fs` module:

```typescript
import { task } from "@capsule-run/sdk";
import fs from "fs/promises";

export const main = task({
    name: "main",
    allowedFiles: [
        { path: "./data", mode: "read-only" },
        { path: "./output", mode: "read-write" },
    ]
}, async () => {
    const content = await fs.readFile("./data/input.txt", "utf8");
    await fs.writeFile("./output/result.txt", content);
    return content;
});
```

Plain strings are still accepted: `allowedFiles: ["./output"]` defaults to read-write.

#### Dynamic directory aliases (`--mount`)

The `--mount` flag (CLI) or `mounts` parameter (SDK) mount a host directory into the sandbox under an alias. Mounts propagate to sub-tasks and add access to new paths, they don't change the access mode of paths already declared in `allowed_files`.

**Format:** `HOST_PATH[::GUEST_PATH][:ro|:rw]`

| Part | Required | Description |
|------|----------|-------------|
| `HOST_PATH` | yes | Path on the host machine (relative to `cwd`, must stay inside project root) |
| `::GUEST_PATH` | no | Path the task sees inside the sandbox. Defaults to `HOST_PATH` |
| `:ro` / `:rw` | no | Access mode. Defaults to read-write |

**CLI**

```bash
# Mount a session workspace and expose it as "workspace" inside the task
capsule run main.py --mount sessions/abc123_workspace::workspace

# Multiple directories
capsule run main.py \
  --mount sessions/abc123_workspace::workspace \
  --mount sessions/bce456_workspace::workspace:ro
```

**Python SDK**

```python
from capsule import run

result = await run(
    file="main.py",
    mounts=[".capsule/sessions/abc123_workspace::workspace"],
)
```

**TypeScript / JavaScript SDK**

```typescript
import { run } from "@capsule-run/sdk";

const result = await run({
    file: "main.py",
    mounts: [".capsule/sessions/abc123_workspace::workspace"],
});
```

Inside the task, the directory is accessed via the guest path:

```python
# task sees it at "workspace/", not at the full session path
with open("workspace/output.txt", "w") as f:
    f.write("done")
```

> [!NOTE]
> `--mount` paths must be relative and must not escape the project root. Absolute paths are rejected.


### Environment Variables

Tasks can access environment variables to read configuration, API keys, or other runtime settings.

#### Python

Use Python's standard `os.environ` to access environment variables:
```python
from capsule import task
import os

@task(name="main", env_variables=["API_KEY"])
def main() -> dict:
    api_key = os.environ.get("API_KEY")
    return {"api_key": api_key}
```

#### TypeScript / JavaScript

Use the standard `process.env` to access environment variables:
```typescript
import { task } from "@capsule-run/sdk";

export const main = task({
    name: "main",
    envVariables: ["API_KEY"]
}, () => {
    const apiKey = process.env.API_KEY;
    return { apiKeySet: apiKey !== undefined };
});
```

### Project Configuration (Optional)

You can create a `capsule.toml` file in your project root to set default options for all tasks and define workflow metadata:

```toml
# capsule.toml

[workflow]
name = "My AI Workflow"
version = "1.0.0"
entrypoint = "src/main.py"  # Default file when running `capsule run`

[tasks]
default_compute = "MEDIUM"
default_ram = "256MB"
default_timeout = "30s"
default_max_retries = 2
```

With an entrypoint defined, you can simply run:

```bash
capsule run
```

Task-level options always override these defaults when specified.

### Cache Management

When you run your code, Capsule creates a `.capsule` folder in your project root. This is the build cache. It stores compiled artifacts so subsequent runs are fast (from seconds to few milliseconds).

> [!TIP]
> `.capsule` should be added to `.gitignore`. The cache is specific to your own environment and will be regenerated automatically.

```
.capsule/
├── wasm/
│   ├── main_a1b2c3d4.wasm    # Compiled WebAssembly module
│   └── main_a1b2c3d4.cwasm   # Native precompiled cache
├── wit/                       # Interface definitions
└── trace.db                   # Execution logs
```

Use `capsule build` to precompile ahead of time and skip the compilation cost on the first run:

```bash
capsule build main.ts # or `main.py`
```

## Production

Running source code directly (like `.py` or `.ts`) evaluates and compiles your file at runtime. While great for development, this compilation step adds a few seconds of latency on first call. For use cases where sub-second latency is critical, you should build your tasks ahead of time.

```bash
# Generates an optimized hello.wasm file
capsule build hello.py --export

# Execute the compiled artifact directly
capsule exec hello.wasm
```

> [!NOTE]
> Or from your existing code:
>
> ```python
> from capsule import run
>
> result = await run(
>    file="./hello.wasm", # or `hello.py`
>    args=[]
> )
>
> print(f"Task completed: {result['result']}")
> ```

Executing a `.wasm` file bypasses the compiler completely, reducing initialization time to milliseconds while using a natively optimized (`.cwasm`) format behind the scenes.

## Compatibility

> [!NOTE]
> TypeScript/JavaScript has broader compatibility than Python since it doesn't rely on native bindings.

**Python:** Most standard Python libraries work perfectly. Packages that use C extensions require a `wasm32-wasi` compiled wheel. Many popular packages like numpy and pandas don't ship one yet, so they won't work inside the sandbox. However, your host code (using `run()`) has access to the full Python ecosystem, including any pip package and native extensions. see [in-code usage](#run-from-your-code)

**TypeScript/JavaScript:** npm packages and ES modules work. Common Node.js built-ins are available. If you have any trouble with a built-in, do not hesitate to open an issue.

## Contributing

Contributions are welcome!

### Development setup

**Prerequisites:** Rust (latest stable), Python 3.13+, Node.js 22+

```bash
git clone https://github.com/mavdol/capsule.git
cd capsule

# Build and install CLI
cargo install --path crates/capsule-cli

# Python SDK (editable install)
pip install -e crates/capsule-sdk/python

# TypeScript SDK (link for local dev)
cd crates/capsule-sdk/javascript
npm install && npm run build && npm link

# Then in your project: npm link @capsule-run/sdk
```

### How to contribute

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/amazing-feature`
3. **Run tests**: `cargo test` (only needed if modifying `crates/capsule-cli` or `crates/capsule-core`)
4. **Open** a Pull Request

Need help? [Open an issue](https://github.com/mavdol/capsule/issues)

## Credits

Capsule builds on these open source projects:

- [componentize-py](https://github.com/bytecodealliance/componentize-py) – Python to WebAssembly Component compilation
- [jco](https://github.com/bytecodealliance/jco) – JavaScript toolchain for WebAssembly Components
- [wasmtime](https://github.com/bytecodealliance/wasmtime) – WebAssembly runtime
- [WASI](https://github.com/WebAssembly/WASI) – WebAssembly System Interface

## License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.
