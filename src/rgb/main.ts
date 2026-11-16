import "../style.css";
import { BOARD } from "../remap/keys";
import { previewBoard } from "../ui/board";
import { attrs, el } from "../ui/dom";
import { holdFocus, releaseFocus, renderKeepingFocus, requestFocus } from "../ui/focus";
import { announce, applyBar, badge, confirmInline, shell, switchRow, type BannerSpec } from "../ui/shell";
import { CUSTOM_MODE, MODES, type LightSettings } from "./protocol";

interface RgbState {
  present: boolean;
  settings?: LightSettings;
  raw?: string;
  hasBackup?: boolean;
  unrecognized?: boolean;
}

type Tone = "good" | "bad" | "info";
type Busy = "" | "Reading the keyboard…" | "Writing…" | "Restoring…";

// The palette the vendor's own app offers.
const PRESETS: { name: string; hex: string }[] = [
  { name: "Red", hex: "#ff0000" },
  { name: "Orange", hex: "#ff7200" },
  { name: "Yellow", hex: "#fff005" },
  { name: "Green", hex: "#00d70f" },
  { name: "Sky blue", hex: "#0099ff" },
  { name: "Blue", hex: "#3153ff" },
  { name: "Violet", hex: "#5e01d2" },
  { name: "Pink", hex: "#ff16a9" },
  { name: "White", hex: "#ffffff" },
];
const BRIGHTNESS = ["Off", "Low", "Medium", "High", "Max"];
const STATIC = 0x06;

const ui = {
  server: null as RgbState | null,
  edit: null as LightSettings | null,
  serverDown: false,
  serverError: "",
  loadError: "",
  busy: "" as Busy,
  confirmRestore: false,
  result: { text: "", tone: "info" as Tone },
};

const app = document.getElementById("app")!;

const hex = (c: { r: number; g: number; b: number }) => "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("");
const rgb = (h: string) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const dirty = () => !!ui.edit && !!ui.server?.settings && JSON.stringify(ui.edit) !== JSON.stringify(ui.server.settings);
const colorName = (c: { r: number; g: number; b: number }) => PRESETS.find((p) => p.hex === hex(c))?.name ?? hex(c).toUpperCase();
const modeName = (id: number) => (id === CUSTOM_MODE ? "Custom" : (MODES.find((m) => m.id === id)?.name ?? `Mode ${id}`));

