import json
import os
from capsule import task

from execution import _execute_code
from serialization import _serialize_env, _deserialize_env


@task(
    name="import_file",
    compute="MEDIUM",
    ram="256MB",
    allowed_files=[{"path": ".capsule/sessions", "mode": "read-write"}],
)
def import_file(session_id: str, path: str, content: str):
    workspace = f".capsule/sessions/{session_id}_workspace"
    full_path = os.path.normpath(os.path.join(workspace, path))
    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    with open(full_path, "w") as f:
        f.write(content)

    return f"Imported {path}"


@task(
    name="delete_file",
    compute="MEDIUM",
    ram="256MB",
    allowed_files=[{"path": ".capsule/sessions", "mode": "read-write"}],
)
def delete_file(session_id: str, path: str):
    workspace = f".capsule/sessions/{session_id}_workspace"
    full_path = os.path.normpath(os.path.join(workspace, path))
    os.remove(full_path)

    return f"Deleted {path}"


@task(name="execute_code", compute="LOW", ram="256MB")
def execute_code(code: str, env: dict = {}):
    return _execute_code(code, env)


@task(
    name="execute_code_in_session",
    compute="LOW",
    ram="256MB",
    allowed_files=[{"path": ".capsule/sessions", "mode": "read-write"}],
)
def execute_code_in_session(code: str, session_id: str):
    env = {}

    with open(f".capsule/sessions/{session_id}_state.json", "r") as f:
        state_data = json.load(f)
    _deserialize_env(state_data, env)

    result = _execute_code(code, env)

    with open(f".capsule/sessions/{session_id}_state.json", "w") as f:
        json.dump(_serialize_env(env), f)

    return result


@task(name="main", compute="HIGH")
def main(action: str, *args):
    if action == "EXECUTE_CODE":
        response = execute_code(*args)

    elif action == "EXECUTE_CODE_IN_SESSION":
        response = execute_code_in_session(*args)

    elif action == "IMPORT_FILE_IN_SESSION":
        response = import_file(*args)

    elif action == "DELETE_FILE_IN_SESSION":
        response = delete_file(*args)

    else:
        raise ValueError(f"Invalid action: {action}")

    if not response["success"] and response["error"]:
        raise Exception(response["error"]["message"])

    return response["result"]
