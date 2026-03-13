# `Capsule` Python Adapter

[![Python Adapter Release](https://github.com/mavdol/capsule/actions/workflows/python-adapter-release.yml/badge.svg)](https://github.com/mavdol/capsule/actions/workflows/python-adapter-release.yml)

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

## How It Works

The adapter compiles Python and JavaScript sandboxes into WebAssembly modules during the build step. When you call `run_python()` or `run_javascript()`, the adapter invokes these pre-built sandboxes using Capsule's runner with the code you provide.

Learn more about [Capsule](https://github.com/mavdol/capsule).
