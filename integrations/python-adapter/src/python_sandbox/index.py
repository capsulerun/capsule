import json
import os
import shutil
from capsule import task

from execution import _execute_code
from serialization import _serialize_env, _deserialize_env


@task(
    name="import_file_in_session",
    compute="MEDIUM",
    ram="256MB",
    allowed_files=[{"path": "./", "mode": "read-only"}],
)
def import_file_in_session(src_path: str, dest_path: str):
    src = os.path.normpath(src_path)
    dest = os.path.normpath(os.path.join('workspace', dest_path))

    if os.path.isdir(src):
        shutil.copytree(src, dest, dirs_exist_ok=True)
    else:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(src, dest)

    return f"Imported {dest_path}"


@task(
    name="delete_file_from_session",
    compute="MEDIUM",
    ram="256MB",
)
def delete_file_from_session(path: str):
    # have access to mounted /workspace
    full_path = os.path.normpath('workspace/' + path)
    os.remove(full_path)

    return f"Deleted {path}"


@task(name="execute_code", compute="LOW", ram="256MB")
def execute_code(code: str, env: dict = {}):
    return _execute_code(code, env)


@task(
    name="execute_code_in_session",
    compute="LOW",
    ram="256MB",
    allowed_files=[{"path": ".capsule/sessions/states", "mode": "read-write"}],
)
def execute_code_in_session(code: str, session_id: str):
    env = {}

    with open(f".capsule/sessions/states/{session_id}.json", "r") as f:
        state_data = json.load(f)
    _deserialize_env(state_data, env)

    result = _execute_code(code, env)

    with open(f".capsule/sessions/states/{session_id}.json", "w") as f:
        json.dump(_serialize_env(env), f)

    return result


@task(name="main", compute="HIGH")
def main(action: str, *args):
    if action == "EXECUTE_CODE":
        response = execute_code(*args)

    elif action == "EXECUTE_CODE_IN_SESSION":
        response = execute_code_in_session(*args)

    elif action == "IMPORT_FILE_IN_SESSION":
        response = import_file_in_session(*args)

    elif action == "DELETE_FILE_FROM_SESSION":
        response = delete_file_from_session(*args)

    else:
        raise ValueError(f"Invalid action: {action}")

    if not response["success"] and response["error"]:
        raise Exception(response["error"]["message"])

    return response["result"]
