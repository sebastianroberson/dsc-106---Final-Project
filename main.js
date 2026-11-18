import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

/* ------------------------------------------------------------------ setup */

const METRICS = {
  POTENTIAL_AST:          { label: "Potential assists / game",            fmt: d3.format(".1f"), zero: true },
  AST:                    { label: "Assists / game",                       fmt: d3.format(".1f"), zero: true },
  PASSES_MADE:            { label: "Passes made / game",                   fmt: d3.format(".1f"), zero: true },
  AST_POINTS_CREATED:     { label: "Points created by assists / game",     fmt: d3.format(".1f"), zero: true },
  SECONDARY_AST:          { label: "Secondary (hockey) assists / game",    fmt: d3.format(".2f"), zero: true },
  POT_AST_PER_100_PASSES: { label: "Shots created per 100 passes",         fmt: d3.format(".1f"), zero: true },
  CONVERSION:             { label: "Teammate conversion (AST ÷ potential)", fmt: d3.format(".0%"), zero: false },
  AST_PCT:                { label: "Assist % (teammate FGs assisted)",     fmt: d3.format(".0%"), zero: true },
  USG_PCT:                { label: "Usage %",                              fmt: d3.format(".0%"), zero: false },
  TOV:                    { label: "Turnovers / game",                     fmt: d3.format(".1f"), zero: true },
};

const state = {
  x: "POTENTIAL_AST",
  y: "AST",
  minMpg: 20,
  selected: null,  // PLAYER_ID
  team: null,      // team abbreviation shown in the network
  linkMin: 2,
};

const tooltip = d3.select("#tooltip");
let players = [];
let byId = new Map();
let networks = {};

async function loadJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function showEmpty(sel, extra = "") {
  d3.select(sel).html(`
    <div class="empty">
      <strong>Data not loaded yet.</strong> Generate it with nba_api from the repo root:<br/>
      <code>python3 -m venv .venv &amp;&amp; .venv/bin/pip install -r requirements.txt</code><br/>
      <code>.venv/bin/python scripts/fetch_data.py</code><br/>
      then commit the <code>data/</code> folder. ${extra}
    </div>`);
}

/* ---------------------------------------------------------------- tooltip */

function showTip(event, html) {
  tooltip.html(html).attr("hidden", null);
  const node = tooltip.node();
  const { innerWidth: W, innerHeight: H } = window;
  const r = node.getBoundingClientRect();
  let x = event.clientX + 14, y = event.clientY + 14;
  if (x + r.width > W - 8) x = event.clientX - r.width - 14;
  if (y + r.height > H - 8) y = event.clientY - r.height - 14;
  tooltip.style("left", `${x}px`).style("top", `${y}px`);
}
const hideTip = () => tooltip.attr("hidden", true);
const row = (k, v) => `<div class="tt-row"><span>${k}</span><span>${v}</span></div>`;

/* ------------------------------------------------------------ viz 1: scatter */

function initScatterControls() {
  const opts = Object.entries(METRICS);
  for (const [id, key] of [["#x-metric", "x"], ["#y-metric", "y"]]) {
    d3.select(id).selectAll("option").data(opts).join("option")
      .attr("value", d => d[0]).text(d => d[1].label)
      .property("selected", d => d[0] === state[key]);
    d3.select(id).on("change", function () { state[key] = this.value; drawScatter(); });
  }
  d3.select("#min-mpg").on("input", function () {
    state.minMpg = +this.value;
    d3.select("#min-mpg-out").text(this.value);
    drawScatter();
  });
  d3.select("#player-list").selectAll("option")
    .data(players.slice().sort((a, b) => d3.ascending(a.PLAYER_NAME, b.PLAYER_NAME)))
    .join("option").attr("value", d => d.PLAYER_NAME);
  d3.select("#player-search").on("change", function () {
    const p = players.find(d => d.PLAYER_NAME.toLowerCase() === this.value.trim().toLowerCase());
    if (p) {
      if (p.MIN < state.minMpg) {               // make sure the player is visible
        state.minMpg = Math.floor(p.MIN);
        d3.select("#min-mpg").property("value", state.minMpg);
        d3.select("#min-mpg-out").text(state.minMpg);
      }
      selectPlayer(p.PLAYER_ID);
    }
  });
}

