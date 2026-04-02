/**
 * @file tests/unit/consts/index.test.js
 * @description Ensures consts barrel exports remain wired and importable.
 */

import * as ConstsIndex from "../../../src/consts/index.js";
import { APP_CONSTS } from "../../../src/consts/app.js";
import { ERROR_MESSAGES } from "../../../src/consts/errors.js";
import { LOG_MESSAGES } from "../../../src/consts/messages.js";

describe("consts index barrel", () => {
  it("re-exports key const groups", () => {
    expect(ConstsIndex.APP_CONSTS).toBe(APP_CONSTS);
    expect(ConstsIndex.ERROR_MESSAGES).toBe(ERROR_MESSAGES);
    expect(ConstsIndex.LOG_MESSAGES).toBe(LOG_MESSAGES);
  });
});
