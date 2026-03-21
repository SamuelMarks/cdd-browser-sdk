# cdd-ctl-wasm-sdk

This library is a pure-JavaScript (TypeScript) wrapper that executes the underlying `cdd-*` ecosystem generators strictly within the browser. Utilizing WebAssembly and a WASI polyfill (`@bjorn3/browser_wasi_shim`), this SDK evaluates OpenAPI payload instructions against isolated runtime WASM binaries entirely on the client-side.

## Installation

```bash
npm install cdd-ctl-wasm-sdk
```

*(Note: Depending on your build environment, you may need a bundler that supports top-level await and WebAssembly file fetching like Webpack 5 or Vite).*

## Usage

```typescript
import { CddWasmSdk } from "cdd-ctl-wasm-sdk";

// Example: Fetch your required cdd-language WASM binary
// Usually downloaded directly from GitHub releases or bundled with your frontend
const response = await fetch("https://example.com/assets/wasm/cdd-python.wasm");
const wasmBinary = await response.arrayBuffer();

const openApiSpec = JSON.stringify({
    "openapi": "3.2.0",
    "info": { "title": "Test SDK", "version": "1.0.0" }
    // ...
});

const generatedFiles = await CddWasmSdk.fromOpenApi({
    ecosystem: "cdd-python",
    target: "to_sdk",
    specContent: openApiSpec,
    wasmBinary: wasmBinary,
    printStdout: true
});

// Output generated SDK files
for (const file of generatedFiles) {
    console.log(`Generated: ${file.path}`);
    const textContent = new TextDecoder().decode(file.content);
    console.log(textContent);
}
```

## Supported Ecosystems
All natively supported `cdd-ctl` ecosystems can be run natively in the browser so long as the `wasm32-wasi` variant is loaded via the `wasmBinary` parameter:
`cdd-c`, `cdd-cpp`, `cdd-csharp`, `cdd-go`, `cdd-java`, `cdd-kotlin`, `cdd-php`, `cdd-python`, `cdd-ruby`, `cdd-rust`, `cdd-swift`, `cdd-ts`.