function drawScatter() {
  const fig = d3.select("#scatter");
  fig.selectAll("*").remove();

  const X = state.x, Y = state.y, mx = METRICS[X], my = METRICS[Y];
  const data = players.filter(d => d.MIN >= state.minMpg && d[X] != null && d[Y] != null);

  const width = Math.max(320, fig.node().clientWidth - 16);
  const height = Math.round(Math.min(560, Math.max(360, width * 0.62)));
  const m = { top: 20, right: 28, bottom: 48, left: 56 };

  const ext = (k, meta) => {
    const [lo, hi] = d3.extent(data, d => d[k]);
    if (meta.zero) return [0, hi * 1.05];
    const pad = (hi - lo) * 0.05;
    return [lo - pad, hi + pad];
  };
  const x = d3.scaleLinear(ext(X, mx), [m.left, width - m.right]).nice();
  const y = d3.scaleLinear(ext(Y, my), [height - m.bottom, m.top]).nice();

  const svg = fig.append("svg").attr("viewBox", [0, 0, width, height]);

  // grid + axes
  svg.append("g").attr("class", "grid").attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickSize(-(height - m.top - m.bottom)).tickFormat(""));
  svg.append("g").attr("class", "grid").attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(6).tickSize(-(width - m.left - m.right)).tickFormat(""));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(mx.fmt));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left},0)`)
    .call(d3.axisLeft(y).ticks(6).tickFormat(my.fmt));
  svg.append("text").attr("class", "axis-label").attr("x", width - m.right).attr("y", height - 10)
    .attr("text-anchor", "end").text(`${mx.label} →`);
  svg.append("text").attr("class", "axis-label").attr("x", 12).attr("y", m.top - 6)
    .text(`↑ ${my.label}`);

  // Annotation: conversion-rate guide lines when plotting AST vs potential AST
  if (X === "POTENTIAL_AST" && Y === "AST") {
    const [x0, x1] = x.domain(), [, y1] = y.domain();
    for (const k of [1, 0.6, 0.5, 0.4]) {
      const xe = Math.min(x1, y1 / k);
      svg.append("line").attr("class", "guide")
        .attr("x1", x(x0)).attr("y1", y(x0 * k)).attr("x2", x(xe)).attr("y2", y(xe * k));
      svg.append("text").attr("class", "guide-label")
        .attr("x", x(xe) - 4).attr("y", y(xe * k) - 6).attr("text-anchor", "end")
        .text(k === 1 ? "100% converted" : `${k * 100}%`);
    }
  }

  // Annotation: league medians
  const medX = d3.median(data, d => d[X]), medY = d3.median(data, d => d[Y]);
  svg.append("line").attr("class", "median")
    .attr("x1", x(medX)).attr("x2", x(medX)).attr("y1", m.top).attr("y2", height - m.bottom);
  svg.append("line").attr("class", "median")
    .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y(medY)).attr("y2", y(medY));
  svg.append("text").attr("class", "median-label").attr("x", x(medX) + 4).attr("y", m.top + 10)
    .text(`median ${mx.fmt(medX)}`);
  svg.append("text").attr("class", "median-label").attr("x", width - m.right - 4).attr("y", y(medY) - 5)
    .attr("text-anchor", "end").text(`median ${my.fmt(medY)}`);

  // dots: selected player drawn last so it sits on top
  const sorted = data.slice().sort((a, b) =>
    (a.PLAYER_ID === state.selected) - (b.PLAYER_ID === state.selected));
  const g = svg.append("g").selectAll("g").data(sorted, d => d.PLAYER_ID).join("g")
    .attr("transform", d => `translate(${x(d[X])},${y(d[Y])})`);
  g.append("circle").attr("class", d => `dot${d.PLAYER_ID === state.selected ? " selected" : ""}`)
    .attr("r", d => d.PLAYER_ID === state.selected ? 7 : 4.5);
  g.append("circle").attr("class", "dot-hit").attr("r", 10)
    .on("mouseenter", function (event, d) {
      d3.select(this.parentNode).select(".dot").classed("hot", true);
      showTip(event, `
        <div class="tt-title">${d.PLAYER_NAME}</div>
        <div class="tt-sub">${d.TEAM_ABBREVIATION} · ${d.GP} games · ${d3.format(".1f")(d.MIN)} min</div>
        ${row(mx.label, mx.fmt(d[X]))}
        ${row(my.label, my.fmt(d[Y]))}
        ${X !== "POTENTIAL_AST" && Y !== "POTENTIAL_AST" ? row("Potential assists / game", d3.format(".1f")(d.POTENTIAL_AST)) : ""}
        ${row("Teammate conversion", d.CONVERSION != null ? d3.format(".0%")(d.CONVERSION) : "–")}`);
    })
    .on("mousemove", (event, d) => showTip(event, tooltip.html()))
    .on("mouseleave", function () {
      d3.select(this.parentNode).select(".dot").classed("hot", false);
      hideTip();
    })
    .on("click", (event, d) => selectPlayer(d.PLAYER_ID));

  // Annotation: label the leaders on the y metric, plus the selected player
  const leaders = data.slice().sort((a, b) => d3.descending(a[Y], b[Y])).slice(0, 5);
  const labelled = new Set(leaders.map(d => d.PLAYER_ID));
  if (state.selected && data.some(d => d.PLAYER_ID === state.selected)) labelled.add(state.selected);
  svg.append("g").selectAll("text")
    .data(data.filter(d => labelled.has(d.PLAYER_ID)))
    .join("text")
    .attr("class", d => `dot-label${d.PLAYER_ID === state.selected ? " selected" : ""}`)
    .attr("x", d => x(d[X]) + (x(d[X]) > width - 140 ? -10 : 10))
    .attr("y", d => y(d[Y]) + 4)
    .attr("text-anchor", d => (x(d[X]) > width - 140 ? "end" : "start"))
    .text(d => lastName(d.PLAYER_NAME));
}

function drawPlayerCard() {
  const card = d3.select("#player-card");
  const p = byId.get(state.selected);
  if (!p) { card.html(`<p>Click a dot to see a player's passing profile.</p>`); return; }

  const pool = players.filter(d => d.MIN >= state.minMpg);
  const rank = k => {
    if (p[k] == null) return "";
    const r = pool.filter(d => d[k] != null && d[k] > p[k]).length + 1;
    return `<small>#${r}</small>`;
  };
  const stat = (label, k) =>
    `<dt>${label}</dt><dd>${p[k] != null ? METRICS[k].fmt(p[k]) : "–"}${rank(k)}</dd>`;

  card.html(`
    <h4>${p.PLAYER_NAME}</h4>
    <div class="team">${p.TEAM_ABBREVIATION} · ${p.GP} games · ${d3.format(".1f")(p.MIN)} min/game</div>
    <dl>
      ${stat("Passes made", "PASSES_MADE")}
      ${stat("Potential assists", "POTENTIAL_AST")}
      ${stat("Assists", "AST")}
      ${stat("Points created", "AST_POINTS_CREATED")}
      ${stat("Shots / 100 passes", "POT_AST_PER_100_PASSES")}
      ${stat("Teammate conversion", "CONVERSION")}
      ${stat("Turnovers", "TOV")}
    </dl>
    <p style="margin-top:12px;font-size:12px;color:var(--muted)">
      Ranks are among the ${pool.length} players shown (≥ ${state.minMpg} min/game).
    </p>`);
}

