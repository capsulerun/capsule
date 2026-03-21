# capsule-run

**A secure, durable runtime for agentic workflows**

## Overview

Capsule is a runtime for coordinating AI agent tasks in isolated environments. It is designed to handle untrusted code execution, long-running workflows, large-scale processing, or even multi-agent systems.

Each task runs inside its own WebAssembly sandbox, providing:

- **Isolated execution**: Each task runs isolated from your host system
- **Resource limits**: Set CPU, memory, and timeout limits per task
- **Automatic retries**: Handle failures without manual intervention
- **Lifecycle tracking**: Monitor which tasks are running, completed, or failed

This enables safe task-level execution of untrusted code within AI agent systems.

## Installation

```bash
pip install capsule-run
```

## Getting started

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

> Use `--verbose` to display real-time task execution details.

## Production

Running source code directly (like `.py`) evaluates and compiles your file at runtime. While great for development, this compilation step adds a few seconds of latency. For use cases where sub-second latency is critical, you should build your tasks ahead of time.

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
>
> See [Integrate Into an Existing Project](#integrate-into-an-existing-project) for details.

Executing a `.wasm` file bypasses the compiler completely, reducing initialization time to milliseconds while using a natively optimized (`.cwasm`) format behind the scenes.

## Integrate Into an Existing Project

The `run()` function lets you execute tasks programmatically from your application code, no CLI needed.

```python
from capsule import run

result = await run(
    file="./capsule.py", # or `capsule.wasm`
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

## How It Works

Simply annotate your Python functions with the `@task` decorator:

```python
from capsule import task

@task(name="analyze_data", compute="MEDIUM", ram="512MB", timeout="30s", max_retries=1)
def analyze_data(dataset: list) -> dict:
    """Process data in an isolated, resource-controlled environment."""
    return {"processed": len(dataset), "status": "complete"}
```

> The runtime requires a task named `"main"` as the entry point. Python will create one automatically if none is defined, but it's recommended to set it explicitly.

When you run `capsule run main.py`, your code is compiled into a WebAssembly module and executed in a dedicated sandbox.

### Response Format

Every task returns a structured JSON envelope containing both the result and execution metadata:
```json
{
  "success": true,
  "result": { "processed": 5, "status": "complete" },
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
- `result` — The actual return value from your task (json, string, null on failure etc.)
- `error` — Error details if the task failed (`{ error_type: string, message: string }`)
- `execution` — Performance metrics:
  - `task_name` — Name of the executed task
  - `duration_ms` — Execution time in milliseconds
  - `retries` — Number of retry attempts that occurred
  - `fuel_consumed` — CPU resources used (see [Compute Levels](#compute-levels))

## Documentation

### Task Configuration Options

| Parameter | Description | Type | Default | Example |
|-----------|-------------|------|---------|---------|
| `name` | Task identifier | `str` | function name | `"process_data"` |
| `compute` | CPU level: `"LOW"`, `"MEDIUM"`, `"HIGH"` | `str` | `"MEDIUM"` | `"HIGH"` |
| `ram` | Memory limit | `str` | unlimited | `"512MB"`, `"2GB"` |
| `timeout` | Maximum execution time | `str` | unlimited | `"30s"`, `"5m"` |
| `max_retries` | Retry attempts on failure | `int` | `0` | `3` |
| `allowed_files` | Folders accessible in the sandbox (with optional access mode) | `list` | `[]` | `["./data"]`, `[{"path": "./data", "mode": "ro"}]` |
| `allowed_hosts` | Domains accessible in the sandbox | `list` | `["*"]` | `["api.openai.com", "*.anthropic.com"]` |
| `env_variables` | Environment variables accessible in the sandbox | `list` | `[]` | `["API_KEY"]` |

### Compute Levels

- **LOW**: Minimal allocation for lightweight tasks
- **MEDIUM**: Balanced resources for typical workloads
- **HIGH**: Maximum fuel for compute-intensive operations
- **CUSTOM**: Specify exact fuel value (e.g., `compute="1000000"`)

### Project Configuration (Optional)

Create a `capsule.toml` file in your project root to set default options:

```toml
[workflow]
name = "My AI Workflow"
version = "1.0.0"
entrypoint = "src/main.py"  # Run `capsule run` without specifying a file

[tasks]
default_compute = "MEDIUM"
default_ram = "256MB"
default_timeout = "30s"
```

Task-level options always override these defaults.

### File Access

Tasks can read and write files within directories specified in `allowed_files`. Any attempt to access files outside these directories is not possible.

> `allowed_files` supports directory paths only, not individual files.

Each entry can be a plain path (read-write by default) or a dict with an explicit `mode`: `"read-only"` (or `"ro"`) or `"read-write"` (or `"rw"`).

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

### Network Access

Tasks can make HTTP requests to domains specified in `allowed_hosts`. By default, all outbound requests are allowed (`["*"]`). Restrict access by providing a whitelist of domains.

> Wildcards are supported: `*.example.com` matches all subdomains of `example.com`.

```python
from capsule import task
from urllib.request import urlopen
import json

@task(name="main", allowed_hosts=["api.openai.com", "*.anthropic.com"])
def main() -> dict:
    with urlopen("https://api.openai.com/v1/models") as response:
        return json.loads(response.read().decode("utf-8"))
```

### Environment Variables

Tasks can access environment variables to read configuration, API keys, or other runtime settings. Use Python's standard `os.environ` to access environment variables:

```python
from capsule import task
import os

@task(name="main", env_variables=["API_KEY"])
def main() -> dict:
    api_key = os.environ.get("API_KEY")
    return {"api_key": api_key}
```

## Compatibility

✅ **Supported:**
- Pure Python packages and standard library
- `json`, `math`, `re`, `datetime`, `collections`, etc.

⚠️ **Not yet supported (inside the sandbox):**
- Packages with C extensions (e.g. `numpy`, `pandas`)

> These limitations only apply to the task file executed in the sandbox. Your host code using `run()` has access to the full Python ecosystem, any pip package, native extensions, everything. (see [Integrate Into an Existing Project](#integrate-into-an-existing-project))

## Links

- [GitHub](https://github.com/mavdol/capsule)
- [Issues](https://github.com/mavdol/capsule/issues)
