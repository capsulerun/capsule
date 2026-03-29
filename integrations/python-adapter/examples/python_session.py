import asyncio
from capsule_adapter import Session


async def main():
    async with Session("python") as session:
        await session.run("x = 2")
        result = await session.run("x += 1; x")
        print(result)

if __name__ == "__main__":
    asyncio.run(main())
