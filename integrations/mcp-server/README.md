# `Capsule` MCP Server

[![CI](https://github.com/mavdol/capsule/actions/workflows/ci.yml/badge.svg)](https://github.com/mavdol/capsule/actions/workflows/ci.yml)

Give your AI agent the ability to write and run Python and JavaScript code, in a secure sandbox.

Every execution happens inside its own WebAssembly sandbox with strict resource limits. No file system access, no risk to your host machine.

## Tools

| Tool | Description |
|------|-------------|
| `execute_python` | Run Python code in an isolated sandbox |
| `execute_javascript` | Run JavaScript code in an isolated sandbox |

### Example

Ask your AI agent:

> *"I have monthly revenue of [12400, 15800, 14200, 18900, 21000, 19500]. What's the average and which month grew the most?"*

The agent calls `execute_python` with:

```python
revenue = [12400, 15800, 14200, 18900, 21000, 19500]

avg = sum(revenue) / len(revenue)
growth = [revenue[i] - revenue[i-1] for i in range(1, len(revenue))]
best_month = growth.index(max(growth)) + 2  # +2 for 1-indexed and offset

{"average": round(avg, 2), "best_growth_month": best_month, "growth": max(growth)}
```

→ `{"average": 16966.67, "best_growth_month": 4, "growth": 4700}`

The code runs in a Wasm sandbox, the result comes back, and nothing was executed on your system.

## Setup

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "capsule": {
      "command": "npx",
      "args": ["-y", "@capsule-run/mcp-server"]
    }
  }
}
```

or with other solution like `add-mcp` :

```bash
npx add-mcp "npx -y @capsule-run/mcp-server"
```

## How It Works

The server ships two pre-compiled WebAssembly modules: one for Python, one for JavaScript. When a tool is called, the code is executed via `capsule` inside a dedicated Wasm sandbox with:

- **Isolated memory** — each execution gets its own address space
- **CPU/Ram limits** — fuel-metered execution prevents runaway loops
- **No host access** — no filesystem or network unless explicitly allowed

Learn more about [Capsule](https://github.com/mavdol/capsule).

## Limitations

> [!NOTE]
> JavaScript sandbox has standard network access and a broader compatibility since it doesn't rely on native bindings.

- **Stateless** — each execution starts from a clean sandbox. There is no shared state between calls. To chain results, pass previous outputs as inputs to the next execution.
- **Python HTTP** — standard networking libraries are not compatible with the Wasm sandbox.

## Build

```bash
npm install

# Build everything (wasm sandboxes + TypeScript)
npm run build

# Or separately:
npm run build:wasm   # compile sandbox sources to .wasm
npm run build:ts     # compile TypeScript to dist/
```
