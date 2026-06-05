# cdd-browser-sdk

[![CI](https://github.com/SamuelMarks/cdd-browser-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/SamuelMarks/cdd-browser-sdk/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0%20OR%20MIT-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Test Coverage](https://img.shields.io/badge/coverage-100%25-success.svg)](https://github.com/SamuelMarks/cdd-browser-sdk/actions)
[![Doc Coverage](https://img.shields.io/badge/docs-100%25-success.svg)](https://github.com/SamuelMarks/cdd-browser-sdk/actions)

This library is a pure-JavaScript (TypeScript) wrapper that executes the underlying `cdd-*` ecosystem generators strictly within the browser. Utilizing WebAssembly and a WASI polyfill (`@bjorn3/browser_wasi_shim`), this SDK evaluates OpenAPI payload instructions against isolated runtime WASM binaries entirely on the client-side.

## Installation

```bash
npm install cdd-browser-sdk
```

_(Note: Depending on your build environment, you may need a bundler that supports top-level await and WebAssembly file fetching like Webpack 5 or Vite)._

## Usage

```typescript
import { CddWasmSdk } from "cdd-browser-sdk";

// Example: Fetch your required cdd-language WASM binary
// Usually downloaded directly from GitHub releases or bundled with your frontend
const response = await fetch("https://github.com/offscale/cdd-python/releases/download/latest/cdd-python.wasm");
const wasmBinary = await response.arrayBuffer();

const openApiSpec = JSON.stringify({
  openapi: "3.2.0",
  info: { title: "Test SDK", version: "1.0.0" },
  // ...
});

const generatedFiles = await CddWasmSdk.fromOpenApi({
  ecosystem: "cdd-python",
  target: "to_sdk",
  specContent: openApiSpec,
  wasmBinary: wasmBinary,
  printStdout: true,
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

## License

This project is dual-licensed under either of the following, at your option:

- Apache License, Version 2.0 (LICENSE-APACHE or <https://www.apache.org/licenses/LICENSE-2.0>)
- MIT License (LICENSE-MIT or <https://opensource.org/licenses/MIT>)
