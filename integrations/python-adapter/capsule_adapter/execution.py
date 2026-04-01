"""
Core execution logic for running code in Capsule sandboxes.
"""

import asyncio
import json
from pathlib import Path

from capsule import run

_SANDBOXES_DIR = Path(__file__).parent / "sandboxes"
_SANDBOX_PY = str(_SANDBOXES_DIR / "python_sandbox.wasm")
_SANDBOX_JS = str(_SANDBOXES_DIR / "js_sandbox.wasm")


def _unwrap_result(raw: object) -> str:
    """Parse the JSON envelope returned by sandbox main tasks."""
    if raw is None:
        return ""
    if not isinstance(raw, str):
        return str(raw)
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return raw
    if not isinstance(parsed, dict) or "success" not in parsed:
        return raw
    if "error" in parsed:
        err = parsed["error"]
        msg = err.get("message") if isinstance(err, dict) else str(err)
        raise RuntimeError(msg)
    result = parsed.get("result")
    if result is None:
        return ""
    return result if isinstance(result, str) else str(result)


async def _invoke_sandbox(wasm_file: str, action: str, payload: str) -> str:
    """Execute an action in a Capsule sandbox and return the result."""
    res = await run(file=wasm_file, args=[action, payload])
    if not res.get("success"):
        error = res.get("error", {})
        message = error.get("message") if isinstance(error, dict) else str(error)
        raise RuntimeError(f"Capsule execution failed: {message}")
    return _unwrap_result(res.get("result"))


async def load_javascript_sandbox() -> None:
    """Preload the JavaScript sandbox to reduce cold start time."""
    await _invoke_sandbox(_SANDBOX_JS, "EXECUTE_CODE", "// pre-load sandbox")


async def load_python_sandbox() -> None:
    """Preload the Python sandbox to reduce cold start time."""
    await _invoke_sandbox(_SANDBOX_PY, "EXECUTE_CODE", "# pre-load sandbox")


async def load_sandboxes() -> None:
    """Preload both Python and JavaScript sandboxes in parallel."""
    await asyncio.gather(
        load_python_sandbox(),
        load_javascript_sandbox(),
    )


async def run_python(code: str) -> str:
    """Execute Python code in an isolated Capsule sandbox."""
    return await _invoke_sandbox(_SANDBOX_PY, "EXECUTE_CODE", code)


async def run_javascript(code: str) -> str:
    """Execute JavaScript code in an isolated Capsule sandbox."""
    return await _invoke_sandbox(_SANDBOX_JS, "EXECUTE_CODE", code)
