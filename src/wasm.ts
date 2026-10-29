/**
 * @module wasm
 * WebAssembly, WASI, GraalVM (WasmGC), and Pyodide execution engine for running
 * `cdd-*` OpenAPI code generators in the browser.
 */

import {
  ConsoleStdout,
  Directory,
  File,
  type Inode,
  OpenFile,
  PreopenDirectory,
  WASI,
} from "@bjorn3/browser_wasi_shim";
import { CddEngineError, CddValidationError } from "./error.js";

/**
 * Supported ecosystems for CDD code generation.
 */
export type Ecosystem =
  | "cdd-c"
  | "cdd-cpp"
  | "cdd-csharp"
  | "cdd-go"
  | "cdd-java"
  | "cdd-kotlin"
  | "cdd-php"
  | "cdd-python"
  | "cdd-python-all"
  | "cdd-ruby"
  | "cdd-rust"
  | "cdd-sh"
  | "cdd-swift"
  | "cdd-ts";

/**
 * Supported generation targets, including standard SDK generation targets,
 * server generation, ORM generation, MCP generation, and docs generation.
 */
export type Target =
  | "to_sdk"
  | "to_sdk_cli"
  | "to_server"
  | "to_docs_json"
  | "to_openapi"
  | "to_mcp"
  | "to_orm";

/**
 * Map of `cdd-*` ecosystems to their browser WebAssembly readiness status.
 */
export const WASM_ECOSYSTEM_SUPPORT: Readonly<Record<Ecosystem, boolean>> = {
  "cdd-c": true,
  "cdd-cpp": false,
  "cdd-csharp": true,
  "cdd-go": true,
  "cdd-java": true,
  "cdd-kotlin": true,
  "cdd-php": false,
  "cdd-python": true,
  "cdd-python-all": true,
  "cdd-ruby": true,
  "cdd-rust": false,
  "cdd-sh": true,
  "cdd-swift": true,
  "cdd-ts": true,
};

/**
 * Result returned by the `CddJavaBrowser` WasmGC wrapper.
 */
export interface CddJavaExecutionResult {
  /**
   * Map of relative file paths to their generated string contents.
   */
  files: Record<string, string>;
}

/**
 * Instance interface for the `CddJavaBrowser` WasmGC engine.
 */
export interface CddJavaBrowserEngine {
  /**
   * Generates server code from an OpenAPI specification string.
   * @param specContent OpenAPI specification string.
   * @returns Promise resolving to generated files.
   */
  generateServer(specContent: string): Promise<CddJavaExecutionResult>;

  /**
   * Generates CLI SDK code from an OpenAPI specification string.
   * @param specContent OpenAPI specification string.
   * @param noGithubActions Whether to omit GitHub Actions workflows.
   * @param noInstallablePackage Whether to omit installable package boilerplate.
   * @param includeTests Whether to generate test suites.
   * @returns Promise resolving to generated files.
   */
  generateSdkCli(
    specContent: string,
    noGithubActions: boolean,
    noInstallablePackage: boolean,
    includeTests: boolean,
  ): Promise<CddJavaExecutionResult>;

  /**
   * Generates ORM / database model code from an OpenAPI specification string.
   * @param specContent OpenAPI specification string.
   * @returns Promise resolving to generated files.
   */
  generateOrm(specContent: string): Promise<CddJavaExecutionResult>;

  /**
   * Generates client SDK code from an OpenAPI specification string.
   * @param specContent OpenAPI specification string.
   * @param noGithubActions Whether to omit GitHub Actions workflows.
   * @param noInstallablePackage Whether to omit installable package boilerplate.
   * @param includeTests Whether to generate test suites.
   * @returns Promise resolving to generated files.
   */
  generateSdk(
    specContent: string,
    noGithubActions: boolean,
    noInstallablePackage: boolean,
    includeTests: boolean,
  ): Promise<CddJavaExecutionResult>;

  /**
   * Generates documentation JSON (`docs.json`) from an OpenAPI specification string.
   * @param specContent OpenAPI specification string.
   * @param noImports Whether to omit import statements in generated snippets.
   * @param noWrapping Whether to omit wrapping boilerplate in generated snippets.
   * @returns Promise resolving to generated files.
   */
  generateDocsJson?(
    specContent: string,
    noImports: boolean,
    noWrapping: boolean,
  ): Promise<CddJavaExecutionResult>;

  /**
   * Generates an OpenAPI specification from Java source code.
   * @param specContent Java source code string.
   * @returns Promise resolving to generated files.
   */
  generateOpenApi?(specContent: string): Promise<CddJavaExecutionResult>;
}

/**
 * Constructor signature for `CddJavaBrowser`.
 */
export interface CddJavaBrowserConstructor {
  /**
   * Creates a new `CddJavaBrowser` engine instance.
   * @param wasmUrl URL to the `cdd-java.wasm` binary.
   * @param jsUrl URL to the `cdd-java.js` loader script.
   */
  new (wasmUrl: string, jsUrl: string): CddJavaBrowserEngine;
}

/**
 * Virtual filesystem stat result inside Pyodide.
 */
export interface PyodideStat {
  /**
   * POSIX file mode bitmask.
   */
  mode: number;
}

/**
 * Emscripten virtual filesystem interface exposed by Pyodide.
 */
export interface PyodideFileSystem {
  /**
   * Writes data to a file in the Pyodide virtual filesystem.
   * @param path Virtual filesystem path.
   * @param data String or binary content to write.
   */
  writeFile(path: string, data: string | Uint8Array): void;

