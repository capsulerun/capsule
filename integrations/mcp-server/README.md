# @capsule-run/mcp-server

An [MCP](https://modelcontextprotocol.io/) server that lets AI agents execute Python and JavaScript code in secure WebAssembly sandboxes powered by [Capsule](https://github.com/mavdol/capsule).

## Tools

| Tool | Description |
|------|-------------|
| `execute_python` | Execute Python code in an isolated Wasm sandbox |
| `execute_javascript` | Execute JavaScript code in an isolated Wasm sandbox |

Each tool accepts a `code` string and returns the result of the last evaluated expression.

## Setup

Add to your MCP client configuration (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "capsule-sandbox": {
      "command": "npx",
      "args": ["-y", "@capsule-run/mcp-server"]
    }
  }
}
```

## Build

```bash
npm install

# Build wasm sandboxes + compile TypeScript
npm run build

# Or separately:
npm run build:wasm   # compile sandbox sources to .wasm
npm run build:ts     # compile TypeScript to dist/
```

## How It Works

The server ships two pre-compiled WebAssembly sandboxes:

- `python_sandbox.wasm` — executes Python code using `ast.parse` + `exec`/`eval`
- `js_sandbox.wasm` — executes JavaScript code using `eval`

When a tool is called, the server invokes `capsule exec <sandbox>.wasm` with the user's code as an argument. Each execution runs in its own isolated Wasm sandbox with configurable resource limits.

## License

Apache-2.0
