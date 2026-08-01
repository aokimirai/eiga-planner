const BUFFER_MIN = 10; // extra minutes assumed for leaving a screen / getting settled at the next one
const MAX_SELECTED = 3;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const state = {
  theaters: [],
  theaterById: new Map(),
  screenings: [],
  travel: null,
  distanceCache: null, // Map<station, Map<station, minutes>>
  dates: [],
  filters: { date: null, title: "", areas: new Set(), theaterId: "" },
  selectedTitles: [],
};

async function loadData() {
  const [theaters, screeningsPayload, travel] = await Promise.all([
    fetch("data/theaters.json").then((r) => r.json()),
    fetch("data/screenings.json").then((r) => r.json()),
    fetch("data/travel.json").then((r) => r.json()),
  ]);
  state.theaters = theaters;
  state.theaterById = new Map(theaters.map((t) => [t.id, t]));
  state.screenings = screeningsPayload.screenings;
  state.travel = travel;
  state.distanceCache = buildAllPairsDistances(travel.edges);
  state.dates = [...new Set(state.screenings.map((s) => s.date))].sort();
  state.filters.date = state.dates[0] || null;

  document.getElementById("data-note").textContent = screeningsPayload.generatedAt
    ? `上映情報 最終取得: ${new Date(screeningsPayload.generatedAt).toLocaleString("ja-JP")}`
    : "";
}

// ---------- travel time graph (Dijkstra over hand-curated station edges) ----------

function buildAllPairsDistances(edges) {
  const adjacency = new Map();
  const addEdge = (a, b, minutes) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a).push([b, minutes]);
  };
  for (const [a, b, minutes] of edges) {
    addEdge(a, b, minutes);
    addEdge(b, a, minutes);
  }

  const stations = [...adjacency.keys()];
  const allDistances = new Map();
  for (const start of stations) {
    const dist = new Map(stations.map((s) => [s, Infinity]));
    dist.set(start, 0);
    const visited = new Set();
    while (visited.size < stations.length) {
      let current = null;
      let currentDist = Infinity;
      for (const [station, d] of dist) {
        if (!visited.has(station) && d < currentDist) {
          current = station;
          currentDist = d;
        }
      }
      if (current === null) break;
      visited.add(current);
      for (const [neighbor, weight] of adjacency.get(current) || []) {
        const candidate = currentDist + weight;
        if (candidate < dist.get(neighbor)) dist.set(neighbor, candidate);
      }
    }
    allDistances.set(start, dist);
  }
  return allDistances;
}

function travelMinutes(theaterIdA, theaterIdB) {
  if (theaterIdA === theaterIdB) return 0;
  const stationInfo = state.travel.theaterStations;
  const a = stationInfo[theaterIdA];
  const b = stationInfo[theaterIdB];
  if (!a || !b) return null;
  if (a.station === b.station) return a.walkMin + b.walkMin;
  const dist = state.distanceCache.get(a.station)?.get(b.station);
  if (!Number.isFinite(dist)) return null;
  return a.walkMin + dist + b.walkMin;
}

// ---------- filtering & rendering the schedule list ----------

function filteredScreenings() {
  const { date, title, areas, theaterId } = state.filters;
  const q = title.trim();
  return state.screenings.filter((s) => {
    if (date && s.date !== date) return false;
    if (q && !s.title.includes(q)) return false;
    if (theaterId && s.theaterId !== theaterId) return false;
    if (areas.size > 0) {
      const theater = state.theaterById.get(s.theaterId);
      if (!theater || !areas.has(theater.area)) return false;
    }
    return true;
  });
}

