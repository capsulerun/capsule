import asyncio

from capsule import run
from dotenv import load_dotenv
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

load_dotenv()

@tool
async def execute_code(code: str) -> dict:
    """Execute Python code in an isolated sandbox.

    Write Python code that stores its final output in a variable called `result`.
    Example: "result = sum(range(10))"
    """
    result = await run(file="./capsule_sandbox.py", args=[code])

    return {
        "success": result["success"],
        "result": result["result"],
        "error": result["error"]["message"] if result["error"] else None,
        "duration_ms": result["execution"]["duration_ms"],
    }


SYSTEM_PROMPT = (
    "You are a helpful assistant that solves problems by writing Python code. "
    "Use the execute_code tool to run your code. "
    "Your code must store the final answer in a variable called `result`."
)

llm = ChatOpenAI(model="gpt-4o-mini")
agent = create_react_agent(llm, [execute_code], prompt=SYSTEM_PROMPT)


async def main():
    response = await agent.ainvoke(
        {"messages": [("user", "Calculate the fibonacci of 15")]}
    )

    for message in response["messages"]:
        print(f"{message.type}: {message.content}")


if __name__ == "__main__":
    asyncio.run(main())
