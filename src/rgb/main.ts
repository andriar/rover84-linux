import "../style.css";
import { el } from "../ui/dom";
import { CUSTOM_MODE, MODES, type LightSettings } from "./protocol";

interface RgbState {
  present: boolean;
  settings?: LightSettings;
  raw?: string;
  hasBackup?: boolean;
  unrecognized?: boolean;
}

// Presets are the palette the vendor's own app offers.
const PRESETS = ["#ff0000", "#ff7200", "#fff005", "#00d70f", "#0099ff", "#3153ff", "#5e01d2", "#ff16a9", "#ffffff"];
const LEVELS = ["Off", "1", "2", "3", "Max"];

const ui = {
  server: null as RgbState | null,
  edit: null as LightSettings | null,
  busy: false,
  confirmRestore: false,
  status: { text: "Loading…", error: false },
};

const app = document.getElementById("app")!;

const hex = (c: { r: number; g: number; b: number }) => "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("");
const rgb = (h: string) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });
const dirty = () => !!ui.edit && !!ui.server?.settings && JSON.stringify(ui.edit) !== JSON.stringify(ui.server.settings);

async function api(path: string, body?: unknown): Promise<RgbState> {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as RgbState & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

function adopt(s: RgbState): void {
  ui.server = s;
  ui.edit = s.settings ? structuredClone(s.settings) : null;
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
  run("Reading the keyboard…", async () => {
    adopt(await api("/api/rgb"));
    setStatus(ui.server?.present ? "Ready" : "Keyboard not found", !ui.server?.present);
  });

const applyEdit = (e: LightSettings, done: string) =>
  run("Writing to the keyboard…", async () => {
    adopt(await api("/api/rgb", e));
    ui.confirmRestore = false;
    setStatus(done);
  });

const restore = () =>
  run("Restoring…", async () => {
    adopt(await api("/api/rgb/restore", {}));
    ui.confirmRestore = false;
    setStatus("Original lighting restored");
  });

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el("div", { class: "field" }, el("label", { textContent: label }), control, hint ? el("p", { class: "hint", textContent: hint }) : "");
}

function renderControls(e: LightSettings): HTMLElement {
  const modeSel = el("select");
  modeSel.setAttribute("aria-label", "Lighting mode");
  if (e.mode === CUSTOM_MODE) modeSel.append(el("option", { value: String(CUSTOM_MODE), textContent: "Custom (per-key, current)", selected: true }));
  for (const m of MODES) modeSel.append(el("option", { value: String(m.id), textContent: m.name, selected: m.id === e.mode }));
  modeSel.onchange = () => {
    e.mode = Number(modeSel.value);
    render();
  };

  const picker = el("input", { type: "color", value: hex(e.color) });
  picker.setAttribute("aria-label", "Color");
  picker.oninput = () => {
    e.color = rgb(picker.value);
    render();
  };
  const swatches = el("div", { class: "swatches" });
  for (const p of PRESETS) {
    const b = el("button", { class: "swatch", title: p });
    b.style.background = p;
    b.setAttribute("aria-label", `Color ${p}`);
    b.setAttribute("aria-pressed", String(hex(e.color) === p));
    b.onclick = () => {
      e.color = rgb(p);
      render();
    };
    swatches.append(b);
  }

  const level = (name: string, value: number, set: (v: number) => void) => {
    const r = el("input", { type: "range", min: "0", max: "4", step: "1", value: String(value) });
    r.setAttribute("aria-label", name);
    r.oninput = () => {
      set(Number(r.value));
      render();
    };
    return el("div", { class: "range" }, r, el("span", { class: "range-val", textContent: name === "Brightness" ? LEVELS[value]! : String(value) }));
  };

  const multi = el("input", { type: "checkbox", checked: e.multicolor });
  multi.setAttribute("aria-label", "Random colors");
  multi.onchange = () => {
    e.multicolor = multi.checked;
    render();
  };

  return el(
    "div",
    { class: "controls" },
    field("Mode", modeSel, "Only Static has been confirmed on this keyboard. Other modes are sent as-is and may look different."),
    field("Color", el("div", { class: "color-row" }, picker, swatches)),
    field("Brightness", level("Brightness", e.brightness, (v) => (e.brightness = v))),
    field("Speed", level("Speed", e.speed, (v) => (e.speed = v)), "Applies to animated modes. Which end is faster is not confirmed."),
    field("Random colors", el("label", { class: "check" }, multi, " Let the mode pick its own colors")),
  );
}

function render(): void {
  const s = ui.server;
  const e = ui.edit;

  const header = el(
    "header",
    {},
    el("h1", { textContent: "Keyboard Lighting" }),
    el("span", { class: `status${ui.status.error ? " error" : ""}`, textContent: ui.status.text }),
    el("a", { href: "/", textContent: "← Key remap", class: "link" }),
  );
  header.querySelector(".status")?.setAttribute("role", "status");

  const badge = (text: string, tone: "ok" | "warn" | "muted") => el("span", { class: `badge ${tone}`, textContent: text });
  const badges = el("div", { class: "toolbar" });
  if (s) badges.append(s.present ? badge("Keyboard connected", "ok") : badge("Not found", "warn"));
  if (dirty()) badges.append(badge("Not written yet", "warn"));

  const sections: HTMLElement[] = [];

  if (s && !s.present) {
    sections.push(
      el(
        "section",
        { class: "card" },
        el("p", { textContent: "The Rover 84 vendor interface was not found or cannot be opened." }),
        el("p", { class: "hint", textContent: "Check that the keyboard is plugged in by cable, and that the udev rule for 320f:5055 is installed (see README). Then reload." }),
        el("div", { class: "toolbar" }, Object.assign(el("button", { textContent: "Try again", disabled: ui.busy }), { onclick: () => void load() })),
      ),
    );
  }

  if (s?.unrecognized) {
    sections.push(
      el("section", { class: "card warn-card" }, el("p", { textContent: "The keyboard holds a lighting record this app does not recognize, so writing is disabled to avoid damaging it." }), el("p", { class: "hint", textContent: `Raw record: ${s.raw ?? ""}` })),
    );
  }

  if (e && s?.present) {
    const preview = el("div", { class: "preview" });
    const k = e.brightness / 4;
    preview.style.background = e.multicolor ? "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f)" : hex(e.color);
    preview.style.opacity = String(0.15 + 0.85 * k);
    preview.setAttribute("role", "img");
    preview.setAttribute("aria-label", "Approximate color preview");

    const apply = el("button", { class: "primary", textContent: dirty() ? "Apply to keyboard" : "Apply again", disabled: ui.busy || !!s.unrecognized });
    apply.onclick = () => void applyEdit(e, "Written to the keyboard and verified");
    const off = el("button", { textContent: "Turn lights off", disabled: ui.busy || !!s.unrecognized });
    off.onclick = () => void applyEdit({ ...e, brightness: 0 }, "Lights off, written and verified");

    const reloadBtn = el("button", { textContent: "Read from keyboard", disabled: ui.busy, title: "The keyboard's own Fn keys also change the lighting. Read what it holds now." });
    reloadBtn.onclick = () => void load();

    let restoreBtn: HTMLElement;
    if (ui.confirmRestore) {
      const yes = el("button", { class: "danger", textContent: "Yes, restore original", disabled: ui.busy });
      yes.onclick = () => void restore();
      const no = el("button", { textContent: "Cancel" });
      no.onclick = () => {
        ui.confirmRestore = false;
        render();
      };
      restoreBtn = el("span", { class: "toolbar" }, yes, no);
    } else {
      const b = el("button", { textContent: "Restore original", disabled: ui.busy || !s.hasBackup, title: s.hasBackup ? "Put back the lighting the keyboard had before this app first changed it" : "Nothing saved yet. The original is saved the first time you apply." });
      b.onclick = () => {
        ui.confirmRestore = true;
        render();
      };
      restoreBtn = b;
    }

    sections.push(
      el(
        "section",
        { class: "card" },
        el("div", { class: "toolbar" }, el("h2", { textContent: "Backlight" }), el("span", { class: "spacer" }), badges),
        preview,
        renderControls(e),
        el("div", { class: "toolbar" }, restoreBtn, reloadBtn, el("span", { class: "spacer" }), off, apply),
        el("p", { class: "hint", textContent: "Changes are written to the keyboard only when you press Apply, and each write is read back to check it. The keyboard keeps the setting itself." }),
      ),
    );
  }

  app.replaceChildren(el("div", { class: "shell" }, header, ...sections));
}

window.addEventListener("focus", () => {
  if (!ui.busy && !dirty()) void load();
});

render();
void load();
