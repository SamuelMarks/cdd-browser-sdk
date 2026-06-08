/**
 * Central Error types for the cdd-browser-sdk
 */

/** Base error class for all SDK errors */
export class CddSdkError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

/** Error originating from the Remote Gateway HTTP/SSE layer */
export class CddGatewayError extends CddSdkError {
    public status?: number;
    public code?: string;

    constructor(message: string, status?: number, code?: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/** Error originating from the internal Engine / WASM execution */
export class CddEngineError extends CddSdkError {
    constructor(message: string) {
        super(`Engine execution failed: ${message}`);
    }
}

/** Validation errors for parameters */
export class CddValidationError extends CddSdkError {
    constructor(message: string) {
        super(`Validation failed: ${message}`);
    }
}

/**
 * Type-safe error handler that converts unknown errors into CddSdkError
 */
export function wrapError(err: unknown): CddSdkError {
    if (err instanceof CddSdkError) {
        return err;
    }
    if (err instanceof Error) {
        return new CddSdkError(err.message);
    }
    return new CddSdkError(String(err));
}
