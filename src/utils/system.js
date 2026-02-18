/**
 * @file src/utils/system.js
 * @description Wrapper for system-level process operations to facilitate testing and mocking.
 */

/**
 * Exits the process with the specified code.
 * @param {number} code
 */
export const exit = (code) => {
  process.exit(code);
};

/**
 * Registers a listener for a signal event.
 * @param {string} event
 * @param {(...args: any[]) => void} handler
 */
export const on = (event, handler) => {
  process.on(event, handler);
};
