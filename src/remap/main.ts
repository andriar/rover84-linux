import "../style.css";
import { el } from "../ui/dom";
import { BOARD, TARGETS, isPhysical, isProtectedSource, keyByCode, type Category } from "./keys";
import { emptyConfig, type RemapConfig } from "./xkb";

const UNIT = 54;
const CATEGORIES: Category[] = ["Letters", "Numbers", "Punctuation", "Modifiers", "Function", "Navigation", "Media", "Special"];

interface ServerState {
  config: RemapConfig;
  devices: string[];
  matched: string[];
  active: boolean;
  warning?: string;
}

const ui = {
  config: emptyConfig(),
  saved: JSON.stringify(emptyConfig()),
  server: null as ServerState | null,
  selected: null as string | null,
  category: "Letters" as Category,
  search: "",
  listening: false,
  busy: false,
  status: { text: "Loading…", error: false },
};

const app = document.getElementById("app")!;
const dirty = () => JSON.stringify(ui.config) !== ui.saved;

async function api(path: string, body?: unknown): Promise<ServerState> {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as ServerState & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function adopt(s: ServerState, keepEdits: boolean): void {
  ui.server = s;
  ui.saved = JSON.stringify(s.config);
  if (!keepEdits) ui.config = structuredClone(s.config);
}

function setStatus(text: string, error = false): void {
  ui.status = { text, error };
  render();
}

async function run(label: string, task: () => Promise<void>): Promise<void> {
  if (ui.busy) return;
  ui.busy = true;
  setStatus(label);
  try {
    await task();
  } catch (e) {
    setStatus((e as Error).message, true);
  } finally {
    ui.busy = false;
    render();
  }
}

const load = () =>
  run("Loading…", async () => {
    adopt(await api("/api/state"), false);
    setStatus(ui.server?.warning ?? "Ready");
  });

const apply = () =>
  run("Applying…", async () => {
    adopt(await api("/api/apply", { config: ui.config }), true);
    ui.saved = JSON.stringify(ui.config);
    setStatus(`Applied to ${ui.server?.matched.length ?? 0} device(s)`);
  });

const revert = () =>
  run("Reverting…", async () => {
    adopt(await api("/api/revert", {}), true);
    setStatus("Reverted to the default layout. Your mappings are still saved.");
  });

function assign(targetCode: string): void {
  const src = ui.selected;
  if (!src) return;
  if (src === targetCode) delete ui.config.mappings[src];
  else ui.config.mappings[src] = targetCode;
  render();
}

function select(code: string): void {
  const key = keyByCode(code);
  if (!key) return;
  ui.selected = code;
  if (isProtectedSource(key)) setStatus(`${key.label} is a modifier; remapping modifiers is not supported yet.`);
  else setStatus(`Selected ${key.label}`);
}

window.addEventListener("keydown", (e) => {
  if (!ui.listening) return;
  e.preventDefault();
  e.stopPropagation();
  if (isPhysical(e.code)) select(e.code);
  else setStatus(`Key "${e.code}" is not in the key table`, true);
});

function renderBoard(): HTMLElement {
  const width = Math.max(...BOARD.map((k) => k.x + k.w)) * UNIT;
  const board = el("div", { class: "board" });
  board.style.width = `${width}px`;
  board.style.height = `${6 * UNIT}px`;

  for (const k of BOARD) {
    const def = keyByCode(k.code)!;
    const target = ui.config.mappings[k.code];
    const locked = isProtectedSource(def);
    const btn = el("button", { class: `key${target ? " mapped" : ""}${locked ? " locked" : ""}` }, el("span", { textContent: def.label }));
    if (target) btn.append(el("span", { class: "map", textContent: `→ ${keyByCode(target)?.label ?? target}` }));
    btn.style.left = `${k.x * UNIT}px`;
    btn.style.top = `${k.y * UNIT}px`;
    btn.style.width = `${k.w * UNIT - 4}px`;
    btn.title = locked ? `${def.label}: modifier, cannot be remapped yet` : k.code;
    btn.setAttribute("aria-pressed", String(ui.selected === k.code));
    btn.onclick = () => select(k.code);
    board.append(btn);
  }
  return board;
}

function renderPicker(): HTMLElement {
  const query = ui.search.trim().toLowerCase();
  const items = TARGETS.filter((t) => (query ? `${t.label} ${t.code}`.toLowerCase().includes(query) : t.category === ui.category));
  const src = ui.selected ? keyByCode(ui.selected) : undefined;
  const canEdit = !!src && !isProtectedSource(src);

  const search = el("input", { type: "search", placeholder: "Search keys…", value: ui.search });
  search.setAttribute("aria-label", "Search keys");
  search.oninput = () => {
    ui.search = search.value;
    render(true);
  };

  const tabs = el("div", { class: "tabs" });
  for (const c of CATEGORIES) {
    const b = el("button", { textContent: c });
    b.setAttribute("aria-pressed", String(!query && ui.category === c));
    b.onclick = () => {
      ui.category = c;
      ui.search = "";
      render();
    };
    tabs.append(b);
  }

  const clear = el("button", { textContent: "Clear mapping", disabled: !(ui.selected && ui.config.mappings[ui.selected]) });
  clear.onclick = () => {
    if (ui.selected) delete ui.config.mappings[ui.selected];
    render();
  };

  const grid = el("div", { class: "picker-grid" });
  for (const t of items) {
    const b = el("button", { textContent: t.label, title: t.code, disabled: !canEdit });
    b.onclick = () => assign(t.code);
    grid.append(b);
  }

  const current = ui.selected ? ui.config.mappings[ui.selected] : undefined;
  const hint = src
    ? canEdit
      ? `${src.label} currently ${current ? `acts as ${keyByCode(current)?.label}` : "is not remapped"}. Pick what it should type.`
      : `${src.label} is a modifier and cannot be remapped yet.`
    : "Select a key on the board (or turn on Listen and press it), then pick what it should do.";
  return el("section", { class: "card" }, el("div", { class: "picker-head" }, tabs, search, clear), el("p", { class: "hint", textContent: hint }), grid);
}

function render(keepSearchFocus = false): void {
  const s = ui.server;
  const count = Object.keys(ui.config.mappings).length;

  const badge = (text: string, tone: "ok" | "warn" | "muted") => el("span", { class: `badge ${tone}`, textContent: text });
  const badges = el("div", { class: "toolbar" });
  if (s) badges.append(s.active ? badge("Active", "ok") : badge("Not active", "muted"));
  if (dirty()) badges.append(badge("Unapplied changes", "warn"));

  const via = el("a", { href: "/via.html", textContent: "VIA keyboards →", class: "link" });
  const header = el("header", {}, el("h1", { textContent: "Keyboard Remap" }), el("span", { class: `status${ui.status.error ? " error" : ""}`, textContent: ui.status.text }), via);
  header.querySelector(".status")?.setAttribute("role", "status");

  const match = el("input", { type: "text", value: ui.config.deviceMatch, spellcheck: false });
  match.setAttribute("aria-label", "Device name filter");
  match.onchange = () => {
    ui.config.deviceMatch = match.value.trim();
    render();
  };
  const matched = s?.matched.length ? s.matched.join(", ") : "no keyboard matches this filter";
  const devices = el(
    "section",
    { class: "card" },
    el("div", { class: "toolbar" }, el("label", { textContent: "Apply to keyboards whose name contains " }, match), el("span", { class: "spacer" }), badges),
    el("p", { class: "hint", textContent: `Matched: ${matched}` }),
  );

  const listen = el("button", { textContent: ui.listening ? "Listening… (click to stop)" : "Listen to keyboard" });
  listen.setAttribute("aria-pressed", String(ui.listening));
  listen.onclick = () => {
    ui.listening = !ui.listening;
    render();
  };
  const applyBtn = el("button", { class: "primary", textContent: `Apply (${count})`, disabled: ui.busy || !s?.matched.length || (!dirty() && !!s?.active) });
  applyBtn.onclick = () => void apply();
  const revertBtn = el("button", { textContent: "Revert to default", disabled: ui.busy || !s?.active });
  revertBtn.onclick = () => void revert();

  const board = el(
    "section",
    { class: "card" },
    el("div", { class: "toolbar" }, listen, el("span", { class: "spacer" }), revertBtn, applyBtn),
    el("div", { class: "board-wrap" }, renderBoard()),
    el("p", { class: "hint", textContent: "Layout is approximate. If a key is missing or misplaced, use Listen and press it on your keyboard." }),
  );

  app.replaceChildren(el("div", { class: "shell" }, header, devices, board, renderPicker()));

  if (keepSearchFocus) {
    const input = app.querySelector<HTMLInputElement>("input[type=search]");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}

render();
void load();