/* ------------------------------------------------------------ viz 2: network */

function initNetworkControls() {
  const teams = Object.keys(networks).sort();
  d3.select("#team-select").selectAll("option").data(teams).join("option")
    .attr("value", d => d).text(d => d);
  d3.select("#team-select").on("change", function () { state.team = this.value; drawNetwork(); });
  d3.select("#link-min").on("input", function () {
    state.linkMin = +this.value;
    d3.select("#link-min-out").text(d3.format(".1f")(state.linkMin));
    drawNetwork();
  });
}

function drawNetwork() {
  const fig = d3.select("#network-chart");
  fig.selectAll("*").remove();
  const net = networks[state.team];
  if (!net) { fig.html(`<div class="empty">No network data for this team.</div>`); return; }
  d3.select("#team-select").property("value", state.team);

  const nodes = net.nodes.slice().sort((a, b) => d3.descending(a.passes_made, b.passes_made));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const allLinks = net.links
    .filter(l => nodeById.has(l.source) && nodeById.has(l.target))
    .map(l => {
      const gp = nodeById.get(l.source).gp || 1;
      return { ...l, ppg: l.passes / gp, apg: (l.ast || 0) / gp };
    });
  const links = allLinks.filter(l => l.ppg >= state.linkMin);

  const width = Math.max(320, fig.node().clientWidth - 16);
  const height = Math.min(640, Math.max(380, width * 0.8));
  const cx = width / 2, cy = height / 2;
  const R = Math.min(width, height) / 2 - 90;

  const rScale = d3.scaleSqrt([0, d3.max(nodes, n => n.passes_made) || 1], [6, 26]);
  const wScale = d3.scaleSqrt([0, d3.max(allLinks, l => l.ppg) || 1], [0.5, 11]);

  nodes.forEach((n, i) => {
    n.angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
    n.x = cx + R * Math.cos(n.angle);
    n.y = cy + R * Math.sin(n.angle);
    n.r = rScale(n.passes_made || 0);
  });

  const svg = fig.append("svg").attr("viewBox", [0, 0, width, height]);

  // Curved directed link that stops at the edge of the target circle.
  // Curving to the same side means A→B and B→A arc apart instead of overlapping.
  const linkPath = l => {
    const s = nodeById.get(l.source), t = nodeById.get(l.target);
    const dx = t.x - s.x, dy = t.y - s.y, dist = Math.hypot(dx, dy);
    const nx = -dy / dist, ny = dx / dist;            // unit normal
    const bend = dist * 0.18;
    const mx = (s.x + t.x) / 2 + nx * bend, my = (s.y + t.y) / 2 + ny * bend;
    // pull endpoints back to circle edges along the control direction
    const back = (p, q, r) => {
      const vx = q[0] - p[0], vy = q[1] - p[1], d = Math.hypot(vx, vy);
      return [p[0] + (vx / d) * r, p[1] + (vy / d) * r];
    };
    const [sx, sy] = back([s.x, s.y], [mx, my], s.r + 2);
    const [tx, ty] = back([t.x, t.y], [mx, my], t.r + 4 + wScale(l.ppg));
    return `M${sx},${sy} Q${mx},${my} ${tx},${ty}`;
  };

  const defs = svg.append("defs");
  for (const [id, cls] of [["arrow", "var(--link)"], ["arrow-out", "var(--accent)"], ["arrow-in", "var(--in)"]]) {
    defs.append("marker").attr("id", id).attr("viewBox", "0 -5 10 10")
      .attr("refX", 2).attr("markerWidth", 2.5).attr("markerHeight", 2.5).attr("orient", "auto")
      .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", cls);
  }

  const linkSel = svg.append("g").selectAll("path")
    .data(links.sort((a, b) => a.ppg - b.ppg)).join("path")
    .attr("class", "net-link")
    .attr("d", linkPath)
    .attr("stroke-width", l => wScale(l.ppg))
    .attr("marker-end", "url(#arrow)")
    .on("mouseenter", function (event, l) {
      const s = nodeById.get(l.source), t = nodeById.get(l.target);
      d3.select(this).classed("out", true).attr("marker-end", "url(#arrow-out)");
      showTip(event, `
        <div class="tt-title">${lastName(s.name)} → ${lastName(t.name)}</div>
        ${row("Passes / game", d3.format(".1f")(l.ppg))}
        ${row("Assists / game", d3.format(".2f")(l.apg))}
        ${row("Passes that became assists", l.passes ? d3.format(".1%")((l.ast || 0) / l.passes) : "–")}
        ${row("Receiver FG% after pass", l.fga ? d3.format(".0%")(l.fgm / l.fga) : "–")}`);
    })
    .on("mousemove", event => showTip(event, tooltip.html()))
    .on("mouseleave", function () {
      d3.select(this).classed("out", false).attr("marker-end", "url(#arrow)");
      hideTip();
    });

  const nodeSel = svg.append("g").selectAll("g").data(nodes).join("g")
    .attr("class", n => `net-node${n.id === state.selected ? " selected" : ""}`)
    .attr("transform", n => `translate(${n.x},${n.y})`);
  nodeSel.append("circle").attr("r", n => n.r);
  const label = nodeSel.append("text")
    .attr("text-anchor", n => (Math.abs(Math.cos(n.angle)) < 0.2 ? "middle" : Math.cos(n.angle) > 0 ? "start" : "end"))
    .attr("x", n => Math.cos(n.angle) * (n.r + 8))
    .attr("y", n => Math.sin(n.angle) * (n.r + 10) + (Math.sin(n.angle) > 0.2 ? 8 : Math.sin(n.angle) < -0.2 ? -2 : 4));
  label.append("tspan").text(n => lastName(n.name));
  label.append("tspan").attr("class", "ppg").text(n => ` ${d3.format(".0f")(n.passes_made)} p/g`);

  nodeSel
    .on("mouseenter", (event, n) => {
      linkSel
        .classed("out", l => l.source === n.id)
        .classed("in", l => l.target === n.id)
        .classed("faded", l => l.source !== n.id && l.target !== n.id)
        .attr("marker-end", l => l.source === n.id ? "url(#arrow-out)" : l.target === n.id ? "url(#arrow-in)" : "url(#arrow)");
      const linked = new Set([n.id]);
      allLinks.forEach(l => { if (l.source === n.id) linked.add(l.target); if (l.target === n.id) linked.add(l.source); });
      nodeSel.classed("faded", d => !linked.has(d.id));
      const out = allLinks.filter(l => l.source === n.id).sort((a, b) => b.ppg - a.ppg);
      showTip(event, `
        <div class="tt-title">${n.name}</div>
        <div class="tt-sub">${d3.format(".1f")(n.min)} min · ${d3.format(".1f")(n.ast)} ast / game</div>
        ${row("Passes made / game", d3.format(".1f")(n.passes_made))}
        ${row("Potential assists / game", d3.format(".1f")(n.potential_ast))}
        ${out[0] ? row("Favorite target", `${lastName(nodeById.get(out[0].target).name)} (${d3.format(".1f")(out[0].ppg)})`) : ""}`);
    })
    .on("mousemove", event => showTip(event, tooltip.html()))
    .on("mouseleave", () => {
      linkSel.classed("out", false).classed("in", false).classed("faded", false).attr("marker-end", "url(#arrow)");
      nodeSel.classed("faded", false);
      hideTip();
    })
    .on("click", (event, n) => { if (byId.has(n.id)) selectPlayer(n.id, { keepTeam: true }); });

  // Legend: link width
  const lg = svg.append("g").attr("transform", `translate(16, ${height - 20})`);
  const ex = [2, 6, 12].filter(v => v <= (d3.max(allLinks, l => l.ppg) || 0) * 1.2);
  let lx = 0;
  lg.append("text").attr("class", "guide-label").attr("y", -14).text("Passes / game");
  ex.forEach(v => {
    lg.append("line").attr("x1", lx).attr("x2", lx + 26).attr("stroke", "var(--link)").attr("stroke-width", wScale(v));
    lg.append("text").attr("class", "guide-label").attr("x", lx + 30).attr("y", 4).text(v);
    lx += 56;
  });

  drawNetworkNotes(nodes, allLinks, nodeById);
}

