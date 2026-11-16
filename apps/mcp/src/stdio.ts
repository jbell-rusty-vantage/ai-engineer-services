#!/usr/bin/env node
import { requiredEnvironment } from "@aiengineer/service-application";
import { AiEngineerClient } from "@aiengineer/service-client";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAiEngineerMcpServer } from "./server.js";

/**
 * Local MCP server for a harness on the learner's machine. It calls the AI Engineer API over HTTP with the user's
 * session (and optional client grant) and may read local folders, e.g. to publish a site the harness just built.
 * Schema navigation goes through the API too, so it needs no schema workspace on this machine.
 */
const clientToken = process.env.AIENG_CLIENT_TOKEN?.trim();
const client = new AiEngineerClient({
  baseUrl: requiredEnvironment(process.env, "AIENG_API_URL"),
  accessToken: requiredEnvironment(process.env, "AIENG_ACCESS_TOKEN"),
  ...(clientToken ? { clientToken } : {}),
});

const server = createAiEngineerMcpServer({ port: client, schema: client, localFiles: true });
await server.connect(new StdioServerTransport());
