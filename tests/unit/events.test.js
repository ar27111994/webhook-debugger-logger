/**
 * @file tests/unit/events.test.js
 * @description Unit tests for event emitter singleton logic.
 */

import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import { appEvents, EVENT_NAMES } from "../../src/utils/events.js";

const MAX_LISTENERS = 50;

describe("Events Utils", () => {
  it("appEvents should be an instance of EventEmitter", () => {
    expect(appEvents).toBeInstanceOf(EventEmitter);
  });

  it("should have defined EVENT_NAMES", () => {
    expect(EVENT_NAMES).toBeDefined();
    expect(EVENT_NAMES).toHaveProperty("LOG_RECEIVED");
    // Check if other events exist or just verify structure is frozen
    expect(Object.isFrozen(EVENT_NAMES)).toBe(true);
  });

  it("should enforce singleton behavior (same instance import)", async () => {
    const mod1 = await import("../../src/utils/events.js");
    const mod2 = await import("../../src/utils/events.js");
    expect(mod1.appEvents).toBe(mod2.appEvents);
  });

  it("should handle max listeners to prevent leaks", () => {
    // Just verifying we can set it, specific limits are app config dependent
    const originalLimit = appEvents.getMaxListeners();
    appEvents.setMaxListeners(MAX_LISTENERS);
    expect(appEvents.getMaxListeners()).toBe(MAX_LISTENERS);
    appEvents.setMaxListeners(originalLimit);
  });

  it("should operate as a standard EventEmitter (emit/on)", () => {
    const TEST_EVENT = "test-event";
    const TEST_DATA = { data: 123 };
    const spy = jest.fn();

    appEvents.on(TEST_EVENT, spy);
    appEvents.emit(TEST_EVENT, TEST_DATA);

    expect(spy).toHaveBeenCalledWith(TEST_DATA);
    appEvents.off(TEST_EVENT, spy);
  });
});
