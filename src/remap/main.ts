import "../style.css";
import { interactiveBoard, type CapSpec } from "../ui/board";
import { attrs, el } from "../ui/dom";
import { holdFocus, releaseFocus, renderKeepingFocus } from "../ui/focus";
import { announce, applyBar, shell, switchRow, type BannerSpec } from "../ui/shell";
import { BOARD, TARGETS, isPhysical, isProtectedSource, keyByCode, type Category, type KeyDef } from "./keys";
import { describePending, friendlyDeviceName, pendingChanges } from "./pending";
import { emptyConfig, type RemapConfig } from "./xkb";

const CATEGORIES: Category[] = ["Letters", "Numbers", "Punctuation", "Modifiers", "Function", "Navigation", "Media", "Special"];

interface ServerState {
  config: RemapConfig;
  devices: string[];
  matched: string[];
  active: boolean;
  warning?: string;
}

type Tone = "good" | "bad" | "info";
type Busy = "" | "Applying…" | "Turning off…" | "Reading Hyprland…";

const ui = {
  config: emptyConfig(),
  saved: emptyConfig(),
  server: null as ServerState | null,
  serverDown: false,
  serverError: "",
  loaded: false,
  selected: null as string | null,
  category: "Letters" as Category,
  search: "",
  listening: false,
  busy: "" as Busy,
  result: { text: "", tone: "info" as Tone },
};

const app = document.getElementById("app")!;
const clone = <T,>(v: T): T => structuredClone(v);

