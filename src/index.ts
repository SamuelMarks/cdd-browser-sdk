/**
 * @module index
 * Public entry point for the `cdd-browser-sdk` package.
 * Re-exports domain error classes, the Model Context Protocol (MCP) client,
 * and the WebAssembly execution engine for `cdd-*` OpenAPI generators.
 */

export * from "./error.js";
export * from "./mcp/client.js";
export * from "./wasm.js";
