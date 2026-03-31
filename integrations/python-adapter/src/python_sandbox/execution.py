import ast
import sys
from io import StringIO


def _tag_definitions(code: str, tree: ast.Module, env: dict, before: set) -> None:
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            name = node.name
            if name not in before and name in env:
                segment = ast.get_source_segment(code, node)
                if segment:
                    env[name].__source__ = segment


def _execute_code(code: str, env: dict):
    captured = StringIO()
    old_stdout = sys.stdout
    sys.stdout = captured

    try:
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            if "return" not in str(e):
                raise
            indented = "\n".join("    " + line for line in code.splitlines())
            tree = ast.parse(f"def __capsule_fn__():\n{indented}")
            exec(compile(tree, "<capsule>", "exec"), env)
            result = env.pop("__capsule_fn__")()
            output = captured.getvalue()
            if output:
                return output + (str(result) if result is not None else "")
            return result

        if not tree.body:
            return None

        last = tree.body[-1]
        if isinstance(last, ast.Expr):
            tree.body.pop()
            if tree.body:
                before = set(env.keys())
                exec(compile(tree, "<ast>", "exec"), env)
                _tag_definitions(code, tree, env, before)
            result = eval(compile(ast.Expression(last.value), "<ast>", "eval"), env)
        else:
            before = set(env.keys())
            exec(compile(tree, "<ast>", "exec"), env)
            _tag_definitions(code, tree, env, before)
            result = None
    finally:
        sys.stdout = old_stdout

    output = captured.getvalue()
    if output:
        return output + (str(result) if result is not None else "")
    return result