async function api(path: string, body?: unknown): Promise<RgbState> {
  let res: Response;
  try {
    res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    ui.serverDown = true;
    ui.serverError = (e as Error).message;
    throw new Error("Can't reach the local server.");
  }
  ui.serverDown = false;
  const data = (await res.json().catch(() => ({}))) as RgbState & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function adopt(s: RgbState): void {
  ui.server = s;
  ui.edit = s.settings ? structuredClone(s.settings) : null;
}

function say(text: string, tone: Tone = "info"): void {
  ui.result = { text, tone };
  if (text) announce(text, tone === "bad");
}

async function run(label: Exclude<Busy, "">, task: () => Promise<void>, failure: (m: string) => string): Promise<void> {
  if (ui.busy) return;
  ui.busy = label;
  holdFocus(app);
  render();
  try {
    await task();
  } catch (e) {
    say(failure((e as Error).message), "bad");
  } finally {
    ui.busy = "";
    render();
    releaseFocus();
  }
}

/** Reads the keyboard. */
const load = () =>
  run(
    "Reading the keyboard…",
    async () => {
      try {
        adopt(await api("/api/rgb"));
        ui.loadError = "";
        say("");
      } catch (e) {
        if (!ui.server && !ui.serverDown) ui.loadError = (e as Error).message;
        throw e;
      }
    },
    (m) => m,
  );

/** The automatic re-read when the window gets focus: no busy state, so the controls don't flash. */
async function quietReload(): Promise<void> {
  if (ui.busy) return;
  try {
    const before = ui.server?.settings ? JSON.stringify(ui.server.settings) : null;
    adopt(await api("/api/rgb"));
    ui.loadError = "";
    if (before !== null && ui.server?.settings && JSON.stringify(ui.server.settings) !== before) say("Updated from the keyboard. It was changed there, maybe with the Fn keys.");
  } catch {
    // Keep what is on screen. A dead server still shows its banner through ui.serverDown.
  }
  if (!ui.busy) render();
}

const write = (settings: LightSettings, done: string) =>
  run(
    "Writing…",
    async () => {
      adopt(await api("/api/rgb", settings));
      ui.confirmRestore = false;
      requestFocus("apply");
      say(done, "good");
    },
    (m) => `Couldn't write: ${m}. Re-read the keyboard to see what it holds now.`,
  );

const restore = () =>
  run(
    "Restoring…",
    async () => {
      adopt(await api("/api/rgb/restore", {}));
      ui.confirmRestore = false;
      requestFocus("restore");
      say("Original lighting restored.", "good");
    },
    (m) => `Couldn't restore: ${m}`,
  );

/* ---------- controls ---------- */

function stepped(opts: { id: string; label: string; value: number; words: string[]; disabled?: boolean; reason?: string; helper?: string; set: (v: number) => void }): HTMLElement {
  const range = attrs(el("input", { type: "range", id: opts.id, min: "0", max: "4", step: "1", value: String(opts.value), disabled: !!opts.disabled }), {
    "aria-valuetext": `${opts.words[opts.value]} (${opts.value} of 4)`,
    "data-fid": opts.id,
  });
  const value = el("span", { class: "value", textContent: opts.words[opts.value] ?? "" });
  // Re-rendering during a drag replaces the slider under the pointer, so input only updates in place and change renders.
  range.oninput = () => {
    const v = Number(range.value);
    value.textContent = opts.words[v] ?? "";
    range.setAttribute("aria-valuetext", `${opts.words[v]} (${v} of 4)`);
    opts.set(v);
  };
  range.onchange = () => render();
  const ticks = el("div", { class: "ticks" }, ...opts.words.map((w, i) => {
    const t = el("span", { textContent: w });
    t.style.setProperty("--i", String(i));
    return t;
  }));
  const node = el(
    "div",
    { class: "slider" },
    el("div", { class: "head" }, el("label", { htmlFor: opts.id, class: "label", textContent: opts.label }), value),
    range,
    ticks,
  );
  if (opts.disabled && opts.reason) node.append(el("p", { class: "helper", textContent: opts.reason }));
  else if (opts.helper) node.append(el("p", { class: "helper", textContent: opts.helper }));
  return node;
}

function controls(e: LightSettings, disabled: boolean): HTMLElement {
  const sel = attrs(el("select", { id: "mode", disabled }), { "data-fid": "mode" });
  if (e.mode === CUSTOM_MODE) sel.append(el("option", { value: String(CUSTOM_MODE), textContent: "Custom (per-key, set on keyboard)", selected: true }));
  const tested = el("optgroup", { label: "Tested on this keyboard" }, el("option", { value: String(STATIC), textContent: "Static", selected: e.mode === STATIC }));
  const untested = el("optgroup", { label: "Untested" });
  for (const m of MODES) if (m.id !== STATIC) untested.append(el("option", { value: String(m.id), textContent: m.name, selected: m.id === e.mode }));
  sel.append(tested, untested);
  sel.onchange = () => {
    e.mode = Number(sel.value);
    render();
  };
  const modeHelp = el("p", { class: "helper" });
  if (e.mode === STATIC) modeHelp.textContent = "Tested on this keyboard.";
  else modeHelp.append(badge("Untested", "untested"), " Not tested on the Rover 84 yet. It may not look like its name. Switch back to Static any time.");

  const picker = attrs(el("input", { type: "color", id: "color-custom", value: hex(e.color), disabled }), { "data-fid": "color-custom" });
  picker.oninput = () => {
    e.color = rgb(picker.value);
    refreshPreview(e);
  };
  picker.onchange = () => render();
  const swatches = el("div", { class: "swatches" });
  for (const p of PRESETS) {
    const dot = el("span", { class: "dot" });
    dot.style.background = p.hex;
    const b = attrs(el("button", { type: "button", class: "swatch", disabled }, dot), { "aria-pressed": hex(e.color) === p.hex, "aria-label": p.name, "data-fid": `swatch-${p.name}` });
    b.onclick = () => {
      e.color = rgb(p.hex);
      render();
    };
    swatches.append(b);
  }
  const isPreset = PRESETS.some((p) => p.hex === hex(e.color));
  const custom = el("div", { class: `custom${isPreset ? "" : " selected"}` }, picker, el("label", { htmlFor: "color-custom", class: "label", textContent: "Custom" }));

  const animated = e.mode !== STATIC;
  return el(
    "div",
    { class: "stack" },
    el("div", { class: "field" }, el("label", { htmlFor: "mode", textContent: "Mode" }), sel, modeHelp),
    el("div", { class: "field" }, el("span", { class: "label", id: "color-label", textContent: "Color" }), el("div", { class: "row" }, swatches, custom)),
    stepped({ id: "brightness", label: "Brightness", value: e.brightness, words: BRIGHTNESS, disabled, set: (v) => ((e.brightness = v), refreshPreview(e)) }),
    stepped({
      id: "speed",
      label: "Speed",
      value: e.speed,
      words: ["0", "1", "2", "3", "4"],
      disabled: disabled || !animated,
      reason: "Static doesn't animate, so speed has no effect.",
      helper: "Only affects animated modes. It isn't confirmed yet whether higher means faster or slower.",
      set: (v) => { e.speed = v; },
    }),
    switchRow({
      id: "random",
      label: "Random colors",
      helper: "Let the mode pick its own colors instead of the one above. Untested on this keyboard.",
      checked: e.multicolor,
      disabled,
      onChange: (v) => ((e.multicolor = v), render()),
    }),
  );
}

const captionFor = (e: LightSettings) =>
  e.mode === CUSTOM_MODE ? "Custom · set on the keyboard" : `${modeName(e.mode)} · ${e.multicolor ? "Random colors" : colorName(e.color)} · ${BRIGHTNESS[e.brightness]}`;

function plateFor(e: LightSettings): HTMLElement {
  const custom = e.mode === CUSTOM_MODE;
  return previewBoard(
    BOARD.map((k) => ({ x: k.x, y: k.y, w: k.w })),
    { led: hex(e.color), brightness: e.brightness, random: e.multicolor && !custom, off: custom, label: `Preview: ${captionFor(e)}` },
  );
}

/** Updates the preview in place while a slider or the color picker is being dragged. */
function refreshPreview(e: LightSettings): void {
  document.querySelector(".plate")?.replaceWith(plateFor(e));
  const caption = document.querySelector(".preview-caption");
  if (caption) caption.textContent = captionFor(e);
}

const nearlyBlack = (c: { r: number; g: number; b: number }) => Math.max(c.r, c.g, c.b) < 0x50;

function previewCard(e: LightSettings, loading = false): HTMLElement {
  const custom = e.mode === CUSTOM_MODE;
  const caption = loading ? "Reading the keyboard…" : captionFor(e);
  const reread = attrs(el("button", { type: "button", class: "ghost", textContent: "↻ Re-read keyboard", disabled: !!ui.busy }), { "data-fid": "reread" });
  reread.onclick = () => void load();
  const notes = [
    custom ? "Custom per-key lighting is set on the keyboard. This app can't show or edit it." : "Color and brightness only; animations aren't shown.",
    "Re-reads when you come back to this window, because the keyboard's Fn keys can change it too.",
  ];
  if (e.multicolor && !custom) notes.unshift("Random colors: example pattern.");
  if (!loading && !custom && !e.multicolor && e.brightness > 0 && nearlyBlack(e.color)) notes.unshift("This color is nearly black, so the keys look off. Pick a brighter color to see them light up.");
  return el(
    "section",
    { class: "card preview" },
    el("div", { class: "card-head" }, el("h2", { textContent: "Preview" }), reread),
    plateFor(e),
    el("p", { class: "label preview-caption", textContent: caption }),
    ...(loading ? [] : notes.map((n) => el("p", { class: "helper", textContent: n }))),
  );
}

function restoreCard(s: RgbState): HTMLElement {
  const body = el("div", { class: "stack" });
  if (ui.confirmRestore) {
    body.append(
      confirmInline({
        question: "Replace the current lighting with the original?",
        yes: ui.busy === "Restoring…" ? "Restoring…" : "Yes, restore",
        busy: !!ui.busy,
        onYes: () => void restore(),
        onCancel: () => {
          ui.confirmRestore = false;
          requestFocus("restore");
          render();
        },
      }),
    );
  } else {
    const b = attrs(el("button", { type: "button", class: "danger", textContent: "Restore original", disabled: !!ui.busy || !s.hasBackup }), { "data-fid": "restore" });
    b.onclick = () => {
      ui.confirmRestore = true;
      requestFocus("confirm-cancel");
      render();
    };
    body.append(b);
    if (!s.hasBackup) body.append(el("p", { class: "helper", textContent: "Nothing to restore yet. The original is saved the first time you apply." }));
  }
  return el(
    "section",
    { class: "card restore" },
    el("h2", { textContent: "Restore original lighting" }),
    el("p", { class: "helper", textContent: "Puts back the lighting the keyboard had before this app first changed it." }),
    body,
  );
}

function banner(): BannerSpec | null {
  const s = ui.server;
  if (ui.serverDown) {
    const spec: BannerSpec = { tone: "bad", title: "Can't reach the local server", body: "Start it with npm start in the keyboard-config folder, then try again.", retry: () => void load() };
    if (ui.serverError) spec.details = ui.serverError;
    return spec;
  }
  if (!s && ui.loadError) {
    if (/EACCES|EPERM|permission/i.test(ui.loadError)) {
      return {
        tone: "bad",
        title: "The app can't open the Rover 84",
        body: "It's plugged in, but this app doesn't have permission. Install the udev rule once (README, Lighting section), then unplug and replug the keyboard.",
        details: ui.loadError,
        retry: () => void load(),
      };
    }
    return { tone: "bad", title: "Couldn't read the keyboard", body: "Unplug it and plug it back in, then try again.", details: ui.loadError, retry: () => void load() };
  }
  if (s && !s.present) {
    return {
      tone: "bad",
      title: "Can't open the Rover 84",
      body: "Plug the keyboard in with a USB cable. If it's already plugged in, the app may not have permission. Install the udev rule once (README, Lighting section), then unplug and replug it.",
      retry: () => void load(),
    };
  }
  if (s?.unrecognized) {
    return { tone: "warn", title: "Writing is off to protect the keyboard", body: "It holds a lighting record this app doesn't recognize.", detailsLabel: "Raw record", details: s.raw ?? "" };
  }
  return null;
}

function draw(): void {
  const s = ui.server;
  const e = ui.edit;
  const chip = ui.serverDown
    ? { text: "Server offline", tone: "bad" as const }
    : !s
      ? ui.loadError
        ? { text: "Keyboard not found", tone: "bad" as const }
        : { text: "Reading…", tone: "neutral" as const }
      : s.present
        ? { text: "Keyboard connected", tone: "good" as const }
        : { text: "Keyboard not found", tone: "bad" as const };

  const main: HTMLElement[] = [];
  let bar: HTMLElement | null = null;

  if (!s) {
    // Loading: draw the dark plate and disabled controls so the page is never blank. Not when the load already failed.
    if (!ui.loadError && !ui.serverDown) {
      const idle: LightSettings = { mode: STATIC, brightness: 0, speed: 0, multicolor: false, color: { r: 0, g: 0, b: 0 } };
      main.push(el("div", { class: "two-col light" }, previewCard(idle, true), el("section", { class: "card controls" }, el("h2", { textContent: "Backlight" }), controls(idle, true))));
    }
  } else if (s.present && e) {
    const blocked = !!s.unrecognized;
    const off = attrs(el("button", { type: "button", textContent: "Turn lights off", disabled: !!ui.busy || blocked }), { "data-fid": "lights-off" });
    off.onclick = () => void write({ ...e, brightness: 0 }, "Lights off. Written and verified.");
    const changed = dirty();
    const apply = attrs(el("button", { type: "button", class: changed ? "primary" : "", textContent: ui.busy === "Writing…" ? "Writing…" : changed ? "Apply to keyboard" : "Write again", disabled: !!ui.busy || blocked }), { "data-fid": "apply" });
    if (ui.busy) apply.setAttribute("aria-busy", "true");
    apply.onclick = () => void write(e, "Written and verified.");
    bar = applyBar({ summary: changed ? "Not written yet" : "Matches what the keyboard holds.", result: ui.busy ? { text: ui.busy, tone: "info" } : ui.result, secondary: off, primary: apply });

    main.push(
      el(
        "div",
        { class: "two-col light" },
        blocked ? "" : previewCard(e),
        el("section", { class: "card controls" }, el("h2", { textContent: "Backlight" }), controls(e, blocked || ui.busy === "Writing…" || ui.busy === "Restoring…")),
        blocked ? "" : restoreCard(s),
      ),
    );
  }

  app.replaceChildren(shell({ page: "rgb", title: "Lighting", chip, banner: banner(), main, bar }));
}

function render(): void {
  renderKeepingFocus(app, draw);
}

window.addEventListener("focus", () => {
  if (!ui.busy && !dirty() && !ui.serverDown) void quietReload();
});

render();
void load();
