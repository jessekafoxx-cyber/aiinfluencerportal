import express, { type RequestHandler } from "express";

/**
 * Defense-in-depth JSON body parser for portal endpoints.
 *
 * The stock `express.json()` only parses a request when its
 * `Content-Type` is *exactly* `application/json` (modulo charset /
 * boundary params). A malformed client that sends a duplicated,
 * comma-joined media type - e.g. `application/json, application/json` -
 * slips past the type matcher, so `req.body` comes back `undefined`
 * and downstream validation rejects the request with a misleading
 * error (the tax-form endpoint reported `invalid_form_type` because
 * `formType` was empty).
 *
 * This helper builds an `express.json()` middleware whose `type`
 * predicate accepts *any* request whose `Content-Type` contains the
 * `application/json` token, including duplicated / comma-joined values.
 * It is otherwise identical to the stock parser (same limit default).
 *
 * Only wire this into endpoints that have demonstrated this failure
 * mode; it is intentionally a shared helper so other portal JSON
 * routes can opt in later without re-deriving the predicate.
 */
export function tolerantJson(options?: { limit?: string }): RequestHandler {
  return express.json({
    limit: options?.limit ?? "1mb",
    type: (req) => {
      const contentType = req.headers["content-type"];
      if (typeof contentType !== "string") return false;
      return contentType.toLowerCase().includes("application/json");
    },
  });
}
