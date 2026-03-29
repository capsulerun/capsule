import { Session } from "../session.js";

async function main() {
    await using s = new Session("python");
    await s.run("x = 1");
    const result = await s.run("x += 1; x");
    console.log("result", result);
}

main();
