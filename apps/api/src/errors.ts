/**
 * Every error leaves the API in the sdk ApiError shape with a fixed, safe message.
 * Internal details (driver errors, stack traces, SQL) go to the log only.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { ApiError } from "@strata/sdk";

export type ApiErrorCode = ApiError["error"]["code"];

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
};

export class HttpError extends Error {
  readonly status: number;
  constructor(readonly code: ApiErrorCode, message: string) {
    super(message);
    this.status = STATUS[code];
  }
}

/** Raised by the repository layer when the database cannot answer. */
export class DataUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("data store unavailable", options);
  }
}

/** Raised when an outgoing payload fails its sdk schema: a server bug, never shown to clients. */
export class ResponseContractError extends Error {}

export function errorBody(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

/** Parse request input; any failure becomes a 400 naming only the offending fields. */
export function parseInput<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => i.path.join(".") || what))].join(", ");
    throw new HttpError("bad_request", `invalid ${what}: ${fields}`);
  }
  return r.data;
}

/** Validate an outgoing payload against its sdk schema before it is serialized. */
export function validated<T>(schema: ZodType<T, ZodTypeDef, unknown>, payload: unknown): T {
  const r = schema.safeParse(payload);
  if (!r.success) throw new ResponseContractError(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

function classify(err: unknown): { code: ApiErrorCode; message: string; status: number } {
  if (err instanceof HttpError) return { code: err.code, message: err.message, status: err.status };
  if (err instanceof DataUnavailableError) return { code: "unavailable", message: "data temporarily unavailable", status: 503 };
  if (err instanceof ZodError) return { code: "bad_request", message: "invalid request", status: 400 };
  const fe = err as Partial<FastifyError>;
  if (typeof fe.statusCode === "number" && fe.statusCode >= 400 && fe.statusCode < 500) {
    if (fe.statusCode === 429) return { code: "rate_limited", message: "too many requests", status: 429 };
    if (fe.statusCode === 404) return { code: "not_found", message: "not found", status: 404 };
    if (fe.statusCode === 401 || fe.statusCode === 403) return { code: "unauthorized", message: "unauthorized", status: fe.statusCode };
    // Fastify's own 4xx (bad JSON, body too large, wrong content type) carry safe, generic messages.
    return { code: "bad_request", message: fe.code === "FST_ERR_CTP_BODY_TOO_LARGE" ? "body too large" : "invalid request", status: fe.statusCode };
  }
  return { code: "internal", message: "internal error", status: 500 };
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const c = classify(err);
    if (c.status >= 500) req.log.error({ err }, "request failed");
    else req.log.info({ code: c.code }, "request rejected");
    void reply.status(c.status).type("application/json").send(errorBody(c.code, c.message));
  });
  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send(errorBody("not_found", "route not found"));
  });
}
