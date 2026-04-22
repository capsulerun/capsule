# `Capsule` Python Adapter

[![Python Adapter Release](https://github.com/capsulerun/capsule/actions/workflows/python-adapter-release.yml/badge.svg)](https://github.com/capsulerun/capsule/actions/workflows/python-adapter-release.yml)

Execute Python and JavaScript code securely inside Capsule sandboxes from your Python applications.

## Installation

```bash
pip install capsule-run-adapter
```

## Usage

### Execute Python Code

```python
from capsule_adapter import run_python

result = await run_python("""
print("Hello from Python!")
x = 5 + 3
x * 2
""")

print(result)  # "Hello from Python!\n16"
```

### Execute JavaScript Code

```python
from capsule_adapter import run_javascript

result = await run_javascript("""
console.log("Hello from JavaScript!");
const x = 5 + 3;
x * 2;
""")

print(result)  # "Hello from JavaScript!\n16"
```

### Preload Sandboxes (Optional)

The first execution of a sandbox has a cold start (~1 second). You can preload sandboxes to warm them up for faster subsequent executions (~10ms):

```python
import asyncio
from capsule_adapter import load_sandboxes, run_python

async def main():
    # Preload sandboxes
    await load_sandboxes()

    # Or preload individually
    # await load_python_sandbox()     # Warm up Python only
    # await load_javascript_sandbox() # Warm up JavaScript only

    # Fast execution
    result = await run_python('print("Fast!")')
    print(result)

asyncio.run(main())
```

## Sessions (Persistent State)

Use `Session` to run code across multiple calls while preserving state. Each session gets an isolated workspace directory that is automatically cleaned up when the session ends.

```python
from capsule_adapter import Session

async with Session() as s:
    await s.run("x = 1")
    result = await s.run("x += 1; x")
    print(result)  # 2
```

JavaScript sessions work the same way:

```python
async with Session("javascript") as s:
    await s.run("x = 1")
    result = await s.run("x += 1; x")
    print(result)  # 2
```

#### Import Files

Copy a file or directory from your filesystem into the session workspace. The sandbox code can then access it at the destination path under `workspace/`.

```python
async with Session() as s:
    # Import a single file
    await s.import_file("./notes.txt", "notes.txt")

    result = await s.run("""
with open("workspace/notes.txt") as f:
    content = f.read()
content
""")
```

### Export Files

Export file from the session workspace to your filesystem.

```python
async with Session() as s:
    await s.import_file("./notes.txt", "notes.txt")
    # ... do some work ...
    await s.export_file("notes.txt", "./exported_notes.txt")
```

#### Delete Files

Remove a file from the session workspace:

```python
async with Session() as s:
    await s.import_file("./notes.txt", "notes.txt")
    # ... do some work ...
    await s.delete_file("notes.txt")
```

#### Reset State

Clear the session's variable state without touching workspace files:

```python
async with Session() as s:
    await s.run("x = 42")
    await s.reset()
    result = await s.run("x")  # raises NameError
```

## How It Works

The adapter compiles Python and JavaScript sandboxes into WebAssembly modules during the build step. When you call `run_python()` or `run_javascript()`, the adapter invokes these pre-built sandboxes using Capsule's runner with the code you provide.

Learn more about [Capsule](https://github.com/capsulerun/capsule).
