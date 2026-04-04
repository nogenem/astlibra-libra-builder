let allItems = [];
let originalAllItems = [];
let desiredStatKeys = new Set();
let desiredStatKeysForTesting = new Set([
  "Attack Power|epic",
  "Magical Power|epic",
  "Weight Reduction|epic",
  "Coins Earned|epic",
  "Experience Earned|epic",
  "Max ST|epic",
  "Attack Power|good",
  "Magical Power|good",
  "Weight Reduction|good",
  "Coins Earned|good",
  "Experience Earned|good",
  "Attack Power|normal",
  "Magical Power|normal",
  "Weight Reduction|normal",
  "Coins Earned|normal",
  "Experience Earned|normal",
  "Max ST|normal",
  "Max ST|good",
]);
let currentSortOrder = "desc";

let MAX_ITEMS_LEFT = 5;
let MAX_ITEMS_RIGHT = 5;
let BALANCE_THRESHOLD = 1.0; // 1.0 = perfect, 0.9 = 90%
let MAX_FILLERS = 30; // Representatives of "weight" after filtering
let MAX_BUILDS_RETURNED = 50;
