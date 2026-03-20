"""
Capsule SDK Export Module for task-runner interface

This module implements the `capsule:host/task-runner` export interface
that the Wasm component provide.
"""

import asyncio
import inspect
import json


class _WasmEventLoop(asyncio.SelectorEventLoop):
    """
    Minimal event loop for WASM that skips OS-level self-pipe setup.

    The self-pipe is only used for thread wakeups and signal handling,
    neither of which exist in a WASM sandbox.
    """

    def _make_self_pipe(self):
        self._ssock = None
        self._csock = None
        self._internal_fds += 1

    def _close_self_pipe(self):
        if self._ssock is not None:
            self._remove_reader(self._ssock.fileno())
            self._ssock.close()
            self._ssock = None
        if self._csock is not None:
            self._csock.close()
            self._csock = None
        self._internal_fds -= 1

    def _write_to_self(self):
        pass

    def _read_from_self(self):
        pass

_TASKS = {}
_main_module = None


def register_task(name: str, func, config: dict = None):
    """
    Register a task function by name with its configuration.

    Args:
        name: Task name
        func: The task function
        config: Task configuration (compute, ram, timeout, etc.)
    """
    _TASKS[name] = {
        "func": func,
        "config": config or {}
    }

def get_task(name: str):
    """Get a registered task by name"""
    task_info = _TASKS.get(name)
    if task_info:
        return task_info["func"]
    return None

def get_task_config(name: str):
    """Get the configuration for a registered task"""
    task_info = _TASKS.get(name)
    if task_info:
        return task_info["config"]
    return {}

class TaskRunner:
    """
    Implementation of the capsule:host/task-runner interface.

    This class is instantiated by capsule-core when the component is loaded.
    The Rust host calls `run(args_json)` to execute a task.
    """
    def run(self, args_json: str) -> str:
        """
        Execute a task with the given arguments.

        Args:
            args_json: JSON string containing:
                - task_name: Name of the task to run
                - args: Positional arguments list
                - kwargs: Keyword arguments dict

        Returns:
            JSON string with the task result or error

        The host calls this function to execute a task within this Wasm instance.
        """
        try:
            data = json.loads(args_json)
            task_name = data.get("task_name", "main")
            args = data.get("args", [])
            kwargs = data.get("kwargs", {})

            task_func = get_task(task_name)

            if task_func is None and task_name != "main":
                task_func = get_task("main")

            if task_func is None and _main_module is not None:
                if hasattr(_main_module, 'main') and callable(_main_module.main):
                    task_func = _main_module.main

            if task_func is None and _TASKS:
                first_task_name = next(iter(_TASKS.keys()))
                task_func = get_task(first_task_name)

            if task_func is None:
                return json.dumps({
                    "error": f"No tasks or main() function found. Available tasks: {list(_TASKS.keys())}"
                })

            if inspect.iscoroutinefunction(task_func):
                loop = _WasmEventLoop()
                try:
                    result = loop.run_until_complete(task_func(*args, **kwargs))
                finally:
                    loop.close()
            else:
                result = task_func(*args, **kwargs)

            return json.dumps({"result": result})

        except Exception as e:
            return json.dumps({
                "error_type": "task_error",
                "message": str(e),
            })


exports = TaskRunner()
