function setOptimizerConfig() {
  const maxLeft = Number(document.getElementById("max-items-left").value);
  const maxRight = Number(document.getElementById("max-items-right").value);
  const balance = Number(document.getElementById("balance-threshold").value);
  const maxFillers = Number(document.getElementById("max-fillers").value);
  const maxBuilds = Number(document.getElementById("max-builds").value);
  const order = document.getElementById("sort-order").value;

  if (!Number.isNaN(maxLeft) && maxLeft > 0) MAX_ITEMS_LEFT = maxLeft;
  if (!Number.isNaN(maxRight) && maxRight > 0) MAX_ITEMS_RIGHT = maxRight;
  if (!Number.isNaN(balance)) BALANCE_THRESHOLD = Math.max(0, Math.min(1, balance));
  if (!Number.isNaN(maxFillers) && maxFillers > 0) MAX_FILLERS = maxFillers;
  if (!Number.isNaN(maxBuilds) && maxBuilds > 0) MAX_BUILDS_RETURNED = maxBuilds;

  currentSortOrder = order === "asc" ? "asc" : "desc";
}

function updateInputsFromConfig() {
  document.getElementById("max-items-left").value = MAX_ITEMS_LEFT;
  document.getElementById("max-items-right").value = MAX_ITEMS_RIGHT;
  document.getElementById("balance-threshold").value = BALANCE_THRESHOLD;
  document.getElementById("max-fillers").value = MAX_FILLERS;
  document.getElementById("max-builds").value = MAX_BUILDS_RETURNED;
  document.getElementById("sort-order").value = currentSortOrder;
}

function loadDefaultJson() {
  setStatus("Loading default items...", true);
  fetch("data/items.json")
    .then((res) => {
      if (!res.ok) throw new Error("Failed to load data/items.json");
      return res.json();
    })
    .then((data) => {
      finishLoad(data);
      setStatus("");
    })
    .catch((err) => {
      setStatus("");
      alert("Error loading default items: " + err.message);
    });
}

async function handleSaveFileUpload(file) {
  const { pans, ownedItems } = await parseSaveFile(file, originalAllItems);

  console.log("pans: ", pans, "originalAllItems: ", originalAllItems.length, "OwnedItems: ", ownedItems.length);

  MAX_ITEMS_RIGHT = Math.floor(pans / 2);
  MAX_ITEMS_LEFT = pans - MAX_ITEMS_RIGHT;

  updateInputsFromConfig();
  finishLoad(ownedItems, false);
}

function openSaveUploadModal() {
  document.getElementById("save-upload-modal").style.display = "flex";
}

function closeSaveUploadModal() {
  document.getElementById("save-upload-modal").style.display = "none";
}

function onSaveFileInputChange(evt) {
  const file = evt.target.files[0];
  if (!file) return;

  closeSaveUploadModal();
  handleSaveFileUpload(file);

  // Reset value so same file can be reselected if needed.
  evt.target.value = "";
}

function finishLoad(data, raw = true) {
  if (raw) {
    allItems = processRaw(data);
    originalAllItems = allItems.slice(); // Keep a copy of the original items for filtering based on owned items
  } else {
    allItems = data;
  }

  document.getElementById("item-count").innerHTML =
    `<strong>${allItems.length}/${originalAllItems.length}</strong> unique items loaded.`;
  buildStatSelector();
  if (isLocalhost() && desiredStatKeysForTesting.size > 0) {
    selectDesiredStats([...desiredStatKeysForTesting]);
  }
  document.getElementById("stat-section").style.display = "block";
  document.getElementById("find-btn").style.display = "inline-block";
  document.getElementById("results-section").style.display = "none";
  document.getElementById("results-list").innerHTML = "";
}

window.addEventListener("load", () => {
  updateInputsFromConfig();
  loadDefaultJson();

  const loadSaveBtn = document.getElementById("load-save-btn");
  const cancelSaveBtn = document.getElementById("cancel-save-upload");
  const confirmSaveBtn = document.getElementById("confirm-save-upload");
  const saveFileInput = document.getElementById("save-file-input");

  if (loadSaveBtn) loadSaveBtn.addEventListener("click", openSaveUploadModal);
  if (cancelSaveBtn) cancelSaveBtn.addEventListener("click", closeSaveUploadModal);
  if (confirmSaveBtn)
    confirmSaveBtn.addEventListener("click", () => {
      if (saveFileInput) saveFileInput.click();
    });
  if (saveFileInput) saveFileInput.addEventListener("change", onSaveFileInputChange);
});

function runOptimizer() {
  if (allItems.length === 0) {
    alert("Load items first.");
    return;
  }
  if (desiredStatKeys.size === 0) {
    alert("Select at least one desired stat.");
    return;
  }
  setStatus("Filtering items...", true);

  const desired = [...desiredStatKeys].map((k) => {
    const [name, tier] = k.split("|");
    return { name, tier, key: k };
  });

  setOptimizerConfig();
  clearResults();
  setStatus("Searching for optimal combinations...", true);

  const findBtn = document.getElementById("find-btn");
  const cancelContainer = document.getElementById("cancel-search-container");
  const cancelBtn = document.getElementById("cancel-search-btn");
  findBtn.disabled = true;

  let solvePromise = null;
  let cancelTimeout = null;

  setTimeout(() => {
    const solveStartTime = performance.now();
    solvePromise = solveAsync(allItems, desired, currentSortOrder, {
      onProgress: ({ workerId, results }) => {
        if (results && results.length > 0) {
          showResults(results, desired);
          setStatus(`Partial results from worker ${workerId} (best so far)...`, true);
        }
      },
    });

    // Show cancel button after 10 seconds
    cancelTimeout = setTimeout(() => {
      cancelContainer.style.display = "block";
    }, 10000);

    solvePromise
      .then((results) => {
        console.log(`Solver completed in ${(performance.now() - solveStartTime) / 1000}s`);

        clearTimeout(cancelTimeout);
        cancelContainer.style.display = "none";
        setStatus("");
        if (results.length === 0) {
          showNoResults("No balanced combinations found with the selected stats.");
          return;
        }
        showResults(results, desired);
      })
      .catch((error) => {
        console.log(`Solver completed in ${(performance.now() - solveStartTime) / 1000}s`);
        console.error("Error during solving:", error);

        clearTimeout(cancelTimeout);
        cancelContainer.style.display = "none";

        if (error.cancelled_by_user) {
          setStatus("Search cancelled - showing partial results", true);
        } else {
          setStatus("");
          showNoResults("Error: " + error.message);
        }
      })
      .finally(() => {
        findBtn.disabled = false;
      });
  }, 1000);

  // Cancel button event listener
  cancelBtn.onclick = () => {
    if (solvePromise && solvePromise.cancel) {
      solvePromise.cancel();
    }
  };
}