function groupByTitle(screenings) {
  const map = new Map();
  for (const s of screenings) {
    if (!map.has(s.title)) map.set(s.title, []);
    map.get(s.title).push(s);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"));
}

function formatDateLabel(dateStr) {
  const y = +dateStr.slice(0, 4);
  const m = +dateStr.slice(4, 6);
  const d = +dateStr.slice(6, 8);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}（${weekday}）`;
}

function renderFilters() {
  const dateSelect = document.getElementById("date-select");
  dateSelect.innerHTML = state.dates
    .map((d) => `<option value="${d}">${formatDateLabel(d)}</option>`)
    .join("");
  dateSelect.value = state.filters.date;

  const areas = [...new Set(state.theaters.map((t) => t.area))].sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
  const areaPanel = document.getElementById("area-panel");
  areaPanel.innerHTML =
    `<div class="multiselect-actions">
      <button type="button" id="area-select-all">すべて選択</button>
      <button type="button" id="area-select-none">選択解除</button>
    </div>` +
    areas
      .map(
        (a) =>
          `<label class="multiselect-option"><input type="checkbox" value="${a}" ${state.filters.areas.has(a) ? "checked" : ""} />${a}</label>`,
      )
      .join("");
  updateAreaToggleLabel();

  const theaterSelect = document.getElementById("theater-select");
  const theatersSorted = [...state.theaters].sort((a, b) =>
    a.area.localeCompare(b.area, "ja") || a.name.localeCompare(b.name, "ja"),
  );
  theaterSelect.innerHTML =
    `<option value="">すべて</option>` +
    theatersSorted
      .map((t) => `<option value="${t.id}">${t.area} / ${t.name}</option>`)
      .join("");
}

function renderMovieList() {
  const screenings = filteredScreenings();
  const groups = groupByTitle(screenings);
  document.getElementById("movie-count").textContent = `${groups.length} 作品 / ${screenings.length} 上映`;

  const container = document.getElementById("movie-list");
  if (groups.length === 0) {
    container.innerHTML = `<p class="hint">条件に一致する上映がありません。</p>`;
    return;
  }

  container.innerHTML = groups
    .map(([title, items]) => {
      const byTheater = new Map();
      for (const s of items) {
        if (!byTheater.has(s.theaterId)) byTheater.set(s.theaterId, []);
        byTheater.get(s.theaterId).push(s);
      }
      const runtime = items[0].runtimeMin;
      const selected = state.selectedTitles.includes(title);
      const theaterBlocks = [...byTheater.entries()]
        .map(([theaterId, list]) => {
          const theater = state.theaterById.get(theaterId);
          list.sort((a, b) => a.timestamp - b.timestamp);
          const chips = list
            .map(
              (s) =>
                `<span class="time-chip">${s.time}${s.typeLabel ? `<span class="type-label">${s.typeLabel}</span>` : ""}</span>`,
            )
            .join("");
          return `<div class="theater-block">
            <span class="theater-name">${theater ? theater.name : theaterId}</span><span class="theater-area">${theater ? theater.area : ""}</span>
            <div class="time-chips">${chips}</div>
          </div>`;
        })
        .join("");

      return `<article class="movie-card" data-title="${escapeAttr(title)}">
        <div class="movie-card-head">
          <div>
            <h3>${title}</h3>
            <div class="movie-meta">${runtime ? `上映時間 ${runtime}分` : ""}・上映館数 ${byTheater.size}</div>
          </div>
          <button class="small toggle-plan" data-title="${escapeAttr(title)}">${selected ? "プランから外す" : "プランに追加"}</button>
        </div>
        ${theaterBlocks}
      </article>`;
    })
    .join("");

  container.querySelectorAll(".toggle-plan").forEach((btn) => {
    btn.addEventListener("click", () => toggleSelected(btn.dataset.title));
  });
}

function escapeAttr(s) {
  return s.replace(/"/g, "&quot;");
}

// ---------- plan selection ----------

function toggleSelected(title) {
  const idx = state.selectedTitles.indexOf(title);
  if (idx >= 0) {
    state.selectedTitles.splice(idx, 1);
  } else {
    if (state.selectedTitles.length >= MAX_SELECTED) {
      alert(`プランに追加できるのは最大${MAX_SELECTED}本までです。`);
      return;
    }
    state.selectedTitles.push(title);
  }
  renderSelectedChips();
  renderMovieList();
}

function renderSelectedChips() {
  const el = document.getElementById("selected-movies");
  if (state.selectedTitles.length === 0) {
    el.innerHTML = `<span class="hint">まだ映画が選択されていません。</span>`;
  } else {
    el.innerHTML = state.selectedTitles
      .map(
        (t) =>
          `<span class="selected-chip">${t}<button data-title="${escapeAttr(t)}" aria-label="削除">×</button></span>`,
      )
      .join("");
    el.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => toggleSelected(btn.dataset.title));
    });
  }
  const planButton = document.getElementById("plan-button");
  const clearButton = document.getElementById("plan-clear");
  planButton.disabled = state.selectedTitles.length === 0;
  clearButton.disabled = state.selectedTitles.length === 0;
}

// ---------- best-plan recommendation ----------

function optionsForTitle(title, date) {
  return state.screenings
    .filter((s) => s.title === title && s.date === date && s.runtimeMin)
    .map((s) => ({ ...s, theater: state.theaterById.get(s.theaterId) }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  arr.forEach((item, i) => {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const perm of permutations(rest)) result.push([item, ...perm]);
  });
  return result;
}

function buildPlans(titles, date) {
  const optionSets = titles.map((t) => optionsForTitle(t, date));
  const missing = titles.filter((t, i) => optionSets[i].length === 0);
  if (missing.length) {
    return { plans: [], missing };
  }

  if (titles.length === 1) {
    return {
      plans: optionSets[0].map((opt) => ({
        steps: [opt],
        totalTravelMin: 0,
        totalWaitMin: 0,
        spanMin: opt.runtimeMin,
      })),
      missing: [],
    };
  }

  const orders = permutations(titles.map((_, i) => i));
  const plansByKey = new Map();

  for (const order of orders) {
    walk(order, 0, []);
  }

  function walk(order, depth, chosen) {
    if (depth === order.length) {
      const steps = [...chosen].sort((a, b) => a.timestamp - b.timestamp);
      const key = steps.map((s) => `${s.movieIndex}:${s.theaterId}:${s.timestamp}`).join("|");
      if (plansByKey.has(key)) return;

      let totalTravelMin = 0;
      let totalWaitMin = 0;
      for (let i = 0; i < steps.length - 1; i++) {
        const cur = steps[i];
        const next = steps[i + 1];
        const travel = travelMinutes(cur.theaterId, next.theaterId);
        const curEnd = cur.timestamp + cur.runtimeMin * 60;
        const gapMin = (next.timestamp - curEnd) / 60;
        totalTravelMin += travel || 0;
        totalWaitMin += gapMin - (travel || 0);
      }
      const spanMin =
        (steps[steps.length - 1].timestamp +
          steps[steps.length - 1].runtimeMin * 60 -
          steps[0].timestamp) /
        60;
      plansByKey.set(key, { steps, totalTravelMin, totalWaitMin, spanMin });
      return;
    }

    const movieIndex = order[depth];
    for (const opt of optionSets[movieIndex]) {
      if (chosen.length > 0) {
        const prev = chosen[chosen.length - 1];
        const travel = travelMinutes(prev.theaterId, opt.theaterId);
        if (travel === null) continue;
        const prevEnd = prev.timestamp + prev.runtimeMin * 60;
        const requiredStart = prevEnd + (travel + BUFFER_MIN) * 60;
        if (opt.timestamp < requiredStart) continue;
      }
      chosen.push({ ...opt, movieIndex });
      walk(order, depth + 1, chosen);
      chosen.pop();
    }
  }

  const plans = [...plansByKey.values()].sort(
    (a, b) => a.spanMin - b.spanMin || a.totalTravelMin - b.totalTravelMin,
  );
  return { plans, missing: [] };
}

function renderPlans() {
  const resultsEl = document.getElementById("plan-results");
  if (state.selectedTitles.length === 0) {
    resultsEl.innerHTML = "";
    return;
  }
  const date = state.filters.date;
  const { plans, missing } = buildPlans(state.selectedTitles, date);

  if (missing.length) {
    resultsEl.innerHTML = `<p class="plan-empty">${formatDateLabel(date)}は次の作品の上映が見つかりませんでした: ${missing.join("、")}。日付を変えてお試しください。</p>`;
    return;
  }
  if (plans.length === 0) {
    resultsEl.innerHTML = `<p class="plan-empty">${formatDateLabel(date)}に、移動時間を考慮しても無理なく回れる組み合わせが見つかりませんでした。作品数を減らすか日付を変えてお試しください。</p>`;
    return;
  }

  const top = plans.slice(0, 5);
  resultsEl.innerHTML = top
    .map((plan, i) => {
      const stepsHtml = plan.steps
        .map((s, idx) => {
          const gapHtml =
            idx > 0
              ? renderGap(plan.steps[idx - 1], s)
              : "";
          return `${gapHtml}<div class="plan-step">
            <div class="step-time">${s.time}</div>
            <div class="step-detail">
              <div class="movie">${s.title}${s.typeLabel ? `（${s.typeLabel}）` : ""}</div>
              <div class="theater">${s.theater ? `${s.theater.name}（${s.theater.area}）` : s.theaterId} ・ 上映時間${s.runtimeMin}分</div>
            </div>
          </div>`;
        })
        .join("");
      return `<div class="plan-card">
        <div><span class="plan-rank">プラン${i + 1}</span>${formatDateLabel(date)}</div>
        <div class="plan-summary">合計移動時間 約${Math.round(plan.totalTravelMin)}分 ・ 待ち時間 約${Math.round(Math.max(plan.totalWaitMin, 0))}分 ・ 拘束時間 約${Math.round(plan.spanMin / 60 * 10) / 10}時間</div>
        ${stepsHtml}
      </div>`;
    })
    .join("");
}

function renderGap(prev, next) {
  const travel = travelMinutes(prev.theaterId, next.theaterId);
  const prevEnd = prev.timestamp + prev.runtimeMin * 60;
  const gapMin = Math.round((next.timestamp - prevEnd) / 60);
  const sameTheater = prev.theaterId === next.theaterId;
  const label = sameTheater
    ? `同じ映画館・待ち時間 約${gapMin}分`
    : `移動 約${Math.round(travel || 0)}分（待ち時間込みで${gapMin}分あります）`;
  return `<div class="plan-gap">↓ ${label}</div>`;
}

// ---------- area multiselect ----------

function updateAreaToggleLabel() {
  const toggle = document.getElementById("area-toggle");
  const n = state.filters.areas.size;
  toggle.textContent = n === 0 ? "すべて" : `${n}エリア選択中`;
}

function setupAreaMultiselect() {
  const toggle = document.getElementById("area-toggle");
  const panel = document.getElementById("area-panel");

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== toggle) {
      panel.hidden = true;
    }
  });
  panel.addEventListener("change", (e) => {
    if (e.target.type !== "checkbox") return;
    if (e.target.checked) state.filters.areas.add(e.target.value);
    else state.filters.areas.delete(e.target.value);
    updateAreaToggleLabel();
    renderMovieList();
  });
  document.getElementById("area-select-all").addEventListener("click", () => {
    panel.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = true;
      state.filters.areas.add(cb.value);
    });
    updateAreaToggleLabel();
    renderMovieList();
  });
  document.getElementById("area-select-none").addEventListener("click", () => {
    panel.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = false;
    });
    state.filters.areas.clear();
    updateAreaToggleLabel();
    renderMovieList();
  });
}

// ---------- wiring ----------

function attachEvents() {
  document.getElementById("date-select").addEventListener("change", (e) => {
    state.filters.date = e.target.value;
    renderMovieList();
    renderPlans();
  });
  document.getElementById("title-search").addEventListener("input", (e) => {
    state.filters.title = e.target.value;
    renderMovieList();
  });
  setupAreaMultiselect();
  document.getElementById("theater-select").addEventListener("change", (e) => {
    state.filters.theaterId = e.target.value;
    renderMovieList();
  });
  document.getElementById("plan-button").addEventListener("click", renderPlans);
  document.getElementById("plan-clear").addEventListener("click", () => {
    state.selectedTitles = [];
    renderSelectedChips();
    renderMovieList();
    renderPlans();
  });
}

async function main() {
  await loadData();
  renderFilters();
  attachEvents();
  renderSelectedChips();
  renderMovieList();
}

main().catch((err) => {
  console.error(err);
  document.getElementById("movie-list").innerHTML =
    `<p class="hint">データの読み込みに失敗しました: ${err.message}</p>`;
});
