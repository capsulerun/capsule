from capsule import task

@task(name="restricted_writer", allowed_files=[{"path": "./data", "mode": "read-write"}])
def restricted_writer(content: str) -> dict:
    """Sub-task with restricted file access.
    When called, it can ONLY access files in ./data directory
    """
    with open("./data/output.txt", "w") as f:
        f.write(content)
    return {"written": True}


@task(name="main", allowed_files=[{"path": "./data", "mode": "read-only"}])
def main() -> dict:
    """Main task has full project access by default."""

    with open("./data/input.txt") as f:
        content = f.read()

    lines = content.strip().split("\n")
    line_count = len(lines)

    output_content = f"Processed {line_count} lines\nFirst line: {lines[0]}\n"
    write_result = restricted_writer(output_content)

    return {
        "input_lines": line_count,
        "first_line": lines[0],
        "write_result": write_result
    }
