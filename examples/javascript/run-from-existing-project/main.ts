import { run } from "@capsule-run/sdk/runner";

// Run untrusted code safely inside a Capsule sandbox
const result = await run({
  file: "./capsule_sandbox.ts",
  args: ["return Array.from({length: 10}, (_, i) => i * i)"],
});

console.log(result);
