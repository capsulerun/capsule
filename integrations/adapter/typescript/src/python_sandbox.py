import ast
import sys
from io import StringIO
from capsule import task

@task(name="executeCode", compute="LOW", ram="256MB")
def execute_code(code: str):
    tree = ast.parse(code)

    if not tree.body:
        return None

    last_node = tree.body[-1]

    local_env = {}

    captured_output = StringIO()
    old_stdout = sys.stdout
    sys.stdout = captured_output

    try:
        if isinstance(last_node, ast.Expr):
            tree.body.pop()
            if tree.body:
                exec(compile(tree, filename="<ast>", mode="exec"), local_env)
            result = eval(compile(ast.Expression(last_node.value), filename="<ast>", mode="eval"), local_env)
        else:
            exec(compile(tree, filename="<ast>", mode="exec"), local_env)
            result = local_env.get("result")
    finally:
        sys.stdout = old_stdout

    output = captured_output.getvalue()

    if output:
        if result is not None:
            return output + str(result)
        return output

    return result

@task(name="main", compute="HIGH")
def main(code: str):
    response = execute_code(code)

    if isinstance(response, dict):
        if not response.get("success"):
            raise Exception(response["error"]["message"])
        if response.get("success") and response.get("result") is not None:
            return response["result"]

    return response
