/**
 * @file src/consts/http.js
 * @description HTTP-related constants, status codes, and headers.
 * @module consts/http
 */

import { Actor } from "apify";
import { ENV_VARS } from "./app.js";
import { getInt } from "../utils/env.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const inputSchema = require("../../.actor/input_schema.json");

/**
 * @enum {number}
 */
export const HTTP_STATUS = Object.freeze({
  // Informational (1xx)
  CONTINUE: 100,
  SWITCHING_PROTOCOLS: 101,
  PROCESSING: 102,
  EARLY_HINTS: 103,

  // Success (2xx)
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NON_AUTHORITATIVE_INFORMATION: 203,
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  PARTIAL_CONTENT: 206,
  MULTI_STATUS: 207,
  ALREADY_REPORTED: 208,
  IM_USED: 226,

  // Redirection (3xx)
  MULTIPLE_CHOICES: 300,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  SEE_OTHER: 303,
  NOT_MODIFIED: 304,
  USE_PROXY: 305,
  TEMPORARY_REDIRECT: 307,
  PERMANENT_REDIRECT: 308,

  // Client Error (4xx)
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  PROXY_AUTHENTICATION_REQUIRED: 407,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RANGE_NOT_SATISFIABLE: 416,
  EXPECTATION_FAILED: 417,
  IM_A_TEAPOT: 418,
  MISDIRECTED_REQUEST: 421,
  UNPROCESSABLE_ENTITY: 422,
  LOCKED: 423,
  FAILED_DEPENDENCY: 424,
  TOO_EARLY: 425,
  UPGRADE_REQUIRED: 426,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  UNAVAILABLE_FOR_LEGAL_REASONS: 451,

  // Server Error (5xx)
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
  VARIANT_ALSO_NEGOTIATES: 506,
  INSUFFICIENT_STORAGE: 507,
  LOOP_DETECTED: 508,
  NOT_EXTENDED: 510,
  NETWORK_AUTHENTICATION_REQUIRED: 511,
});

/**
 * @enum {string}
 */
export const HTTP_METHODS = Object.freeze({
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  DELETE: "DELETE",
  PATCH: "PATCH",
  OPTIONS: "OPTIONS",
  HEAD: "HEAD",
  CONNECT: "CONNECT",
  TRACE: "TRACE",
  SYSTEM: "SYSTEM",
  REQUEST: "REQUEST",
});

/**
 * @enum {string}
 */
export const MIME_TYPES = Object.freeze({
  JSON: "application/json",
  HTML: "text/html",
  TEXT: "text/plain",
  PLAIN: "text/plain",
  OCTET_STREAM: "application/octet-stream",
  URLENCODED: "application/x-www-form-urlencoded",
  JAVASCRIPT: "application/javascript",
  XML: "application/xml",
  EVENT_STREAM: "text/event-stream",
  WILDCARD: "*/*",
});

/**
 * @enum {string}
 */
export const HTTP_HEADERS = Object.freeze({
  AUTHORIZATION: "authorization",
  CONTENT_TYPE: "content-type",
  CONTENT_LENGTH: "content-length",
  ACCEPT: "accept",
  USER_AGENT: "user-agent",
  X_REQUEST_ID: "x-request-id",
  X_REAL_IP: "x-real-ip",
  X_FORWARDED_FOR: "x-forwarded-for",
  HOST: "host",
  CONTENT_ENCODING: "content-encoding",
  CACHE_CONTROL: "cache-control",
  CONNECTION: "connection",
  CONTENT_SECURITY_POLICY: "Content-Security-Policy",
  X_CONTENT_TYPE_OPTIONS: "X-Content-Type-Options",
  X_FRAME_OPTIONS: "X-Frame-Options",
  REFERRER_POLICY: "Referrer-Policy",
  RETRY_AFTER: "Retry-After",
  X_RATELIMIT_LIMIT: "X-RateLimit-Limit",
  X_RATELIMIT_REMAINING: "X-RateLimit-Remaining",
  X_RATELIMIT_RESET: "X-RateLimit-Reset",
  APIFY_READINESS: "x-apify-container-server-readiness-probe",
  APIFY_REPLAY: "X-Apify-Replay",
  APIFY_REPLAY_WARNING: "X-Apify-Replay-Warning",
  ORIGINAL_WEBHOOK_ID: "X-Original-Webhook-Id",
  IDEMPOTENCY_KEY: "Idempotency-Key",
  X_ACCEL_BUFFERING: "X-Accel-Buffering",
  STRIPE_SIGNATURE: "stripe-signature",
  SHOPIFY_HMAC_SHA256: "x-shopify-hmac-sha256",
  SHOPIFY_HMAC_SHA256_FALLBACK: "http_x_shopify_hmac_sha256",
  SHOPIFY_TRIGGERED_AT: "x-shopify-triggered-at",
  SHOPIFY_TRIGGERED_AT_FALLBACK: "http_x_shopify_triggered_at",
  HUB_SIGNATURE_256: "x-hub-signature-256",
  SLACK_TIMESTAMP: "x-slack-request-timestamp",
  SLACK_SIGNATURE: "x-slack-signature",
  X_SIMULATE_NO_IP: "x-simulate-no-ip",
  ACCEPT_LANGUAGE: "accept-language",
  REFERER: "referer",
  COOKIE: "cookie",
  SET_COOKIE: "set-cookie",
  X_API_KEY: "x-api-key",
  API_KEY: "api-key",
  TRANSFER_ENCODING: "transfer-encoding",
  KEEP_ALIVE: "keep-alive",
  PROXY_AUTHORIZATION: "proxy-authorization",
  TE: "te",
  TRAILER: "trailer",
  UPGRADE: "upgrade",
  PROXY_CONNECTION: "proxy-connection",
  X_FORWARDED_BY: "x-forwarded-by",
  CUSTOM_SIGNATURE: "x-custom-signature",
});

