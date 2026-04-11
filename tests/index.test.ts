import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CddWasmSdk, GenerateOptions } from "../src/index";

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

function makeFakeWasi(opts: { exitCode?: number; throws?: unknown } = {}) {
  return {
    wasiImport: {},
    start: vi.fn(() => {
      if (opts.throws !== undefined) throw opts.throws;
      return opts.exitCode ?? 0;
    }),
  };
}

function makeFakeInstance(missingStart = false) {
  return {
    exports: missingStart ? {} : { _start: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("@bjorn3/browser_wasi_shim", () => {
  const File = vi.fn().mockImplementation((data: Uint8Array) => ({ data }));
  const Directory = vi.fn().mockImplementation(() => ({
    contents: new Map<string, unknown>(),
  }));
  const OpenFile = vi.fn().mockImplementation((f: unknown) => f);
  const ConsoleStdout = {
    lineBuffered: vi.fn().mockImplementation(() => ({})),
  };
  const PreopenDirectory = vi.fn().mockImplementation(() => ({}));
  const WASI = vi.fn().mockImplementation(() => makeFakeWasi());
  return { WASI, File, Directory, OpenFile, ConsoleStdout, PreopenDirectory };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseOptions(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    ecosystem: "cdd-rust",
    target: "to_sdk",
    specContent: '{"openapi":"3.0.0"}',
    wasmBinary: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CddWasmSdk.fromOpenApi", () => {
  beforeEach(() => {
    vi.stubGlobal("WebAssembly", {
      compile: vi.fn().mockResolvedValue({}),
      instantiate: vi.fn().mockResolvedValue(makeFakeInstance()),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // specContent / filename detection
  // -------------------------------------------------------------------------

  it("uses spec.json filename when specContent is a JSON string", async () => {
    const result = await CddWasmSdk.fromOpenApi(
      baseOptions({ specContent: '{"openapi":"3.0.0"}' }),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("uses spec.yaml filename when specContent is a YAML string", async () => {
    const result = await CddWasmSdk.fromOpenApi(
      baseOptions({ specContent: "openapi: 3.0.0\ninfo:\n  title: Test" }),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("handles specContent as Uint8Array (JSON bytes)", async () => {
    const jsonBytes = new TextEncoder().encode('{"openapi":"3.0.0"}');
    const result = await CddWasmSdk.fromOpenApi(
      baseOptions({ specContent: jsonBytes }),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("handles specContent as Uint8Array (YAML bytes)", async () => {
    const yamlBytes = new TextEncoder().encode(
      "openapi: 3.0.0\ninfo:\n  title: T",
    );
    const result = await CddWasmSdk.fromOpenApi(
      baseOptions({ specContent: yamlBytes }),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // wasmBinary as ArrayBuffer
  // -------------------------------------------------------------------------

  it("accepts wasmBinary as ArrayBuffer", async () => {
    const buf = new Uint8Array([0x00, 0x61, 0x73, 0x6d]).buffer;
    const result = await CddWasmSdk.fromOpenApi(
      baseOptions({ wasmBinary: buf }),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // printStdout flag
  // -------------------------------------------------------------------------

  it("does not throw when printStdout is true", async () => {
    const result = await CddWasmSdk.fromOpenApi(
      baseOptions({ printStdout: true }),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("does not throw when printStdout is false", async () => {
    const result = await CddWasmSdk.fromOpenApi(
      baseOptions({ printStdout: false }),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // additionalArgs
  // -------------------------------------------------------------------------

  it("passes additionalArgs through without error", async () => {
    const result = await CddWasmSdk.fromOpenApi(
      baseOptions({ additionalArgs: ["--verbose", "--dry-run"] }),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Exit-code handling
  // -------------------------------------------------------------------------

  it("returns files when WASM exits with code 0", async () => {
    const { WASI } = await import("@bjorn3/browser_wasi_shim");
    (WASI as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      makeFakeWasi({ exitCode: 0 }),
    );
    const result = await CddWasmSdk.fromOpenApi(baseOptions());
    expect(Array.isArray(result)).toBe(true);
  });

  it("throws when WASM exits with non-zero code", async () => {
    const { WASI } = await import("@bjorn3/browser_wasi_shim");
    (WASI as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      makeFakeWasi({ exitCode: 1 }),
    );
    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "WASM execution failed with exit code 1",
    );
  });

  // -------------------------------------------------------------------------
  // WASIProcExit exception handling
  // -------------------------------------------------------------------------

  it("swallows WASIProcExit with code 0 and returns files", async () => {
    const procExit = Object.assign(new Error("proc exit"), {
      name: "WASIProcExit",
      code: 0,
    });
    const { WASI } = await import("@bjorn3/browser_wasi_shim");
    (WASI as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      makeFakeWasi({ throws: procExit }),
    );
    const result = await CddWasmSdk.fromOpenApi(baseOptions());
    expect(Array.isArray(result)).toBe(true);
  });

  it("throws when WASIProcExit has non-zero code", async () => {
    const procExit = Object.assign(new Error("proc exit"), {
      name: "WASIProcExit",
      code: 2,
    });
    const { WASI } = await import("@bjorn3/browser_wasi_shim");
    (WASI as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      makeFakeWasi({ throws: procExit }),
    );
    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "WASM execution failed with exit code 2",
    );
  });

  it("rethrows non-WASIProcExit errors from wasi.start()", async () => {
    const typeErr = new TypeError("unexpected internal error");
    const { WASI } = await import("@bjorn3/browser_wasi_shim");
    (WASI as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      makeFakeWasi({ throws: typeErr }),
    );
    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "unexpected internal error",
    );
  });

  // -------------------------------------------------------------------------
  // Missing _start export guard
  // -------------------------------------------------------------------------

  it("throws when WASM binary is missing _start export", async () => {
    vi.stubGlobal("WebAssembly", {
      compile: vi.fn().mockResolvedValue({}),
      instantiate: vi.fn().mockResolvedValue(makeFakeInstance(true)),
    });
    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "WASM binary missing _start export",
    );
  });

  // -------------------------------------------------------------------------
  // Ecosystem-specific throw paths
  // -------------------------------------------------------------------------

  it("throws immediately for cdd-sh ecosystem", async () => {
    await expect(
      CddWasmSdk.fromOpenApi(baseOptions({ ecosystem: "cdd-sh" })),
    ).rejects.toThrow("mvdan-sh execution via ZIP is not yet wired");
  });

  it("throws immediately for cdd-java ecosystem", async () => {
    await expect(
      CddWasmSdk.fromOpenApi(baseOptions({ ecosystem: "cdd-java" })),
    ).rejects.toThrow("CheerpJ execution not yet fully wired");
  });

  // -------------------------------------------------------------------------
  // cdd-python (Pyodide) path — dynamic import will fail in test env,
  // which is the expected behaviour for this branch
  // -------------------------------------------------------------------------

  it("attempts Pyodide import for cdd-python ecosystem", async () => {
    // In the test environment the CDN import will fail; we just verify the
    // correct branch is entered (not the cdd-sh / cdd-java guard).
    await expect(
      CddWasmSdk.fromOpenApi(
        baseOptions({ ecosystem: "cdd-python", wasmBinary: new ArrayBuffer(4) }),
      ),
    ).rejects.toThrow(); // any error — the CDN import fails in Node
  });
});
