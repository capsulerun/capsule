"""
Capsule adapter for Python applications.

Execute Python and JavaScript code securely inside Capsule sandboxes.
"""

from .execution import (
    load_javascript_sandbox,
    load_python_sandbox,
    load_sandboxes,
    run_javascript,
    run_python,
)
from .session import Session


__all__ = [
    "run_python",
    "run_javascript",
    "load_sandboxes",
    "load_python_sandbox",
    "load_javascript_sandbox",
    "Session",
]