/**
 * @enum {string}
 */
export const ENCODINGS = Object.freeze({
  UTF8: "utf-8",
  BASE64: "base64",
});

export const HTTP_STATUS_MESSAGES = Object.freeze({
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
});

export const RECURSION_HEADER_NAME = HTTP_HEADERS.X_FORWARDED_BY;
export const RECURSION_HEADER_LOOP_SUFFIX = "-Loop-Check";

// Use the unique Actor Run ID to distinguish between instances.
// This allows Instance A to forward to Instance B (valid), but blocks Instance A -> Instance A (loop).
const actorEnv = Actor.getEnv();
export const RECURSION_HEADER_VALUE =
  actorEnv.actorRunId ||
  `local-${process.env[ENV_VARS.APIFY_LOCAL_STORAGE_DIR] || "dev"}`;

export const SENSITIVE_HEADERS = Object.freeze([
  HTTP_HEADERS.AUTHORIZATION,
  HTTP_HEADERS.COOKIE,
  HTTP_HEADERS.SET_COOKIE,
  HTTP_HEADERS.X_API_KEY,
  HTTP_HEADERS.API_KEY,
]);

export const REPLAY_HEADERS_TO_IGNORE = Object.freeze([
  HTTP_HEADERS.CONTENT_LENGTH,
  HTTP_HEADERS.CONTENT_ENCODING,
  HTTP_HEADERS.TRANSFER_ENCODING,
  HTTP_HEADERS.HOST,
  HTTP_HEADERS.CONNECTION,
  HTTP_HEADERS.KEEP_ALIVE,
  HTTP_HEADERS.PROXY_AUTHORIZATION,
  HTTP_HEADERS.TE,
  HTTP_HEADERS.TRAILER,
  HTTP_HEADERS.UPGRADE,
]);

export const FORWARD_HEADERS_TO_IGNORE = Object.freeze([
  ...SENSITIVE_HEADERS,
  HTTP_HEADERS.CONTENT_LENGTH,
  HTTP_HEADERS.HOST,
  HTTP_HEADERS.CONNECTION,
  HTTP_HEADERS.TRANSFER_ENCODING,
  HTTP_HEADERS.KEEP_ALIVE,
  HTTP_HEADERS.PROXY_CONNECTION,
  HTTP_HEADERS.UPGRADE,
]);

export const HTTP_CONSTS = Object.freeze({
  SAFE_HEADERS: [
    HTTP_HEADERS.USER_AGENT,
    HTTP_HEADERS.ACCEPT_LANGUAGE,
    HTTP_HEADERS.REFERER,
  ],
  TEXT_CONTENT_TYPE_PREFIXES: ["text/"],
  TEXT_CONTENT_TYPE_INCLUDES: ["xml", "javascript", "urlencoded", "html"],
  JSON_KEYWORD: "json",
  DEFAULT_SUCCESS_BODY: HTTP_STATUS_MESSAGES[HTTP_STATUS.OK],
  DEFAULT_RESPONSE_CODE: getInt(
    "DEFAULT_RESPONSE_CODE",
    inputSchema.properties.defaultResponseCode.default ?? HTTP_STATUS.OK,
  ),
});
