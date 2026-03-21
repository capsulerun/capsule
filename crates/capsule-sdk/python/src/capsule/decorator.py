"""
Capsule SDK Decorator for task-runner interface

This module export a decorator to mark a function as a Capsule task.
"""

import json
import functools
from .host_api import call_host, is_wasm_mode
from . import app


def _normalize_allowed_file(entry):
    if isinstance(entry, str):
        return entry
    path = entry.get("path", "")
    mode = entry.get("mode")
    if mode is None or mode in ("rw", "read-write"):
        return path
    if mode in ("ro", "read-only"):
        return f"{path}:ro"
    raise ValueError(
        f"Invalid allowed_files mode '{mode}' for path '{path}'. "
        f"Use 'read-only' or 'read-write'."
    )


def task(name=None, compute="MEDIUM", ram=None, timeout=None, max_retries=None, allowed_files=None, allowed_hosts=["*"], env_variables=None):
    """
    Decorator to mark a function as a Capsule task.

    Args:
        name: Task name (defaults to function name)
        compute: Compute level - "LOW", "MEDIUM", or "HIGH"
        ram: RAM limit - e.g., "512MB", "2GB"
        timeout: Timeout duration - e.g., "30s", "5m"
        max_retries: Maximum number of retries (default: 1)
        allowed_files: List of files/folders accessible in sandbox - e.g., ["./data"]
        allowed_hosts: List of allowed hosts for HTTP requests - e.g., ["https://api.openai.com"]
        env_variables: List of environment variables accessible in sandbox - e.g., ["ANTHROPIC_API_KEY"]

    In WASM mode:
    - The function is registered in the task registry with its config
    - When called from within a task, it schedules a new isolated instance
    - The host creates a new Wasm instance with resource limits

    In non-WASM mode:
    - The function executes directly
    """
    def decorator(func):
        task_name = name if name is not None else func.__name__

        task_config = {
            "name": task_name,
            "compute": compute.upper() if compute else "MEDIUM",
        }

        if ram is not None:
            task_config["ram"] = ram
        if timeout is not None:
            task_config["timeout"] = timeout
        if max_retries is not None:
            task_config["max_retries"] = max_retries
        if allowed_files is not None:
            task_config["allowed_files"] = [_normalize_allowed_file(f) for f in allowed_files]
        if allowed_hosts is not None:
            task_config["allowed_hosts"] = allowed_hosts
        if env_variables is not None:
            task_config["env_variables"] = env_variables

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            if not is_wasm_mode():
                return func(*args, **kwargs)

            args_data = list(args)
            result_json = call_host(task_name, args_data, task_config)

            try:
                result = json.loads(result_json)
                return result
            except json.JSONDecodeError:
                return result_json

        app.register_task(task_name, func, task_config)

        return wrapper

    return decorator
