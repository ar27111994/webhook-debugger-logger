/**
 * @file src/consts/http.js
 * @description HTTP-related constants, status codes, and headers.
 */

export const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
});

export const MIME_TYPES = Object.freeze({
  JSON: "application/json",
  HTML: "text/html",
  TEXT: "text/plain",
  PLAIN: "text/plain",
  OCTET_STREAM: "application/octet-stream",
  URLENCODED: "application/x-www-form-urlencoded",
  JAVASCRIPT: "application/javascript",
  XML: "application/xml",
});

export const RECURSION_HEADER_NAME = "X-Forwarded-By";
export const RECURSION_HEADER_LOOP_SUFFIX = "-Loop-Check";

export const SENSITIVE_HEADERS = Object.freeze([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
]);

export const REPLAY_HEADERS_TO_IGNORE = Object.freeze([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
]);

export const FORWARD_HEADERS_TO_IGNORE = Object.freeze([
  ...SENSITIVE_HEADERS,
  "content-length",
  "host",
  "connection",
  "transfer-encoding",
  "keep-alive",
  "proxy-connection",
  "upgrade",
]);
