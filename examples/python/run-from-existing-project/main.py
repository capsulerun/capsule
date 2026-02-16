import asyncio

from capsule import run


async def main():
    # Run untrusted code safely inside a Capsule sandbox
    result = await run(
        file="./capsule_sandbox.py",
        args=["result = sum(range(100))"]
    )

    print(result)


if __name__ == "__main__":
    asyncio.run(main())
