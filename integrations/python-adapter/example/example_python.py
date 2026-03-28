import asyncio
from capsule_adapter import run_python

async def main():
    print("Executing Python code inside Capsule sandbox...")

    result = await run_python("""
print("Hello from Python!")
x = 5 + 3
x * 2
""")

    print("\n--- Sandbox Output ---")
    print(result)

if __name__ == "__main__":
    asyncio.run(main())
