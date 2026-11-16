import "../style.css";
import { attrs, el } from "../ui/dom";
import { holdFocus, releaseFocus, renderKeepingFocus, requestFocus } from "../ui/focus";
import { announce, applyBar, shell, switchRow, type BannerSpec } from "../ui/shell";
import { SCROLL, SENSITIVITY, emptyMouseConfig, friendlyMouseName, type MouseConfig } from "./config";

interface ServerState {
  config: MouseConfig;
  active: boolean;
  present: boolean;
  mice: { name: string; speed: number; scrollFactor: number }[];
  warning?: string;
}

type Tone = "good" | "bad" | "info";
type Busy = "" | "Applying…" | "Resetting…" | "Reading Hyprland…";

const ui = {
  config: emptyMouseConfig(),
  saved: emptyMouseConfig(),
  server: null as ServerState | null,
  serverDown: false,
  serverError: "",
  loaded: false,
  busy: "" as Busy,
  result: { text: "", tone: "info" as Tone },
};

interface NovaState {
  present: boolean;
  dpiStage?: number | null;
  stages?: number;
}

const live = {
  nova: null as NovaState | null,
  error: "",
  checked: false,
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
    say(label === "Reading Hyprland…" ? (e as Error).message : `Couldn't ${label === "Applying…" ? "apply" : "reset"}: ${(e as Error).message}`, "bad");
  } finally {
    ui.busy = "";
    render();
    releaseFocus();
  }
}

const load = () =>
  run("Reading Hyprland…", async () => {
    adopt(await api("/api/mouse"), ui.loaded);
    say("");
  });

const apply = () =>
  run("Applying…", async () => {
    adopt(await api("/api/mouse", { config: ui.config }), true);
    say(`Applied to ${friendlyMouseName(ui.config.device)}.`, "good");
    requestFocus("reset");
  });

const reset = () =>
  run("Resetting…", async () => {
    adopt(await api("/api/mouse/revert", {}), true);
    ui.config = clone(ui.saved);
    say("Back to your Hyprland defaults. Your settings here are saved for next time.", "good");
    requestFocus("apply");
  });

/* ---------- live status (read-only) ---------- */

async function pollStatus(): Promise<void> {
  try {
    const res = await fetch("/api/mouse/status");
    const data = (await res.json().catch(() => ({}))) as NovaState & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    live.nova = data;
    live.error = "";
  } catch (e) {
    live.nova = null;
    live.error = (e as Error).message;
  }
  live.checked = true;
  // Update in place: a full render would replace a slider that is being dragged.
  document.getElementById("nova-status")?.replaceWith(statusBody());
}

function statusBody(): HTMLElement {
  const box = attrs(el("div", { id: "nova-status", class: "stack" }), { role: "status" });
  const n = live.nova;
  if (!live.checked) box.append(el("p", { class: "helper", textContent: "Reading the mouse…" }));
  else if (live.error) {
    const perm = /EACCES|EPERM|permission/i.test(live.error);
    box.append(
      el("p", { class: "result-line bad", textContent: perm ? "This app can't open the mouse." : "Couldn't read the mouse." }),
      el("p", { class: "helper", textContent: perm ? "Install the udev rule for the Nova V3 once (README, Mouse section), then unplug and replug it." : live.error }),
    );
  } else if (n && !n.present) box.append(el("p", { class: "helper", textContent: "The Nova V3 dongle or cable isn't plugged in." }));
  else if (n) {
    const stage = n.dpiStage;
    box.append(
      el("p", { class: "label", textContent: stage ? `DPI stage ${stage} of ${n.stages ?? 6}` : "DPI stage unknown" }),
      el("p", { class: "helper", textContent: stage ? "Press the DPI button on the mouse and this follows it. The DPI value itself isn't readable yet." : "The mouse reported a value this app doesn't recognize." }),
    );
  }
  return box;
}

function statusCard(): HTMLElement {
  const refresh = attrs(el("button", { type: "button", class: "ghost", textContent: "↻ Refresh" }), { "data-fid": "status-refresh" });
  refresh.onclick = () => void pollStatus();
  return el("section", { class: "card" }, el("div", { class: "card-head" }, el("h2", { textContent: "Mouse status" }), refresh), statusBody());
}

/* ---------- pending ---------- */

