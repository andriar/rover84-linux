import { attrs, el } from "./dom";

export interface CapSpec {
  /** Stable id, also used for data-fid. */
  id: string;
  x: number;
  y: number;
  w: number;
  legend: string;
  /** Small second line under the legend, for example "swapped". */
  sub?: string;
  /** Full accessible name. */
  label: string;
  pressed: boolean;
  classes?: string[];
  onClick: () => void;
}

/** The whole 1u cell is the button, so every key is at least 44x44 even though the visible cap is inset. */
export function interactiveBoard(caps: CapSpec[], opts: { listening?: boolean; cols?: number; rows?: number } = {}): HTMLElement {
  const board = el("div", { class: `board${opts.listening ? " listening" : ""}` });
  if (opts.cols) board.style.setProperty("--cols", String(opts.cols));
  if (opts.rows) board.style.setProperty("--rows", String(opts.rows));
  for (const c of caps) {
    const cap = el("span", { class: "cap" }, el("span", { textContent: c.legend }));
    if (c.sub) cap.append(el("small", { textContent: c.sub }));
    const btn = attrs(el("button", { type: "button", class: `key${c.legend.length === 1 ? " single" : ""} ${(c.classes ?? []).join(" ")}`.trim() }, cap), {
      "aria-pressed": c.pressed,
      "aria-label": c.label,
      "data-fid": `key-${c.id}`,
    });
    btn.style.setProperty("--x", String(c.x));
    btn.style.setProperty("--y", String(c.y));
    btn.style.setProperty("--w", String(c.w));
    btn.onclick = c.onClick;
    board.append(btn);
  }
  return el("div", { class: "board-wrap" }, board);
}

export interface PreviewKey {
  x: number;
  y: number;
  w: number;
}

const HUES = ["#FF3B30", "#FF9500", "#FFD60A", "#34C759", "#0A84FF", "#BF5AF2"];
export const GLOW = [0, 35, 60, 80, 100] as const;

/** Non-interactive picture of the backlight. `led` is a CSS color or "random"; `off` forces every cap dark. */
export function previewBoard(keys: PreviewKey[], opts: { led: string; brightness: number; random: boolean; off: boolean; label: string }): HTMLElement {
  const board = attrs(el("div", { class: "board preview" }), { "aria-hidden": "true" });
  const glow = opts.off ? 0 : (GLOW[Math.max(0, Math.min(4, opts.brightness))] ?? 0);
  for (const k of keys) {
    const cell = el("div", { class: "board-key" }, el("i"));
    cell.style.setProperty("--x", String(k.x));
    cell.style.setProperty("--y", String(k.y));
    cell.style.setProperty("--w", String(k.w));
    const cap = cell.firstElementChild as HTMLElement;
    cap.style.setProperty("--led", opts.random ? (HUES[Math.floor(k.x + k.y) % 6] ?? opts.led) : opts.led);
    cap.style.setProperty("--glow", `${glow}%`);
    board.append(cell);
  }
  const plate = attrs(el("div", { class: "plate" }, board), { role: "img", "aria-label": opts.label });
  return plate;
}
