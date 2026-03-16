# Capsule ElizaOS Plugin

Execute Python and JavaScript code securely in your ElizaOS agents using [Capsule](https://github.com/mavdol/capsule) sandboxes.

## Installation

```bash
npm install @capsule-run/elizaos-plugin
```

## Usage

Add the plugin to your ElizaOS agent:

```typescript
import { capsulePlugin } from '@capsule-run/elizaos-plugin';

const agent = {
  plugins: [capsulePlugin],
};
```

## What It Does

Your agent can now execute code when users ask questions like:

- **"Calculate 156 * 23"** → Runs Python: `156 * 23` → Returns: `3588`
- **"What is the sum of 1 to 100?"** → Executes code → Returns: `5050`
- **"Generate 10 random numbers"** → Runs Python script → Returns array
- **"Sort this array: [5,2,8,1]"** → Executes JavaScript → Returns sorted array

The agent automatically decides when to use code execution and generates the code itself.

## How It Works

1. User asks a question that needs computation
2. The agent's LLM recognizes it needs code execution
3. The LLM generates Python or JavaScript code
4. Code runs in a secure Capsule WebAssembly sandbox
5. Result is returned to the user

## Features

- ✅ **Secure** - Code runs in isolated WebAssembly sandboxes
- ✅ **Fast** - Pre-warmed sandboxes (~10ms execution)
- ✅ **Local** - No external API calls or paid services
- ✅ **Dual Language** - Supports Python and JavaScript
- ✅ **Smart** - LLM decides when to use code execution

## Example

```
User: "What's 15% of 2500?"

Agent: *uses EXECUTE_CODE action*
       *generates: 2500 * 0.15*
       *executes in Capsule sandbox*

Agent: "The result is 375"
```

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Test
bun test
```

## License

Apache-2.0
