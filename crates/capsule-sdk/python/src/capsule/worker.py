"""
Capsule SDK - Worker Client

The worker process is created lazily on the first call and is shared for the
lifetime of the Python process. It is safe to call from multiple async tasks
concurrently — each call gets its own response future keyed by a unique id.
"""

import asyncio
import json
import os
import uuid
from typing import Optional

from .run import RunnerResult, _WASM_EXTENSIONS


class _WorkerClient:
    """Manages a single long-lived `capsule worker` subprocess."""

    def __init__(self, capsule_path: str, cwd: Optional[str]) -> None:
        self._capsule_path = capsule_path
        self._cwd = cwd
        self._process: Optional[asyncio.subprocess.Process] = None
        self._pending: dict[str, asyncio.Future[str]] = {}
        self._reader_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()

    async def _start(self) -> None:
        self._process = await asyncio.create_subprocess_exec(
            self._capsule_path,
            "worker",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd=self._cwd,
        )
        self._reader_task = asyncio.create_task(self._reader_loop())

    async def _reader_loop(self) -> None:
        assert self._process and self._process.stdout
        while True:
            try:
                line = await self._process.stdout.readline()
            except Exception:
                break

            if not line:
                break
            try:
                response = json.loads(line.decode("utf-8"))
                req_id = response.get("id")
                future = self._pending.pop(req_id, None)
                if future and not future.done():
                    future.set_result(line.decode("utf-8"))
            except Exception:
                continue

        for future in self._pending.values():
            if not future.done():
                future.set_exception(RuntimeError("capsule worker process exited unexpectedly"))

        self._pending.clear()

    async def _ensure_running(self) -> None:
        async with self._lock:
            dead = (
                self._process is None
                or self._process.returncode is not None
            )
            if dead:
                await self._start()

    async def send(self, file: str, args: list[str], mounts: list[str]) -> str:
        await self._ensure_running()

        req_id = uuid.uuid4().hex
        request = json.dumps({"id": req_id, "file": file, "args": args, "mounts": mounts})

        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._pending[req_id] = future

        assert self._process and self._process.stdin
        self._process.stdin.write((request + "\n").encode("utf-8"))
        await self._process.stdin.drain()

        return await future

    async def close(self) -> None:
        if self._process and self._process.returncode is None:
            try:
                assert self._process.stdin
                self._process.stdin.close()
                await self._process.wait()
            except Exception:
                pass
        if self._reader_task:
            self._reader_task.cancel()


_clients: dict[tuple[str, Optional[str]], _WorkerClient] = {}

_unavailable: set[str] = set()


def _mark_unavailable(capsule_path: str) -> None:
    _unavailable.add(capsule_path)


def _is_unavailable(capsule_path: str) -> bool:
    return capsule_path in _unavailable

_clients_lock: Optional[asyncio.Lock] = None


def _get_lock() -> asyncio.Lock:
    global _clients_lock

    if _clients_lock is None:
        _clients_lock = asyncio.Lock()
    return _clients_lock


async def _get_client(capsule_path: str, cwd: Optional[str]) -> _WorkerClient:
    key = (capsule_path, cwd)
    async with _get_lock():
        if key not in _clients:
            _clients[key] = _WorkerClient(capsule_path, cwd)
        return _clients[key]


async def run_with_worker(
    *,
    file: str,
    args: Optional[list[str]] = None,
    mounts: Optional[list[str]] = None,
    cwd: Optional[str] = None,
    capsule_path: str = "capsule",
) -> RunnerResult:
    """Run a Capsule task via a persistent worker process (7-10ms per call).

    Uses a single long-lived `capsule worker` subprocess per combination.

    Args:
        file: Path to the source file or pre-built .wasm artifact
        args: Arguments to pass to the task's main function
        mounts: Mount specs forwarded to the worker (HOST[::GUEST][:ro|:rw])
        cwd: Working directory for resolving relative paths
        capsule_path: Path to the capsule CLI binary

    Returns:
        RunnerResult with task result and execution metadata
    """
    args = args or []
    mounts = mounts or []

    resolved_file = os.path.abspath(os.path.join(cwd or os.getcwd(), file))
    ext = os.path.splitext(resolved_file)[1].lower()

    if not os.path.exists(resolved_file):
        if ext in _WASM_EXTENSIONS:
            raise FileNotFoundError(
                f"Artifact not found: {resolved_file}. "
                "Run `capsule build` first to generate the .wasm artifact."
            )
        raise FileNotFoundError(f"File not found: {resolved_file}")

    client = await _get_client(capsule_path, cwd or os.getcwd())

    try:
        raw = await client.send(resolved_file, args, mounts)
    except RuntimeError:
        key = (capsule_path, cwd or os.getcwd())
        _clients.pop(key, None)
        raise

    try:
        lines = raw.strip().split("\n")
        response = json.loads(lines[-1])
    except (json.JSONDecodeError, IndexError):
        raise ValueError(f"Failed to parse worker response: {raw}")

    if "error" in response and "output" not in response:
        raise RuntimeError(response["error"])

    return response.get("output", response)


async def close_all() -> None:
    """Close all active worker processes. Call on application shutdown."""
    for client in list(_clients.values()):
        await client.close()
    _clients.clear()


# Automatically close workers on normal exit to avoid asyncio cleanup warnings on Windows
import atexit

def _close_all_sync() -> None:
    """Close all workers synchronously (for atexit hook)."""
    for client in _clients.values():
        if client._process and client._process.returncode is None:
            try:
                client._process.terminate()
            except Exception:
                pass


atexit.register(_close_all_sync)
