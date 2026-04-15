import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { HTTP_METHODS, ENCODINGS } from "../src/consts/http.js";
import { APP_ROUTES } from "../src/consts/app.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const actorJsonPath = path.join(repoRoot, ".actor", "actor.json");
const packageJsonPath = path.join(repoRoot, "package.json");
const toSchemaMethod = (method) => method.toLowerCase();
const toSchemaPath = (routePath) => routePath.replace(/:(\w+)/g, "{$1}");
const httpMethods = new Set(Object.values(HTTP_METHODS).map(toSchemaMethod));

const requiredOperations = [
  [APP_ROUTES.DASHBOARD, [toSchemaMethod(HTTP_METHODS.GET)]],
  [APP_ROUTES.WEBHOOK, [toSchemaMethod(HTTP_METHODS.POST)]],
  [APP_ROUTES.INFO, [toSchemaMethod(HTTP_METHODS.GET)]],
  [APP_ROUTES.LOGS, [toSchemaMethod(HTTP_METHODS.GET)]],
  [APP_ROUTES.LOG_DETAIL, [toSchemaMethod(HTTP_METHODS.GET)]],
  [APP_ROUTES.LOG_PAYLOAD, [toSchemaMethod(HTTP_METHODS.GET)]],
  [APP_ROUTES.REPLAY, [toSchemaMethod(HTTP_METHODS.POST)]],
  [APP_ROUTES.LOG_STREAM, [toSchemaMethod(HTTP_METHODS.GET)]],
  [APP_ROUTES.SYSTEM_METRICS, [toSchemaMethod(HTTP_METHODS.GET)]],
  [APP_ROUTES.HEALTH, [toSchemaMethod(HTTP_METHODS.GET)]],
  [APP_ROUTES.READY, [toSchemaMethod(HTTP_METHODS.GET)]],
];

const loadJson = async (filePath) =>
  JSON.parse(await readFile(filePath, ENCODINGS.UTF8));

const fail = (message) => {
  console.error(`web_server_schema validation failed: ${message}`);
  process.exitCode = 1;
};

const ensure = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const ensureObject = (value, message) => {
  ensure(
    value !== null && typeof value === "object" && !Array.isArray(value),
    message,
  );
};

const main = async () => {
  const actorJson = await loadJson(actorJsonPath);
  const packageJson = await loadJson(packageJsonPath);

  ensure(
    actorJson.webServerSchema,
    `Missing webServerSchema in ${actorJsonPath}`,
  );

  const schemaSource = actorJson.webServerSchema;
  const schemaPath =
    typeof schemaSource === "string"
      ? path.resolve(path.dirname(actorJsonPath), schemaSource)
      : null;

  const schemaDocument =
    typeof schemaSource === "string"
      ? await loadJson(schemaPath)
      : schemaSource;

  ensureObject(schemaDocument, "Schema document must be a JSON object");
  ensure(
    typeof schemaDocument.openapi === "string" &&
      schemaDocument.openapi.startsWith("3."),
    "Schema must declare an OpenAPI 3.x version",
  );
  ensureObject(schemaDocument.info, "Schema must contain an info object");
  ensure(
    typeof schemaDocument.info.title === "string" &&
      schemaDocument.info.title.length > 0,
    "Schema info.title is required",
  );
  ensure(
    typeof schemaDocument.info.description === "string" &&
      schemaDocument.info.description.length > 0,
    "Schema info.description is required",
  );
  ensure(
    typeof schemaDocument.info.version === "string" &&
      schemaDocument.info.version.length > 0,
    "Schema info.version is required",
  );
  ensureObject(schemaDocument.paths, "Schema must contain a paths object");
  ensureObject(
    schemaDocument.components,
    "Schema must contain a components object",
  );
  ensureObject(
    schemaDocument.components.responses,
    "Schema must define reusable responses under components.responses",
  );
  ensureObject(
    schemaDocument.components.securitySchemes,
    "Schema must define reusable security schemes under components.securitySchemes",
  );
  ensure(
    schemaDocument.components.securitySchemes.bearerAuth,
    "Schema must define components.securitySchemes.bearerAuth",
  );
  ensure(
    schemaDocument.components.securitySchemes.queryKeyAuth,
    "Schema must define components.securitySchemes.queryKeyAuth",
  );

  ensure(
    schemaDocument.info?.version === packageJson.version,
    `OpenAPI info.version (${schemaDocument.info?.version ?? "missing"}) must match package.json version (${packageJson.version})`,
  );

  for (const [routePath, methods] of requiredOperations) {
    const schemaRoutePath = toSchemaPath(routePath);

    ensure(
      schemaDocument.paths?.[schemaRoutePath],
      `Missing required path: ${schemaRoutePath}`,
    );

    for (const method of methods) {
      ensure(
        schemaDocument.paths[schemaRoutePath][method],
        `Missing required operation ${method.toUpperCase()} ${schemaRoutePath}`,
      );
      ensure(
        schemaDocument.paths[schemaRoutePath][method].operationId,
        `Missing operationId for ${method.toUpperCase()} ${schemaRoutePath}`,
      );
    }
  }

  const operationIds = new Set();
  for (const [routePath, pathItem] of Object.entries(
    schemaDocument.paths ?? {},
  )) {
    ensure(
      routePath.startsWith("/"),
      `Path keys must start with '/': ${routePath}`,
    );
    ensureObject(pathItem, `Path item for ${routePath} must be an object`);

    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!httpMethods.has(method)) {
        continue;
      }

      ensureObject(
        operation,
        `Operation ${method.toUpperCase()} ${routePath} must be an object`,
      );
      const operationId = operation?.operationId;
      ensure(
        operationId,
        `Missing operationId for ${method.toUpperCase()} ${routePath}`,
      );
      ensure(
        !operationIds.has(operationId),
        `Duplicate operationId detected: ${operationId}`,
      );
      ensureObject(
        operation.responses,
        `Operation ${method.toUpperCase()} ${routePath} must define responses`,
      );
      ensure(
        Object.keys(operation.responses).length > 0,
        `Operation ${method.toUpperCase()} ${routePath} must contain at least one response`,
      );
      operationIds.add(operationId);
    }
  }

  console.log(
    `Validated web server schema at ${path.relative(repoRoot, schemaPath ?? actorJsonPath)}.`,
  );
};

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
