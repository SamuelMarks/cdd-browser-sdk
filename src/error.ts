/**
 * @module error
 * Central domain error hierarchy and error wrapping utilities for `cdd-browser-sdk`.
 */

/**
 * Base error class for all errors originating from `cdd-browser-sdk`.
 */
export class CddSdkError extends Error {
  /**
   * Optional underlying error cause that triggered this SDK error.
   */
  public override readonly cause?: unknown;

  /**
   * Constructs a new `CddSdkError`.
   * @param message Human-readable error message describing the failure.
   * @param cause Optional underlying exception or rejection reason.
   */
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    if (cause !== undefined) {
      this.cause = cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error originating from the remote CDD Gateway HTTP or Server-Sent Events (SSE) layer.
 */
export class CddGatewayError extends CddSdkError {
  /**
   * Optional HTTP status code associated with the gateway failure.
   */
  public readonly status?: number;

  /**
   * Optional application-specific or RPC error code.
   */
  public readonly code?: string;

  /**
   * Constructs a new `CddGatewayError`.
   * @param message Human-readable error description.
   * @param status Optional HTTP status code (e.g., 401, 500).
   * @param code Optional gateway or JSON-RPC error code identifier.
   * @param cause Optional underlying error cause.
   */
  constructor(
    message: string,
    status?: number,
    code?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    if (status !== undefined) {
      this.status = status;
    }
    if (code !== undefined) {
      this.code = code;
    }
  }
}

/**
 * Error originating from internal WASM, WASI, GraalVM, or Pyodide engine execution.
 */
export class CddEngineError extends CddSdkError {
  /**
   * Optional process exit code returned by the underlying runtime.
   */
  public readonly exitCode?: number;

  /**
   * Constructs a new `CddEngineError`.
   * @param message Specific engine failure description (automatically prefixed).
   * @param exitCode Optional non-zero exit code from the guest process.
   * @param cause Optional underlying exception from the execution runtime.
   */
  constructor(message: string, exitCode?: number, cause?: unknown) {
    super(`Engine execution failed: ${message}`, cause);
    if (exitCode !== undefined) {
      this.exitCode = exitCode;
    }
  }
}

/**
 * Error thrown when input parameters or options fail validation.
 */
export class CddValidationError extends CddSdkError {
  /**
   * Constructs a new `CddValidationError`.
   * @param message Validation failure details (automatically prefixed).
   * @param cause Optional underlying validation error (e.g., `ZodError`).
   */
  constructor(message: string, cause?: unknown) {
    super(`Validation failed: ${message}`, cause);
  }
}

/**
 * Converts an unknown thrown value into a strongly-typed `CddSdkError`.
 * If the input is already a `CddSdkError` (or subclass), it is returned as-is.
 * @param err Unknown error value caught in a `catch` block.
 * @returns A `CddSdkError` instance preserving the original message and cause.
 */
export function wrapError(err: unknown): CddSdkError {
  if (err instanceof CddSdkError) {
    return err;
  }
  if (err instanceof Error) {
    return new CddSdkError(err.message, err);
  }
  return new CddSdkError(String(err), err);
}
