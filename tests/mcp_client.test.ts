import { describe, it, expect, vi, beforeEach } from "vitest";
import { CddMcpClient } from "../src/mcp/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CddGatewayError, CddSdkError } from "../src/error";

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => {
    return {
        SSEClientTransport: vi.fn().mockImplementation(() => {
            return {
                close: vi.fn(),
            };
        }),
    };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
    return {
        Client: vi.fn().mockImplementation(() => {
            return {
                connect: vi.fn().mockResolvedValue(undefined),
                listTools: vi.fn().mockResolvedValue({ tools: [] }),
                callTool: vi.fn().mockResolvedValue({ result: "ok" }),
            };
        }),
    };
});

describe("CddMcpClient", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("connects with auth", async () => {
        const client = new CddMcpClient({ gatewayUrl: "http://api", authToken: "TOKEN" });
        await client.connect();
        expect(SSEClientTransport).toHaveBeenCalled();
        expect(Client).toHaveBeenCalled();
    });

    it("connect fails", async () => {
        const client = new CddMcpClient({ gatewayUrl: "http://api", authToken: "TOKEN" });
        const mockClient = vi.mocked(Client).mock.results[0]?.value as any;
        if (mockClient) { mockClient.connect.mockRejectedValueOnce(new Error("fail")); }
        await expect(client.connect()).rejects.toThrow(CddGatewayError);
    });

    it("disconnects", async () => {
        const client = new CddMcpClient({ gatewayUrl: "http://api", authToken: "TOKEN" });
        await client.connect();
        await client.disconnect();
    });

    it("disconnect fails", async () => {
        const client = new CddMcpClient({ gatewayUrl: "http://api", authToken: "TOKEN" });
        await client.connect();
        const transport = (client as any).transport;
        transport.close.mockRejectedValueOnce(new Error("fail"));
        await expect(client.disconnect()).rejects.toThrow(CddSdkError);
    });

    it("listTools", async () => {
        const client = new CddMcpClient({ gatewayUrl: "http://api", authToken: "TOKEN" });
        const res = await client.listTools();
        expect(res).toEqual({ tools: [] });
    });

    it("listTools fails", async () => {
        const client = new CddMcpClient({ gatewayUrl: "http://api", authToken: "TOKEN" });
        const mockClient = vi.mocked(Client).mock.results[0]?.value as any;
        if (mockClient) { mockClient.listTools.mockRejectedValueOnce(new Error("fail")); }
        await expect(client.listTools()).rejects.toThrow(CddSdkError);
    });

    it("generateSdk", async () => {
        const client = new CddMcpClient({ gatewayUrl: "http://api", authToken: "TOKEN" });
        const res = await client.generateSdk("ts", "input");
        expect(res).toEqual({ result: "ok" });
    });

    it("generateSdk fails", async () => {
        const client = new CddMcpClient({ gatewayUrl: "http://api", authToken: "TOKEN" });
        const mockClient = vi.mocked(Client).mock.results[0]?.value as any;
        if (mockClient) { mockClient.callTool.mockRejectedValueOnce(new Error("fail")); }
        await expect(client.generateSdk("ts", "input")).rejects.toThrow(CddSdkError);
    });
});
