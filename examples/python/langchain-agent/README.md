# LangChain + Capsule Code Execution

This example demonstrates how to integrate [Capsule](https://github.com/mavdol/capsule) with [LangChain](https://python.langchain.com/) to safely execute AI-generated code in a sandboxed environment.

## How it works

1. The LangChain agent receives a task from the user
2. It generates Python code to solve the problem
3. The code is executed in a Capsule sandbox via `run()`
4. Results are returned safely to the user

> [!TIP]
> Check [`capsule_sandbox.py`](./capsule_sandbox.py) to see how the sandbox task executes code.

## Quick Start

```bash
pip install -r requirements.txt
```

Create a `.env` file with your OpenAI API key:

```bash
cp .env.example .env
```

Run the agent:

```bash
python agent.py
```
