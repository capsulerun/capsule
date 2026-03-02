"""
Capsule SDK - SDK Runner

Provides the `run` functions for running Capsule tasks
from third party applications.
"""

import asyncio
import json
import os
from typing import Any, Optional, TypedDict

_WASM_EXTENSIONS = {".wasm"}
_SOURCE_EXTENSIONS = {".py"}


class RunnerOptions(TypedDict, total=False):
    file: str
    args: Optional[list[str]]
    cwd: Optional[str]
    capsule_path: Optional[str]


class ExecutionInfo(TypedDict):
    task_name: str
    duration_ms: int
    retries: int
    fuel_consumed: int


class ErrorInfo(TypedDict):
    error_type: str
    message: str


class RunnerResult(TypedDict):
    success: bool
    result: Any
    error: Optional[ErrorInfo]
    execution: ExecutionInfo


async def run(
    *,
    file: str,
    args: Optional[list[str]] = None,
    cwd: Optional[str] = None,
    capsule_path: str = "capsule",
) -> RunnerResult:
    """Run a Capsule task from a third-party application.

    Args:
        file: Path to the source file or pre-built .wasm artifact
        args: Arguments to pass to the task's main function
        cwd: Working directory (used to resolve relative paths)
        capsule_path: Path to the capsule CLI binary

    Returns:
        RunnerResult with task result and execution metadata
    """
    args = args or []

    resolved_file = os.path.abspath(os.path.join(cwd or os.getcwd(), file))
    ext = os.path.splitext(resolved_file)[1].lower()

    if ext not in _WASM_EXTENSIONS and ext not in _SOURCE_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type: '{ext}'. "
            f"Expected a source file ({', '.join(sorted(_SOURCE_EXTENSIONS))}) "
            f"or a pre-built artifact ({', '.join(sorted(_WASM_EXTENSIONS))})."
        )

    if not os.path.exists(resolved_file):
        if ext in _WASM_EXTENSIONS:
            raise FileNotFoundError(
                f"Artifact not found: {resolved_file}. "
                "Run `capsule build` first to generate the .wasm artifact."
            )
        raise FileNotFoundError(f"File not found: {resolved_file}")

    subcommand = "exec" if ext in _WASM_EXTENSIONS else "run"
    cmd = [capsule_path, subcommand, resolved_file, "--json", *args]

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )

        stdout, stderr = await process.communicate()

        if process.returncode != 0 and not stdout:
            error_msg = stderr.decode("utf-8") if stderr else "Unknown error"
            raise RuntimeError(error_msg)

        try:
            lines = stdout.decode("utf-8").strip().split("\n")
            return json.loads(lines[-1])
        except (json.JSONDecodeError, IndexError):
            raise ValueError(
                f"Failed to parse Capsule output: {stdout.decode('utf-8')}"
            )

    except FileNotFoundError:
        raise FileNotFoundError(
            "Capsule CLI not found. Use 'pip install capsule-run' to install it."
        )