function drawNetworkNotes(nodes, allLinks, nodeById) {
  const notes = d3.select("#network-notes");
  if (!allLinks.length) { notes.html("<p>No passes recorded.</p>"); return; }
  const total = d3.sum(allLinks, l => l.ppg);
  const outBy = d3.rollup(allLinks, v => d3.sum(v, l => l.ppg), l => l.source);
  const inBy = d3.rollup(allLinks, v => d3.sum(v, l => l.ppg), l => l.target);
  const hub = d3.greatest(outBy, d => d[1]);
  const sink = d3.greatest(inBy, d => d[1]);
  const top = d3.greatest(allLinks, l => l.ppg);
  const fmt = d3.format(".1f"), pct = d3.format(".0%");
  const nm = id => nodeById.get(id).name;

  const sel = nodeById.get(state.selected);
  let selLine = "";
  if (sel) {
    const o = outBy.get(sel.id) || 0;
    const fav = d3.greatest(allLinks.filter(l => l.source === sel.id), l => l.ppg);
    selLine = `<p><strong>${sel.name}</strong> makes ${pct(o / total)} of the passes between these
      rotation players${fav ? `, most often to <strong>${lastName(nm(fav.target))}</strong> (${fmt(fav.ppg)}/game)` : ""}.</p>`;
  }

  notes.html(`
    <h4>${state.team}</h4>
    <div class="team">${nodes.length} rotation players · ${fmt(total)} passes/game between them</div>
    <p><strong>Hub:</strong> ${nm(hub[0])} sends ${pct(hub[1] / total)} of the team's passes.</p>
    <p><strong>Busiest connection:</strong> ${lastName(nm(top.source))} → ${lastName(nm(top.target))},
      ${fmt(top.ppg)} passes/game.</p>
    <p><strong>Most fed:</strong> ${nm(sink[0])} receives ${pct(sink[1] / total)}.</p>
    ${selLine}`);
}