  /**
   * Creates a directory in the Pyodide virtual filesystem.
   * @param path Directory path to create.
   */
  mkdir(path: string): void;

  /**
   * Lists directory entries at the given path.
   * @param path Directory path to read.
   * @returns Array of entry names.
   */
  readdir(path: string): string[];

  /**
   * Retrieves POSIX stat metadata for a path.
   * @param path Path to inspect.
   * @returns Stat metadata object.
   */
  stat(path: string): PyodideStat;

  /**
   * Checks whether a POSIX mode bitmask represents a directory.
   * @param mode POSIX mode value from `stat()`.
   * @returns `true` if directory, `false` otherwise.
   */
  isDir(mode: number): boolean;

  /**
   * Reads a file as a `Uint8Array` from the Pyodide virtual filesystem.
   * @param path File path to read.
   * @returns File bytes as a `Uint8Array`.
   */
  readFile(path: string): Uint8Array;
}

/**
 * Minimal interface for `micropip` imported via `pyodide.pyimport("micropip")`.
 */
export interface PyodideMicropip {
  /**
   * Installs one or more Python packages via micropip.
   * @param packages Package specification or array of package specifications.
   * @returns Promise resolving when installation completes.
   */
  install(packages: string | string[]): Promise<void>;
}

/**
 * Minimal interface for Python `sys.argv` or `sys.path` list proxies.
 */
export interface PyodideListProxy {
  /**
   * Clears all elements from the Python list.
   */
  clear(): void;

  /**
   * Appends a string item to the Python list.
   * @param item String element to append.
   */
  append(item: string): void;
}

/**
 * Minimal interface for Python `sys` module imported via `pyodide.pyimport("sys")`.
 */
export interface PyodideSysModule {
  /**
   * Python `sys.argv` list proxy.
   */
  argv: PyodideListProxy;

  /**
   * Python `sys.path` list proxy.
   */
  path: PyodideListProxy;
}

/**
 * Runtime interface for a loaded Pyodide instance.
 */
export interface PyodideInstance {
  /**
   * Emscripten virtual filesystem attached to Pyodide.
   */
  FS: PyodideFileSystem;

  /**
   * Loads a built-in Pyodide package (e.g., `"micropip"`).
   * @param names Package name or list of package names.
   * @returns Promise resolving when loaded.
   */
  loadPackage(names: string | string[]): Promise<void>;

  /**
   * Imports a Python module into JavaScript.
   * @param name Python module name (`"micropip"` or `"sys"`).
   * @returns Imported module proxy.
   */
  pyimport(name: string): PyodideMicropip & PyodideSysModule;

  /**
   * Unpacks a binary archive into the Pyodide virtual filesystem.
   * @param buffer Archive bytes (`ArrayBuffer` or `Uint8Array`).
   * @param format Archive format (e.g., `"zip"`).
   * @param options Optional extraction options including `extractDir`.
   */
  unpackArchive(
    buffer: ArrayBuffer,
    format: string,
    options?: {
      /**
       * Target directory for extraction.
       */
      extractDir?: string;
    },
  ): void;

  /**
   * Executes a Python code snippet asynchronously.
   * @param code Python source code to evaluate.
   * @returns Promise resolving when execution completes.
   */
  runPythonAsync(code: string): Promise<unknown>;
}

/**
 * Loader function type for initializing a Pyodide instance.
 */
export type PyodideLoader = (options?: {
  /**
   * Base URL or directory containing Pyodide runtime assets.
   */
  indexURL?: string;
}) => Promise<PyodideInstance>;

/**
 * Module structure exported by the Pyodide ES module bundle.
 */
export interface PyodideModule {
  /**
   * Function that loads and initializes the Pyodide WebAssembly runtime.
   */
  loadPyodide: PyodideLoader;
}

/**
 * Exports required by `wasi.initialize` for reactor modules.
 */
export interface WasiReactorExports {
  /**
   * WebAssembly linear memory exported by the instance.
   */
  memory: WebAssembly.Memory;

  /**
   * Optional WASI reactor `_initialize` entrypoint.
   */
  _initialize?: () => unknown;
}

/**
 * WebAssembly instance wrapper compatible with `wasi.initialize`.
 */
export interface WasiReactorInstance {
  /**
   * Exported reactor members.
   */
  exports: WasiReactorExports;
}

/**
 * Exports required by `wasi.start` for command modules.
 */
export interface WasiCommandExports {
  /**
   * WebAssembly linear memory exported by the instance.
   */
  memory: WebAssembly.Memory;

  /**
   * WASI command `_start` entrypoint.
   */
  _start: () => unknown;
}

/**
 * WebAssembly instance wrapper compatible with `wasi.start`.
 */
export interface WasiCommandInstance {
  /**
   * Exported command members.
   */
  exports: WasiCommandExports;
}

/**
 * Options for generating code from an OpenAPI specification.
 */
export interface GenerateOptions {
  /**
   * The target ecosystem for generation.
   */
  ecosystem: Ecosystem;

  /**
   * The type of generation (e.g., `to_sdk`, `to_server`, `to_docs_json`).
   */
  target: Target;

  /**
   * The OpenAPI specification content as a UTF-8 string or `Uint8Array`.
   */
  specContent: string | Uint8Array;

  /**
   * The WebAssembly binary (or Python ZIP bundle) for the target ecosystem.
   */
  wasmBinary: Uint8Array | ArrayBuffer;

  /**
   * Optional flag to enable printing WASM stdout to the console.
   */
  printStdout?: boolean;

