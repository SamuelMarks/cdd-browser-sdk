import { describe, it, expect, vi, beforeEach } from "vitest";
import { CddMcpClient } from "../src/mcp/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Mock the MCP modules
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => {
    return {
        SSEClientTransport: vi.fn().mockImplementation(() => {
            return {
                close: vi.fn().mockResolvedValue(undefined),
            };
        })
    };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
    return {
        Client: vi.fn().mockImplementation(() => {
            return {
                connect: vi.fn().mockResolvedValue(undefined),
                listTools: vi.fn().mockResolvedValue({ tools: [{ name: "cdd_generate_sdk" }] }),
                callTool: vi.fn().mockResolvedValue({ result: { sdk: "some-code" } })
            };
        })
    };
});

describe("CddMcpClient", () => {
    let client: CddMcpClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = new CddMcpClient({
            gatewayUrl: "https://api.gateway.local",
            authToken: "mock-token"
        });
    });

    it("should instantiate without throwing", () => {
        expect(client).toBeDefined();
    });

    it("should connect using SSEClientTransport with correct URL and headers", async () => {
        await client.connect();

        // Check if SSE transport was created correctly
        expect(SSEClientTransport).toHaveBeenCalledTimes(1);
        const [urlArg, optionsArg] = vi.mocked(SSEClientTransport).mock.calls[0];
        
        expect(urlArg.toString()).toBe("https://api.gateway.local/mcp/sse");
        expect(optionsArg).toMatchObject({
            eventSourceInit: { withCredentials: true },
            requestInit: { headers: { "Authorization": "Bearer mock-token" } }
        });
    });

    it("should list tools correctly", async () => {
        await client.connect();
        const tools = await client.listTools();
        expect(tools.tools[0].name).toBe("cdd_generate_sdk");
    });

    it("should execute the generate tool correctly", async () => {
        await client.connect();
        const result = await client.generateSdk("rust", "{}");
        expect(result).toEqual({ result: { sdk: "some-code" } });
    });
});
