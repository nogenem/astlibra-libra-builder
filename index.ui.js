function buildStatSelector() {
  const byTier = { epic: new Map(), good: new Map(), normal: new Map() };
  for (const item of allItems) {
    for (const stat of item.stats) {
      const map = byTier[stat.tier];
      const key = stat.name + "|" + stat.tier;
      if (!map.has(key)) map.set(key, { ...stat, count: 0 });
      map.get(key).count++;
    }
  }

  for (const tier of ["epic", "good", "normal"]) {
    const container = document.getElementById("stats-" + tier);
    container.innerHTML = "";
    const sorted = [...byTier[tier].values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const stat of sorted) {
      const key = stat.name + "|" + stat.tier;
      const chip = document.createElement("label");
      chip.className = `stat-chip ${tier}`;
      chip.dataset.key = key;
      chip.innerHTML = `<input type="checkbox" value="${key}"> ${esc(stat.name)} <span style="opacity:0.5;font-size:0.75em">${stat.count}</span>`;
      chip.querySelector("input").addEventListener("change", onStatToggle);
      container.appendChild(chip);
    }
    document.getElementById("stat-tier-" + tier).style.display = sorted.length ? "block" : "none";
  }

  desiredStatKeys.clear();
  updateSelectedCount();
}

function onStatToggle(e) {
  const key = e.target.value;
  const chip = e.target.closest(".stat-chip");
  if (e.target.checked) {
    desiredStatKeys.add(key);
    chip.classList.add("checked");
  } else {
    desiredStatKeys.delete(key);
    chip.classList.remove("checked");
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  document.getElementById("selected-count").innerHTML = `<strong>${desiredStatKeys.size}</strong> stat${
    desiredStatKeys.size !== 1 ? "s" : ""
  } selected.`;
}

function selectAll() {
  document.querySelectorAll(".stat-chip input").forEach((cb) => {
    cb.checked = true;
    cb.closest(".stat-chip").classList.add("checked");
    desiredStatKeys.add(cb.value);
  });
  updateSelectedCount();
}

function clearAll() {
  document.querySelectorAll(".stat-chip input").forEach((cb) => {
    cb.checked = false;
    cb.closest(".stat-chip").classList.remove("checked");
  });
  desiredStatKeys.clear();
  updateSelectedCount();
}

function selectDesiredStats(keys) {
  desiredStatKeys.clear();
  document.querySelectorAll(".stat-chip input").forEach((cb) => {
    const shouldSelect = keys.includes(cb.value);
    cb.checked = shouldSelect;
    const chip = cb.closest(".stat-chip");
    if (shouldSelect) {
      desiredStatKeys.add(cb.value);
      chip.classList.add("checked");
    } else {
      chip.classList.remove("checked");
    }
  });
  updateSelectedCount();
}

function showResults(results, desired) {
  const section = document.getElementById("results-section");
  const list = document.getElementById("results-list");
  const countEl = document.getElementById("results-count");
  section.style.display = "block";
  countEl.innerHTML = `(${results.length})`;
  if (results.length === 0) {
    list.innerHTML =
      '<div class="no-results">No balanced combinations found.<br>Try selecting fewer or different stats.</div>';
    return;
  }
  const desiredSet = new Set(desired.map((d) => d.key));
  list.innerHTML = results
    .map((r, idx) => {
      const balancePct = Math.round(r.balance * 100);
      return `
    <div class="result-card ${idx === 0 ? "top" : ""}">
      <div class="result-rank">
        <span class="rank-label">#${idx + 1}</span>
      </div>
      <div class="result-body">
        <div class="result-side left">
          <div class="side-label">⬅ Left Side — ${r.karmaL} karma</div>
          ${renderSide(r.left, desiredSet)}
        </div>
        <div class="balance-center">
          <div class="scale-icon">⚖</div>
          <div class="karma-value">${balancePct}%</div>
          <div class="karma-label">BALANCE</div>
          <div class="score-value">Score: ${r.score}</div>
        </div>
        <div class="result-side right">
          <div class="side-label">Right Side ➡ — ${r.karmaR} karma</div>
          ${renderSide(r.right, desiredSet)}
        </div>
      </div>
    </div>`;
    })
    .join("");
}

function renderSide(items, desiredSet) {
  return items
    .map(
      (item) => `
        <div class="result-item">
            <div class="item-info-block">
                <div class="item-name">${esc(item.name)}</div>
                <div>
                <span class="item-karma-tag">Karma ${item.karma}</span>
                </div>
                <div class="item-stats">
                ${item.stats
                  .map((s) => {
                    const key = s.name + "|" + s.tier;
                    return `<span class="stat-tag ${s.tier}${desiredSet.has(key) ? " desired" : ""}">${esc(s.name)}</span>`;
                  })
                  .join("")}
                </div>
            </div>
            <div class="item-icon-block">
                <img src="data/icons/${esc(item.icon)}" alt="${esc(item.name)}" />
            </div>
        </div>`,
    )
    .join("");
}

function showNoResults(msg) {
  document.getElementById("results-section").style.display = "block";
  document.getElementById("results-list").innerHTML = `<div class="no-results">${esc(msg)}</div>`;
  document.getElementById("results-count").innerHTML = "(0)";
}

function clearResults() {
  document.getElementById("results-list").innerHTML = "";
  document.getElementById("results-section").style.display = "none";
  document.getElementById("results-count").innerHTML = "(0)";
}

function setStatus(msg, show = false) {
  const el = document.getElementById("status-bar");
  el.style.display = show || msg ? "block" : "none";
  el.textContent = msg;
}

function esc(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
