import { task } from "@capsule-run/sdk";
import fs from "fs/promises";

/**
 * Sub-task with restricted file access.
 * When called, it can ONLY access files in ./data directory
 */
export const restrictedWriter = task({
    name: "restricted_writer",
    allowedFiles: [{
        path: "./data",
        mode: "read-only"
    }]
}, async (content: string) => {
    await fs.writeFile("./data/output.txt", content);
    return { written: true };
});

/**
 * Main task has full project access by default.
 */
export const main = task({ name: "main", allowedFiles: [{
    path: "./data",
    mode: "read-only"
}] }, async () => {
    const content = await fs.readFile("./data/input.txt", "utf8") as string;
    const lines = content.trim().split("\n");
    const lineCount = lines.length;

    const result = await restrictedWriter(
        `Processed ${lineCount} lines\nFirst line: ${lines[0]}\n`
    );

    return {
        inputLines: lineCount,
        firstLine: lines[0],
        writeResult: result
    };
});
