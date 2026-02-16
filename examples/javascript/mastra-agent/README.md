# Mastra + Capsule Code Execution

This example demonstrates how to integrate [Capsule](https://github.com/mavdol/capsule) with [Mastra](https://mastra.ai/) to safely execute AI-generated code in a sandboxed environment.


https://github.com/user-attachments/assets/8a2a3c5d-e1e9-43eb-95b7-44386880836e


## How it works

1. The Mastra agent receives a task from the user
2. It generates JavaScript code to solve the problem
3. The code is executed in a Capsule sandbox via `execSync`
4. Results are returned safely to the user

> [!TIP]
> Check [`capsule.ts`](./capsule.ts) to see how the sandbox task executes code.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:4111 and try: *"Calculate fibonacci of 15"*