const LABELS: [keyof MouseConfig, string][] = [
  ["device", "mouse"],
  ["sensitivity", "pointer speed"],
  ["accelProfile", "acceleration"],
  ["scrollFactor", "scroll speed"],
  ["naturalScroll", "natural scroll"],
  ["leftHanded", "left-handed"],
];
const isDefault = (c: MouseConfig) => LABELS.every(([k]) => k === "device" || c[k] === emptyMouseConfig()[k]);
const changed = () => LABELS.filter(([k]) => ui.config[k] !== ui.saved[k]).map(([, name]) => name);

/* ---------- controls ---------- */

function slider(opts: { id: string; label: string; min: number; max: number; step: number; value: number; format: (v: number) => string; ends: [string, string]; helper: string; set: (v: number) => void }): HTMLElement {
  const range = attrs(el("input", { type: "range", id: opts.id, min: String(opts.min), max: String(opts.max), step: String(opts.step), value: String(opts.value) }), {
    "aria-valuetext": opts.format(opts.value),
    "data-fid": opts.id,
    "aria-describedby": `${opts.id}-help`,
  });
  const value = el("span", { class: "value", textContent: opts.format(opts.value) });
  // Re-rendering during a drag replaces the slider under the pointer, so input updates in place and change renders.
  range.oninput = () => {
    const v = Math.round(Number(range.value) * 10) / 10;
    value.textContent = opts.format(v);
    range.setAttribute("aria-valuetext", opts.format(v));
    opts.set(v);
  };
  range.onchange = () => render();
  return el(
    "div",
    { class: "slider" },
    el("div", { class: "head" }, el("label", { htmlFor: opts.id, class: "label", textContent: opts.label }), value),
    range,
    el("div", { class: "ends" }, el("span", { textContent: opts.ends[0] }), el("span", { textContent: opts.ends[1] })),
    el("p", { id: `${opts.id}-help`, class: "helper", textContent: opts.helper }),
  );
}

