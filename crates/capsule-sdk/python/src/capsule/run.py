"""
Capsule SDK - SDK Runner

Provides the `run` functions for running Capsule tasks
from third party applications.
"""

import asyncio
import json
import os
import tempfile
import uuid
from typing import Any, Optional, TypedDict

_WASM_EXTENSIONS = {".wasm"}
_SOURCE_EXTENSIONS = {".py"}
_ARGS_FILE_THRESHOLD = 8 * 1024


class RunnerOptions(TypedDict, total=False):
    file: str
    args: Optional[list[str]]
    cwd: Optional[str]
    capsule_path: Optional[str]


class HostRequest(TypedDict):
    method: str
    url: str
    headers: Optional[list[str]]
    body: Optional[str]
    status: int


class ExecutionInfo(TypedDict):
    task_name: str
    duration_ms: int
    retries: int
    fuel_consumed: int
    ram_used: int
    host_requests: list[HostRequest]


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
    mounts: Optional[list[str]] = None,
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
    mounts = mounts or []

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
    mount_flags = [flag for m in mounts for flag in ("--mount", m)]

    serialized_args = json.dumps(args).encode("utf-8")
    args_file_path: Optional[str] = None

    if len(serialized_args) > _ARGS_FILE_THRESHOLD:
        args_file_path = os.path.join(
            tempfile.gettempdir(), f"capsule-args-{uuid.uuid4().hex}.json"
        )
        with open(args_file_path, "w", encoding="utf-8") as f:
            f.write(serialized_args.decode("utf-8"))
        args_flags = ["--args-file", args_file_path]
    else:
        args_flags = args

    cmd = [capsule_path, subcommand, resolved_file, "--json", *mount_flags, *args_flags]

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )

        stdout, stderr = await process.communicate()

        if args_file_path:
            try:
                os.unlink(args_file_path)
            except OSError:
                pass

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
        if args_file_path:
            try:
                os.unlink(args_file_path)
            except OSError:
                pass
        raise FileNotFoundError(
            "Capsule CLI not found. Use 'pip install capsule-run' to install it."
        )
