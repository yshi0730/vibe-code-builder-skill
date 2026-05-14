#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerFetchStyleTool } from "./tools/fetch-style.js";
import { registerFetchTemplateTool } from "./tools/fetch-template.js";
import { registerDashboardModuleTool } from "./tools/register-dashboard-module.js";
import { registerPublishAndHireTool } from "./tools/publish-and-hire.js";

const server = new McpServer({
  name: "vibe-code-builder",
  version: "0.1.0",
});

registerFetchStyleTool(server);
registerFetchTemplateTool(server);
registerDashboardModuleTool(server);
registerPublishAndHireTool(server);

const transport = new StdioServerTransport();
await server.connect(transport);
