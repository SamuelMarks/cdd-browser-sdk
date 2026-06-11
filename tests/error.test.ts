import { expect, it, describe } from "vitest";
import { CddSdkError, CddGatewayError, CddEngineError, CddValidationError, wrapError } from "../src/error";

describe("error", () => {
    it("CddSdkError", () => {
        const err = new CddSdkError("test");
        expect(err.message).toBe("test");
        expect(err.name).toBe("CddSdkError");
    });
    it("CddGatewayError", () => {
        const err = new CddGatewayError("test", 500, "CODE");
        expect(err.message).toBe("test");
        expect(err.status).toBe(500);
        expect(err.code).toBe("CODE");
    });
    it("CddEngineError", () => {
        const err = new CddEngineError("test");
        expect(err.message).toBe("Engine execution failed: test");
    });
    it("CddValidationError", () => {
        const err = new CddValidationError("test");
        expect(err.message).toBe("Validation failed: test");
    });
    it("wrapError", () => {
        const sdkErr = new CddSdkError("already");
        expect(wrapError(sdkErr)).toBe(sdkErr);

        const genericErr = new Error("generic");
        const wrapped1 = wrapError(genericErr);
        expect(wrapped1).toBeInstanceOf(CddSdkError);
        expect(wrapped1.message).toBe("generic");

        const wrapped2 = wrapError("string error");
        expect(wrapped2).toBeInstanceOf(CddSdkError);
        expect(wrapped2.message).toBe("string error");
    });
});