async function api(path: string, body?: unknown): Promise<ServerState> {
  let res: Response;
  try {
    res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    ui.serverDown = true;
    ui.serverError = (e as Error).message;
    throw new Error("Can't reach the local server.");
  }
  ui.serverDown = false;
  const data = (await res.json().catch(() => ({}))) as ServerState & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function adopt(s: ServerState, keepEdits: boolean): void {
  ui.server = s;
  ui.saved = clone(s.config);
  if (!keepEdits) ui.config = clone(s.config);
  ui.loaded = true;
}

function say(text: string, tone: Tone = "info"): void {
  ui.result = { text, tone };
  if (text) announce(text, tone === "bad");
}

async function run(label: Exclude<Busy, "">, task: () => Promise<void>): Promise<void> {
  if (ui.busy) return;
  ui.busy = label;
  say(label);
  holdFocus(app);
  render();
  try {
    await task();
  } catch (e) {
    say(label === "Reading Hyprland…" ? (e as Error).message : `Couldn't ${label === "Applying…" ? "apply" : "turn off"}: ${(e as Error).message}`, "bad");
  } finally {
    ui.busy = "";
    render();
    releaseFocus();
  }
}

const load = () =>
  run("Reading Hyprland…", async () => {
    adopt(await api("/api/state"), ui.loaded);
    say("");
  });

const apply = () =>
  run("Applying…", async () => {
    adopt(await api("/api/apply", { config: ui.config }), true);
    say(`Applied to ${friendlyDeviceName(ui.server?.matched ?? []) || "the keyboard"}.`, "good");
  });

const turnOff = () =>
  run("Turning off…", async () => {
    adopt(await api("/api/revert", {}), true);
    say("Remap turned off. Your mappings are saved, and the Alt/Super swap is unchanged.", "good");
  });

/* ---------- selection ---------- */

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function select(code: string): void {
  if (!keyByCode(code)) return;
  ui.selected = code;
  render();
  requestAnimationFrame(() => document.querySelector(".inspector")?.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" }));
}

function assign(target: string): void {
  const src = ui.selected;
  if (!src) return;
  if (src === target) delete ui.config.mappings[src];
  else ui.config.mappings[src] = target;
  render();
}

/** Listen captures exactly one key and then turns itself off, so Tab is never trapped. */
window.addEventListener(
  "keydown",
  (e) => {
    if (!ui.listening) return;
    e.preventDefault();
    e.stopPropagation();
    ui.listening = false;
    if (isPhysical(e.code)) {
      say(`Selected ${full(keyByCode(e.code)!)}.`);
      select(e.code);
    } else {
      say(`That key (${e.code}) isn't on the drawn board.`, "bad");
      render();
    }
  },
  true,
);

/* ---------- board ---------- */

const short = (d: KeyDef) => d.label.replace(/^[LR](?=Shift|Ctrl|Super|Alt)/, "");
/** "LCtrl" -> "Left Ctrl": full names for the inspector and screen readers. */
const full = (d: KeyDef) => d.label.replace(/^L(?=Shift|Ctrl|Super|Alt)/, "Left ").replace(/^R(?=Shift|Ctrl|Super|Alt)/, "Right ");

function capSpecs(): CapSpec[] {
  const swap = ui.config.swapAltSuper;
  return BOARD.map((b) => {
    // In Mac mode the firmware sends Alt for the key printed Win and Super for the key printed Alt. With the swap on,
    // draw each position with the code that key really sends so selecting and Listen hit the right physical key.
    let code = b.code;
    let legend: string | undefined;
    let sub: string | undefined;
    if (b.code === "MetaLeft") {
      code = swap ? "AltLeft" : "MetaLeft";
      legend = "Super";
      sub = swap ? "swapped" : undefined;
    } else if (b.code === "AltLeft") {
      code = swap ? "MetaLeft" : "AltLeft";
      legend = "Alt";
      sub = swap ? "swapped" : undefined;
    } else if (b.code === "AltRight" && swap) {
      legend = "Super";
      sub = "swapped";
    }
    const def = keyByCode(code)!;
    const locked = isProtectedSource(def);
    const target = ui.config.mappings[code];
    const pending = target !== ui.saved.mappings[code];
    const targetLabel = target ? short(keyByCode(target)!) : undefined;
    const name = legend && b.code !== code ? `${legend} (Mac mode, swapped back)` : full(def);
    const label = locked ? `${name}, modifier, can't be remapped` : target ? `${name}, types ${full(keyByCode(target)!)}${pending ? ", not applied yet" : ""}` : name;
    const spec: CapSpec = {
      id: code,
      x: b.x,
      y: b.y,
      w: b.w,
      legend: targetLabel ?? legend ?? short(def),
      label,
      pressed: ui.selected === code,
      classes: [target ? "mapped" : "", pending ? "pending" : "", locked ? "locked" : ""].filter(Boolean),
      onClick: () => select(code),
    };
    if (!targetLabel && sub) spec.sub = sub;
    return spec;
  });
}

/* ---------- sections ---------- */

function settingsCard(): HTMLElement {
  const s = ui.server;
  const nameChanged = ui.config.deviceMatch !== ui.saved.deviceMatch;
  const input = attrs(el("input", { type: "text", id: "device", value: ui.config.deviceMatch, spellcheck: false }), { "data-fid": "device", "aria-describedby": "device-help" });
  input.oninput = () => {
    ui.config.deviceMatch = input.value.trim();
    render();
  };

  const found = el("p", { id: "device-help", class: "helper" });
  if (nameChanged) found.textContent = "Apply to see which keyboards match.";
  else if (s?.matched.length) found.textContent = `Found: ${friendlyDeviceName(s.matched)}`;
  else if (ui.serverDown) found.textContent = "Can't check while the server is offline.";
  else if (s?.warning) found.textContent = "Can't check while Hyprland isn't responding.";
  else found.textContent = s ? "No keyboard found." : "Looking…";

  const foundRow = el("div", { class: "found-row" }, found);
  const device = el("div", { class: "field" }, el("label", { htmlFor: "device", textContent: "Keyboard name contains" }), input, foundRow);
  if (s?.matched.length && !nameChanged) {
    const names = el("p", { class: "mono", textContent: s.matched.join("\n") });
    names.style.whiteSpace = "pre-line";
    foundRow.append(el("details", {}, el("summary", { textContent: "Show input names" }), names));
  }

  const swap = switchRow({
    id: "swap",
    label: "Swap Alt and Super",
    helper: "For Mac mode. Stays on when you turn off the remap.",
    checked: ui.config.swapAltSuper,
    onChange: (v) => {
      ui.config.swapAltSuper = v;
      render();
    },
  });

  swap.append(el("details", {}, el("summary", { textContent: "When to use this" }), el("p", { class: "helper", textContent: "Turn on when the keyboard is in Mac mode (the Win key acts as Alt). Turn off in Windows mode, or the keys swap twice." })));
  return el("section", { class: "card settings" }, el("h2", { textContent: "Keyboard settings" }), el("div", { class: "settings-grid" }, device, swap));
}

function boardCard(): HTMLElement {
  const listen = attrs(el("button", { type: "button", class: "toggle", textContent: ui.listening ? "Press a key…" : "Listen" }), { "aria-pressed": ui.listening, "data-fid": "listen" });
  listen.onclick = () => {
    ui.listening = !ui.listening;
    render();
  };

  const legend = el(
    "p",
    { class: "legend" },
    ...(
      [
        ["sw mapped", "Remapped"],
        ["sw pending", "Not applied"],
        ["sw locked", "Modifier, fixed"],
      ] as const
    ).map(([cls, text]) => el("span", {}, el("span", { class: cls }), text)),
  );
  if (ui.config.swapAltSuper) legend.append(el("span", { textContent: "swapped = Alt/Super swap on" }));

  const hint = el("p", { class: "helper", textContent: "Drawing is approximate. If a key is missing or in the wrong place, use Listen and press it." });
  const wrap = interactiveBoard(capSpecs(), { listening: ui.listening });
  const scrollHint = el("p", { class: "helper", textContent: "Scroll sideways for the whole board, or use Listen.", hidden: true });
  requestAnimationFrame(() => {
    scrollHint.hidden = !(wrap.scrollWidth > wrap.clientWidth + 1);
  });
  return el("section", { class: "card board-card" }, el("div", { class: "card-head" }, el("h2", { textContent: "Key mappings" }), listen), scrollHint, wrap, legend, hint);
}

function inspector(): HTMLElement {
  const def = ui.selected ? keyByCode(ui.selected) : undefined;
  const locked = !!def && isProtectedSource(def);
  const target = ui.selected ? ui.config.mappings[ui.selected] : undefined;
  const pending = !!ui.selected && target !== ui.saved.mappings[ui.selected];

  const title = el("h2", { textContent: def ? full(def) : "No key selected" });
  let text: string;
  if (!def) text = "Select a key on the board, or press Listen and then the key.";
  else if (locked) text = `${full(def)} can't be remapped. A modifier key keeps acting as a modifier in xkb even when it gets a new symbol, so it would still work as ${short(def)}. Caps Lock is the one modifier that can be remapped.`;
  else if (target) text = `Types ${full(keyByCode(target)!)}.${pending ? " Not applied yet." : ""}`;
  else text = `Types ${full(def)} (default).`;

  const reset = attrs(el("button", { type: "button", textContent: "Reset this key" }), { "data-fid": "reset-key" });
  reset.onclick = () => {
    if (ui.selected) delete ui.config.mappings[ui.selected];
    render();
  };

  const canEdit = !!def && !locked;
  const query = ui.search.trim().toLowerCase();
  const items = TARGETS.filter((t) => (query ? `${t.label} ${t.code}`.toLowerCase().includes(query) : t.category === ui.category));

  const search = attrs(el("input", { type: "search", id: "key-search", placeholder: "Search, e.g. Esc or F13", value: ui.search, disabled: !canEdit }), { "data-fid": "search" });
  search.oninput = () => {
    ui.search = search.value;
    render();
  };

  const tabs = el("div", { class: "tabs" });
  for (const c of CATEGORIES) {
    const b = attrs(el("button", { type: "button", textContent: c }), { "aria-pressed": !query && ui.category === c, "data-fid": `tab-${c}` });
    b.onclick = () => {
      ui.category = c;
      ui.search = "";
      render();
    };
    tabs.append(b);
  }

  const grid = el("div", { class: "picker-grid" });
  for (const t of items) {
    const b = attrs(el("button", { type: "button", textContent: t.label, title: t.code }), { "aria-pressed": target === t.code, "data-fid": `pick-${t.code}` });
    b.onclick = () => assign(t.code);
    grid.append(b);
  }

  const gate = !def ? "Select a key first." : locked ? "Pick another key to remap." : "";
  const none = items.length === 0 ? el("p", { class: "helper", textContent: `No key matches "${ui.search}".` }) : null;

  return el(
    "section",
    { class: "card inspector" },
    title,
    el("p", { class: "helper", textContent: text }),
    target ? reset : "",
    ...(canEdit
      ? [el("div", { class: "field" }, el("label", { htmlFor: "key-search", class: "caption", textContent: "Make it type…" }), search), tabs, none ?? grid]
      : [el("p", { class: "helper", textContent: gate })]),
  );
}

function remapBar(): HTMLElement {
  const s = ui.server;
  const p = pendingChanges(ui.config, ui.saved);
  const hasSaved = Object.keys(ui.saved.mappings).length > 0 || ui.saved.swapAltSuper;
  const canApply = !!s && !ui.serverDown && s.matched.length > 0 && !ui.busy;

  let summary: string;
  let primaryText: string;
  let primaryEnabled: boolean;
  if (ui.serverDown) {
    summary = "Can't apply until the local server is running.";
    primaryText = "Apply…";
    primaryEnabled = false;
  } else if (p.total > 0) {
    summary = canApply || ui.busy ? `${p.total} ${p.total === 1 ? "change" : "changes"} not applied: ${describePending(p)}` : s?.warning ? "Can't apply: Hyprland isn't responding." : "Can't apply: no keyboard found.";
    primaryText = `Apply ${p.total} ${p.total === 1 ? "change" : "changes"}`;
    primaryEnabled = canApply;
  } else if (s?.active) {
    summary = "Remap is on. Everything is applied.";
    primaryText = "Applied";
    primaryEnabled = false;
  } else if (hasSaved) {
    summary = s && s.matched.length === 0 ? "Remap is off. Can't turn it on: no keyboard found." : "Remap is off. Your mappings are saved.";
    primaryText = "Turn on remap";
    primaryEnabled = canApply;
  } else {
    summary = "Nothing to apply yet. Pick a key and choose what it should type.";
    primaryText = "Apply";
    primaryEnabled = false;
  }

  const primary = attrs(el("button", { type: "button", class: "primary", textContent: ui.busy === "Applying…" ? "Applying…" : primaryText, disabled: !primaryEnabled }), { "data-fid": "apply" });
  if (ui.busy) primary.setAttribute("aria-busy", "true");
  primary.onclick = () => void apply();
  const off = attrs(el("button", { type: "button", textContent: ui.busy === "Turning off…" ? "Turning off…" : "Turn off remap", disabled: !!ui.busy || !s?.active }), { "data-fid": "turn-off" });
  off.onclick = () => void turnOff();

  return applyBar({ summary, result: ui.serverDown ? { text: "", tone: "info" } : ui.result, secondary: off, primary });
}

function banner(): BannerSpec | null {
  const s = ui.server;
  if (ui.serverDown) {
    const spec: BannerSpec = { tone: "bad", title: "Can't reach the local server", body: "Start it with npm start in the keyboard-config folder, then try again.", retry: () => void load() };
    if (ui.serverError) spec.details = ui.serverError;
    return spec;
  }
  if (s?.warning) {
    return { tone: "warn", title: "Hyprland isn't responding", body: "Changes can't be applied until it does. Check that you're in a Hyprland session.", details: s.warning, retry: () => void load() };
  }
  if (s && s.matched.length === 0 && ui.config.deviceMatch === ui.saved.deviceMatch) {
    return {
      tone: "warn",
      title: `No keyboard matches "${ui.config.deviceMatch}"`,
      body: "Plug the keyboard in, or change the name in Keyboard settings.",
      detailsLabel: "Keyboards Hyprland sees",
      details: s.devices.join("\n") || "(none)",
      retry: () => void load(),
    };
  }
  return null;
}

function draw(): void {
  const s = ui.server;
  const chip = ui.serverDown
    ? { text: "Server offline", tone: "bad" as const }
    : !s
      ? { text: "Checking…", tone: "neutral" as const }
      : s.active
        ? { text: "Remap on", tone: "good" as const }
        : { text: "Remap off", tone: "neutral" as const };
  app.replaceChildren(
    shell({
      page: "remap",
      title: "Key remap",
      chip,
      banner: banner(),
      main: [settingsCard(), el("div", { class: "two-col remap" }, boardCard(), inspector())],
      bar: remapBar(),
    }),
  );
}

function render(): void {
  renderKeepingFocus(app, draw);
}

render();
void load();
