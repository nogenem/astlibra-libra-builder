function getItemStatsScore(item) {
  let score = 0;
  for (const stat of item.stats) {
    const key = getStatKey(stat);
    score += stat.score * (desiredStatKeys.has(key) ? 10 : 1);
  }
  return score;
}

function getStatKey(stat) {
  return stat.name + "|" + stat.tier;
}

function parseStat(s) {
  if (!s || !s.trim()) return null;
  s = s.trim();
  const epicM = s.match(/^(.+?)\s*\(EPIC\)\s*$/i);
  if (epicM) return { name: epicM[1].trim(), tier: "epic", score: 4 };
  const goodM = s.match(/^(.+?)\s*\(GOOD\)\s*$/i);
  if (goodM) return { name: goodM[1].trim(), tier: "good", score: 2 };
  if (s.length < 2) return null;
  return { name: s, tier: "normal", score: 1 };
}

function processRaw(data) {
  if (!Array.isArray(data)) throw new Error("JSON must be an array.");
  const seen = new Set();
  const items = [];
  for (const raw of data) {
    const karma = parseInt(raw.karma) || 0;
    if (karma <= 0) continue;
    const stats = [raw.stats1, raw.stats2, raw.stats3].map(parseStat).filter(Boolean);
    if (stats.length === 0) continue;
    const key = `${raw.name}|${karma}|${stats
      .map((s) => s.name + s.tier)
      .sort()
      .join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: raw.id,
      name: raw.name || "???",
      karma,
      stats,
      icon: raw.icon || "",
    });
  }
  return items;
}

function* getKCombs(array, k) {
  for (let i = 0; i < array.length; i++) {
    if (k === 1) yield [array[i]];
    else {
      for (let next of getKCombs(array.slice(i + 1), k - 1)) {
        yield [array[i], ...next];
      }
    }
  }
}

function* cartesianProduct(arrays) {
  const [head, ...tail] = arrays;
  const remainder = tail.length > 0 ? cartesianProduct(tail) : [[]];
  for (let r of remainder) {
    for (let h of head) {
      yield [h, ...r];
    }
  }
}

function* generateAllLimitedCombinations(map, limit = 10000) {
  const keys = Array.from(map.keys());
  const k = Math.min(keys.length, limit);
  for (const keyCombo of getKCombs(keys, k)) {
    const arraysToCombine = keyCombo.map((key) => map.get(key));
    yield* cartesianProduct(arraysToCombine);
  }
}

function getBalanceProportion(karmaL, karmaR) {
  if (karmaL === 0 && karmaR === 0) return 1;
  if (karmaL === 0 || karmaR === 0) return 0;
  return Math.min(karmaL, karmaR) / Math.max(karmaL, karmaR);
}

// New functions from combinations.claude.js

function buildMap(items, desiredStats) {
  const statsMap = new Map();

  // Desired stats receive the first bits (0, 1, 2, ...)
  desiredStats.forEach((s, i) => statsMap.set(s, 1n << BigInt(i)));

  // Other stats receive subsequent bits
  let nextBit = desiredStats.length;
  for (const item of items) {
    for (const s of item.stats.map(getStatKey)) {
      if (!statsMap.has(s)) {
        statsMap.set(s, 1n << BigInt(nextBit++));
      }
    }
  }

  return statsMap;
}

// Returns BigInt: OR of all bits of the item's stats
function calculateMask(item, statsMap) {
  return item.stats.map(getStatKey).reduce((acc, s) => acc | (statsMap.get(s) ?? 0n), 0n);
}

// Pre-filtering
function preFiltering(items, statsMap, desiredMask) {
  const base = [];
  const fillers = [];

  for (const item of items) {
    const mask = calculateMask(item, statsMap);
    item._mask = mask; // cache as BigInt

    if ((mask & desiredMask) !== 0n) {
      base.push(item); // has at least 1 desired stat
    } else {
      fillers.push(item); // only serves as weight
    }
  }

  // Dominance: groups by mask, keeps up to 3 karma representatives per group
  const groups = new Map();
  for (const item of base) {
    const key = item._mask.toString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const uniqueBase = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.karma - b.karma);
    const representatives = new Set([group[0], group[group.length - 1], group[Math.floor(group.length / 2)]]);
    representatives.forEach((item) => uniqueBase.push(item));
  }

  // Fillers: takes karma representatives (light, heavy, medium)
  fillers.sort((a, b) => a.karma - b.karma);
  const n = Math.max(1, Math.floor(MAX_FILLERS / 3));
  const fillersSet = new Set([
    ...fillers.slice(0, n),
    ...fillers.slice(-n),
    ...fillers.slice(Math.max(0, Math.floor(fillers.length / 2) - 1), Math.floor(fillers.length / 2) - 1 + n),
  ]);

  return { base: uniqueBase, fillers: [...fillersSet] };
}

// Phase 1 — Bases that cover the desired stats
function generateBases(baseItems, desiredMask) {
  const bases = [];
  const maxBaseSize = MAX_ITEMS_LEFT + MAX_ITEMS_RIGHT - 1;

  function search(index, combo, currentMask, karma) {
    // Checks if ALL desired bits are present
    if ((currentMask & desiredMask) === desiredMask) {
      bases.push({ items: [...combo], karma, mask: currentMask });
    }

    if (index >= baseItems.length || combo.length >= maxBaseSize) return;

    const item = baseItems[index];
    search(index + 1, combo, currentMask, karma); // skip
    combo.push(item);
    search(index + 1, combo, currentMask | item._mask, karma + item.karma); // include
    combo.pop();
  }

  search(0, [], 0n, 0);
  return bases;
}

// Calculate score using the stat scores
function calculateScore(combination) {
  let score = 0;
  for (const item of combination) {
    for (const s of item.stats) {
      score += s.score;
    }
  }
  return score;
}

// Phase 2 — Balances each base with fillers, adapted to return the expected format
function balanceWithFillers(bases, fillerItems) {
  const maxTotal = MAX_ITEMS_LEFT + MAX_ITEMS_RIGHT;
  const results = [];
  const seen = new Set();

  // Distributes items between Left and Right trying to balance
  function tryDistribute(allItems) {
    const remainingKarma = new Array(allItems.length + 1).fill(0);
    for (let i = allItems.length - 1; i >= 0; i--) {
      remainingKarma[i] = remainingKarma[i + 1] + allItems[i].karma;
    }

    function distribute(index, leftItems, rightItems, leftKarma, rightKarma) {
      if (index === allItems.length) {
        if (leftItems.length === 0 || rightItems.length === 0) return;

        const balance = getBalanceProportion(leftKarma, rightKarma);
        if (balance < BALANCE_THRESHOLD) return;

        const key = [
          leftItems
            .map((i) => i.id)
            .sort()
            .join(","),
          rightItems
            .map((i) => i.id)
            .sort()
            .join(","),
        ]
          .sort()
          .join("|");
        if (seen.has(key)) return;
        seen.add(key);

        results.push({
          left: leftItems,
          right: rightItems,
          karmaL: leftKarma,
          karmaR: rightKarma,
          balance: balance,
          score: calculateScore([...leftItems, ...rightItems]),
        });
        return;
      }

      const largerSide = Math.max(leftKarma, rightKarma);
      const smallerSide = Math.min(leftKarma, rightKarma);
      if (largerSide > 0 && (smallerSide + remainingKarma[index]) / largerSide < 0.9) return;

      const item = allItems[index];
      if (leftItems.length < MAX_ITEMS_LEFT)
        distribute(index + 1, [...leftItems, item], rightItems, leftKarma + item.karma, rightKarma);
      if (rightItems.length < MAX_ITEMS_RIGHT)
        distribute(index + 1, leftItems, [...rightItems, item], leftKarma, rightKarma + item.karma);
    }

    distribute(0, [], [], 0, 0);
  }

  // Searches for filler combinations to complete each base
  const searchFillers = (base, index, chosenFillers, fillerKarma) => {
    const remainingSlots = maxTotal - base.items.length;
    tryDistribute([...base.items, ...chosenFillers]);

    if (index >= fillerItems.length || chosenFillers.length >= remainingSlots) return;

    const filler = fillerItems[index];
    searchFillers(base, index + 1, chosenFillers, fillerKarma);
    chosenFillers.push(filler);
    searchFillers(base, index + 1, chosenFillers, fillerKarma + filler.karma);
    chosenFillers.pop();
  };

  for (const base of bases) {
    if (maxTotal - base.items.length === 0) continue;
    searchFillers(base, 0, [], 0);
  }

  console.log(`Generated ${results.length} balanced combinations before sorting.`);
  return results.sort((a, b) => b.balance - a.balance || b.score - a.score);
}

function solve(pool, desired, order = "desc") {
  // Use desired keys directly as desiredStats
  const desiredStats = desired.map((d) => d.key);

  const statsMap = buildMap(pool, desiredStats);
  const desiredMask = desiredStats.reduce((acc, s) => acc | (statsMap.get(s) ?? 0n), 0n);

  const { base, fillers } = preFiltering(pool, statsMap, desiredMask);

  const bases = generateBases(base, desiredMask);

  let builds = balanceWithFillers(bases, fillers);

  if (order === "asc") {
    builds = builds.slice().reverse();
  }

  return builds.slice(0, MAX_BUILDS_RETURNED);
}

/**
 * Filters the list of items based on the data from the Astlibra save file.
 * Return the amount of pans that the user has and the list of owned items with their stats and karma.
 */
async function parseSaveFile(saveFile, allItems) {
  // Base addresses extracted from reverse engineering the save
  const BASE_ADDR = 0x12cc;
  const UNLOCK_ADDR = 0x220c;
  const PANS_ADDR = 0x07;

  // Converts the user's file into an ArrayBuffer for byte reading
  const buffer = await saveFile.arrayBuffer();

  // DataView allows us to read integers at specific positions (offsets) in the buffer
  const view = new DataView(buffer);

  console.log("Pans: ", view.getInt32(BASE_ADDR + 0x07 * 4, true));

  const pans = view.getInt32(BASE_ADDR + PANS_ADDR * 4, true);

  // Filters the JSON array
  const ownedItems = allItems.filter((item) => {
    const id = parseInt(item.id, 10);

    // Calculating the offsets according to the logic from the Python repo:
    // Count = base_addr + (id * 4) -> Size of 4 bytes
    // Unlock = unlock_addr + id    -> Size of 1 byte
    const countOffset = BASE_ADDR + id * 4;
    const unlockOffset = UNLOCK_ADDR + id;

    // Security check: ensures we don't try to read beyond the end of the file
    if (countOffset + 4 > view.byteLength || unlockOffset + 1 > view.byteLength) {
      return false;
    }

    // Reading the quantity (4 bytes).
    // The 'true' at the end indicates reading in "Little Endian", standard in PC game saves.
    const count = view.getInt32(countOffset, true);

    // Reading the unlock status (1 byte). Uint8 = Unsigned Integer of 8 bits.
    const unlock = view.getUint8(unlockOffset);

    console.log(
      `Item ID: ${id}, Item Name: ${item.name}, Count: ${count}, Unlock: ${unlock}, Count Offset: ${countOffset}, Unlock Offset: ${unlockOffset}`,
    );

    // Returns true if the player owns the item, including it in the new array
    return unlock === 1 && count > 0;
  });

  return { pans, ownedItems };
}
