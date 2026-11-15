import "./style.css";
import { el } from "./ui/dom";
import { describe, pickerKeycodes, type Category } from "./keycodes";
import { ansi60 } from "./layout";
import { exportKeymap, importKeymap } from "./storage";
import { MockTransport } from "./via/mock";
import { ViaClient, type Keymap, type Transport } from "./via/protocol";
import { requestViaDevice, webHidSupported, type WebHidTransport } from "./via/webhid";

const UNIT = 54;
const CATEGORIES: Category[] = ["Letters", "Numbers", "Punctuation", "Modifiers", "Function", "Navigation", "Layers", "Special"];

interface State {
  client: ViaClient | null;
  keymap: Keymap;
  layer: number;
  selected: { row: number; col: number } | null;
  category: Category | "All";
  search: string;
  status: { text: string; error: boolean };
}

const state: State = {
  client: null,
  keymap: [],
  layer: 0,
  selected: null,
  category: "Letters",
  search: "",
  status: { text: "Not connected", error: false },
};

const layout = ansi60;
const app = document.getElementById("app")!;

function setStatus(text: string, error = false): void {
  state.status = { text, error };
  render();
}

let hidTransport: WebHidTransport | null = null;

async function connect(open: () => Promise<{ transport: Transport; label: string }>): Promise<void> {
  try {
    setStatus("Connecting…");
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
    setStatus(`Connected to ${label} · VIA protocol v${version} · ${keymap.length} layers`);
  } catch (e) {
    state.client = null;
    setStatus(`Connect failed: ${(e as Error).message}`, true);
  }
}

const connectMock = () =>
  connect(async () => ({ transport: new MockTransport(layout.defaultKeymap, 2), label: layout.name }));

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
    setStatus(`Layer ${layer} · row ${selected.row} col ${selected.col} → ${describe(keycode).label}`);
  } catch (e) {
    setStatus(`Write failed: ${(e as Error).message}`, true);
  }
}

async function resetKeymap(): Promise<void> {
  if (!state.client) return;
  try {
    await state.client.resetKeymap();
    state.keymap = await state.client.readKeymap(layout.rows, layout.cols);
    setStatus("Keymap reset to defaults");
  } catch (e) {
    setStatus(`Reset failed: ${(e as Error).message}`, true);
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
    setStatus(`Imported ${file.name} · ${written} keys written`);
  } catch (e) {
    setStatus(`Import failed: ${(e as Error).message}`, true);
  }
}

function renderBoard(): HTMLElement {
  const width = Math.max(...layout.keys.map((k) => k.x + k.w)) * UNIT;
  const board = el("div", { class: "board" });
  board.style.width = `${width}px`;
  board.style.height = `${layout.rows * UNIT}px`;
  const grid = state.keymap[state.layer];

  for (const k of layout.keys) {
    const keycode = grid?.[k.row]?.[k.col] ?? 0;
    const { label, known } = describe(keycode);
    const selected = state.selected?.row === k.row && state.selected?.col === k.col;
    const btn = el("button", { class: `key${keycode === 1 ? " trns" : ""}${known ? "" : " unknown"}`, textContent: label });
    btn.style.left = `${k.x * UNIT}px`;
    btn.style.top = `${k.y * UNIT}px`;
    btn.style.width = `${k.w * UNIT - 4}px`;
    btn.title = `row ${k.row}, col ${k.col} · 0x${keycode.toString(16).padStart(4, "0")}`;
    btn.setAttribute("aria-pressed", String(selected));
    btn.onclick = () => {
      state.selected = { row: k.row, col: k.col };
      render();
    };
    board.append(btn);
  }
  return board;
}

function renderPicker(): HTMLElement {
  const query = state.search.trim().toLowerCase();
  const all = pickerKeycodes(state.keymap.length);
  const items = all.filter((k) =>
    query ? `${k.name} ${k.label}`.toLowerCase().includes(query) : state.category === "All" || k.category === state.category,
  );

  const search = el("input", { type: "search", placeholder: "Search keycodes…", value: state.search });
  search.setAttribute("aria-label", "Search keycodes");
  search.oninput = () => {
    state.search = search.value;
    render(true);
  };

  const tabs = el("div", { class: "tabs" });
  for (const c of CATEGORIES) {
    const b = el("button", { textContent: c });
    b.setAttribute("aria-pressed", String(!query && state.category === c));
    b.onclick = () => {
      state.category = c;
      state.search = "";
      render();
    };
    tabs.append(b);
  }

  const grid = el("div", { class: "picker-grid" });
  for (const k of items) {
    const b = el("button", { textContent: k.label, title: k.name, disabled: !state.selected });
    b.onclick = () => void assign(k.code);
    grid.append(b);
  }

  const hint = state.selected
    ? `Assigning to layer ${state.layer}, row ${state.selected.row} col ${state.selected.col}`
    : "Select a key on the board, then pick a keycode.";
  return el("section", { class: "card" }, el("div", { class: "picker-head" }, tabs, search), el("p", { class: "hint", textContent: hint }), grid);
}

function render(keepSearchFocus = false): void {
  const connected = state.client !== null;

  const mockBtn = el("button", { class: webHidSupported() ? "" : "primary", textContent: "Mock device" });
  mockBtn.onclick = () => void connectMock();
  const hidBtn = el("button", { class: "primary", textContent: "Connect keyboard", disabled: !webHidSupported() });
  hidBtn.title = webHidSupported() ? "" : "WebHID needs Chrome or Edge";
  hidBtn.onclick = () => void connectKeyboard();
  const connect = el("div", { class: "toolbar" }, mockBtn, hidBtn);

  const header = el(
    "header",
    {},
    el("h1", { textContent: "Keyboard Config · VIA" }),
    el("a", { href: "/", textContent: "← OS remap", class: "link" }),
    el("span", { class: `status${state.status.error ? " error" : ""}`, textContent: state.status.text }),
    connect,
  );
  header.querySelector(".status")?.setAttribute("role", "status");

  if (!connected) {
    app.replaceChildren(el("div", { class: "shell" }, header, el("p", { class: "hint", textContent: "Connect the mock device to start editing a keymap." })));
    return;
  }

  const layerTabs = el("div", { class: "tabs" });
  state.keymap.forEach((_, i) => {
    const b = el("button", { textContent: `Layer ${i}` });
    b.setAttribute("aria-pressed", String(state.layer === i));
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
  const importBtn = el("button", { textContent: "Import JSON" });
  importBtn.onclick = () => fileInput.click();
  const exportBtn = el("button", { textContent: "Export JSON" });
  exportBtn.onclick = downloadKeymap;
  const resetBtn = el("button", { textContent: "Reset to defaults" });
  resetBtn.onclick = () => void resetKeymap();

  const boardCard = el(
    "section",
    { class: "card" },
    el("div", { class: "toolbar" }, layerTabs, el("span", { class: "spacer" }), importBtn, exportBtn, resetBtn, fileInput),
    el("div", { class: "board-wrap" }, renderBoard()),
  );

  app.replaceChildren(el("div", { class: "shell" }, header, boardCard, renderPicker()));

  if (keepSearchFocus) {
    const input = app.querySelector<HTMLInputElement>("input[type=search]");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}

render();
