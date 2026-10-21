import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Directory,
  File,
  type Inode,
  PreopenDirectory,
  WASI,
} from "@bjorn3/browser_wasi_shim";
import {
  CddEngineError,
  CddValidationError,
  CddWasmSdk,
  type CddJavaBrowserEngine,
  type GenerateOptions,
  type PyodideInstance,
  WASM_ECOSYSTEM_SUPPORT,
  collectWasiOutputFiles,
  createWasmImports,
  defaultPyodideLoader,
  getCustomSection,
  isZipArchive,
  mountCustomSectionBundle,
  normalizeSpecContent,
  parseJavyStdoutDump,
  toArrayBuffer,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

interface FakeWasiOptions {
  exitCode?: number;
  throws?: unknown;
  onStart?: () => void;
  onInitialize?: () => void;
}

function makeFakeWasi(opts: FakeWasiOptions = {}) {
  return {
    wasiImport: { proc_exit: vi.fn() },
    initialize: vi.fn(() => {
      opts.onInitialize?.();
    }),
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
    .mockImplementation((path: string, contents: Map<string, Inode>) => ({
      path,
      contents,
    }));
  const MockConsoleStdout = {
    lineBuffered: vi.fn().mockImplementation((cb: (msg: string) => void) => ({
      writeLine: cb,
    })),
  };
  const MockWASI = vi.fn().mockImplementation(() => makeFakeWasi());
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
    specContent: '{"openapi":"3.0.0"}',
    wasmBinary: new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    ...overrides,
  };
}

/**
 * Encodes an unsigned integer into unsigned LEB128 bytes.
 */
function encodeLeb128(value: number): number[] {
  const bytes: number[] = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (v !== 0);
  return bytes;
}

/**
 * Builds a valid WASM binary containing custom and standard sections.
 */
function buildWasmWithSections(
  sections: Array<
    | { id: 0; name: string; payload: Uint8Array }
    | { id: number; payload: Uint8Array }
  >,
): Uint8Array {
  const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  for (const sec of sections) {
    out.push(sec.id);
    if (sec.id === 0 && "name" in sec) {
      const nameBytes = Array.from(new TextEncoder().encode(sec.name));
      const nameLenBytes = encodeLeb128(nameBytes.length);
      const totalSize =
        nameLenBytes.length + nameBytes.length + sec.payload.length;
      out.push(...encodeLeb128(totalSize));
      out.push(...nameLenBytes);
      out.push(...nameBytes);
      out.push(...Array.from(sec.payload));
    } else {
      out.push(...encodeLeb128(sec.payload.length));
      out.push(...Array.from(sec.payload));
    }
  }
  return new Uint8Array(out);
}

describe("Utility functions in src/wasm.ts", () => {
  it("exposes WASM_ECOSYSTEM_SUPPORT metadata", () => {
    expect(WASM_ECOSYSTEM_SUPPORT["cdd-c"]).toBe(true);
    expect(WASM_ECOSYSTEM_SUPPORT["cdd-cpp"]).toBe(false);
    expect(WASM_ECOSYSTEM_SUPPORT["cdd-python-all"]).toBe(true);
    expect(WASM_ECOSYSTEM_SUPPORT["cdd-ts"]).toBe(true);
  });

  it("toArrayBuffer slices Uint8Array views accurately and passes ArrayBuffer directly", () => {
    const raw = new Uint8Array([10, 20, 30, 40, 50]);
    const subView = raw.subarray(1, 4);
    const sliced = toArrayBuffer(subView);
    expect(Array.from(new Uint8Array(sliced))).toEqual([20, 30, 40]);

    const direct = toArrayBuffer(raw.buffer);
    expect(direct).toBe(raw.buffer);
  });

  it("normalizeSpecContent handles JSON and YAML strings and Uint8Arrays", () => {
    const jsonStrSpec = normalizeSpecContent('  {"openapi":"3.1.0"}');
    expect(jsonStrSpec.fileName).toBe("spec.json");
    expect(jsonStrSpec.text).toBe('  {"openapi":"3.1.0"}');

    const yamlStrSpec = normalizeSpecContent(`openapi: 3.1.0
`);
    expect(yamlStrSpec.fileName).toBe("spec.yaml");

    const jsonBytesSpec = normalizeSpecContent(
      new TextEncoder().encode('{"openapi":"3.0.0"}'),
    );
    expect(jsonBytesSpec.fileName).toBe("spec.json");

    const yamlBytesSpec = normalizeSpecContent(
      new TextEncoder().encode("openapi: 3.0.0"),
    );
    expect(yamlBytesSpec.fileName).toBe("spec.yaml");
  });

  it("isZipArchive detects PKZIP magic bytes and rejects non-zip or short buffers", () => {
    expect(isZipArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]).buffer)).toBe(
      true,
    );
    expect(isZipArchive(new Uint8Array([0x00, 0x61, 0x73, 0x6d]).buffer)).toBe(
      false,
    );
    expect(isZipArchive(new Uint8Array([0x50, 0x4b]).buffer)).toBe(false);
  });

  it("getCustomSection parses multi-byte LEB128 sections and handles malformed buffers", () => {
    // Short buffer (< 8 bytes)
    expect(getCustomSection(new Uint8Array([1, 2, 3]).buffer, "test")).toBeNull();

    // Truncated section size varint (high bit set at end of buffer)
    expect(
      getCustomSection(
        new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 0x80]).buffer,
        "test",
      ),
    ).toBeNull();

    // Section size exceeds buffer length
    expect(
      getCustomSection(
        new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 10, 1, 2]).buffer,
        "test",
      ),
    ).toBeNull();

    // Custom section with truncated name length varint
    expect(
      getCustomSection(
        new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 1, 0x80]).buffer,
        "test",
      ),
    ).toBeNull();

    // Custom section where nameLen exceeds sectionEnd
    expect(
      getCustomSection(
        new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 2, 5, 0x61]).buffer,
        "test",
      ),
    ).toBeNull();

    // Valid WASM with non-custom section (id=1), non-matching custom section, and matching custom section with >128 byte payload and >128 byte name
    const longName = "s".repeat(130);
    const largePayload = new Uint8Array(140).fill(0x42);
    const wasm = buildWasmWithSections([
      { id: 1, payload: new Uint8Array([1, 2, 3]) },
      { id: 0, name: "other-sec", payload: new Uint8Array([9, 9]) },
      { id: 0, name: longName, payload: largePayload },
    ]);

    expect(getCustomSection(wasm.buffer, "non-existent")).toBeNull();
    const extracted = getCustomSection(wasm.buffer, longName);
    expect(extracted).not.toBeNull();
    expect(Array.from(extracted!)).toEqual(Array.from(largePayload));
  });

  it("mountCustomSectionBundle mounts nested files, reuses directories, and skips empty paths", () => {
    const rootMap = new Map<string, Inode>();
    const payload = new TextEncoder().encode(
      JSON.stringify({
        "bin/sub/file1.php": "<?php echo 1;",
        "bin/sub/file2.php": "<?php echo 2;",
        "/": "ignored-empty",
      }),
    );
    mountCustomSectionBundle(rootMap, payload);

    const binDir = rootMap.get("bin") as Directory;
    expect(binDir).toBeInstanceOf(Directory);
    const subDir = binDir.contents.get("sub") as Directory;
    expect(subDir).toBeInstanceOf(Directory);
    const file1 = subDir.contents.get("file1.php") as File;
    const file2 = subDir.contents.get("file2.php") as File;
    expect(new TextDecoder().decode(file1.data)).toBe("<?php echo 1;");
    expect(new TextDecoder().decode(file2.data)).toBe("<?php echo 2;");
  });

  it("collectWasiOutputFiles handles empty contents, flat files, and nested directories", () => {
    const emptyDir = { contents: undefined } as unknown as Directory;
    expect(collectWasiOutputFiles(emptyDir)).toEqual([]);

    const nestedMap = new Map<string, Inode>([
      ["nested.rs", new File(new Uint8Array([1, 2]))],
    ]);
    const rootDir = new Directory(
      new Map<string, Inode>([
        ["lib.rs", new File(new Uint8Array([3, 4]))],
        ["src", new Directory(nestedMap)],
        ["other", {} as unknown as Inode],
      ]),
    );
    const collected = collectWasiOutputFiles(rootDir);
    expect(collected).toEqual([
      { path: "lib.rs", content: new Uint8Array([3, 4]) },
      { path: "src/nested.rs", content: new Uint8Array([1, 2]) },
    ]);
  });

  it("parseJavyStdoutDump handles empty stdout, valid dump, non-/out/ paths, missing dump line, and invalid JSON", () => {
    expect(parseJavyStdoutDump("")).toEqual([]);
    expect(
      parseJavyStdoutDump(`normal log line
another line`),
    ).toEqual([]);

    const validDump = `log before
JAVY_FS_DUMP:{"/out/index.ts":"export const x = 1;","README.md":"hello"}
log after`;
    const parsed = parseJavyStdoutDump(validDump);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.path).toBe("index.ts");
    expect(new TextDecoder().decode(parsed[0]!.content)).toBe(
      "export const x = 1;",
    );
    expect(parsed[1]?.path).toBe("README.md");
    expect(new TextDecoder().decode(parsed[1]!.content)).toBe("hello");

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(parseJavyStdoutDump("JAVY_FS_DUMP:{bad-json")).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(
      "Failed to parse JAVY_FS_DUMP",
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  it("createWasmImports provides working host callbacks across all namespaces", () => {
    let recordedExitCode = -1;
    const imports = createWasmImports({ proc_exit: vi.fn() }, (code) => {
      recordedExitCode = code;
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = imports["env"] as Record<string, () => unknown>;
    env["abort"]!();
    expect(errSpy).toHaveBeenCalledWith("abort called");
    errSpy.mockRestore();

    const interop = imports["interop"] as Record<
      string,
      (...args: number[]) => unknown
    >;
    interop["genBacktrace"]!();
    expect(typeof interop["Date.now"]!()).toBe("number");
    expect(typeof interop["performance.now"]!()).toBe("number");
    interop["stderrWriter.flush"]!();
    interop["stdoutWriter.flush"]!();
    interop["runtime.setExitCode"]!(42);
    expect(recordedExitCode).toBe(42);
    interop["llog"]!();
    interop["formatStackTrace"]!();
    expect(interop["getCurrentWorkingDirectory"]!()).toBe(0);
    interop["stdoutWriter.close"]!();
    interop["stderrWriter.close"]!();
    interop["stdoutWriter.printChars"]!();
    interop["stderrWriter.printChars"]!();

    const compat = imports["compat"] as Record<
      string,
      (...args: number[]) => number
    >;
    expect(compat["f64rem"]!(10, 3)).toBe(1);
    expect(compat["f64log"]!(Math.E)).toBeCloseTo(1);
    expect(compat["f64log10"]!(100)).toBeCloseTo(2);
    expect(compat["f64pow"]!(2, 3)).toBe(8);

    const jsbody = imports["jsbody"] as Record<string, () => unknown>;
    for (const fn of Object.values(jsbody)) {
      const res = fn();
      expect(res === null || res === 0).toBe(true);
    }

    const convert = imports["convert"] as Record<string, () => void>;
    convert["proxyCharArray"]!();
  });

  it("CddWasmSdk.runGraalVM throws CddEngineError", async () => {
    await expect(
      CddWasmSdk.runGraalVM(new Uint8Array([]), [], {}, {}),
    ).rejects.toThrow(CddEngineError);
  });

  it("defaultPyodideLoader invokes loadPyodide with default or custom indexURL and rejects on failed import", async () => {
    await expect(defaultPyodideLoader()).rejects.toThrow();

    const fakePyodide = { FS: {} } as unknown as PyodideInstance;
    const mockLoadPyodide = vi.fn().mockResolvedValue(fakePyodide);
    const mockImporter = vi.fn().mockResolvedValue({
      loadPyodide: mockLoadPyodide,
    });

    const loaded1 = await defaultPyodideLoader({ importer: mockImporter });
    expect(loaded1).toBe(fakePyodide);
    expect(mockLoadPyodide).toHaveBeenCalledWith({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
    });

    const loaded2 = await defaultPyodideLoader({
      indexURL: "https://custom.cdn/pyodide/",
      importer: mockImporter,
    });
    expect(loaded2).toBe(fakePyodide);
    expect(mockLoadPyodide).toHaveBeenCalledWith({
      indexURL: "https://custom.cdn/pyodide/",
    });
  });
});

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

  it("validates required options and throws CddValidationError when invalid", async () => {
    await expect(
      CddWasmSdk.fromOpenApi(null as unknown as GenerateOptions),
    ).rejects.toThrow(CddValidationError);
    await expect(
      CddWasmSdk.fromOpenApi({} as unknown as GenerateOptions),
    ).rejects.toThrow(CddValidationError);
  });

  it("mounts spec.json and passes -i /spec.json when specContent is a JSON string", async () => {
    await CddWasmSdk.fromOpenApi(
      baseOptions({ specContent: '{"openapi":"3.0.0"}' }),
    );
    expect(PreopenDirectory).toHaveBeenCalledTimes(1);
    const rootMap = vi.mocked(PreopenDirectory).mock.calls[0]?.[1] as Map<
      string,
      Inode
    >;
    expect(rootMap.has("spec.json")).toBe(true);
    expect(WASI).toHaveBeenCalledWith(
      ["cdd-rust", "from_openapi", "to_sdk", "-i", "/spec.json", "-o", "/out"],
      [
        "CDD_COMMAND=from_openapi",
        "CDD_ARGS=from_openapi to_sdk -i /spec.json -o /out",
        "INPUT=/spec.json",
        "OUTPUT_DIR=out",
      ],
      expect.any(Array),
    );
  });

  it("mounts spec.yaml and passes -i /spec.yaml when specContent is a YAML string", async () => {
    await CddWasmSdk.fromOpenApi(
      baseOptions({
        specContent: `openapi: 3.0.0
info:
  title: Test`,
      }),
    );
    const rootMap = vi.mocked(PreopenDirectory).mock.calls[0]?.[1] as Map<
      string,
      Inode
    >;
    expect(rootMap.has("spec.yaml")).toBe(true);
    expect(WASI).toHaveBeenCalledWith(
      ["cdd-rust", "from_openapi", "to_sdk", "-i", "/spec.yaml", "-o", "/out"],
      expect.arrayContaining(["INPUT=/spec.yaml"]),
      expect.any(Array),
    );
  });

  it("handles specContent as Uint8Array for both JSON and YAML payloads", async () => {
    const jsonBytes = new TextEncoder().encode('{"openapi":"3.0.0"}');
    await CddWasmSdk.fromOpenApi(baseOptions({ specContent: jsonBytes }));
    expect(WASI).toHaveBeenLastCalledWith(
      expect.arrayContaining(["-i", "/spec.json"]),
      expect.any(Array),
      expect.any(Array),
    );

    const yamlBytes = new TextEncoder().encode("openapi: 3.0.0");
    await CddWasmSdk.fromOpenApi(baseOptions({ specContent: yamlBytes }));
    expect(WASI).toHaveBeenLastCalledWith(
      expect.arrayContaining(["-i", "/spec.yaml"]),
      expect.any(Array),
      expect.any(Array),
    );
  });

  it("accepts wasmBinary as ArrayBuffer and compiles it via WebAssembly.compile", async () => {
    const buf = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]).buffer;
    await CddWasmSdk.fromOpenApi(baseOptions({ wasmBinary: buf }));
    expect(WebAssembly.compile).toHaveBeenCalledWith(buf);
  });

  it("logs stdout only when printStdout is true and always logs stderr", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(WASI).mockImplementationOnce((_args, _env, fds) => {
      return makeFakeWasi({
        onStart: () => {
          const outFd = fds[1] as unknown as { writeLine: (m: string) => void };
          const errFd = fds[2] as unknown as { writeLine: (m: string) => void };
          outFd.writeLine("hello stdout");
          errFd.writeLine("hello stderr");
        },
      }) as unknown as WASI;
    });

    await CddWasmSdk.fromOpenApi(baseOptions({ printStdout: true }));
    expect(logSpy).toHaveBeenCalledWith("[cdd-rust] hello stdout");
    expect(errSpy).toHaveBeenCalledWith("[cdd-rust] hello stderr");

    logSpy.mockClear();
    vi.mocked(WASI).mockImplementationOnce((_args, _env, fds) => {
      return makeFakeWasi({
        onStart: () => {
          const outFd = fds[1] as unknown as { writeLine: (m: string) => void };
          outFd.writeLine("quiet stdout");
        },
      }) as unknown as WASI;
    });

    await CddWasmSdk.fromOpenApi(baseOptions({ printStdout: false }));
    expect(logSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("passes additionalArgs and constructs args correctly for to_docs_json and cdd-ruby", async () => {
    await CddWasmSdk.fromOpenApi(
      baseOptions({
        ecosystem: "cdd-ruby",
        target: "to_docs_json",
        additionalArgs: ["--verbose", "--dry-run"],
      }),
    );

    expect(WASI).toHaveBeenCalledWith(
      [
        "cdd-ruby",
        "/bin/cdd-ruby",
        "to_docs_json",
        "-i",
        "/spec.json",
        "-o",
        "/out",
        "--verbose",
        "--dry-run",
      ],
      [
        "CDD_COMMAND=/bin/cdd-ruby",
        "CDD_ARGS=/bin/cdd-ruby to_docs_json -i /spec.json -o /out --verbose --dry-run",
        "INPUT=/spec.json",
        "OUTPUT_DIR=out",
      ],
      expect.any(Array),
    );
  });

  it("handles cdd-php custom section mounting and missing custom section warning", async () => {
    const bundleBytes = new TextEncoder().encode(
      JSON.stringify({ "bin/cdd-php": "<?php // entry" }),
    );
    const phpWasmWithPayload = buildWasmWithSections([
      { id: 0, name: "cdd-php-payload", payload: bundleBytes },
    ]);

    await CddWasmSdk.fromOpenApi(
      baseOptions({
        ecosystem: "cdd-php",
        wasmBinary: phpWasmWithPayload,
      }),
    );

    expect(WASI).toHaveBeenLastCalledWith(
      [
        "cdd-php",
        "-q",
        "/bin/cdd-php",
        "from_openapi",
        "to_sdk",
        "-i",
        "/spec.json",
        "-o",
        "/out",
      ],
      ["INPUT=/spec.json", "OUTPUT_DIR=out"],
      expect.any(Array),
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await CddWasmSdk.fromOpenApi(
      baseOptions({
        ecosystem: "cdd-php",
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Could not find cdd-php-payload custom section",
    );
    warnSpy.mockRestore();
  });

  it("collects generated files when WASM exits with code 0", async () => {
    vi.mocked(WASI).mockImplementationOnce((_args, _env, fds) => {
      return makeFakeWasi({
        exitCode: 0,
        onStart: () => {
          const preopen = fds[3] as unknown as {
            contents: Map<string, Inode>;
          };
          const outDir = preopen.contents.get("out") as Directory;
          outDir.contents.set(
            "client.rs",
            new File(new TextEncoder().encode("pub struct Client;")),
          );
        },
      }) as unknown as WASI;
    });

    const result = await CddWasmSdk.fromOpenApi(baseOptions());
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe("client.rs");
    expect(new TextDecoder().decode(result[0]!.content)).toBe(
      "pub struct Client;",
    );
  });

  it("throws CddEngineError with exitCode when WASM exits with non-zero code or sets exitCode via interop", async () => {
    vi.mocked(WASI).mockImplementationOnce(
      () => makeFakeWasi({ exitCode: 1 }) as unknown as WASI,
    );
    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "Engine execution failed: WASM execution failed with exit code 1",
    );

    vi.stubGlobal("WebAssembly", {
      compile: vi.fn().mockResolvedValue({}),
      instantiate: vi
        .fn()
        .mockImplementationOnce(
          async (_mod: WebAssembly.Module, imports: WebAssembly.Imports) => {
            return makeFakeInstance({
              from_openapi: () => {
                const interop = imports["interop"] as Record<
                  string,
                  (code: number) => void
                >;
                interop["runtime.setExitCode"]!(7);
              },
            });
          },
        ),
    });

    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "Engine execution failed: WASM execution failed with exit code 7",
    );
  });

  it("handles WASIProcExit and generic exit-code errors from _start", async () => {
    const procExit0 = Object.assign(new Error("proc exit 0"), {
      name: "WASIProcExit",
      code: 0,
    });
    vi.mocked(WASI).mockImplementationOnce(
      () => makeFakeWasi({ throws: procExit0 }) as unknown as WASI,
    );
    const res0 = await CddWasmSdk.fromOpenApi(baseOptions());
    expect(res0).toEqual([]);

    const procExit2 = Object.assign(new Error("proc exit 2"), {
      name: "WASIProcExit",
      code: 2,
    });
    vi.mocked(WASI).mockImplementationOnce(
      () => makeFakeWasi({ throws: procExit2 }) as unknown as WASI,
    );
    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "WASM execution failed with exit code 2",
    );

    const codeOnlyErr = { code: 3 };
    vi.mocked(WASI).mockImplementationOnce(
      () => makeFakeWasi({ throws: codeOnlyErr }) as unknown as WASI,
    );
    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "WASM execution failed with exit code 3",
    );

    const typeErr = new TypeError("unexpected internal error");
    vi.mocked(WASI).mockImplementationOnce(
      () => makeFakeWasi({ throws: typeErr }) as unknown as WASI,
    );
    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "unexpected internal error",
    );
  });

  it("supports exports.from_openapi reactor entrypoint, WASIProcExit, and error rethrow", async () => {
    vi.stubGlobal("WebAssembly", {
      compile: vi.fn().mockResolvedValue({}),
      instantiate: vi
        .fn()
        .mockResolvedValueOnce(makeFakeInstance({ from_openapi: () => 0 }))
        .mockResolvedValueOnce(
          makeFakeInstance({ from_openapi: () => undefined }),
        )
        .mockResolvedValueOnce(
          makeFakeInstance({
            from_openapi: () => {
              throw Object.assign(new Error("reactor exit"), {
                name: "WASIProcExit",
                code: 0,
              });
            },
          }),
        )
        .mockResolvedValueOnce(
          makeFakeInstance({
            from_openapi: () => {
              throw new Error("reactor crash");
            },
          }),
        ),
    });

    const r1 = await CddWasmSdk.fromOpenApi(baseOptions());
    expect(r1).toEqual([]);

    const r2 = await CddWasmSdk.fromOpenApi(baseOptions());
    expect(r2).toEqual([]);

    const r3 = await CddWasmSdk.fromOpenApi(baseOptions());
    expect(r3).toEqual([]);

    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "reactor crash",
    );
  });

  it("throws CddEngineError for exports.main (GraalVM) or missing _start export", async () => {
    vi.stubGlobal("WebAssembly", {
      compile: vi.fn().mockResolvedValue({}),
      instantiate: vi
        .fn()
        .mockResolvedValueOnce(makeFakeInstance({ main: vi.fn() }))
        .mockResolvedValueOnce(makeFakeInstance({})),
    });

    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "GraalVM Execution currently not supported in this runtime.",
    );

    await expect(CddWasmSdk.fromOpenApi(baseOptions())).rejects.toThrow(
      "WASM binary missing _start export",
    );
  });

  it("handles cdd-ts Javy execution, unreachable trap recovery, and JAVY_FS_DUMP extraction", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(WASI).mockImplementationOnce((_args, _env, fds) => {
      return makeFakeWasi({
        onStart: () => {
          const outFd = fds[1] as unknown as { writeLine: (m: string) => void };
          const errFd = fds[2] as unknown as { writeLine: (m: string) => void };
          outFd.writeLine(
            'JAVY_FS_DUMP:{"/out/src/index.ts":"export const sdk = true;"}',
          );
          errFd.writeLine("stderr trace");
          throw new Error("RuntimeError: unreachable");
        },
      }) as unknown as WASI;
    });

    const files = await CddWasmSdk.fromOpenApi(
      baseOptions({ ecosystem: "cdd-ts" }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Ignored Javy unreachable trap for cdd-ts",
    );
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("src/index.ts");
    expect(new TextDecoder().decode(files[0]!.content)).toBe(
      "export const sdk = true;",
    );

    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("executes cdd-java ecosystem across all targets and handles worker/missing globals", async () => {
    // 1. Missing CddJavaBrowser throws CddEngineError
    await expect(
      CddWasmSdk.fromOpenApi(baseOptions({ ecosystem: "cdd-java" })),
    ).rejects.toThrow(CddEngineError);

    // 2. Non-Error thrown during CddJavaBrowser resolution
    const globalRef = globalThis as Record<string, unknown>;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    globalRef["importScripts"] = vi.fn(() => {
      throw "string importScripts failure";
    });
    Object.defineProperty(globalRef, "CddJavaBrowser", {
      configurable: true,
      get() {
        throw "non-error getter failure";
      },
    });
    await expect(
      CddWasmSdk.fromOpenApi(baseOptions({ ecosystem: "cdd-java" })),
    ).rejects.toThrow("non-error getter failure");

    // 3. Constructor failure in CddJavaBrowser
    Object.defineProperty(globalRef, "CddJavaBrowser", {
      configurable: true,
      writable: true,
      value: class {
        constructor() {
          throw new Error("bad wasm url");
        }
      },
    });
    await expect(
      CddWasmSdk.fromOpenApi(baseOptions({ ecosystem: "cdd-java" })),
    ).rejects.toThrow("Failed to instantiate CddJavaBrowser");

    // 4. Successful execution across to_server, to_sdk_cli, to_orm, and to_sdk with location & self.GraalVM
    const mockEngine: CddJavaBrowserEngine = {
      generateServer: vi
        .fn()
        .mockResolvedValue({ files: { "Server.java": "class Server {}" } }),
      generateSdkCli: vi
        .fn()
        .mockResolvedValue({ files: { "Cli.java": "class Cli {}" } }),
      generateOrm: vi
        .fn()
        .mockResolvedValue({ files: { "Orm.java": "class Orm {}" } }),
      generateSdk: vi
        .fn()
        .mockResolvedValue({ files: { "Sdk.java": "class Sdk {}" } }),
    };

    const recordedUrls: Array<{ wasmUrl: string; jsUrl: string }> = [];
    globalRef["location"] = { origin: "https://cdd.local" };
    globalRef["self"] = { GraalVM: { version: "21" } };
    delete globalRef["GraalVM"];
    globalRef["importScripts"] = vi.fn();
    globalRef["CddJavaBrowser"] = class {
      constructor(wasmUrl: string, jsUrl: string) {
        recordedUrls.push({ wasmUrl, jsUrl });
        return mockEngine;
      }
    };

    const serverFiles = await CddWasmSdk.fromOpenApi(
      baseOptions({ ecosystem: "cdd-java", target: "to_server" }),
    );
    expect(serverFiles[0]?.path).toBe("Server.java");
    expect(recordedUrls[0]).toEqual({
      wasmUrl: "https://cdd.local/assets/wasm/cdd-java.wasm",
      jsUrl: "https://cdd.local/assets/wasm/cdd-java.js",
    });

    // Without self.GraalVM pre-populated in importScripts, test fallback from self.GraalVM
    delete globalRef["GraalVM"];
    delete globalRef["importScripts"];
    globalRef["self"] = { GraalVM: { version: "21-self" } };

    const cliFiles = await CddWasmSdk.fromOpenApi(
      baseOptions({
        ecosystem: "cdd-java",
        target: "to_sdk_cli",
        additionalArgs: ["--no-github-actions", "--tests"],
        cddJavaWasmUrl: "/custom.wasm",
        cddJavaJsUrl: "/custom.js",
      }),
    );
    expect(cliFiles[0]?.path).toBe("Cli.java");
    expect(mockEngine.generateSdkCli).toHaveBeenCalledWith(
      '{"openapi":"3.0.0"}',
      true,
      false,
      true,
    );

    const ormFiles = await CddWasmSdk.fromOpenApi(
      baseOptions({ ecosystem: "cdd-java", target: "to_orm" }),
    );
    expect(ormFiles[0]?.path).toBe("Orm.java");

    const sdkFiles = await CddWasmSdk.fromOpenApi(
      baseOptions({ ecosystem: "cdd-java", target: "to_sdk" }),
    );
    expect(sdkFiles[0]?.path).toBe("Sdk.java");

    delete globalRef["CddJavaBrowser"];
    delete globalRef["GraalVM"];
    delete globalRef["location"];
    delete globalRef["self"];
    warnSpy.mockRestore();
  });

  it("executes cdd-python and cdd-python-all ZIP archives via PyodideLoader", async () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);
    const writtenFiles = new Map<string, string | Uint8Array>();
    const argvItems: string[] = [];
    const pathItems: string[] = [];
    const ranCode: string[] = [];

    const fakePyodide: PyodideInstance = {
      FS: {
        writeFile: vi.fn((p: string, data: string | Uint8Array) => {
          writtenFiles.set(p, data);
        }),
        mkdir: vi.fn(),
        readdir: vi.fn((dirPath: string) => {
          if (dirPath === "/out") {
            return [".", "..", "pkg", "README.md"];
          }
          return [".", "..", "__init__.py"];
        }),
        stat: vi.fn((fullPath: string) => ({
          mode: fullPath === "/out/pkg" ? 0o040000 : 0o100644,
        })),
        isDir: vi.fn((mode: number) => mode === 0o040000),
        readFile: vi.fn((fullPath: string) =>
          new TextEncoder().encode(`content of ${fullPath}`),
        ),
      },
      loadPackage: vi.fn().mockResolvedValue(undefined),
      pyimport: vi.fn().mockImplementation(() => ({
        install: vi.fn().mockResolvedValue(undefined),
        argv: {
          clear: vi.fn(() => {
            argvItems.length = 0;
          }),
          append: vi.fn((item: string) => {
            argvItems.push(item);
          }),
        },
        path: {
          clear: vi.fn(),
          append: vi.fn((item: string) => {
            pathItems.push(item);
          }),
        },
      })),
      unpackArchive: vi.fn(),
      runPythonAsync: vi.fn(async (code: string) => {
        ranCode.push(code);
      }),
    };

    const customLoader = vi.fn().mockResolvedValue(fakePyodide);

    // 1. cdd-python-all with non-empty specContent and additionalArgs
    const pyAllFiles = await CddWasmSdk.fromOpenApi(
      baseOptions({
        ecosystem: "cdd-python-all",
        target: "to_sdk",
        wasmBinary: zipBytes,
        additionalArgs: ["--extra"],
        pyodideLoader: customLoader,
      }),
    );

    expect(customLoader).toHaveBeenCalledTimes(1);
    expect(writtenFiles.get("/spec.json")).toBe('{"openapi":"3.0.0"}');
    expect(argvItems).toEqual([
      "cdd-python-all",
      "from_openapi",
      "to_sdk",
      "-i",
      "/spec.json",
      "-o",
      "/out",
      "--extra",
    ]);
    expect(ranCode[0]).toContain("openapi_client.cli.main()");
    expect(pyAllFiles).toEqual([
      {
        path: "pkg/__init__.py",
        content: new TextEncoder().encode("content of /out/pkg/__init__.py"),
      },
      {
        path: "README.md",
        content: new TextEncoder().encode("content of /out/README.md"),
      },
    ]);

    // 2. cdd-python with empty specContent and additionalArgs
    writtenFiles.clear();
    const pyFiles = await CddWasmSdk.fromOpenApi(
      baseOptions({
        ecosystem: "cdd-python",
        target: "to_sdk",
        specContent: "",
        wasmBinary: zipBytes,
        additionalArgs: ["--py-arg"],
        pyodideLoader: customLoader,
      }),
    );
    expect(writtenFiles.size).toBe(0);
    expect(argvItems).toEqual(["cdd", "--py-arg"]);
    expect(ranCode[1]).toContain("cdd.__main__.main()");
    expect(pyFiles).toHaveLength(2);

    // 3. cdd-python-all without additionalArgs and cdd-python without additionalArgs
    await CddWasmSdk.fromOpenApi(
      baseOptions({
        ecosystem: "cdd-python-all",
        target: "to_sdk",
        wasmBinary: zipBytes,
        pyodideLoader: customLoader,
      }),
    );
    expect(argvItems).toEqual([
      "cdd-python-all",
      "from_openapi",
      "to_sdk",
      "-i",
      "/spec.json",
      "-o",
      "/out",
    ]);

    await CddWasmSdk.fromOpenApi(
      baseOptions({
        ecosystem: "cdd-python",
        target: "to_sdk",
        wasmBinary: zipBytes,
        pyodideLoader: customLoader,
      }),
    );
    expect(argvItems).toEqual(["cdd"]);

    // 4. executePythonZipEcosystem using defaultPyodideLoader (no pyodideLoader passed)
    await expect(
      CddWasmSdk.fromOpenApi(
        baseOptions({
          ecosystem: "cdd-python",
          target: "to_sdk",
          wasmBinary: zipBytes,
        }),
      ),
    ).rejects.toThrow();
  });
});
