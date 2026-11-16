import "./style.css";
import { describe, pickerKeycodes, type Category } from "./keycodes";
import { ansi60 } from "./layout";
import { exportKeymap, importKeymap } from "./storage";
import { interactiveBoard, type CapSpec } from "./ui/board";
import { attrs, el } from "./ui/dom";
import { renderKeepingFocus, requestFocus } from "./ui/focus";
import { announce, confirmInline, shell } from "./ui/shell";
import { MockTransport } from "./via/mock";
import { ViaClient, type Keymap, type Transport } from "./via/protocol";
import { requestViaDevice, webHidSupported, type WebHidTransport } from "./via/webhid";

const CATEGORIES: Category[] = ["Letters", "Numbers", "Punctuation", "Modifiers", "Function", "Navigation", "Layers", "Special"];

type Tone = "good" | "bad" | "info";

interface State {
  client: ViaClient | null;
  keymap: Keymap;
  layer: number;
  selected: { row: number; col: number } | null;
  category: Category;
  search: string;
  busy: boolean;
  confirmReset: boolean;
  result: { text: string; tone: Tone };
}

const state: State = {
  client: null,
  keymap: [],
  layer: 0,
  selected: null,
  category: "Letters",
  search: "",
  busy: false,
  confirmReset: false,
  result: { text: "", tone: "info" },
};

const layout = ansi60;
const app = document.getElementById("app")!;
let hidTransport: WebHidTransport | null = null;

function say(text: string, tone: Tone = "info"): void {
  state.result = { text, tone };
  if (text) announce(text, tone === "bad");
  render();
}

async function connect(open: () => Promise<{ transport: Transport; label: string }>): Promise<void> {
  try {
    state.busy = true;
    say("Connecting…");
    await hidTransport?.close().catch(() => undefined);
    hidTransport = null;
    const { transport, label } = await open();
    const client = new ViaClient(transport);
    const version = await client.getProtocolVersion();
    const keymap = await client.readKeymap(layout.rows, layout.cols);
    state.client = client;
    state.keymap = keymap;
    state.layer = 0;
    state.selected = null;
    state.busy = false;
    say(`Connected to ${label} (${keymap.length} layers). VIA protocol v${version}.`, "good");
  } catch (e) {
    state.client = null;
    state.busy = false;
    const err = e as Error;
    // Closing the browser's device chooser is a choice, not a failure.
    if (err.name === "NotFoundError" || /no device selected/i.test(err.message)) say("");
    else say(`Couldn't connect: ${err.message}`, "bad");
  }
}

const connectMock = () => connect(async () => ({ transport: new MockTransport(layout.defaultKeymap, 2), label: "the demo keyboard" }));

const connectKeyboard = () =>
  connect(async () => {
    const t = await requestViaDevice();
    hidTransport = t;
    return { transport: t, label: `${t.name} (using generic ${layout.name} layout)` };
  });

async function assign(keycode: number): Promise<void> {
  const { client, selected, layer } = state;
  if (!client || !selected) return;
  try {
    await client.setKeycode(layer, selected.row, selected.col, keycode);
    state.keymap[layer]![selected.row]![selected.col] = keycode;
    say(`Layer ${layer} · row ${selected.row} col ${selected.col} → ${describe(keycode).label}`, "good");
  } catch (e) {
    say(`Couldn't write: ${(e as Error).message}`, "bad");
  }
}

async function resetKeymap(): Promise<void> {
  if (!state.client) return;
  try {
    await state.client.resetKeymap();
    state.keymap = await state.client.readKeymap(layout.rows, layout.cols);
    state.confirmReset = false;
    say("Keymap reset to defaults.", "good");
  } catch (e) {
    state.confirmReset = false;
    say(`Couldn't reset: ${(e as Error).message}`, "bad");
  }
}

