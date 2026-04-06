import { task } from "@capsule-run/sdk";
import fs from "fs";
import OpenAI from "openai";

const getDialogueLines = task({
    name: "Get Dialogue Lines",
    compute: "LOW",
    allowedFiles: ["source"]
}, async (): Promise<{lines: string[]}> => {
    const dialogues = fs.readFileSync('source/dialogue-lines.json', 'utf-8');
    return JSON.parse(dialogues);
})

const insertDialogueLine = task({
    name: "Save Dialogue Line",
    allowedFiles: ["output"]
}, async (line: string, evaluation: string): Promise<void> => {
    const output = fs.readFileSync('output/evaluated-dialogue-lines.csv', 'utf-8');
    const outputCsv = output.trim().split('\n');

    outputCsv.push(`"${line}",${evaluation}`);

    fs.writeFileSync('output/evaluated-dialogue-lines.csv', outputCsv.join('\n'));
})

const evaluateDialogueLine = task({
    name: "Evaluate Dialogue Line",
    envVariables: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"]
}, async (prompt: string): Promise<string> => {

    const openai = new OpenAI({
        baseURL: process.env.OPENAI_BASE_URL,
        apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: process.env.OPENAI_MODEL as string,
    });

    return completion.choices[0].message.content || "";
})

const agent = task({
    name: "Agent Evaluator",
    compute: "MEDIUM",
    maxRetries: 1,
    timeout: "1.8s"
}, async (line: string) => {
    const prompt = `
        Analyze the emotional tone of the following dialogue line: "${line}"

        Respond with a single lowercase word representing the emotion (e.g., neutral, angry, happy).
        Do not include any explanation.

        Examples:
        "What's in the suitcase?" -> "neutral"
        "You're out of your mind." -> "angry"
        "I'll buy it off you." -> "happy"
    `;

    const evaluateDialogueLineResponse = await evaluateDialogueLine(prompt);
    await insertDialogueLine(line, evaluateDialogueLineResponse.result);
    return;
})

task({name: "main", compute: "HIGH"}, async () => {

    const getDialogueLinesResponse = await getDialogueLines();
    const lines = getDialogueLinesResponse.result.lines;

    let failedAttempts = 0;
    let successfulAttempts = 0;

    for (const [index, line] of lines.entries()) {
        console.log(`\n💬 [${index + 1}/${lines.length}] Analyzing: "${line}"`);
        const agentResponse = await agent(line);

        if(!agentResponse.success) {
            failedAttempts++;
            continue;
        }

        successfulAttempts++;
    }

    console.log(
        "\n ----------\n",
        `Successful attempts: ${successfulAttempts}\n`,
        `Failed attempts: ${failedAttempts}\n`,
        "----------\n"
    )

    return;
})
