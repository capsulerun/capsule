"""
Persistent sandbox session backed by per-session state files.
"""

import shutil
import uuid
from pathlib import Path

from capsule import run

from .execution import _SANDBOX_PY, _SANDBOX_JS, _unwrap_result

_SESSIONS_DIR = Path(".capsule/sessions")
_SESSIONS_STATES_DIR = _SESSIONS_DIR / "states"


class Session:
    """Persistent sandbox session backed by per-session state files.

    Each run() call is a fresh Wasm instance. State is serialized to
    ``.capsule/sessions/<id>_state.json`` between calls. Workspace files
    live under ``.capsule/sessions/<id>_workspace/``.

    Usage::

        async with Session() as s:
            await s.run("x = 1")
            result = await s.run("x += 1; x")  # "2"

        async with Session("javascript") as s:
            await s.run("x = 1")
            result = await s.run("x += 1; x")  # "2"
    """

    def __init__(self, type: str = "python"):
        self._sandbox = _SANDBOX_PY if type == "python" else _SANDBOX_JS
        self._id = uuid.uuid4().hex
        _SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        _SESSIONS_STATES_DIR.mkdir(parents=True, exist_ok=True)
        self._state_file = _SESSIONS_STATES_DIR / f"{self._id}.json"
        self._workspace_dir = _SESSIONS_DIR / f"{self._id}_workspace"
        self._workspace_dir.mkdir(exist_ok=True)
        self._state_file.write_text("{}")

    async def _invoke(self, action: str, *args: str) -> str:
        res = await run(
            file=self._sandbox,
            args=[action, *args],
            mounts=[f"{self._workspace_dir}::workspace"],
        )
        if not res.get("success"):
            error = res.get("error", {})
            message = error.get("message") if isinstance(error, dict) else str(error)
            raise RuntimeError(f"Capsule session failed: {message}")
        return _unwrap_result(res.get("result"))

    async def run(self, code: str) -> str:
        """Execute code inside the session, preserving state across calls."""
        return await self._invoke("EXECUTE_CODE_IN_SESSION", code, self._id)

    async def import_file(self, src_path: str, dest_path: str) -> str:
        """Write a file into the session workspace."""
        return await self._invoke("IMPORT_FILE_IN_SESSION", src_path, dest_path)

    async def delete_file(self, path: str) -> str:
        """Delete a file from the session workspace."""
        return await self._invoke("DELETE_FILE_FROM_SESSION", path)

    async def reset(self) -> None:
        """Clear session state, preserving workspace files."""
        self._state_file.write_text("{}")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        if self._state_file.exists():
            self._state_file.unlink()
        if self._workspace_dir.exists():
            shutil.rmtree(self._workspace_dir)