function downloadKeymap(): void {
  const blob = new Blob([exportKeymap(layout.name, state.keymap)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "keymap.json" });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function loadKeymapFile(file: File): Promise<void> {
  const { client } = state;
  if (!client) return;
  try {
    const next = importKeymap(await file.text(), state.keymap.length, layout.rows, layout.cols);
    const written = await client.writeKeymap(next, state.keymap);
    state.keymap = next;
    say(`Imported ${file.name} · ${written} keys written`, "good");
  } catch (e) {
    say(`Couldn't import: ${(e as Error).message}`, "bad");
  }
}

/** QMK names are for the keyboard firmware; show plain key names on the board and keep the QMK name in the label. */
function friendlyLegend(label: string): string {
  return label
    .replace(/^[LR]Gui$/, "Super")
    .replace(/^[LR](Shift|Ctrl|Alt)$/, "$1")
    .replace(/^MO\((\d+)\)$/, "Fn $1");
}

function capSpecs(): CapSpec[] {
  const grid = state.keymap[state.layer];
  return layout.keys.map((k) => {
    const keycode = grid?.[k.row]?.[k.col] ?? 0;
    const { label, known } = describe(keycode);
    return {
      id: `${k.row}-${k.col}`,
      x: k.x,
      y: k.y,
      w: k.w,
      legend: friendlyLegend(label),
      label: `Row ${k.row}, column ${k.col}: ${label}`,
      pressed: state.selected?.row === k.row && state.selected?.col === k.col,
      classes: [keycode === 1 ? "trns" : "", known ? "" : "unknown"].filter(Boolean),
      onClick: () => {
        state.selected = { row: k.row, col: k.col };
        render();
      },
    };
  });
}

function picker(): HTMLElement {
  const query = state.search.trim().toLowerCase();
  const items = pickerKeycodes(state.keymap.length).filter((k) => (query ? `${k.name} ${k.label}`.toLowerCase().includes(query) : k.category === state.category));
  const ready = !!state.selected;

  const search = attrs(el("input", { type: "search", id: "via-search", placeholder: "Search keycodes", value: state.search, disabled: !ready }), { "data-fid": "search" });
  search.oninput = () => {
    state.search = search.value;
    render();
  };

  const tabs = el("div", { class: "tabs" });
  for (const c of CATEGORIES) {
    const b = attrs(el("button", { type: "button", textContent: c }), { "aria-pressed": !query && state.category === c, "data-fid": `tab-${c}` });
    b.onclick = () => {
      state.category = c;
      state.search = "";
      render();
    };
    tabs.append(b);
  }

  const grid = el("div", { class: "picker-grid" });
  for (const k of items) {
    const b = attrs(el("button", { type: "button", textContent: k.label, title: k.name, disabled: !ready }), { "data-fid": `pick-${k.code}` });
    b.onclick = () => void assign(k.code);
    grid.append(b);
  }

  return el(
    "section",
    { class: "card inspector" },
    el("div", { class: "card-head" }, el("h2", { textContent: "Keycodes" })),
    el("p", { class: "helper", textContent: ready ? `Layer ${state.layer} · row ${state.selected!.row}, col ${state.selected!.col}` : "Select a key on the board first." }),
    el("div", { class: "field" }, el("label", { htmlFor: "via-search", class: "caption", textContent: "Search" }), search),
    tabs,
    items.length ? grid : el("p", { class: "helper", textContent: `No keycode matches "${state.search}".` }),
  );
}

function emptyState(): HTMLElement {
  const supported = webHidSupported();
  const hid = attrs(el("button", { type: "button", textContent: "Connect a VIA keyboard", disabled: !supported || state.busy }), { "data-fid": "connect" });
  hid.onclick = () => void connectKeyboard();
  const mock = attrs(el("button", { type: "button", textContent: "Try a demo keyboard", disabled: state.busy }), { "data-fid": "demo" });
  mock.onclick = () => void connectMock();
  return el(
    "section",
    { class: "card empty" },
    el("h2", { textContent: "For keyboards with VIA firmware" }),
    el(
      "p",
      {},
      "This editor changes keymaps on QMK keyboards that have VIA enabled. Your Rover 84 doesn't use VIA, so use ",
      el("a", { href: "/", textContent: "Key remap" }),
      " and ",
      el("a", { href: "/rgb.html", textContent: "Lighting" }),
      " for it instead.",
    ),
    el("div", { class: "row" }, hid, mock),
    supported ? "" : el("p", { class: "helper", textContent: "Needs Chrome or Edge (WebHID)." }),
    state.result.text ? el("p", { class: `helper${state.result.tone === "bad" ? " bad-text" : ""}`, textContent: state.result.text }) : "",
  );
}

function boardCard(): HTMLElement {
  const layerTabs = el("div", { class: "tabs" });
  state.keymap.forEach((_, i) => {
    const b = attrs(el("button", { type: "button", textContent: `Layer ${i}` }), { "aria-pressed": state.layer === i, "data-fid": `layer-${i}` });
    b.onclick = () => {
      state.layer = i;
      render();
    };
    layerTabs.append(b);
  });

  const fileInput = el("input", { type: "file", accept: "application/json", hidden: true });
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (f) void loadKeymapFile(f);
  };
  const importBtn = attrs(el("button", { type: "button", textContent: "Import JSON" }), { "data-fid": "import" });
  importBtn.onclick = () => fileInput.click();
  const exportBtn = attrs(el("button", { type: "button", textContent: "Export JSON" }), { "data-fid": "export" });
  exportBtn.onclick = downloadKeymap;

  let reset: HTMLElement;
  if (state.confirmReset) {
    reset = confirmInline({
      question: "Reset every key on every layer to the firmware default?",
      yes: "Yes, reset",
      onYes: () => void resetKeymap(),
      onCancel: () => {
        state.confirmReset = false;
        requestFocus("reset");
        render();
      },
    });
  } else {
    reset = attrs(el("button", { type: "button", class: "danger", textContent: "Reset to defaults" }), { "data-fid": "reset" });
    reset.onclick = () => {
      state.confirmReset = true;
      requestFocus("confirm-cancel");
      render();
    };
  }

  const result = state.result.text ? el("p", { class: `result-line ${state.result.tone === "info" ? "" : state.result.tone}`.trim(), textContent: state.result.text }) : "";
  return el(
    "section",
    { class: "card board-card" },
    el("div", { class: "card-head" }, layerTabs, el("span", { class: "grow" }), importBtn, exportBtn, reset, fileInput),
    result,
    interactiveBoard(capSpecs(), { cols: Math.max(...layout.keys.map((k) => k.x + k.w)), rows: Math.max(...layout.keys.map((k) => k.y + 1)) }),
  );
}

function draw(): void {
  const connected = state.client !== null;
  app.replaceChildren(
    shell({
      page: "via",
      title: "VIA editor",
      chip: connected ? { text: "Connected", tone: "good" } : { text: "Not connected", tone: "neutral" },
      main: connected ? [el("div", { class: "two-col remap" }, boardCard(), picker())] : [emptyState()],
    }),
  );
}

function render(): void {
  renderKeepingFocus(app, draw);
}

render();
