// Import shared functions from index.utils.js
importScripts("index.utils.js");

// Configuration (will be received from main thread)
let MAX_ITEMS_LEFT = 5;
let MAX_ITEMS_RIGHT = 5;
let BALANCE_THRESHOLD = 1.0;
let MAX_FILLERS = 10;
let MAX_BUILDS_RETURNED = 50;

function getTierScore(tier) {
  switch (tier) {
    case "epic":
      return 4;
    case "good":
      return 2;
    default:
      return 1;
  }
}

function calculateRealScore(items) {
  const statSet = new Set();
  items.forEach((item) => {
    item.stats.forEach((stat) => {
      statSet.add(stat.name + "|" + stat.tier);
    });
  });
  let realScore = 0;
  statSet.forEach((statKey) => {
    const tier = statKey.split("|")[1];
    realScore += getTierScore(tier);
  });
  return realScore;
}

function solveWithInitial(
  id,
  pool,
  desired,
  order,
  initialMaskStr,
  initialCount,
  initialKarma,
  initialScore,
  initialItemsIndices,
  splitDepth,
) {
  console.log(
    `Worker ${id} starting with initial count ${initialCount}, karma ${initialKarma}, score ${initialScore}, mask ${initialMaskStr}`,
  );

  const initialMask = BigInt(initialMaskStr);

  const statsToIndex = new Map();
  desired.forEach((s, i) => statsToIndex.set(s.key.toLowerCase().trim(), i));

  const processed = pool
    .map((item) => {
      let mask = 0n;
      let score = 0;
      item.stats.forEach((s) => {
        const key = (s.name + "|" + s.tier).toLowerCase().trim();
        if (statsToIndex.has(key)) {
          mask |= 1n << BigInt(statsToIndex.get(key));
        }
        score += s.score;
      });
      return { ...item, mask, score };
    })
    .sort((a, b) => b.score - a.score);

  const desiredMask = (1n << BigInt(desired.length)) - 1n;
  const maxSlots = MAX_ITEMS_LEFT + MAX_ITEMS_RIGHT;

  const baseItems = processed.filter((i) => (i.mask & desiredMask) !== 0n);
  const fillers = processed.filter((i) => (i.mask & desiredMask) === 0n).slice(0, MAX_FILLERS);
  const searchPool = [...baseItems, ...fillers];

  const itemCount = searchPool.length;
  const karmaArr = new Uint32Array(searchPool.map((i) => i.karma));
  const maskArr = new BigUint64Array(searchPool.map((i) => i.mask));
  const scoreArr = new Uint32Array(searchPool.map((i) => i.score));

  const suffixMasks = new BigUint64Array(itemCount + 1);
  for (let i = itemCount - 1; i >= 0; i--) suffixMasks[i] = suffixMasks[i + 1] | maskArr[i];

  const results = [];
  const currentComboIndices = new Int32Array(maxSlots);

  // Set initial items
  for (let i = 0; i < initialItemsIndices.length; i++) {
    currentComboIndices[i] = initialItemsIndices[i];
  }

  function search(idx, count, currentMask, currentKarma, currentScore) {
    if ((currentMask & desiredMask) === desiredMask) {
      const items = [];
      for (let i = 0; i < count; i++) items.push(searchPool[currentComboIndices[i]]);

      const balanceResult = findBestBalance(items);
      if (balanceResult) {
        const realScore = calculateRealScore(items);
        results.push({ ...balanceResult, score: realScore, mask: currentMask });
        if (results.length > 1000) return;
      }
    }

    if (idx >= itemCount || count >= maxSlots) return;

    if ((currentMask | (suffixMasks[idx] & desiredMask)) !== desiredMask) return;

    currentComboIndices[count] = idx;
    search(idx + 1, count + 1, currentMask | maskArr[idx], currentKarma + karmaArr[idx], currentScore + scoreArr[idx]);

    search(idx + 1, count, currentMask, currentKarma, currentScore);
  }

  search(splitDepth, initialCount, initialMask, initialKarma, initialScore);

  console.log(`Worker ${id} found ${results.length} valid combinations`);
  const finalBuilds = results
    .sort((a, b) => (order === "asc" ? a.score - b.score : b.score - a.score))
    .slice(0, MAX_BUILDS_RETURNED);

  return finalBuilds;
}

// Message handler
self.onmessage = (event) => {
  const {
    config,
    pool,
    desired,
    order,
    id,
    initialMask,
    initialCount,
    initialKarma,
    initialScore,
    initialItemsIndices,
    splitDepth,
  } = event.data;

  // Update configuration if provided
  if (config) {
    MAX_ITEMS_LEFT = config.MAX_ITEMS_LEFT ?? MAX_ITEMS_LEFT;
    MAX_ITEMS_RIGHT = config.MAX_ITEMS_RIGHT ?? MAX_ITEMS_RIGHT;
    BALANCE_THRESHOLD = config.BALANCE_THRESHOLD ?? BALANCE_THRESHOLD;
    MAX_FILLERS = config.MAX_FILLERS ?? MAX_FILLERS;
    MAX_BUILDS_RETURNED = config.MAX_BUILDS_RETURNED ?? MAX_BUILDS_RETURNED;
  }

  try {
    const results = solveWithInitial(
      id,
      pool,
      desired,
      order,
      initialMask,
      initialCount,
      initialKarma,
      initialScore,
      initialItemsIndices,
      splitDepth,
    );
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
