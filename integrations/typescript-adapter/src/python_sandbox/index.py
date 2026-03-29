import ast
import sys
import os
from io import StringIO
from capsule import task

from serialization import _serialize_env, _deserialize_env

@task(
    name="import_file",
    compute="MEDIUM",
    allowed_files=[{"path": ".capsule/sessions/workspace", "mode": "read-write"}],
)
def import_file(path: str, content: str):
    full_path = os.path.normpath(os.path.join(".capsule/sessions/workspace", path))
    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    with open(full_path, "w") as f:
        f.write(content)

    return f"Imported {path}"


@task(
    name="delete_file",
    compute="MEDIUM",
    allowed_files=[{"path": ".capsule/sessions/workspace", "mode": "read-write"}],
)
def delete_file(path: str):
    full_path = os.path.normpath(os.path.join(".capsule/sessions/workspace", path))
    os.remove(full_path)

    return f"Deleted {path}"


@task(name="execute_code", compute="LOW", ram="256MB")
def execute_code(code: str, env: dict = {}):
    tree = ast.parse(code)
    if not tree.body:
        return None

    captured = StringIO()
    old_stdout = sys.stdout
    sys.stdout = captured

    try:
        last = tree.body[-1]
        if isinstance(last, ast.Expr):
            tree.body.pop()
            if tree.body:
                exec(compile(tree, "<ast>", "exec"), env)
            result = eval(compile(ast.Expression(last.value), "<ast>", "eval"), env)
        else:
            exec(compile(tree, "<ast>", "exec"), env)
            result = None
    finally:
        sys.stdout = old_stdout

    output = captured.getvalue()
    if output:
        return output + (str(result) if result is not None else "")
    return result


@task(
    name="execute_code_in_session",
    compute="MEDIUM",
    allowed_files=[{"path": ".capsule/sessions", "mode": "read-write"}],
)
def execute_code_in_session(code: str, session_id: str):
    env = {}

    with open(f".capsule/sessions/{session_id}_state.json", "r") as f:
        state_data = json.load(f)
    _deserialize_env(state_data, env)

    result = execute_code(code, env)

    with open(f".capsule/sessions/{session_id}_state.json", "w") as f:
        json.dump(_serialize_env(env), f)

    return result


@task(name="main", compute="HIGH")
def main(action: str, *args):
    if action == "EXECUTE_CODE":
        return execute_code(*args)

    elif action == "EXECUTE_CODE_IN_SESSION":
        return execute_code_in_session(*args)

    elif action == "IMPORT_FILE":
        return import_file(*args)

    elif action == "DELETE_FILE":
        return delete_file(*args)

    else:
        raise ValueError(f"Invalid action: {action}")
