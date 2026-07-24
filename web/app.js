const daySelect = document.getElementById("daySelect");
const digestEl = document.getElementById("digest");
const timelineEl = document.getElementById("timeline");
const emptyEl = document.getElementById("empty");
const metaEl = document.getElementById("meta");

function hm(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function hourLabel(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).replace(/:\d\d/, ":00");
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Collapse consecutive idle/excluded entries into single spans.
function collapse(entries) {
  const items = [];
  for (const entry of entries) {
    if (entry.status === "active") {
      items.push({ type: "active", entry, ts: entry.ts });
      continue;
    }
    const last = items[items.length - 1];
    const key = entry.status === "excluded" ? `excluded:${entry.app || ""}` : "idle";
    if (last && last.type === "span" && last.key === key) {
      last.count += 1;
      last.to = entry.ts;
    } else {
      items.push({
        type: "span",
        key,
        status: entry.status,
        app: entry.app,
        count: 1,
        from: entry.ts,
        to: entry.ts,
        ts: entry.ts,
      });
    }
  }
  return items;
}

function renderDigest(summary) {
  digestEl.innerHTML = "";
  if (!summary) {
    digestEl.classList.add("hidden");
    return;
  }
  digestEl.classList.remove("hidden");
  digestEl.appendChild(el("h2", null, "What I did"));
  if (summary.narrative) digestEl.appendChild(el("p", "narrative", summary.narrative));
  if (summary.shipped && summary.shipped.length) {
    const ul = el("ul");
    for (const s of summary.shipped) ul.appendChild(el("li", null, s));
    digestEl.appendChild(ul);
  }
  const chips = el("div", "chips");
  for (const [app, t] of Object.entries(summary.appTime || {})) {
    chips.appendChild(el("span", "chip", `${app} · ${t}`));
  }
  digestEl.appendChild(chips);
}

function renderActive(entry) {
  const row = el("div", "entry active");
  row.appendChild(el("div", "time", hm(entry.ts)));

  if (entry.screenshot) {
    const thumb = el("a", "thumb");
    thumb.href = "/" + entry.screenshot;
    thumb.target = "_blank";
    thumb.rel = "noopener";
    const img = el("img");
    img.loading = "lazy";
    img.src = "/" + entry.screenshot;
    thumb.appendChild(img);
    row.appendChild(thumb);
  }

  const body = el("div", "body");
  if (entry.analysis && entry.analysis.summary) {
    body.appendChild(el("div", "summary", entry.analysis.summary));
  } else if (entry.error) {
    body.appendChild(el("div", "err", "analysis failed — " + entry.error));
  } else {
    body.appendChild(el("div", "summary", "(no summary)"));
  }
  const app = [entry.app, entry.title].filter(Boolean).join(" — ");
  if (app) body.appendChild(el("div", "app", app));
  const tags = entry.analysis && entry.analysis.tags ? entry.analysis.tags : [];
  if (tags.length || (entry.analysis && entry.analysis.provider)) {
    const chips = el("div", "chips");
    for (const t of tags) chips.appendChild(el("span", "chip", t));
    // Where this minute's screen text went. In "auto" mode it varies per entry.
    if (entry.analysis.provider) {
      const p = entry.analysis.provider;
      const badge = el("span", "chip provider " + p, p === "local" ? "local" : "cloud");
      badge.title =
        (p === "local"
          ? "Analyzed on this machine — nothing was sent off-device."
          : "Sent to the cloud endpoint.") + " Model: " + (entry.analysis.model || "?");
      chips.appendChild(badge);
    }
    body.appendChild(chips);
  }
  row.appendChild(body);
  return row;
}

function renderSpan(item) {
  const cls = item.status === "excluded" ? "entry excluded" : "entry idle";
  const label =
    item.status === "excluded"
      ? `🔒 ${item.app || "excluded app"} — not captured`
      : "⋯ idle";
  const range = item.count > 1 ? `${hm(item.from)}–${hm(item.to)}` : hm(item.from);
  const mins = item.count === 1 ? "1 min" : `${item.count} min`;
  const row = el("div", cls);
  row.appendChild(el("div", "time", hm(item.from)));
  row.appendChild(el("div", "body", `${label} · ${range} (${mins})`));
  return row;
}

function renderTimeline(entries) {
  timelineEl.innerHTML = "";
  const items = collapse(entries);
  if (!items.length) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  let currentHour = null;
  let group = null;
  for (const item of items) {
    const hl = hourLabel(item.ts);
    if (hl !== currentHour) {
      currentHour = hl;
      group = el("div", "hourgroup");
      group.appendChild(el("div", "hourhead", hl));
      timelineEl.appendChild(group);
    }
    group.appendChild(item.type === "active" ? renderActive(item.entry) : renderSpan(item));
  }
}

async function loadDay(day) {
  const res = await fetch(`/api/day/${day}`);
  const data = await res.json();
  renderDigest(data.summary);
  renderTimeline(data.entries || []);
  const active = (data.entries || []).filter((e) => e.status === "active").length;
  metaEl.textContent = `${data.entries ? data.entries.length : 0} min tracked · ${active} analyzed`;
}

async function init() {
  const days = await (await fetch("/api/days")).json();
  if (!days.length) {
    emptyEl.classList.remove("hidden");
    metaEl.textContent = "no data yet — run `bun start`";
    return;
  }
  daySelect.innerHTML = "";
  for (const d of days) {
    const opt = el("option", null, d);
    opt.value = d;
    daySelect.appendChild(opt);
  }
  daySelect.value = days[0];
  daySelect.addEventListener("change", () => loadDay(daySelect.value));
  await loadDay(days[0]);
}

init();
