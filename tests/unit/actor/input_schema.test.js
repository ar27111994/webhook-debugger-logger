/**
 * @file tests/unit/actor/input_schema.test.js
 * @description Unit tests for Apify input schema compatibility constraints.
 */

import { describe, expect, it } from "@jest/globals";
import { getInputSchemaSecretFieldKeys } from "@apify/input_secrets";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default;
const inputSchema = require("../../../.actor/input_schema.json");
const datasetSchema = require("../../../.actor/dataset_schema.json");

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} schemaNode
 * @param {string} schemaPath
 * @returns {string[]}
 */
function findNestedSecretPaths(schemaNode, schemaPath) {
  const properties = isPlainObject(schemaNode.properties)
    ? schemaNode.properties
    : null;

  if (!properties) {
    return [];
  }

  /** @type {string[]} */
  const matches = [];

  for (const [propertyName, propertyValue] of Object.entries(properties)) {
    if (!isPlainObject(propertyValue)) {
      continue;
    }

    const propertyPath = `${schemaPath}.properties.${propertyName}`;

    if (propertyValue.isSecret === true) {
      matches.push(propertyPath);
    }

    matches.push(...findNestedSecretPaths(propertyValue, propertyPath));
  }

  return matches;
}

/**
 * @param {Record<string, unknown>} schemaNode
 * @param {string} schemaPath
 * @returns {string[]}
 */
function findMissingDescriptions(schemaNode, schemaPath) {
  const properties = isPlainObject(schemaNode.properties)
    ? schemaNode.properties
    : null;

  if (!properties) {
    return [];
  }

  /** @type {string[]} */
  const matches = [];

  for (const [propertyName, propertyValue] of Object.entries(properties)) {
    if (!isPlainObject(propertyValue)) {
      continue;
    }

    const propertyPath = `${schemaPath}.properties.${propertyName}`;

    if (
      typeof propertyValue.description !== "string" ||
      propertyValue.description.trim() === ""
    ) {
      matches.push(propertyPath);
    }

    matches.push(...findMissingDescriptions(propertyValue, propertyPath));
  }

  return matches;
}
describe("Apify input schema", () => {
  it("keeps isSecret flags only on top-level properties", () => {
    const topLevelProperties = isPlainObject(inputSchema.properties)
      ? inputSchema.properties
      : {};

    const topLevelSecretKeys = Object.entries(topLevelProperties)
      .filter(
        ([, propertyValue]) =>
          isPlainObject(propertyValue) && propertyValue.isSecret === true,
      )
      .map(([propertyName]) => propertyName)
      .sort();

    const apifySecretKeys = getInputSchemaSecretFieldKeys(inputSchema).sort();

    expect(apifySecretKeys).toEqual(topLevelSecretKeys);

    /** @type {string[]} */
    const nestedSecretPaths = [];

    for (const [propertyName, propertyValue] of Object.entries(
      topLevelProperties,
    )) {
      if (!isPlainObject(propertyValue)) {
        continue;
      }

      nestedSecretPaths.push(
        ...findNestedSecretPaths(propertyValue, `properties.${propertyName}`),
      );
    }

    expect(nestedSecretPaths).toEqual([]);
  });

  it("defines descriptions for all nested input schema properties", () => {
    const missingDescriptions = findMissingDescriptions(inputSchema, "schema");

    expect(missingDescriptions).toEqual([]);
  });
});

describe("Apify dataset schema", () => {
  it("allows webhook body fields to be stored as either string or object", () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(datasetSchema.fields);

    expect(
      validate({
        body: { status: "success" },
        responseBody: { received: true },
      }),
    ).toBe(true);
    expect(validate.errors).toBeNull();

    expect(
      validate({
        body: '{"status":"success"}',
        responseBody: '{"received":true}',
      }),
    ).toBe(true);
    expect(validate.errors).toBeNull();
  });
});
