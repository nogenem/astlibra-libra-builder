// Import shared functions from index.utils.js
importScripts("index.utils.js");

// Configuration (will be received from main thread)
let MAX_ITEMS_LEFT = 5;
let MAX_ITEMS_RIGHT = 5;
let BALANCE_THRESHOLD = 1.0;
let MAX_FILLERS = 10;
let MAX_BUILDS_RETURNED = 50;

// Message handler
self.onmessage = (event) => {
  const { config, pool, desired, order, id } = event.data;

  // Update configuration if provided
  if (config) {
    MAX_ITEMS_LEFT = config.MAX_ITEMS_LEFT ?? MAX_ITEMS_LEFT;
    MAX_ITEMS_RIGHT = config.MAX_ITEMS_RIGHT ?? MAX_ITEMS_RIGHT;
    BALANCE_THRESHOLD = config.BALANCE_THRESHOLD ?? BALANCE_THRESHOLD;
    MAX_FILLERS = config.MAX_FILLERS ?? MAX_FILLERS;
    MAX_BUILDS_RETURNED = config.MAX_BUILDS_RETURNED ?? MAX_BUILDS_RETURNED;
  }

  try {
    const results = solve(pool, desired, order);
    self.postMessage({
      id,
      success: true,
      results,
    });
  } catch (error) {
    self.postMessage({
      id,
      success: false,
      error: error.message,
    });
  }
};
