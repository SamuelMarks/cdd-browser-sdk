import { describe, expect, it } from "vitest";
import {
  CddEngineError,
  CddGatewayError,
  CddSdkError,
  CddValidationError,
  wrapError,
} from "../src/index.js";

describe("Error hierarchy and wrapError", () => {
  it("constructs CddSdkError with message and optional cause", () => {
    const err = new CddSdkError("base error");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CddSdkError);
    expect(err.message).toBe("base error");
    expect(err.name).toBe("CddSdkError");
    expect(err.cause).toBeUndefined();

    const rootCause = new Error("root");
    const errWithCause = new CddSdkError("with cause", rootCause);
    expect(errWithCause.cause).toBe(rootCause);
  });

  it("constructs CddGatewayError with status, code, and cause", () => {
    const cause = new Error("network timeout");
    const err = new CddGatewayError("gateway failed", 502, "BAD_GATEWAY", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CddSdkError);
    expect(err).toBeInstanceOf(CddGatewayError);
    expect(err.name).toBe("CddGatewayError");
    expect(err.message).toBe("gateway failed");
    expect(err.status).toBe(502);
    expect(err.code).toBe("BAD_GATEWAY");
    expect(err.cause).toBe(cause);

    const minimalErr = new CddGatewayError("minimal gateway error");
    expect(minimalErr.status).toBeUndefined();
    expect(minimalErr.code).toBeUndefined();
    expect(minimalErr.cause).toBeUndefined();
  });

  it("constructs CddEngineError with prefixed message, exitCode, and cause", () => {
    const cause = new Error("trap");
    const err = new CddEngineError("unreachable instruction", 134, cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CddSdkError);
    expect(err).toBeInstanceOf(CddEngineError);
    expect(err.name).toBe("CddEngineError");
    expect(err.message).toBe("Engine execution failed: unreachable instruction");
    expect(err.exitCode).toBe(134);
    expect(err.cause).toBe(cause);

    const minimalErr = new CddEngineError("simple failure");
    expect(minimalErr.exitCode).toBeUndefined();
    expect(minimalErr.cause).toBeUndefined();
  });

  it("constructs CddValidationError with prefixed message and optional cause", () => {
    const cause = new Error("zod issue");
    const err = new CddValidationError("missing field", cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CddSdkError);
    expect(err).toBeInstanceOf(CddValidationError);
    expect(err.name).toBe("CddValidationError");
    expect(err.message).toBe("Validation failed: missing field");
    expect(err.cause).toBe(cause);

    const minimalErr = new CddValidationError("bad input");
    expect(minimalErr.cause).toBeUndefined();
  });

  it("wraps unknown errors into CddSdkError while preserving CddSdkError subclasses", () => {
    const existingSdkErr = new CddEngineError("already typed", 1);
    expect(wrapError(existingSdkErr)).toBe(existingSdkErr);

    const nativeErr = new TypeError("invalid argument");
    const wrappedNative = wrapError(nativeErr);
    expect(wrappedNative).toBeInstanceOf(CddSdkError);
    expect(wrappedNative.message).toBe("invalid argument");
    expect(wrappedNative.cause).toBe(nativeErr);

    const wrappedString = wrapError("plain string error");
    expect(wrappedString).toBeInstanceOf(CddSdkError);
    expect(wrappedString.message).toBe("plain string error");
    expect(wrappedString.cause).toBe("plain string error");

    const wrappedNumber = wrapError(404);
    expect(wrappedNumber).toBeInstanceOf(CddSdkError);
    expect(wrappedNumber.message).toBe("404");
    expect(wrappedNumber.cause).toBe(404);
  });
});
