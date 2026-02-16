<div align="center">

# ```Capsule```

**A secure, durable runtime for AI agents**

[![CI](https://github.com/mavdol/capsule/actions/workflows/ci.yml/badge.svg)](https://github.com/mavdol/capsule/actions/workflows/ci.yml)

[Getting Started](#getting-started) • [Documentation](#documentation-v052) • [Contributing](#contributing)

</div>

---

## Overview

```Capsule``` is a runtime for coordinating AI agent tasks in isolated environments. It is designed to handle, long-running workflows, large-scale processing, autonomous decision-making securely, or even multi-agent systems.

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

For TypeScript and JavaScript, use the `task()` wrapper function with full access to the npm ecosystem:

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
> The runtime requires a task named `"main"` as the entry point. Python can define the main task itself, but it's recommended to set it manually.

When you run `capsule run main.py` (or `main.ts`), your code is compiled into a WebAssembly module and executed in a dedicated sandbox to isolate tasks.

Each task operates within its own sandbox with configurable resource limits, ensuring that failures are contained and don't cascade to other parts of your workflow. The host system controls every aspect of execution, from CPU allocation via Wasm fuel metering to memory constraints and timeout enforcement.

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
    "fuel_consumed": 45000
  }
}
```

**Response fields:**
- `success` — Boolean indicating whether the task completed successfully
- `result` — The actual return value from your task (json, string, null on failure etc..)
- `error` — Error details if the task failed (`{ error_type: string, message: string }`)
- `execution` — Performance metrics:
  - `task_name` — Name of the executed task
  - `duration_ms` — Execution time in milliseconds
  - `retries` — Number of retry attempts that occurred
  - `fuel_consumed` — CPU resources used (see [Compute Levels](#compute-levels))

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
> Use `--verbose` to display real-time task execution details.

## Integrate Into an Existing Project

The `run()` function lets you execute tasks programmatically from your application code, no CLI needed.

### Python

```python
from capsule import run

result = await run(
    file="./capsule.py",
    args=["code to execute"]
)
```

Create `capsule.py`:

```python
from capsule import task

@task(name="main", compute="LOW", ram="64MB")
def main(code: str) -> str:
    return exec(code)
```

### TypeScript / JavaScript

> [!IMPORTANT]
> You need `@capsule-run/cli` in your dependencies to use the `runner` functions in TypeScript.

```typescript
import { run } from '@capsule-run/sdk/runner';

const result = await run({
  file: './capsule.ts',
  args: ['code to execute']
});
```

Create `capsule.ts`:

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

## Documentation (v0.6.0)

### Task Configuration Options

Configure your tasks with these parameters:

| Parameter | Description | Type | Default | Example |
|-----------|-------------|------|---------|---------|
| `name` | Task identifier | `str` | function name (Python) / *required* (TS) | `"process_data"` |
| `compute` | CPU allocation level: `"LOW"`, `"MEDIUM"`, or `"HIGH"` | `str` | `"MEDIUM"` | `"HIGH"` |
| `ram` | Memory limit for the task | `str` | unlimited | `"512MB"`, `"2GB"` |
| `timeout` | Maximum execution time | `str` | unlimited | `"30s"`, `"5m"`, `"1h"` |
| `max_retries` / `maxRetries` | Number of retry attempts on failure | `int` | `0` | `3` |
| `allowed_files` / `allowedFiles` | Folders accessible in the sandbox | `list` | `[]` | `["./data", "./output"]` |
| `allowed_hosts` / `allowedHosts` | Domains accessible in the sandbox | `list` | `["*"]` | `["api.openai.com", "*.anthropic.com"]` |
| `env_variables` / `envVariables` | Environment variables accessible in the sandbox | `list` | `[]` | `["API_KEY"]` |

### Compute Levels

Capsule controls CPU usage through WebAssembly's **fuel mechanism**, which meters instruction execution. The compute level determines how much fuel your task receives.
- **LOW** provides minimal allocation for lightweight tasks
- **MEDIUM** offers balanced resources for typical workloads
- **HIGH** grants maximum fuel for compute-intensive operations
- **CUSTOM** to specify an exact fuel value (e.g., `compute="1000000"`) for precise control over execution limits.

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

### HTTP Client API

#### Python

The standard Python `requests` library and socket-based networking aren't natively compatible with WebAssembly's sandboxed I/O model. Capsule provides its own HTTP client that works within the Wasm environment:

```python
from capsule import task
from capsule.http import get, post, put, delete

@task(name="http_example", compute="MEDIUM", timeout="30s")
def main() -> dict:
    """Example demonstrating HTTP client usage within a task."""

    # GET request
    response = get("https://api.example.com/data")

    # POST with JSON body
    response = post("https://api.example.com/submit", json={"key": "value"})

    # Response methods
    is_ok = response.ok()           # Returns True if status code is 2xx
    status = response.status_code    # Get the HTTP status code
    data = response.json()           # Parse response as JSON
    text = response.text()           # Get response as text

    return {"status": status, "success": is_ok}
```

#### TypeScript / JavaScript

Standard libraries like `fetch` are already compatible, so no custom HTTP client is needed for TypeScript/JavaScript.

```typescript
import { task } from "@capsule-run/sdk";

export const main = task({
    name: "main",
    compute: "MEDIUM"
}, async () => {
    const response = await fetch("https://api.example.com/data");
    return response.json();
});
```

### File Access

Tasks can read and write files within directories specified in `allowed_files`. Any attempt to access files outside these directories is not possible.

> [!NOTE]
> Currently, `allowed_files` supports directory paths, not individual files.

#### Python

Python's standard file operations work normally. Use `open()`, `os`, `pathlib`, or any file manipulation library.

```python
from capsule import task

@task(name="restricted_writer", allowed_files=["./output"])
def restricted_writer() -> None:
    with open("./output/result.txt", "w") as f:
        f.write("result")

@task(name="main")
def main() -> str:
    restricted_writer()
```

#### TypeScript / JavaScript

Common Node.js built-ins are available. Use the standard `fs` module:

```typescript
import { task } from "@capsule-run/sdk";
import fs from "fs/promises";

export const restrictedWriter = task({
    name: "restricted_writer",
    allowedFiles: ["./output"]
}, async () => {
    await fs.writeFile("./output/result.txt", "result");
});

export const main = task({ name: "main", allowedFiles: ["./data"] }, async () => {
    await restrictedWriter();
    return await fs.readFile("./data/input.txt", "utf8");
});
```

### Network Access

Tasks can make HTTP requests to domains specified in `allowed_hosts`. By default, all outbound requests are allowed (`["*"]`). Restrict access by providing a whitelist of domains.

#### Python

```python
from capsule import task
from capsule.http import get

@task(name="main", allowed_hosts=["api.openai.com", "*.anthropic.com"])
def main() -> dict:
    response = get("https://api.openai.com/v1/models")
    return response.json()
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


## Compatibility

> [!NOTE]
> TypeScript/JavaScript has broader compatibility than Python since it doesn't rely on native bindings.

**Python:** Pure Python packages and standard library modules work. Packages with C extensions (`numpy`, `pandas`) are not yet supported.

**TypeScript/JavaScript:** npm packages and ES modules work. Common Node.js built-ins are available. If you have any trouble with a built-in do not hesitate to open an issue.

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
3. **Run tests**: `cargo test`
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
