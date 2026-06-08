import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { wrapError, CddGatewayError } from "../error.js";

export interface CddMcpClientOptions {
    /** The base URL to the CDD Gateway (e.g. "https://api.cdd-gateway.io") */
    gatewayUrl: string;
    /** Standard Bearer token or session token for auth */
    authToken: string;
}

export class CddMcpClient {
    private client: Client;
    private transport: SSEClientTransport | null = null;
    private gatewayUrl: string;
    private authToken: string;

    constructor(options: CddMcpClientOptions) {
        this.gatewayUrl = options.gatewayUrl.replace(/\/$/, "");
        this.authToken = options.authToken;
        
        this.client = new Client(
            {
                name: "cdd-browser-sdk",
                version: "0.0.1",
            },
            {
                capabilities: {
                },
            }
        );
    }

    /**
     * Connect to the remote CDD Gateway via Server-Sent Events
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
                        "Authorization": `Bearer ${this.authToken}`
                    }
                }
            });

            await this.client.connect(this.transport);
        } catch (e: unknown) {
            throw new CddGatewayError(wrapError(e).message);
        }
    }

    /**
     * Disconnect the MCP transport
     */
    public async disconnect(): Promise<void> {
        try {
            if (this.transport) {
                await this.transport.close();
            }
        } catch (e: unknown) {
            throw wrapError(e);
        }
    }

    /**
     * List all available tools exposed by the 13 language daemons
     */
    public async listTools() {
        try {
            return await this.client.listTools();
        } catch (e: unknown) {
            throw wrapError(e);
        }
    }

    /**
     * Execute a specific language code generation tool
     * @param targetLanguage e.g., "rust", "go", "ts"
     * @param input the OpenAPI schema JSON/YAML as a string
     */
    public async generateSdk(targetLanguage: string, input: string) {
        try {
            return await this.client.callTool({
                name: "cdd_generate_sdk",
                arguments: {
                    target_language: targetLanguage,
                    input: input,
                }
            });
        } catch (e: unknown) {
            throw wrapError(e);
        }
    }
}
