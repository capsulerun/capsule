# `Capsule` ElizaOS Plugin

[![@capsule-run/elizaos-plugin Release](https://github.com/mavdol/capsule/actions/workflows/elizaos-plugin-release.yml/badge.svg)](https://github.com/mavdol/capsule/actions/workflows/elizaos-plugin-release.yml)

Execute Python and JavaScript code securely in your ElizaOS agents using local WASM sandboxes.

## Installation

```bash
bun install @capsule-run/elizaos-plugin
```

## Usage

Add the plugin to your ElizaOS agent configuration:

```typescript
import { capsulePlugin } from '@capsule-run/elizaos-plugin';

const agent = {
  name: "assistant",
  plugins: [capsulePlugin],
  // ... other agent config
};
```

## Available Actions

### `EXECUTE_CODE`

Executes Python or JavaScript code in a secure Capsule sandbox.

**Aliases:** `RUN_CODE`, `EVAL_CODE`, `CODE_EXEC`, `RUN_PYTHON`, `RUN_JAVASCRIPT`

**Example Interactions:**

```
User: Calculate the fibonacci of 10
Agent: *generates and safely executes Python code*
Result: 55
```

## How It Works

The plugin uses Capsule to execute code in secure sandboxes. It uses a pre-built [adapter](https://github.com/mavdol/capsule/tree/main/integrations/typescript-adapter) with the default sandboxes included to make it simple to use.

Learn more about [Capsule](https://github.com/mavdol/capsule).

