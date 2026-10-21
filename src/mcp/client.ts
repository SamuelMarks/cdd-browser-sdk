/**
 * @module mcp/client
 * Model Context Protocol (MCP) client for connecting to a remote CDD Gateway over SSE.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type {
  CompatibilityCallToolResultSchema,
  ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  CddGatewayError,
  CddValidationError,
  wrapError,
} from "../error.js";

/**
 * Type alias for the result returned by `CddMcpClient.generateSdk`.
 */
export type McpCallToolResult = z.infer<
  typeof CompatibilityCallToolResultSchema
>;

/**
 * Zod schema for validating `CddMcpClientOptions`.
 */
const CddMcpClientOptionsSchema = z.object({
  gatewayUrl: z
    .string()
    .trim()
    .min(1, "gatewayUrl must not be empty")
    .url("gatewayUrl must be a valid URL"),
  authToken: z.string().trim().min(1, "authToken must not be empty"),
});

/**
 * Configuration options for initializing a `CddMcpClient`.
 */
export interface CddMcpClientOptions {
  /**
   * The base URL to the CDD Gateway (e.g. `"https://api.cdd-gateway.io"`).
   */
  gatewayUrl: string;

  /**
   * Standard Bearer token or session token for authentication.
   */
  authToken: string;
}

/**
 * Client for communicating with the remote CDD Model Context Protocol (MCP) Gateway
 * over Server-Sent Events (SSE).
 */
export class CddMcpClient {
  /**
   * Underlying MCP SDK client instance.
   */
  private readonly client: Client;

  /**
   * Active SSE transport instance when connected, or `null` when disconnected.
   */
  private transport: SSEClientTransport | null = null;

  /**
   * Normalized base URL of the remote CDD Gateway (without trailing slash).
   */
  private readonly gatewayUrl: string;

  /**
   * Authentication Bearer token used for gateway requests.
   */
  private readonly authToken: string;

  /**
   * Constructs a new `CddMcpClient` instance.
   * @param options Configuration options containing `gatewayUrl` and `authToken`.
   * @throws {CddValidationError} If `gatewayUrl` is not a valid URL or `authToken` is empty.
   */
  constructor(options: CddMcpClientOptions) {
    const parsed = CddMcpClientOptionsSchema.safeParse(options);
    if (!parsed.success) {
      const issueMessage = parsed.error.issues
        .map((i) => i.message)
        .join("; ");
      throw new CddValidationError(issueMessage, parsed.error);
    }

    this.gatewayUrl = parsed.data.gatewayUrl.replace(/\/+$/, "");
    this.authToken = parsed.data.authToken;

    this.client = new Client(
      {
        name: "cdd-browser-sdk",
        version: "0.0.1",
      },
      {
        capabilities: {},
      },
    );
  }

  /**
   * Indicates whether the client currently holds an active SSE transport connection.
   * @returns `true` if connected, `false` otherwise.
   */
  public isConnected(): boolean {
    return this.transport !== null;
  }

  /**
   * Connects to the remote CDD Gateway via Server-Sent Events (`/mcp/sse`).
   * @returns A promise that resolves once the MCP handshake succeeds.
   * @throws {CddGatewayError} If establishing the SSE connection or handshake fails.
   */
  public async connect(): Promise<void> {
    try {
      const sseUrl = new URL("/mcp/sse", this.gatewayUrl);

      this.transport = new SSEClientTransport(sseUrl, {
        eventSourceInit: {
          withCredentials: true,
        },
        requestInit: {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
          },
        },
      });

      await this.client.connect(this.transport);
    } catch (e: unknown) {
      this.transport = null;
      const wrapped = wrapError(e);
      throw new CddGatewayError(wrapped.message, undefined, undefined, e);
    }
  }

  /**
   * Disconnects the active MCP SSE transport if connected.
   * Calling `disconnect()` when already disconnected is a safe no-op.
   * @returns A promise that resolves once the transport is closed.
   * @throws {CddSdkError} If closing the underlying transport fails.
   */
  public async disconnect(): Promise<void> {
    if (!this.transport) {
      return;
    }
    const activeTransport = this.transport;
    this.transport = null;
    try {
      await activeTransport.close();
    } catch (e: unknown) {
      throw wrapError(e);
    }
  }

  /**
   * Lists all available tools exposed by the remote language daemons on the gateway.
   * @returns A promise resolving to the MCP `ListToolsResult`.
   * @throws {CddSdkError} If the RPC request fails.
   */
  public async listTools(): Promise<ListToolsResult> {
    try {
      return await this.client.listTools();
    } catch (e: unknown) {
      throw wrapError(e);
    }
  }

  /**
   * Executes a remote language code generation tool via MCP (`cdd_generate_sdk`).
   * @param targetLanguage Target language identifier (e.g., `"rust"`, `"go"`, `"ts"`).
   * @param input The OpenAPI schema JSON or YAML document as a string.
   * @returns A promise resolving to the MCP tool call result.
   * @throws {CddValidationError} If `targetLanguage` or `input` is empty.
   * @throws {CddSdkError} If the remote tool invocation fails.
   */
  public async generateSdk(
    targetLanguage: string,
    input: string,
  ): Promise<McpCallToolResult> {
    if (!targetLanguage || targetLanguage.trim().length === 0) {
      throw new CddValidationError("targetLanguage must not be empty");
    }
    if (!input || input.trim().length === 0) {
      throw new CddValidationError("input must not be empty");
    }
    try {
      return await this.client.callTool({
        name: "cdd_generate_sdk",
        arguments: {
          target_language: targetLanguage,
          input: input,
        },
      });
    } catch (e: unknown) {
      throw wrapError(e);
    }
  }
}
