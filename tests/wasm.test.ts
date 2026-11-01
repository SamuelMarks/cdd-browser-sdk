import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Directory, File, type Inode, WASI } from "@bjorn3/browser_wasi_shim";
import {
  CddWasmError,
  CddWasmSdk,
  type GenerateOptions,
  buildCliArgs,
  buildEffectiveAdditionalArgs,
  detectSpecFormat,
  formatMonorepoName,
  formatPolyrepoName,
  prefixGeneratedFilesForTopology,
  resolveCppConverterBinary,
  resolveEffectiveTarget,
} from "../src/index.js";

interface FakeWasiOptions {
  exitCode?: number;
  throws?: unknown;
  onStart?: () => void;
}

function makeFakeWasi(opts: FakeWasiOptions = {}) {
  return {
    wasiImport: { proc_exit: vi.fn() },
    initialize: vi.fn(),
    start: vi.fn(() => {
      opts.onStart?.();
      if (opts.throws !== undefined) {
        throw opts.throws;
      }
      return opts.exitCode ?? 0;
    }),
  };
}

function makeFakeInstance(
  exportsOverride?: Record<string, unknown>,
): WebAssembly.Instance {
  return {
    exports: exportsOverride ?? { _start: vi.fn() },
  } as unknown as WebAssembly.Instance;
}

vi.mock("@bjorn3/browser_wasi_shim", () => {
  class MockFile {
    public data: Uint8Array;
    constructor(data: Uint8Array) {
      this.data = data;
    }
  }
  class MockDirectory {
    public contents: Map<string, Inode>;
    constructor(contents?: Map<string, Inode>) {
      this.contents = contents ?? new Map<string, Inode>();
    }
  }
  class MockOpenFile {
    public file: MockFile;
    constructor(file: MockFile) {
      this.file = file;
    }
  }
  const MockPreopenDirectory = vi
    .fn()
    .mockImplementation(function (path: string, contents: Map<string, Inode>) {
      return {
        path,
        contents,
      };
    });
  const MockConsoleStdout = {
    lineBuffered: vi.fn().mockImplementation((cb: (msg: string) => void) => ({
      writeLine: cb,
    })),
  };
  const MockWASI = vi.fn().mockImplementation(function () {
    return makeFakeWasi();
  });
  return {
    WASI: MockWASI,
    File: MockFile,
    Directory: MockDirectory,
    OpenFile: MockOpenFile,
    ConsoleStdout: MockConsoleStdout,
    PreopenDirectory: MockPreopenDirectory,
  };
});

function baseOptions(
  overrides: Partial<GenerateOptions> = {},
): GenerateOptions {
  return {
    ecosystem: "cdd-rust",
    target: "to_sdk",
    specContent: '{"openapi":"3.2.0"}',
    wasmBinary: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    ...overrides,
  };
}

