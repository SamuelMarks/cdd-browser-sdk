import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  CddGatewayError,
  CddMcpClient,
  CddSdkError,
  CddValidationError,
} from "../src/index.js";

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => {
  return {
    SSEClientTransport: vi.fn().mockImplementation(function () {
      return {
        close: vi.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: vi.fn().mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "ok" }],
        }),
      };
    }),
  };
});

describe("CddMcpClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates options in constructor and rejects invalid gatewayUrl or authToken", () => {
    expect(
      () => new CddMcpClient({ gatewayUrl: "", authToken: "TOKEN" }),
    ).toThrow(CddValidationError);

    expect(
      () => new CddMcpClient({ gatewayUrl: "not-a-url", authToken: "TOKEN" }),
    ).toThrow(CddValidationError);

    expect(
      () =>
        new CddMcpClient({
          gatewayUrl: "https://api.example.com",
          authToken: "   ",
        }),
    ).toThrow(CddValidationError);
  });

  it("connects with normalized gateway URL and Bearer header", async () => {
    const client = new CddMcpClient({
      gatewayUrl: "http://api.example.com///",
      authToken: "SECRET_TOKEN",
    });
    expect(client.isConnected()).toBe(false);

    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect(SSEClientTransport).toHaveBeenCalledWith(
      new URL("http://api.example.com/mcp/sse"),
      {
        eventSourceInit: { withCredentials: true },
        requestInit: {
          headers: {
            Authorization: "Bearer SECRET_TOKEN",
          },
        },
      },
    );
    expect(Client).toHaveBeenCalledTimes(1);
  });

  it("wraps connection errors in CddGatewayError and resets connection state", async () => {
    const client = new CddMcpClient({
      gatewayUrl: "http://api.example.com",
      authToken: "TOKEN",
    });
    const mockClientInstance = vi.mocked(Client).mock.results[0]?.value as {
      connect: ReturnType<typeof vi.fn>;
    };
    mockClientInstance.connect.mockRejectedValueOnce(new Error("SSE handshake failed"));

    await expect(client.connect()).rejects.toThrow(CddGatewayError);
    expect(client.isConnected()).toBe(false);
  });

  it("disconnects safely when connected and is a no-op when not connected", async () => {
    const client = new CddMcpClient({
      gatewayUrl: "http://api.example.com",
      authToken: "TOKEN",
    });

    // Disconnecting before connecting should be a safe no-op
    await client.disconnect();
    expect(client.isConnected()).toBe(false);

    await client.connect();
    expect(client.isConnected()).toBe(true);

    const mockTransportInstance = vi.mocked(SSEClientTransport).mock.results[0]
      ?.value as {
      close: ReturnType<typeof vi.fn>;
    };

    await client.disconnect();
    expect(mockTransportInstance.close).toHaveBeenCalledTimes(1);
    expect(client.isConnected()).toBe(false);

    // Second disconnect is also a no-op
    await client.disconnect();
    expect(mockTransportInstance.close).toHaveBeenCalledTimes(1);
  });

  it("wraps transport close errors in CddSdkError on disconnect", async () => {
    const client = new CddMcpClient({
      gatewayUrl: "http://api.example.com",
      authToken: "TOKEN",
    });
    await client.connect();

    const mockTransportInstance = vi.mocked(SSEClientTransport).mock.results[0]
      ?.value as {
      close: ReturnType<typeof vi.fn>;
    };
    mockTransportInstance.close.mockRejectedValueOnce(new Error("close failed"));

    await expect(client.disconnect()).rejects.toThrow(CddSdkError);
    expect(client.isConnected()).toBe(false);
  });

  it("lists tools from the remote MCP gateway", async () => {
    const client = new CddMcpClient({
      gatewayUrl: "http://api.example.com",
      authToken: "TOKEN",
    });
    const res = await client.listTools();
    expect(res).toEqual({ tools: [] });
  });

  it("wraps listTools errors in CddSdkError", async () => {
    const client = new CddMcpClient({
      gatewayUrl: "http://api.example.com",
      authToken: "TOKEN",
    });
    const mockClientInstance = vi.mocked(Client).mock.results[0]?.value as {
      listTools: ReturnType<typeof vi.fn>;
    };
    mockClientInstance.listTools.mockRejectedValueOnce(new Error("rpc fail"));

    await expect(client.listTools()).rejects.toThrow(CddSdkError);
  });

  it("validates arguments and invokes cdd_generate_sdk tool in generateSdk", async () => {
    const client = new CddMcpClient({
      gatewayUrl: "http://api.example.com",
      authToken: "TOKEN",
    });

    await expect(client.generateSdk("", "input")).rejects.toThrow(
      CddValidationError,
    );
    await expect(client.generateSdk("ts", "   ")).rejects.toThrow(
      CddValidationError,
    );

    const res = await client.generateSdk("ts", '{"openapi":"3.0.0"}');
    expect(res).toEqual({ content: [{ type: "text", text: "ok" }] });

    const mockClientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>;
    };
    expect(mockClientInstance.callTool).toHaveBeenCalledWith({
      name: "cdd_generate_sdk",
      arguments: {
        target_language: "ts",
        input: '{"openapi":"3.0.0"}',
      },
    });
  });

  it("wraps callTool failures in CddSdkError during generateSdk", async () => {
    const client = new CddMcpClient({
      gatewayUrl: "http://api.example.com",
      authToken: "TOKEN",
    });
    const mockClientInstance = vi.mocked(Client).mock.results[0]?.value as {
      callTool: ReturnType<typeof vi.fn>;
    };
    mockClientInstance.callTool.mockRejectedValueOnce(new Error("tool crash"));

    await expect(
      client.generateSdk("rust", '{"openapi":"3.0.0"}'),
    ).rejects.toThrow(CddSdkError);
  });
});