/* ---------------------------------------------------------------- linking */

function selectPlayer(id, { keepTeam = false } = {}) {
  state.selected = id;
  const p = byId.get(id);
  if (p) d3.select("#player-search").property("value", p.PLAYER_NAME);
  if (!keepTeam && p && networks[p.TEAM_ABBREVIATION]) state.team = p.TEAM_ABBREVIATION;
  drawScatter();
  drawPlayerCard();
  if (Object.keys(networks).length) drawNetwork();
}

const lastName = name => {
  const parts = name.split(" ");
  const suffix = /^(Jr\.?|Sr\.?|II|III|IV)$/i;
  return parts.length > 2 && suffix.test(parts.at(-1)) ? parts.at(-2) : parts.at(-1);
};

/* ------------------------------------------------------------------- init */

async function init() {
  const [pData, nData] = await Promise.all([
    loadJSON("data/players.json"),
    loadJSON("data/networks.json"),
  ]);

  if (!pData) {
    showEmpty("#scatter");
    showEmpty("#network-chart");
    d3.select("#player-card").html("<p>Player profiles appear here once data is loaded.</p>");
    d3.select("#network-notes").html("<p>Team summaries appear here once data is loaded.</p>");
    return;
  }

  players = pData.players;
  byId = new Map(players.map(d => [d.PLAYER_ID, d]));
  networks = nData?.teams ?? {};
  const meta = pData.meta;
  d3.select("#data-meta").text(`${meta.season} ${meta.season_type}, players with ≥ ${meta.min_gp} games (fetched ${meta.fetched}).`);

  // Default to the league leader in potential assists: the "court vision" archetype
  const leader = d3.greatest(players.filter(d => d.MIN >= state.minMpg), d => d.POTENTIAL_AST);
  state.selected = leader?.PLAYER_ID ?? null;
  state.team = leader?.TEAM_ABBREVIATION ?? Object.keys(networks)[0];

  initScatterControls();
  if (Object.keys(networks).length) {
    initNetworkControls();
  } else {
    showEmpty("#network-chart", "(networks.json is missing.)");
  }
  selectPlayer(state.selected);

  let t;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => { drawScatter(); if (Object.keys(networks).length) drawNetwork(); }, 150);
  });
}

init();
