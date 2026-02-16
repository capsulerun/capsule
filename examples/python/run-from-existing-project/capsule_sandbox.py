from capsule import task


@task(name="main", compute="HIGH", ram="64MB", timeout="10s")
def main(code: str) -> str:
    """Execute code in a sandboxed environment."""
    local_vars = {}
    exec(code, {}, local_vars)
    return local_vars.get("result")