  /**
   * Optional additional CLI arguments to pass to the generator binary.
   */
  additionalArgs?: string[];

  /**
   * Optional override URL for `cdd-java.wasm` when using the `cdd-java` ecosystem.
   */
  cddJavaWasmUrl?: string;

  /**
   * Optional override URL for `cdd-java.js` when using the `cdd-java` ecosystem.
   */
  cddJavaJsUrl?: string;

  /**
   * Optional custom Pyodide loader function for `cdd-python` and `cdd-python-all`.
   */
  pyodideLoader?: PyodideLoader;
}

/**
 * A file generated by the CDD WASM SDK.
 */
export interface GeneratedFile {
  /**
   * The relative path of the generated file within the output directory.
   */
  path: string;

  /**
   * The file contents as a `Uint8Array`.
   */
  content: Uint8Array;
}

/**
 * Normalized OpenAPI specification representation used internally during execution.
 */
export interface NormalizedSpec {
  /**
   * Raw UTF-8 encoded bytes of the specification.
   */
  bytes: Uint8Array;

  /**
   * Decoded UTF-8 string of the specification.
   */
  text: string;

  /**
   * Determined virtual filename (`"spec.json"` or `"spec.yaml"`).
   */
  fileName: "spec.json" | "spec.yaml";
}

/**
 * Extended global scope declarations for browser/WebWorker GraalVM and `CddJavaBrowser` globals.
 */
interface GlobalJavaScope {
  /**
   * Global GraalVM runtime object injected by `cdd-java.js`.
   */
  GraalVM?: unknown;

  /**
   * Global `CddJavaBrowser` constructor exposed by `cdd-java-cli`.
   */
  CddJavaBrowser?: CddJavaBrowserConstructor | null;

  /**
   * Optional WebWorker `importScripts` function.
   */
  importScripts?: (...urls: string[]) => void;

  /**
   * Optional browser/WebWorker `location` object.
   */
  location?: {
    /**
     * Origin URL string.
     */
    origin: string;
  };

  /**
   * Optional WebWorker `self` reference.
   */
  self?: {
    /**
     * Worker-scoped GraalVM runtime object.
     */
    GraalVM?: unknown;
  };
}

/**
 * Expected exports structure on a compiled CDD WebAssembly instance.
 */
interface CddWasmExports {
  /**
   * Reactor-style `from_openapi` entrypoint export.
   */
  from_openapi?: () => number | void;

  /**
   * Standard WASI command `_start` entrypoint export.
   */
  _start?: () => number | void;

  /**
   * GraalVM/native `main` entrypoint export.
   */
  main?: () => number | void;
}

/**
 * Structure of a `WASIProcExit` or exit-code bearing exception.
 */
interface ExitCodeError {
  /**
   * Error name (e.g., `"WASIProcExit"`).
   */
  name?: string;

  /**
   * Numeric exit code raised by `proc_exit`.
   */
  code?: number;

  /**
   * Exception message string.
   */
  message?: string;
}

/**
 * Normalizes a `Uint8Array` or `ArrayBuffer` into a standalone `ArrayBuffer` slice.
 * Fixes sub-view offset issues when a `Uint8Array` is a slice of a larger buffer.
 * @param binary Input `Uint8Array` or `ArrayBuffer`.
 * @returns A tightly-bounded `ArrayBuffer` containing only the binary's bytes.
 */
export function toArrayBuffer(binary: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (binary instanceof Uint8Array) {
    return binary.buffer.slice(
      binary.byteOffset,
      binary.byteOffset + binary.byteLength,
    ) as ArrayBuffer;
  }
  return binary;
}

/**
 * Normalizes an OpenAPI specification input (`string` or `Uint8Array`) into
 * both UTF-8 bytes, text, and a detected filename (`"spec.json"` or `"spec.yaml"`).
 * @param specContent Input OpenAPI specification content.
 * @returns Normalized specification bytes, text, and filename.
 */
export function normalizeSpecContent(
  specContent: string | Uint8Array,
): NormalizedSpec {
  const bytes =
    typeof specContent === "string"
      ? new TextEncoder().encode(specContent)
      : new Uint8Array(specContent);
  const text =
    typeof specContent === "string"
      ? specContent
      : new TextDecoder().decode(bytes);
  const isJson = text.trim().startsWith("{");
  return {
    bytes,
    text,
    fileName: isJson ? "spec.json" : "spec.yaml",
  };
}

/**
 * Checks whether an `ArrayBuffer` starts with the standard PKZIP magic header (`PK\x03\x04`).
 * @param buffer Binary buffer to inspect.
 * @returns `true` if the buffer begins with `0x50 0x4b 0x03 0x04`.
 */
export function isZipArchive(buffer: ArrayBufferLike): boolean {
  const view = new Uint8Array(buffer);
  return (
    view.length >= 4 &&
    view[0] === 0x50 &&
    view[1] === 0x4b &&
    view[2] === 0x03 &&
    view[3] === 0x04
  );
}

/**
 * Extracts a named WebAssembly custom section (section ID `0`) from a WASM binary buffer.
 * Safely bounds-checks LEB128 varints and section lengths against truncated buffers.
 * @param buffer Raw WebAssembly binary buffer.
 * @param sectionName Target custom section name (e.g., `"cdd-php-payload"`).
 * @returns The custom section payload bytes as a `Uint8Array`, or `null` if not found or malformed.
 */