const signed = (v: number) => (v === 0 ? "Default (0)" : v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

function pointerCard(): HTMLElement {
  const c = ui.config;
  const mice = ui.server?.mice ?? [];
  const select = attrs(el("select", { id: "device", disabled: mice.length === 0 }), { "data-fid": "device" });
  const names = mice.some((m) => m.name === c.device) || !c.device ? mice.map((m) => m.name) : [c.device, ...mice.map((m) => m.name)];
  for (const n of names) select.append(el("option", { value: n, textContent: friendlyMouseName(n), selected: n === c.device }));
  select.onchange = () => {
    c.device = select.value;
    render();
  };

  const accel = attrs(el("select", { id: "accel" }), { "data-fid": "accel" });
  accel.append(
    el("option", { value: "default", textContent: "Default (the pointer speeds up when you move fast)", selected: c.accelProfile === "default" }),
    el("option", { value: "flat", textContent: "Flat (same speed however fast you move)", selected: c.accelProfile === "flat" }),
  );
  accel.onchange = () => {
    c.accelProfile = accel.value === "flat" ? "flat" : "default";
    render();
  };

  return el(
    "section",
    { class: "card" },
    el("h2", { textContent: "Pointer" }),
    el("div", { class: "field" }, el("label", { htmlFor: "device", textContent: "Mouse" }), select, el("p", { class: "helper", textContent: mice.length ? "Settings apply to this mouse only." : "No mouse found." })),
    slider({
      id: "speed",
      label: "Pointer speed",
      min: SENSITIVITY.min,
      max: SENSITIVITY.max,
      step: SENSITIVITY.step,
      value: c.sensitivity,
      format: signed,
      ends: ["Slower", "Faster"],
      helper: "Moves the whole range, on top of the mouse's own DPI.",
      set: (v) => {
        c.sensitivity = v;
      },
    }),
    el("div", { class: "field" }, el("label", { htmlFor: "accel", textContent: "Acceleration" }), accel, el("p", { class: "helper", textContent: "Flat is usual for games and for precise work." })),
  );
}

function scrollCard(): HTMLElement {
  const c = ui.config;
  return el(
    "section",
    { class: "card" },
    el("h2", { textContent: "Scrolling and buttons" }),
    slider({
      id: "scroll",
      label: "Scroll speed",
      min: SCROLL.min,
      max: SCROLL.max,
      step: SCROLL.step,
      value: c.scrollFactor,
      format: (v) => (v === 1 ? "Default (1.0)" : `${v.toFixed(1)}×`),
      ends: ["Slower", "Faster"],
      helper: "How far one wheel notch scrolls.",
      set: (v) => {
        c.scrollFactor = v;
      },
    }),
    switchRow({
      id: "natural",
      label: "Natural scroll",
      helper: "Content follows the wheel, like a phone: scrolling down moves the page up.",
      checked: c.naturalScroll,
      onChange: (v) => {
        c.naturalScroll = v;
        render();
      },
    }),
    switchRow({
      id: "lefty",
      label: "Left-handed",
      helper: "Swaps the left and right buttons. Use Reset if it feels wrong.",
      checked: c.leftHanded,
      onChange: (v) => {
        c.leftHanded = v;
        render();
      },
    }),
  );
}

function notice(): HTMLElement {
  return el("section", { class: "card" }, el("h2", { textContent: "Not available here yet" }), el("p", { class: "helper", textContent: "Setting DPI, polling rate and lighting needs commands that write to the mouse, and their effects aren't known. This app only reads the mouse, it never writes to it." }));
}

function bar(): HTMLElement {
  const s = ui.server;
  const diff = changed();
  const canApply = !!s && !ui.serverDown && s.present && !ui.busy;

  let summary: string;
  let primaryText: string;
  let enabled: boolean;
  if (ui.serverDown) {
    summary = "Can't apply until the local server is running.";
    primaryText = "Apply";
    enabled = false;
  } else if (s?.warning) {
    summary = "Can't apply: Hyprland isn't responding.";
    primaryText = "Apply";
    enabled = false;
  } else if (diff.length > 0) {
    summary = canApply || ui.busy ? `${diff.length} ${diff.length === 1 ? "change" : "changes"} not applied: ${diff.join(", ")}` : "Can't apply: that mouse isn't connected.";
    primaryText = `Apply ${diff.length} ${diff.length === 1 ? "change" : "changes"}`;
    enabled = canApply;
  } else if (s?.active) {
    summary = "Applied. These settings are active and survive a Hyprland reload.";
    primaryText = "Applied";
    enabled = false;
  } else if (s && s.present && !s.active && !isDefault(ui.saved)) {
    summary = "Off. Your settings above are saved but not applied.";
    primaryText = "Apply";
    enabled = canApply;
  } else {
    summary = s && !s.present ? "No mouse found." : "Using your Hyprland defaults. Change something above to apply it.";
    primaryText = "Apply";
    enabled = false;
  }

  const primary = attrs(el("button", { type: "button", class: "primary", textContent: ui.busy === "Applying…" ? "Applying…" : primaryText, disabled: !enabled }), { "data-fid": "apply" });
  if (ui.busy) primary.setAttribute("aria-busy", "true");
  primary.onclick = () => void apply();
  const off = attrs(el("button", { type: "button", textContent: ui.busy === "Resetting…" ? "Resetting…" : "Use defaults", disabled: !!ui.busy || !s?.active }), { "data-fid": "reset" });
  off.onclick = () => void reset();
  return applyBar({ summary, result: ui.serverDown ? { text: "", tone: "info" } : ui.result, secondary: off, primary });
}

function banner(): BannerSpec | null {
  const s = ui.server;
  if (ui.serverDown) {
    const spec: BannerSpec = { tone: "bad", title: "Can't reach the local server", body: "Start it with npm start in the keyboard-config folder, then try again.", retry: () => void load() };
    if (ui.serverError) spec.details = ui.serverError;
    return spec;
  }
  if (s?.warning) return { tone: "warn", title: "Hyprland isn't responding", body: "Changes can't be applied until it does. Check that you're in a Hyprland session.", details: s.warning, retry: () => void load() };
  if (s && !s.present) {
    return {
      tone: "warn",
      title: "That mouse isn't connected",
      body: "Plug in its dongle or turn the mouse on, or pick another mouse in Pointer.",
      detailsLabel: "Mice Hyprland sees",
      details: s.mice.map((m) => m.name).join("\n") || "(none)",
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
        ? { text: "Settings on", tone: "good" as const }
        : { text: "Defaults", tone: "neutral" as const };
  app.replaceChildren(shell({ page: "mouse", title: "Mouse", chip, banner: banner(), main: [el("div", { class: "two-col light" }, pointerCard(), scrollCard()), statusCard(), notice()], bar: bar() }));
}

function render(): void {
  renderKeepingFocus(app, draw);
}

render();
void load();

window.addEventListener("focus", () => void pollStatus());
// Follows the DPI button. Only while the page is visible, and one small read every 2 seconds.
window.setInterval(() => {
  if (document.visibilityState === "visible") void pollStatus();
}, 2000);
void pollStatus();
