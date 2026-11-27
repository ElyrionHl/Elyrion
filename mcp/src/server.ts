#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig, makeClients } from "./chain.js";
import { callTool, tools, type ToolContext } from "./tools.js";

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "elyrion", version: "0.1.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly },
      },
      // Validation lives in callTool so errors come back as readable tool errors.
      async (args: unknown) => callTool(ctx, tool.name, args),
    );
  }
  return server;
}

async function main() {
  const config = loadConfig();
  const { publicClient, getWallet } = makeClients(config);
  const ctx: ToolContext = {
    config,
    publicClient,
    getWallet,
    secrets: config.agentKey ? [config.agentKey] : [],
  };
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; diagnostics go to stderr and never include the key.
  console.error("elyrion-mcp ready (chain 99901)");
}

main().catch((err) => {
  console.error(err instanceof ConfigError ? err.message : "elyrion-mcp failed to start.");
  process.exit(1);
});