export function getCustomSection(
  buffer: ArrayBufferLike,
  sectionName: string,
): Uint8Array | null {
  const view = new Uint8Array(buffer);
  if (view.length < 8) {
    return null;
  }
  let offset = 8;
  while (offset < view.length) {
    const id = view[offset++];
    let size = 0;
    let shift = 0;
    while (true) {
      if (offset >= view.length) {
        return null;
      }
      const byte = view[offset++]!;
      size |= (byte & 0x7f) << shift;
      shift += 7;
      if ((byte & 0x80) === 0) {
        break;
      }
    }
    const sectionEnd = offset + size;
    if (sectionEnd > view.length) {
      return null;
    }
    if (id === 0) {
      let nameLen = 0;
      shift = 0;
      while (true) {
        if (offset >= sectionEnd) {
          return null;
        }
        const byte = view[offset++]!;
        nameLen |= (byte & 0x7f) << shift;
        shift += 7;
        if ((byte & 0x80) === 0) {
          break;
        }
      }
      if (offset + nameLen > sectionEnd) {
        return null;
      }
      const name = new TextDecoder().decode(
        view.slice(offset, offset + nameLen),
      );
      offset += nameLen;
      if (name === sectionName) {
        return view.slice(offset, sectionEnd);
      }
    }
    offset = sectionEnd;
  }
  return null;
}

/**
 * Mounts a JSON-encoded virtual file bundle (extracted from a WASM custom section)
 * into a WASI root directory map.
 * @param rootMap Target root directory `Map<string, Inode>`.
 * @param payloadBytes UTF-8 JSON bytes mapping relative file paths to string contents.
 */
export function mountCustomSectionBundle(
  rootMap: Map<string, Inode>,
  payloadBytes: Uint8Array,
): void {
  const jsonStr = new TextDecoder().decode(payloadBytes);
  const bundle = JSON.parse(jsonStr) as Record<string, string>;

  for (const [filePath, contentStr] of Object.entries(bundle)) {
    const parts = filePath.split("/").filter((part) => part.length > 0);
    const fileName = parts.pop();
    if (!fileName) {
      continue;
    }
    let currentDir = rootMap;
    for (const part of parts) {
      let existing = currentDir.get(part);
      if (!(existing instanceof Directory)) {
        existing = new Directory(new Map<string, Inode>());
        currentDir.set(part, existing);
      }
      currentDir = (existing as Directory).contents;
    }
    currentDir.set(fileName, new File(new TextEncoder().encode(contentStr)));
  }
}

/**
 * Recursively collects generated files from an in-memory WASI `Directory`.
 * @param dir The WASI `Directory` inode to traverse.
 * @param basePath Relative path prefix accumulated during recursion.
 * @returns Array of `GeneratedFile` entries.
 */
export function collectWasiOutputFiles(
  dir: Directory,
  basePath = "",
): GeneratedFile[] {
  const results: GeneratedFile[] = [];
  if (!dir.contents) {
    return results;
  }
  for (const [name, entry] of dir.contents.entries()) {
    const fullPath = basePath ? `${basePath}/${name}` : name;
    if (entry instanceof File) {
      results.push({
        path: fullPath,
        content: entry.data,
      });
    } else if (entry instanceof Directory) {
      results.push(...collectWasiOutputFiles(entry, fullPath));
    }
  }
  return results;
}

/**
 * Parses `JAVY_FS_DUMP:<json>` lines emitted to stdout by `cdd-ts` Javy builds.
 * @param stdout Combined stdout/stderr string captured from `cdd-ts`.
 * @returns Array of `GeneratedFile` objects extracted from the dump.
 */
export function parseJavyStdoutDump(stdout: string): GeneratedFile[] {
  const results: GeneratedFile[] = [];
  if (!stdout) {
    return results;
  }
  try {
    const lines = stdout.split(/\r?\n/);
    const jsonLine = lines.find((line) => line.startsWith("JAVY_FS_DUMP:"));
    if (jsonLine) {
      const fsData = JSON.parse(
        jsonLine.substring("JAVY_FS_DUMP:".length),
      ) as Record<string, string>;
      for (const [key, value] of Object.entries(fsData)) {
        const normalizedPath = key.startsWith("/out/")
          ? key.substring("/out/".length)
          : key;
        results.push({
          path: normalizedPath,
          content: new TextEncoder().encode(String(value)),
        });
      }
    }
  } catch (e: unknown) {
    console.error("Failed to parse JAVY_FS_DUMP", e);
  }
  return results;
}

/**
 * Patches `ra_ap_syntax` `Parse<T>::drop` calls in `cdd-rust` WASI binaries that were
 * compiled without `--cfg no_salsa_async_drops` so dropping a syntax tree does not attempt
 * to spawn an OS background thread on single-threaded `wasm32-wasip1`.
 * @param buffer Raw WebAssembly binary buffer.
 * @returns Patched `ArrayBuffer` (or the original buffer if no unpatched sites exist).
 */
export function patchRustSalsaAsyncDrops(buffer: ArrayBuffer): ArrayBuffer {
  const view = new Uint8Array(buffer);
  let copyBuffer: ArrayBuffer | null = null;
  let copy: Uint8Array | null = null;
  for (let i = 0; i <= view.length - 19; i++) {
    if (
      view[i] === 0x20 &&
      view[i + 2] === 0x45 &&
      view[i + 3] === 0x0d &&
      view[i + 4] === 0x00 &&
      view[i + 5] === 0x41 &&
      view[i + 10] === 0x2d &&
      view[i + 11] === 0x00 &&
      view[i + 12] === 0x00 &&
      view[i + 13] === 0x41 &&
      view[i + 14] === 0x03 &&
      view[i + 15] === 0x47 &&
      view[i + 16] === 0x04 &&
      view[i + 17] === 0x40 &&
      view[i + 18] === 0x10
    ) {
      if (!copy) {
        copyBuffer = buffer.slice(0);
        copy = new Uint8Array(copyBuffer);
      }
      copy[i] = 0x41;
      copy[i + 1] = 0x01;
      copy[i + 2] = 0x01;
    }
  }
  return copyBuffer ?? buffer;
}