describe("Phase 1 & Phase 2: SpecFormat detection, Google Discovery conversion, Arazzo routing, CLI flags, and Topology helpers", () => {
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

  it("detectSpecFormat identifies OpenAPI 3, Swagger 2, Arazzo 1, and Google Discovery in JSON and YAML", () => {
    expect(detectSpecFormat("")).toBe("openapi_3");
    expect(detectSpecFormat("   ")).toBe("openapi_3");
    expect(detectSpecFormat('{"openapi":"3.2.0"}')).toBe("openapi_3");
    expect(detectSpecFormat('{"swagger":"2.0"}')).toBe("swagger_2");
    expect(detectSpecFormat('{"arazzo":"1.0.1"}')).toBe("arazzo_1");
    expect(detectSpecFormat('{"discoveryVersion":"v1"}')).toBe(
      "google_discovery_1",
    );
    expect(
      detectSpecFormat('{"kind":"discovery#restDescription","name":"drive"}'),
    ).toBe("google_discovery_1");

    // Malformed JSON or non-matching JSON object falls back to regex or openapi_3
    expect(detectSpecFormat('{"otherKey": 123}')).toBe("openapi_3");
    expect(
      detectSpecFormat(`{bad json
"swagger": "2.0"`),
    ).toBe("swagger_2");
    expect(
      detectSpecFormat(`{bad json
"arazzo": "1.1.0"`),
    ).toBe("arazzo_1");
    expect(
      detectSpecFormat(`{bad json
"discoveryVersion": "v1"`),
    ).toBe("google_discovery_1");
    expect(
      detectSpecFormat(`{bad json
"kind": "discovery#restDescription"`),
    ).toBe("google_discovery_1");

    // YAML root keys
    expect(
      detectSpecFormat(`openapi: 3.1.0
info:
  title: API`),
    ).toBe("openapi_3");
    expect(
      detectSpecFormat(`swagger: '2.0'
info:
  title: API`),
    ).toBe("swagger_2");
    expect(
      detectSpecFormat(`arazzo: 1.1.0
info:
  title: Workflow`),
    ).toBe("arazzo_1");
    expect(
      detectSpecFormat(`discoveryVersion: v1
name: compute`),
    ).toBe("google_discovery_1");
    expect(detectSpecFormat("kind: discovery#restDescription")).toBe(
      "google_discovery_1",
    );
  });

  it("resolveEffectiveTarget and buildEffectiveAdditionalArgs forward all generator flags without duplicates", () => {
    expect(resolveEffectiveTarget(baseOptions({ target: "to_sdk" }))).toBe(
      "to_sdk",
    );
    expect(
      resolveEffectiveTarget(baseOptions({ target: "to_sdk", cli: true })),
    ).toBe("to_sdk_cli");
    expect(
      resolveEffectiveTarget(baseOptions({ target: "to_server", cli: true })),
    ).toBe("to_server");

    const allFlags = buildEffectiveAdditionalArgs(
      baseOptions({
        mcp: true,
        noImports: true,
        noWrapping: true,
        framework: " fastapi ",
        orm: " sqlalchemy ",
        autoAdmin: true,
        tests: true,
        noGithubActions: true,
        noInstallablePackage: true,
      }),
    );
    expect(allFlags).toEqual([
      "--mcp",
      "--no-imports",
      "--no-wrapping",
      "--framework",
      "fastapi",
      "--orm",
      "sqlalchemy",
      "--auto-admin",
      "--tests",
      "--no-github-actions",
      "--no-installable-package",
    ]);

    // No duplicates if already in additionalArgs
    const deduped = buildEffectiveAdditionalArgs(
      baseOptions({
        additionalArgs: [
          "--mcp",
          "--no-imports",
          "--no-wrapping",
          "--framework",
          "axum",
          "--orm",
          "diesel",
          "--auto-admin",
          "--tests",
          "--no-github-actions",
          "--no-installable-package",
        ],
        mcp: true,
        noImports: true,
        noWrapping: true,
        framework: "actix",
        orm: "seaorm",
        autoAdmin: true,
        tests: true,
        noGithubActions: true,
        noInstallablePackage: true,
      }),
    );
    expect(deduped).toEqual([
      "--mcp",
      "--no-imports",
      "--no-wrapping",
      "--framework",
      "axum",
      "--orm",
      "diesel",
      "--auto-admin",
      "--tests",
      "--no-github-actions",
      "--no-installable-package",
    ]);
  });

  it("buildCliArgs routes openapi_3, arazzo_1, and google_discovery_1 (cdd-cpp vs others) and handles leading slash in specFilename", () => {
    expect(buildCliArgs(baseOptions(), "spec.json")).toEqual([
      "cdd-rust",
      "from_openapi",
      "to_sdk",
      "-i",
      "/spec.json",
      "-o",
      "/out",
    ]);

    expect(
      buildCliArgs(
        baseOptions({ cli: true, mcp: true }),
        "/spec.yaml",
        "arazzo_1",
      ),
    ).toEqual([
      "cdd-rust",
      "from_arazzo",
      "to_sdk_cli",
      "-i",
      "/spec.yaml",
      "-o",
      "/out",
      "--mcp",
    ]);

    expect(
      buildCliArgs(
        baseOptions({ ecosystem: "cdd-cpp", target: "to_sdk" }),
        "spec.json",
        "google_discovery_1",
      ),
    ).toEqual([
      "cdd-cpp",
      "from_google_discovery",
      "to_sdk",
      "-i",
      "/spec.json",
      "-o",
      "/out",
    ]);
  });

  it("formatMonorepoName, formatPolyrepoName, and prefixGeneratedFilesForTopology format paths accurately", () => {
    expect(formatMonorepoName("offscale")).toBe("offscale-sdk");
    expect(formatMonorepoName("offscale", "   ")).toBe("offscale-sdk");
    expect(formatMonorepoName("offscale", " custom-mono ")).toBe("custom-mono");

    expect(formatPolyrepoName("offscale", "cdd-python")).toBe(
      "offscale-sdk-python",
    );
    expect(formatPolyrepoName("offscale", "rust", "   ")).toBe(
      "offscale-sdk-rust",
    );
    expect(formatPolyrepoName("offscale", "rust", " custom-poly ")).toBe(
      "custom-poly",
    );

    const rawFiles = [
      { path: "src/lib.rs", content: new Uint8Array([1]) },
      { path: "/Cargo.toml", content: new Uint8Array([2]) },
    ];

    const monoFiles = prefixGeneratedFilesForTopology(
      rawFiles,
      "monorepo",
      "offscale",
      "cdd-rust",
    );
    expect(monoFiles.map((f) => f.path)).toEqual([
      "offscale-sdk/rust/src/lib.rs",
      "offscale-sdk/rust/Cargo.toml",
    ]);

    const polyFiles = prefixGeneratedFilesForTopology(
      rawFiles,
      "polyrepo",
      "offscale",
      "cdd-rust",
    );
    expect(polyFiles.map((f) => f.path)).toEqual([
      "offscale-sdk-rust/src/lib.rs",
      "offscale-sdk-rust/Cargo.toml",
    ]);
  });

  it("resolveCppConverterBinary resolves Uint8Array, ArrayBuffer, custom URL, default URL, and throws CddWasmError on fetch failure", async () => {
    const u8 = new Uint8Array([1, 2, 3, 4]);
    const bufFromU8 = await resolveCppConverterBinary(u8);
    expect(Array.from(new Uint8Array(bufFromU8))).toEqual([1, 2, 3, 4]);

    const bufDirect = await resolveCppConverterBinary(u8.buffer);
    expect(bufDirect).toBe(u8.buffer);

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => u8.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const fetchedDefault = await resolveCppConverterBinary();
    expect(fetchMock).toHaveBeenCalledWith("/assets/wasm/cdd-cpp.wasm");
    expect(fetchedDefault).toBe(u8.buffer);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    await expect(
      resolveCppConverterBinary("https://cdn.example.com/cdd-cpp.wasm"),
    ).rejects.toThrow(CddWasmError);

    fetchMock.mockRejectedValueOnce("network down");
    await expect(resolveCppConverterBinary("")).rejects.toThrow(
      "Failed to load cdd-cpp.wasm converter from /assets/wasm/cdd-cpp.wasm: network down",
    );
  });

  it("CddWasmSdk.convertGoogleDiscoveryToOpenApi converts via /out/openapi.json or stdout and throws CddWasmError on failure", async () => {
    const cppBin = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

    await expect(
      CddWasmSdk.convertGoogleDiscoveryToOpenApi("   ", cppBin),
    ).rejects.toThrow(CddWasmError);

    // 1. Emits /out/openapi.json
    vi.mocked(WASI).mockImplementationOnce(function (_args, _env, fds) {
      return makeFakeWasi({
        exitCode: 0,
        onStart: () => {
          const preopen = fds[3] as unknown as {
            contents: Map<string, Inode>;
          };
          const outDir = preopen.contents.get("out") as Directory;
          outDir.contents.set(
            "openapi.json",
            new File(
              new TextEncoder().encode(
                '{"openapi":"3.2.0","info":{"title":"Converted"}}',
              ),
            ),
          );
        },
      }) as unknown as WASI;
    });

    const convertedFile = await CddWasmSdk.convertGoogleDiscoveryToOpenApi(
      '{"discoveryVersion":"v1"}',
      cppBin,
    );
    expect(convertedFile).toBe(
      '{"openapi":"3.2.0","info":{"title":"Converted"}}',
    );

    // 2. Falls back to stdout JSON when /out is empty or has empty file
    vi.mocked(WASI).mockImplementationOnce(function (_args, _env, fds) {
      return makeFakeWasi({
        exitCode: 0,
        onStart: () => {
          const outFd = fds[1] as unknown as { writeLine: (m: string) => void };
          const errFd = fds[2] as unknown as { writeLine: (m: string) => void };
          const preopen = fds[3] as unknown as {
            contents: Map<string, Inode>;
          };
          const outDir = preopen.contents.get("out") as Directory;
          outDir.contents.set(
            "other.json",
            new File(new TextEncoder().encode("   ")),
          );
          errFd.writeLine("converter stderr");
          outFd.writeLine('{"openapi":"3.2.0","from":"stdout"}');
        },
      }) as unknown as WASI;
    });

    const convertedStdout = await CddWasmSdk.convertGoogleDiscoveryToOpenApi(
      '{"discoveryVersion":"v1"}',
      cppBin,
    );
    expect(convertedStdout).toBe('{"openapi":"3.2.0","from":"stdout"}');

    // 3. Missing _start export
    vi.stubGlobal("WebAssembly", {
      compile: vi.fn().mockResolvedValue({}),
      instantiate: vi.fn().mockResolvedValueOnce(makeFakeInstance({})),
    });
    await expect(
      CddWasmSdk.convertGoogleDiscoveryToOpenApi(
        '{"discoveryVersion":"v1"}',
        cppBin,
      ),
    ).rejects.toThrow("missing _start export");

    // 4. Guest sets exitCode via interop
    vi.stubGlobal("WebAssembly", {
      compile: vi.fn().mockResolvedValue({}),
      instantiate: vi
        .fn()
        .mockImplementationOnce(
          async (_mod: WebAssembly.Module, imports: WebAssembly.Imports) => {
            return makeFakeInstance({
              _start: () => {
                const interop = imports["interop"] as Record<
                  string,
                  (c: number) => void
                >;
                interop["runtime.setExitCode"]!(9);
              },
            });
          },
        ),
    });
    vi.mocked(WASI).mockImplementationOnce(function () {
      return {
        wasiImport: {},
        initialize: vi.fn(),
        start: vi.fn((inst: { exports: { _start: () => void } }) => {
          inst.exports._start();
          return 9;
        }),
      } as unknown as WASI;
    });
    await expect(
      CddWasmSdk.convertGoogleDiscoveryToOpenApi(
        '{"discoveryVersion":"v1"}',
        cppBin,
      ),
    ).rejects.toThrow("Google Discovery conversion exited with code 9");

    // 5. WASIProcExit with non-zero code
    vi.stubGlobal("WebAssembly", {
      compile: vi.fn().mockResolvedValue({}),
      instantiate: vi.fn().mockResolvedValue(makeFakeInstance()),
    });
    vi.mocked(WASI).mockImplementationOnce(function () {
      return makeFakeWasi({ throws: { code: 5 } }) as unknown as WASI;
    });
    await expect(
      CddWasmSdk.convertGoogleDiscoveryToOpenApi(
        '{"discoveryVersion":"v1"}',
        cppBin,
      ),
    ).rejects.toThrow("Google Discovery conversion exited with code 5");

    // 6. Generic error thrown during compile/start (Error and string)
    vi.mocked(WASI).mockImplementationOnce(function () {
      return makeFakeWasi({
        throws: new Error("corrupt wasm"),
      }) as unknown as WASI;
    });
    await expect(
      CddWasmSdk.convertGoogleDiscoveryToOpenApi(
        '{"discoveryVersion":"v1"}',
        cppBin,
      ),
    ).rejects.toThrow("Google Discovery conversion failed: corrupt wasm");

    vi.mocked(WASI).mockImplementationOnce(function () {
      return makeFakeWasi({ throws: "string crash" }) as unknown as WASI;
    });
    await expect(
      CddWasmSdk.convertGoogleDiscoveryToOpenApi(
        '{"discoveryVersion":"v1"}',
        cppBin,
      ),
    ).rejects.toThrow("Google Discovery conversion failed: string crash");

    // 7. Empty output throws CddWasmError
    vi.mocked(WASI).mockImplementationOnce(function () {
      return makeFakeWasi({ exitCode: 0 }) as unknown as WASI;
    });
    await expect(
      CddWasmSdk.convertGoogleDiscoveryToOpenApi(
        '{"discoveryVersion":"v1"}',
        cppBin,
      ),
    ).rejects.toThrow(
      "Google Discovery conversion produced empty OpenAPI output",
    );
  });

  it("CddWasmSdk.generate and fromOpenApi pre-convert Google Discovery JSON and route Arazzo 1.1.0", async () => {
    const cppBin = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

    // Pre-conversion for non-cpp ecosystem
    vi.mocked(WASI)
      .mockImplementationOnce(function (_args, _env, fds) {
        return makeFakeWasi({
          exitCode: 0,
          onStart: () => {
            const preopen = fds[3] as unknown as {
              contents: Map<string, Inode>;
            };
            const outDir = preopen.contents.get("out") as Directory;
            outDir.contents.set(
              "openapi.json",
              new File(new TextEncoder().encode('{"openapi":"3.2.0"}')),
            );
          },
        }) as unknown as WASI;
      })
      .mockImplementationOnce(function (_args, _env, fds) {
        return makeFakeWasi({
          exitCode: 0,
          onStart: () => {
            const preopen = fds[3] as unknown as {
              contents: Map<string, Inode>;
            };
            const outDir = preopen.contents.get("out") as Directory;
            outDir.contents.set(
              "lib.rs",
              new File(new TextEncoder().encode("// rust sdk")),
            );
          },
        }) as unknown as WASI;
      });

    const files = await CddWasmSdk.generate(
      baseOptions({
        ecosystem: "cdd-rust",
        target: "to_sdk",
        specContent: '{"discoveryVersion":"v1","name":"drive"}',
        cppConverterWasmUrl: cppBin,
      }),
    );
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("lib.rs");
    expect(files.convertedOpenApiSpec).toBe('{"openapi":"3.2.0"}');

    // Pre-conversion when ecosystem === "cdd-cpp" and target === "to_docs_json"
    vi.mocked(WASI)
      .mockImplementationOnce(function (_args, _env, fds) {
        return makeFakeWasi({
          exitCode: 0,
          onStart: () => {
            const preopen = fds[3] as unknown as {
              contents: Map<string, Inode>;
            };
            const outDir = preopen.contents.get("out") as Directory;
            outDir.contents.set(
              "openapi.json",
              new File(new TextEncoder().encode('{"openapi":"3.2.0"}')),
            );
          },
        }) as unknown as WASI;
      })
      .mockImplementationOnce(function (_args, _env, fds) {
        return makeFakeWasi({
          exitCode: 0,
          onStart: () => {
            const preopen = fds[3] as unknown as {
              contents: Map<string, Inode>;
            };
            const outDir = preopen.contents.get("out") as Directory;
            outDir.contents.set(
              "docs.json",
              new File(new TextEncoder().encode('{"endpoints":[]}')),
            );
          },
        }) as unknown as WASI;
      });

    const cppDocs = await CddWasmSdk.toDocsJson({
      ecosystem: "cdd-cpp",
      specContent: '{"discoveryVersion":"v1"}',
      wasmBinary: cppBin,
    });
    expect(cppDocs[0]?.path).toBe("docs.json");
    expect(cppDocs.convertedOpenApiSpec).toBe('{"openapi":"3.2.0"}');

    // Direct cdd-cpp execution with Google Discovery (no pre-conversion)
    vi.mocked(WASI).mockClear();
    await CddWasmSdk.generate(
      baseOptions({
        ecosystem: "cdd-cpp",
        target: "to_sdk",
        specContent: '{"discoveryVersion":"v1"}',
      }),
    );
    expect(WASI).toHaveBeenCalledTimes(1);
    expect(WASI).toHaveBeenCalledWith(
      [
        "cdd-cpp",
        "from_google_discovery",
        "to_sdk",
        "-i",
        "/spec.json",
        "-o",
        "/out",
      ],
      expect.arrayContaining(["CDD_COMMAND=from_google_discovery"]),
      expect.any(Array),
    );

    // Arazzo 1.1.0 routing
    vi.mocked(WASI).mockClear();
    await CddWasmSdk.generate(
      baseOptions({
        ecosystem: "cdd-go",
        target: "to_sdk",
        specContent: '{"arazzo":"1.0.1","workflows":[]}',
        mcp: true,
        framework: "gin",
        orm: "gorm",
        autoAdmin: true,
      }),
    );
    expect(WASI).toHaveBeenCalledWith(
      [
        "cdd-go",
        "from_arazzo",
        "to_sdk",
        "-i",
        "/spec.json",
        "-o",
        "/out",
        "--mcp",
        "--framework",
        "gin",
        "--orm",
        "gorm",
        "--auto-admin",
      ],
      expect.arrayContaining(["CDD_COMMAND=from_arazzo"]),
      expect.any(Array),
    );
  });
});
