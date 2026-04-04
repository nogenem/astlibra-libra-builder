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

function findBestBalance(items) {
  const n = items.length;
  if (n === 0) return null;

  let best = null;
  // For small sets, bitmask is ultra fast
  const limit = 1 << n;
  for (let i = 0; i < limit; i++) {
    let left = [],
      right = [];
    let kL = 0,
      kR = 0;

    for (let j = 0; j < n; j++) {
      if ((i >> j) & 1) {
        left.push(items[j]);
        kL += items[j].karma;
      } else {
        right.push(items[j]);
        kR += items[j].karma;
      }
    }

    // Validates if the division respects the current build slots
    if (left.length <= MAX_ITEMS_LEFT && right.length <= MAX_ITEMS_RIGHT && left.length + right.length === n) {
      const balance = kL === 0 && kR === 0 ? 1 : Math.min(kL, kR) / Math.max(kL, kR);
      if (balance >= BALANCE_THRESHOLD) {
        if (!best || balance > best.balance) {
          best = { left, right, karmaL: kL, karmaR: kR, balance };
        }
      }
    }
  }
  return best;
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

// ============ Web Worker Support ============

let solveWorkerResolvers = new Map();
let messageIdCounter = 0;

/**
 * Solves using multiple Web Workers to parallelize the search
 * Returns a Promise that resolves with the results
 */
function solveAsync(pool, desired, order = "desc") {
  const numWorkers = Math.max(4, Math.min(navigator.hardwareConcurrency || 4, 8));

  // Compute searchPool in main thread to ensure consistency
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
  const baseItems = processed.filter((i) => (i.mask & desiredMask) !== 0n);
  const fillers = processed.filter((i) => (i.mask & desiredMask) === 0n).slice(0, MAX_FILLERS);
  const searchPool = [...baseItems, ...fillers];

  const splitDepth = Math.min(3, searchPool.length);
  let actualSplitDepth = splitDepth;
  while (1 << actualSplitDepth > numWorkers && actualSplitDepth > 0) actualSplitDepth--;
  const totalInitial = 1 << actualSplitDepth;

  console.log({ poolLen: pool.length, searchPoolLen: searchPool.length, numWorkers, totalInitial, actualSplitDepth });

  const workerPromises = [];
  const workers = [];
  const localIds = [];

  for (let initCode = 0; initCode < Math.min(totalInitial, numWorkers); initCode++) {
    const initialItemsIndices = [];
    let initialMask = 0n;
    let initialCount = 0;
    let initialKarma = 0;
    let initialScore = 0;

    for (let j = 0; j < actualSplitDepth; j++) {
      if (initCode & (1 << j)) {
        const item = searchPool[j];
        initialItemsIndices.push(j);
        initialMask |= item.mask;
        initialCount++;
        initialKarma += item.karma;
        initialScore += item.score;
      }
    }

    const promise = new Promise((resolve, reject) => {
      const worker = new Worker("solve.worker.js");
      workers.push(worker);
      const id = ++messageIdCounter;
      localIds.push(id);

      solveWorkerResolvers.set(id, { resolve, reject });

      const config = {
        MAX_ITEMS_LEFT,
        MAX_ITEMS_RIGHT,
        BALANCE_THRESHOLD,
        MAX_FILLERS,
        MAX_BUILDS_RETURNED,
      };

      try {
        worker.postMessage({
          config,
          pool,
          desired,
          order,
          id,
          initialMask: initialMask.toString(),
          initialCount,
          initialKarma,
          initialScore,
          initialItemsIndices,
          splitDepth: actualSplitDepth,
        });
      } catch (e) {
        solveWorkerResolvers.delete(id);
        reject(e);
      }

      worker.onmessage = (event) => {
        const { id: msgId, success, results, error } = event.data;
        const resolver = solveWorkerResolvers.get(msgId);
        if (resolver) {
          if (success) {
            resolver.resolve(results);
          } else {
            resolver.reject(new Error(error || "Worker error"));
          }
          solveWorkerResolvers.delete(msgId);
        }
      };

      worker.onerror = (error) => {
        console.error("Worker error:", error);
        reject(error);
      };
    });

    workerPromises.push(promise);
  }

  function terminateWorkers(workerList) {
    workerList.forEach((w) => {
      try {
        w.terminate();
      } catch (e) {
        console.warn("Error terminating worker:", e.message);
      }
    });
  }

  const masterPromise = Promise.all(workerPromises)
    .then((allResults) => {
      const combinedResults = allResults.flat();
      const finalBuilds = combinedResults
        .sort((a, b) => (order === "asc" ? a.score - b.score : b.score - a.score))
        .slice(0, MAX_BUILDS_RETURNED);

      terminateWorkers(workers);

      return finalBuilds;
    })
    .catch((error) => {
      terminateWorkers(workers);
      throw error;
    });

  masterPromise.cancel = () => {
    terminateWorkers(workers);
    for (const id of localIds) {
      const resolver = solveWorkerResolvers.get(id);
      if (resolver) {
        resolver.reject(new Error("Search cancelled by user"));
        solveWorkerResolvers.delete(id);
      }
    }
  };

  return masterPromise;
}