/**
 * Fallback OpenAPI 3.2.0 extractor for TypeScript model files (`export interface` / `export type`)
 * when `cdd-ts` Javy WASM is invoked with `to_openapi` on a file without service classes.
 * @param sourceText TypeScript source code string.
 * @returns Array containing `openapi.json` as a `GeneratedFile`.
 */
export function extractTypeScriptSchemasToOpenApi(
  sourceText: string,
): GeneratedFile[] {
  const schemas: Record<string, Record<string, unknown>> = {};
  const interfaceRegex =
    /(?:export\s+)?interface\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = interfaceRegex.exec(sourceText)) !== null) {
    const name = match[1]!;
    const body = match[2]!;
    const properties: Record<string, Record<string, string>> = {};
    const required: string[] = [];
    const propRegex =
      /([A-Za-z0-9_]+)(\?)?\s*:\s*([^;\n]+?)(?:;|\n|$)/g;
    let propMatch: RegExpExecArray | null;
    while ((propMatch = propRegex.exec(body)) !== null) {
      const propName = propMatch[1]!;
      const isOptional = Boolean(propMatch[2]);
      const rawType = propMatch[3]!.trim();
      let oaType = "string";
      if (rawType.includes("number")) {
        oaType = "number";
      } else if (rawType.includes("boolean")) {
        oaType = "boolean";
      } else if (rawType.endsWith("[]") || rawType.startsWith("Array<")) {
        oaType = "array";
      }
      properties[propName] = { type: oaType };
      if (!isOptional) {
        required.push(propName);
      }
    }
    schemas[name] = {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }
  const openApiDoc = {
    openapi: "3.2.0",
    info: {
      title: "Extracted API",
      version: "1.0.0",
    },
    paths: {},
    components: {
      schemas,
    },
  };
  return [
    {
      path: "openapi.json",
      content: new TextEncoder().encode(JSON.stringify(openApiDoc, null, 2)),
    },
  ];
}

/**
 * Default Pyodide loader that dynamically imports `pyodide` from the local package or CDN.
 * @param options Optional configuration with `indexURL` and custom `importer`.
 * @returns Promise resolving to a `PyodideInstance`.
 */
export async function defaultPyodideLoader(options?: {
  /**
   * Optional base URL for Pyodide assets.
   */
  indexURL?: string;
  /**
   * Optional module importer override for testing or custom bundling.
   */
  importer?: (url: string) => Promise<PyodideModule>;
}): Promise<PyodideInstance> {
  const cdnUrl = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs";
  const importFn =
    options?.importer ??
    ((url: string): Promise<PyodideModule> =>
      import(/* @vite-ignore */ url) as Promise<PyodideModule>);
  const mod = await importFn(cdnUrl);
  return mod.loadPyodide({
    indexURL:
      options?.indexURL ?? "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
  });
}

/**
 * Executes `cdd-java` code generation via the GraalVM WasmGC `CddJavaBrowser` wrapper.
 * @param options Code generation options.
 * @param specText Normalized UTF-8 OpenAPI specification string.
 * @returns Promise resolving to an array of `GeneratedFile` items.
 * @throws {CddEngineError} If `CddJavaBrowser` is unavailable or execution fails.
 */
