let allItems = [];
let originalAllItems = [];
let desiredStatKeys = new Set();
let currentSortOrder = "desc";

let MAX_ITEMS_LEFT = 5;
let MAX_ITEMS_RIGHT = 5;
let BALANCE_THRESHOLD = 1.0; // 1.0 = perfect, 0.9 = 90%
let MAX_FILLERS = 10; // Representatives of "weight" after filtering
let MAX_BUILDS_RETURNED = 50;
