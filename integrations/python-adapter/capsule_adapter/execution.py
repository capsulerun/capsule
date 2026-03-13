"""
Core execution logic for running code in Capsule sandboxes.
"""

import asyncio
from pathlib import Path

from capsule import run

_SANDBOXES_DIR = Path(__file__).parent / "sandboxes"
_SANDBOX_PY = str(_SANDBOXES_DIR / "python_sandbox.wasm")
_SANDBOX_JS = str(_SANDBOXES_DIR / "js_sandbox.wasm")

async def _invoke_sandbox(wasm_file: str, code: str) -> str:
    """Execute code in a Capsule sandbox and return the result."""
    res = await run(file=wasm_file, args=[code])

    if not res.get("success"):
        error = res.get("error", {})
        message = error.get("message") if isinstance(error, dict) else str(error)
        raise RuntimeError(f"Capsule execution failed: {message}")

    result = res.get("result")
    if result is None:
        return ""
    if isinstance(result, str):
        return result
    return str(result)


async def load_javascript_sandbox() -> None:
    """Preload the JavaScript sandbox to reduce cold start time."""
    await _invoke_sandbox(_SANDBOX_JS, "// pre-load sandbox")


async def load_python_sandbox() -> None:
    """Preload the Python sandbox to reduce cold start time."""
    await _invoke_sandbox(_SANDBOX_PY, "# pre-load sandbox")


async def load_sandboxes() -> None:
    """Preload both Python and JavaScript sandboxes in parallel."""
    await asyncio.gather(
        load_python_sandbox(),
        load_javascript_sandbox()
    )


async def run_python(code: str) -> str:
    """
    Execute Python code in an isolated Capsule sandbox.
    """
    return await _invoke_sandbox(_SANDBOX_PY, code)


async def run_javascript(code: str) -> str:
    """
    Execute JavaScript code in an isolated Capsule sandbox
    """
    return await _invoke_sandbox(_SANDBOX_JS, code)
