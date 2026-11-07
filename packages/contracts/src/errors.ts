/** Error codes shared by the database layer, the API, the MCP server and the CLI. */
export const productErrorCodes = [
  "AUTH_REQUIRED",
  "CLIENT_GRANT_INVALID",
  "CLIENT_SCOPE_DENIED",
  "FORBIDDEN",
  "CONSENT_REQUIRED",
  "NOT_FOUND",
  "UNKNOWN_OPERATION",
  "CONFLICT",
  "EXPOSURE_BLOCKED",
  "VALIDATION",
  "LIMIT_EXCEEDED",
  "BUDGET_EXCEEDED",
  "NO_CHANGES",
  "DIGEST_MISMATCH",
  "STORAGE_OBJECT_MISSING",
  "UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ProductErrorCode = (typeof productErrorCodes)[number];

const httpStatusByCode: Readonly<Record<ProductErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  CLIENT_GRANT_INVALID: 401,
  CLIENT_SCOPE_DENIED: 403,
  FORBIDDEN: 403,
  CONSENT_REQUIRED: 403,
  NOT_FOUND: 404,
  UNKNOWN_OPERATION: 404,
  CONFLICT: 409,
  EXPOSURE_BLOCKED: 409,
  VALIDATION: 422,
  LIMIT_EXCEEDED: 413,
  BUDGET_EXCEEDED: 409,
  NO_CHANGES: 409,
  DIGEST_MISMATCH: 422,
  STORAGE_OBJECT_MISSING: 422,
  UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export function isProductErrorCode(value: unknown): value is ProductErrorCode {
  return typeof value === "string" && (productErrorCodes as readonly string[]).includes(value);
}

export function httpStatusForError(code: ProductErrorCode): number {
  return httpStatusByCode[code];
}

/** The body every surface returns for a failed operation. `message` repeats the code for older clients. */
export interface ProductErrorBody {
  readonly code: ProductErrorCode;
  readonly message: ProductErrorCode;
  readonly detail?: string;
}

export class ProductError extends Error {
  readonly code: ProductErrorCode;
  readonly detail: string | undefined;

  constructor(code: ProductErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ProductError";
    this.code = code;
    this.detail = detail;
  }

  toBody(): ProductErrorBody {
    return this.detail
      ? { code: this.code, message: this.code, detail: this.detail }
      : { code: this.code, message: this.code };
  }
}