export async function executeJavaEcosystem(
  options: GenerateOptions,
  specText: string,
): Promise<GeneratedFile[]> {
  const scope = globalThis as unknown as GlobalJavaScope;
  let CddJavaBrowser: CddJavaBrowserConstructor | null = null;

  try {
    const origin =
      typeof scope.location !== "undefined" ? scope.location.origin : "";

    if (typeof scope.importScripts === "function") {
      try {
        scope.importScripts(`${origin}/assets/wasm/cdd-java.js`);
        if (scope.self?.GraalVM) {
          scope.GraalVM = scope.self.GraalVM;
        }
      } catch (e: unknown) {
        console.warn("Failed to importScripts cdd-java.js", e);
      }
    }

    if (!scope.GraalVM && typeof scope.self !== "undefined" && scope.self.GraalVM) {
      scope.GraalVM = scope.self.GraalVM;
    }

    if (!scope.GraalVM) {
      scope.GraalVM = null;
    }

    CddJavaBrowser = scope.CddJavaBrowser ?? null;
    if (!CddJavaBrowser) {
      throw new Error("Could not find StaticCddJavaBrowser from cdd-java-cli");
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CddEngineError(
      `cdd-java-cli is not installed or available for WasmGC execution. Error: ${msg}`,
      undefined,
      e,
    );
  }

  let engine: CddJavaBrowserEngine;
  try {
    const origin =
      typeof scope.location !== "undefined" ? scope.location.origin : "";
    const wasmUrl =
      options.cddJavaWasmUrl ?? `${origin}/assets/wasm/cdd-java.wasm`;
    const jsUrl = options.cddJavaJsUrl ?? `${origin}/assets/wasm/cdd-java.js`;
    engine = new CddJavaBrowser(wasmUrl, jsUrl);
  } catch (e: unknown) {
    throw new CddEngineError(
      `Failed to instantiate CddJavaBrowser: ${String(e)}`,
      undefined,
      e,
    );
  }

  const noGithubActions = Boolean(
    options.additionalArgs?.includes("--no-github-actions"),
  );
  const noInstallablePackage = Boolean(
    options.additionalArgs?.includes("--no-installable-package"),
  );
  const includeTests = Boolean(options.additionalArgs?.includes("--tests"));
  const noImports = Boolean(options.additionalArgs?.includes("--no-imports"));
  const noWrapping = Boolean(options.additionalArgs?.includes("--no-wrapping"));

  let res: CddJavaExecutionResult;
  if (options.target === "to_server") {
    res = await engine.generateServer(specText);
  } else if (options.target === "to_sdk_cli") {
    res = await engine.generateSdkCli(
      specText,
      noGithubActions,
      noInstallablePackage,
      includeTests,
    );
  } else if (options.target === "to_orm") {
    res = await engine.generateOrm(specText);
  } else if (options.target === "to_docs_json" && engine.generateDocsJson) {
    res = await engine.generateDocsJson(specText, noImports, noWrapping);
  } else if (options.target === "to_openapi" && engine.generateOpenApi) {
    res = await engine.generateOpenApi(specText);
  } else {
    res = await engine.generateSdk(
      specText,
      noGithubActions,
      noInstallablePackage,
      includeTests,
    );
  }

  const results: GeneratedFile[] = [];
  for (const [filePath, content] of Object.entries(res.files)) {
    results.push({
      path: filePath,
      content: new TextEncoder().encode(content),
    });
  }
  return results;
}

/**
 * Executes `cdd-python` or `cdd-python-all` code generation inside Pyodide when
 * provided a Python ZIP archive payload.
 * @param options Code generation options.
 * @param slicedBuffer Normalized `ArrayBuffer` containing the ZIP archive.
 * @param spec Normalized OpenAPI specification.
 * @returns Promise resolving to an array of `GeneratedFile` items.
 */
export async function executePythonZipEcosystem(
  options: GenerateOptions,
  slicedBuffer: ArrayBuffer,
  spec: NormalizedSpec,
): Promise<GeneratedFile[]> {
  const loader = options.pyodideLoader ?? defaultPyodideLoader;
  const pyodide = await loader({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/",
  });
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");
  await micropip.install(["pydantic>=2.0", "libcst", "urllib3", "python-cdd"]);

  pyodide.unpackArchive(slicedBuffer, "zip", {
    extractDir: "/cdd_src",
  });

  if (spec.text.length > 0) {
    pyodide.FS.writeFile(`/${spec.fileName}`, spec.text);
  }
  try {
    pyodide.FS.mkdir("/out");
  } catch {
    // Ignore if /out already exists from a previous run on a warm Pyodide instance
  }

  const sys = pyodide.pyimport("sys");
  sys.argv.clear();
  sys.path.append("/cdd_src");
  sys.path.append("/cdd_src/src");

  if (options.ecosystem === "cdd-python-all") {
    const pySubcmd =
      options.target === "to_docs_json"
        ? ["to_docs_json"]
        : options.target === "to_openapi"
          ? ["to_openapi"]
          : ["from_openapi", options.target];
    const pyOutput =
      options.target === "to_docs_json"
        ? "/out/docs.json"
        : options.target === "to_openapi"
          ? "/out/openapi.json"
          : "/out";
    const pyArgs = [
      "cdd-python-all",
      ...pySubcmd,
      "-i",
      `/${spec.fileName}`,
      "-o",
      pyOutput,
      ...(options.additionalArgs ?? []),
    ];
    for (const arg of pyArgs) {
      sys.argv.append(arg);
    }

    await pyodide.runPythonAsync(`
import ast, os, shutil
shutil.rmtree("/out", ignore_errors=True)
os.makedirs("/out", exist_ok=True)
for _alias in ("Bytes", "NameConstant", "Num", "Str", "Ellipsis", "Index", "ExtSlice"):
    if not hasattr(ast, _alias):
        setattr(ast, _alias, getattr(ast, "Constant", ast.AST) if _alias not in ("Index", "ExtSlice") else ast.AST)
import openapi_client.cli
try:
    openapi_client.cli.main()
except SystemExit as e:
    if e.code != 0:
        raise Exception(f"Failed with exit code {e.code}")
`);
  } else {
    const pyArgs = ["cdd", ...(options.additionalArgs ?? [])];
    for (const arg of pyArgs) {
      sys.argv.append(arg);
    }

    await pyodide.runPythonAsync(`
import cdd.__main__
try:
    cdd.__main__.main()
except SystemExit as e:
    if e.code != 0:
        raise Exception(f"Failed with exit code {e.code}")
`);
  }

  const results: GeneratedFile[] = [];

  /**
   * Recursively reads generated files from the Pyodide `/out` directory.
   * @param dirPath Current virtual directory path in Pyodide FS.
   * @param basePath Relative path prefix accumulated so far.
   */
  function readPyDir(dirPath: string, basePath: string): void {
    const names = pyodide.FS.readdir(dirPath).filter(
      (n) => n !== "." && n !== "..",
    );
    for (const name of names) {
      const fullPath = `${dirPath}/${name}`;
      const stat = pyodide.FS.stat(fullPath);
      const relPath = basePath ? `${basePath}/${name}` : name;
      if (pyodide.FS.isDir(stat.mode)) {
        readPyDir(fullPath, relPath);
      } else {
        results.push({
          path: relPath,
          content: pyodide.FS.readFile(fullPath),
        });
      }
    }
  }

  readPyDir("/out", "");
  return results;
}

/**
 * Builds the WebAssembly import object required for WASI, TeaVM/Kotlin, .NET/WebCIL,
 * and C/C++/Rust/Go/Ruby/PHP/Swift guest binaries.
 * @param wasiImport The `wasi_snapshot_preview1` host import record from `@bjorn3/browser_wasi_shim`.
 * @param setExitCode Callback invoked when guest interop sets an explicit exit code.
 * @returns WebAssembly `Imports` object ready for `WebAssembly.instantiate`.
 */
export function createWasmImports(
  wasiImport: Record<string, unknown>,
  setExitCode: (code: number) => void,
): WebAssembly.Imports {
  return {
    wasi_snapshot_preview1: wasiImport as WebAssembly.ModuleImports,
    webcil: {},
    dotnet_browser: {},
    env: {
      abort: (): void => {
        console.error("abort called");
      },
    },
    interop: {
      genBacktrace: (): void => {},
      "Date.now": (): number => Date.now(),
      "performance.now": (): number => performance.now(),
      "stderrWriter.flush": (): void => {},
      "stdoutWriter.flush": (): void => {},
      "runtime.setExitCode": (code: number): void => {
        setExitCode(code);
      },
      llog: (): void => {},
      formatStackTrace: (): void => {},
      getCurrentWorkingDirectory: (): number => 0,
      "stdoutWriter.close": (): void => {},
      "stderrWriter.close": (): void => {},
      "stdoutWriter.printChars": (): void => {},
      "stderrWriter.printChars": (): void => {},
    },
    compat: {
      f64rem: (x: number, y: number): number => x % y,
      f64log: Math.log,
      f64log10: Math.log10,
      f64pow: Math.pow,
    },
    jsbody: {
      "_JSObject.stringValue___String": (): null => null,
      "_JSNumber.javaDouble___Double": (): number => 0,
      "_JSConversion.extractJavaScriptProxy___Object_Object": (): null => null,
      "_JSConversion.javaScriptUndefined___Object": (): null => null,
      "_JSConversion.asJavaObjectOrString___Object_Object": (): null => null,
      "_JSConversion.extractJavaScriptString___String_Object": (): null => null,
      "_JSConversion.javaScriptToJava___Object_Object": (): null => null,
      "_JSConversion.unproxy___Object_Object": (): null => null,
      "_JSSymbol.referenceEquals___JSSymbol_JSSymbol_JSBoolean": (): number =>
        0,
      "_JSString.javaString___String": (): null => null,
      "_JSSymbol.javaString___String": (): null => null,
      "_JSObject.typeofString___JSString": (): null => null,
      "_JSObject.get___Object_Object": (): null => null,
      "_JSBoolean.javaBoolean___Boolean": (): number => 0,
      "_JSBigInt.javaString___String": (): null => null,
    },
    convert: {
      proxyCharArray: (): void => {},
    },
  };
}

/**
 * The CDD WebAssembly SDK class for executing `cdd-*` generators in-browser.
 */
export class CddWasmSdk {
  /**
   * Placeholder for direct GraalVM binary execution when WasmGC wrapper is not used.
   * @param _buffer The WebAssembly binary buffer.
   * @param _args Command-line arguments.
   * @param _stdoutStream Standard output stream handler.
   * @param _wasiImport WASI host imports object.
   * @returns Never resolves; always throws `CddEngineError`.
   * @throws {CddEngineError} Always thrown because GraalVM requires `CddJavaBrowser`.
   */
  static async runGraalVM(
    _buffer: Uint8Array | ArrayBuffer,
    _args: string[],
    _stdoutStream: unknown,
    _wasiImport: Record<string, unknown>,
  ): Promise<number> {
    throw new CddEngineError(
      "GraalVM execution not fully supported yet in this environment",
    );
  }

  /**
   * Generates code from an OpenAPI specification using the provided WASM binary.
   * @param options The generation options, including ecosystem, target, spec content, and WASM binary.
   * @returns A promise that resolves to an array of generated files.
   * @throws {CddValidationError} If `options` contains invalid or missing required fields.
   * @throws {CddEngineError} If the WASM binary is invalid or guest execution fails.
   */
  static async fromOpenApi(options: GenerateOptions): Promise<GeneratedFile[]> {
    if (!options || !options.ecosystem || !options.target) {
      throw new CddValidationError("ecosystem and target are required");
    }

    const spec = normalizeSpecContent(options.specContent);
    const rawBuffer = toArrayBuffer(options.wasmBinary);
    const slicedBuffer =
      options.ecosystem === "cdd-rust"
        ? patchRustSalsaAsyncDrops(rawBuffer)
        : rawBuffer;

    if (options.ecosystem === "cdd-java") {
      return executeJavaEcosystem(options, spec.text);
    }

    if (
      (options.ecosystem === "cdd-python" ||
        options.ecosystem === "cdd-python-all") &&
      isZipArchive(slicedBuffer)
    ) {
      return executePythonZipEcosystem(options, slicedBuffer, spec);
    }

    const specFile = new File(spec.bytes);
    const outDir = new Directory(new Map<string, Inode>());
    const rootMap = new Map<string, Inode>([
      [spec.fileName, specFile],
      ["out", outDir],
    ]);

    if (options.ecosystem === "cdd-cpp" && options.target === "to_openapi") {
      rootMap.set(
        "src",
        new Directory(new Map<string, Inode>([["input.hpp", new File(spec.bytes)]])),
      );
    }

    if (options.ecosystem === "cdd-php") {
      const payloadBytes = getCustomSection(slicedBuffer, "cdd-php-payload");
      if (payloadBytes) {
        mountCustomSectionBundle(rootMap, payloadBytes);
      } else {
        console.warn("Could not find cdd-php-payload custom section");
      }
    }

    const rootPreopen = new PreopenDirectory("/", rootMap);

    const rootCommandArgs =
      options.target === "to_docs_json"
        ? ["to_docs_json"]
        : options.target === "to_openapi"
          ? ["to_openapi"]
          : ["from_openapi", options.target];

    const outputFlagValue =
      options.target === "to_docs_json"
        ? "/out/docs.json"
        : options.target === "to_openapi"
          ? "/out/openapi.json"
          : "/out";

    const inputFlagValue =
      options.ecosystem === "cdd-cpp" && options.target === "to_openapi"
        ? "/src"
        : `/${spec.fileName}`;

    const args = [
      options.ecosystem,
      ...(options.ecosystem === "cdd-ruby" ? ["/bin/cdd-ruby"] : []),
      ...(options.ecosystem === "cdd-php" ? ["-q", "/bin/cdd-php"] : []),
      ...rootCommandArgs,
      "-i",
      inputFlagValue,
      "-o",
      outputFlagValue,
      ...(options.additionalArgs ?? []),
    ];

    const env: string[] =
      options.ecosystem === "cdd-php"
        ? [`INPUT=/${spec.fileName}`, `OUTPUT_DIR=out`]
        : [
            `CDD_COMMAND=${args.includes("from_openapi") ? "from_openapi" : rootCommandArgs[0]!}`,
            `CDD_ARGS=${args.slice(1).join(" ")}`,
            `INPUT=/${spec.fileName}`,
            `OUTPUT_DIR=out`,
          ];

    let cddTsStdout = "";

    const stdinFile =
      options.ecosystem === "cdd-ts"
        ? new OpenFile(
            new File(
              new TextEncoder().encode(
                JSON.stringify({
                  args,
                  input: spec.text,
                }),
              ),
            ),
          )
        : new OpenFile(new File(new Uint8Array([])));

    const stdoutFd = ConsoleStdout.lineBuffered((msg: string): void => {
      if (options.ecosystem === "cdd-ts") {
        cddTsStdout += `${msg}
`;
        if (msg.startsWith("JAVY_FS_DUMP:")) {
          return;
        }
      }
      if (options.printStdout) {
        console.log(`[${options.ecosystem}] ${msg}`);
      }
    });

    const stderrFd = ConsoleStdout.lineBuffered((msg: string): void => {
      if (options.ecosystem === "cdd-ts") {
        cddTsStdout += `${msg}
`;
        if (msg.startsWith("JAVY_FS_DUMP:")) {
          return;
        }
        if (
          msg.startsWith("❌") ||
          msg.startsWith("runGeneration error:") ||
          msg.startsWith("Failed to parse stdin:") ||
          msg.startsWith("Error:")
        ) {
          console.error(`[${options.ecosystem}] ${msg}`);
        } else if (options.printStdout) {
          console.log(`[${options.ecosystem}] ${msg}`);
        }
        return;
      }
      console.error(`[${options.ecosystem}] ${msg}`);
    });

    const fds = [stdinFile, stdoutFd, stderrFd, rootPreopen];
    const wasi = new WASI(args, env, fds);

    const module = await WebAssembly.compile(slicedBuffer);
    let exitCode = 0;

    const wasmImports = createWasmImports(
      wasi.wasiImport as Record<string, unknown>,
      (code: number): void => {
        exitCode = code;
      },
    );

    const instance = await WebAssembly.instantiate(module, wasmImports);
    const exports = instance.exports as unknown as CddWasmExports;

    try {
      if (exports.from_openapi) {
        wasi.initialize(instance as unknown as WasiReactorInstance);
        const ret = exports.from_openapi();
        if (typeof ret === "number") {
          exitCode = ret;
        }
      } else if (exports._start) {
        exitCode = wasi.start(instance as unknown as WasiCommandInstance);
      } else if (exports.main) {
        throw new CddEngineError(
          "GraalVM Execution currently not supported in this runtime.",
        );
      } else {
        throw new CddEngineError("WASM binary missing _start export");
      }
    } catch (e: unknown) {
      const errObj = e as ExitCodeError | null;
      if (
        options.ecosystem === "cdd-ts" &&
        errObj &&
        typeof errObj.message === "string" &&
        errObj.message.includes("unreachable")
      ) {
        exitCode = 0;
        console.warn("Ignored Javy unreachable trap for cdd-ts");
      } else if (errObj && typeof errObj.code === "number") {
        exitCode = errObj.code;
      } else {
        throw e;
      }
    }

    if (exitCode !== 0) {
      throw new CddEngineError(
        `WASM execution failed with exit code ${exitCode}`,
        exitCode,
      );
    }

    const results = collectWasiOutputFiles(outDir);

    if (options.ecosystem === "cdd-ts" && cddTsStdout.length > 0) {
      results.push(...parseJavyStdoutDump(cddTsStdout));
    }

    if (
      options.ecosystem === "cdd-ts" &&
      options.target === "to_openapi" &&
      results.length === 0
    ) {
      results.push(...extractTypeScriptSchemasToOpenApi(spec.text));
    }

    return results;
  }
}
