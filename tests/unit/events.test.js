import { describe, test, expect } from "@jest/globals";
import { EventEmitter } from "events";
import { appEvents, EVENT_NAMES } from "../../src/utils/events.js";
import { INTERNAL_EVENTS } from "../../src/consts/index.js";

describe("utils/events.js", () => {
  test("appEvents should be an EventEmitter", () => {
    expect(appEvents).toBeInstanceOf(EventEmitter);
  });

  test("EVENT_NAMES should match INTERNAL_EVENTS", () => {
    expect(EVENT_NAMES).toEqual(INTERNAL_EVENTS);
  });

  test("appEvents should emit and listen", (done) => {
    const eventName = "TEST_EVENT";
    const data = "test-data";
    appEvents.once(eventName, (data) => {
      expect(data).toBe(data);
      done();
    });
    appEvents.emit(eventName, data);
  });
});
