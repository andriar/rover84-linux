import { code } from "./keycodes";
import type { Keymap } from "./via/protocol";

export interface KeyPos {
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
}

export interface Layout {
  name: string;
  rows: number;
  cols: number;
  layers: number;
  keys: KeyPos[];
  /** Fresh copy each call: the mock device mutates it. */
  defaultKeymap(): Keymap;
}

/** ANSI 60%: each entry is [qmkName, widthInUnits]. Matrix col = index in row. */
const ANSI60: ReadonlyArray<ReadonlyArray<readonly [string, number]>> = [
  [["KC_GRV", 1], ["KC_1", 1], ["KC_2", 1], ["KC_3", 1], ["KC_4", 1], ["KC_5", 1], ["KC_6", 1], ["KC_7", 1], ["KC_8", 1], ["KC_9", 1], ["KC_0", 1], ["KC_MINS", 1], ["KC_EQL", 1], ["KC_BSPC", 2]],
  [["KC_TAB", 1.5], ["KC_Q", 1], ["KC_W", 1], ["KC_E", 1], ["KC_R", 1], ["KC_T", 1], ["KC_Y", 1], ["KC_U", 1], ["KC_I", 1], ["KC_O", 1], ["KC_P", 1], ["KC_LBRC", 1], ["KC_RBRC", 1], ["KC_BSLS", 1.5]],
  [["KC_CAPS", 1.75], ["KC_A", 1], ["KC_S", 1], ["KC_D", 1], ["KC_F", 1], ["KC_G", 1], ["KC_H", 1], ["KC_J", 1], ["KC_K", 1], ["KC_L", 1], ["KC_SCLN", 1], ["KC_QUOT", 1], ["KC_ENT", 2.25]],
  [["KC_LSFT", 2.25], ["KC_Z", 1], ["KC_X", 1], ["KC_C", 1], ["KC_V", 1], ["KC_B", 1], ["KC_N", 1], ["KC_M", 1], ["KC_COMM", 1], ["KC_DOT", 1], ["KC_SLSH", 1], ["KC_RSFT", 2.75]],
  [["KC_LCTL", 1.25], ["KC_LGUI", 1.25], ["KC_LALT", 1.25], ["KC_SPC", 6.25], ["KC_RALT", 1.25], ["KC_RGUI", 1.25], ["MO(1)", 1.25], ["KC_RCTL", 1.25]],
];

const LAYERS = 4;
const COLS = Math.max(...ANSI60.map((r) => r.length));

/** Layer 1: F-row on the number row, IJKL arrows, Del on Backspace. Everything else transparent. */
const FN_OVERRIDES: Record<string, string> = {
  "0,1": "KC_F1", "0,2": "KC_F2", "0,3": "KC_F3", "0,4": "KC_F4", "0,5": "KC_F5", "0,6": "KC_F6",
  "0,7": "KC_F7", "0,8": "KC_F8", "0,9": "KC_F9", "0,10": "KC_F10", "0,11": "KC_F11", "0,12": "KC_F12",
  "0,13": "KC_DEL",
  "1,8": "KC_UP", "2,7": "KC_LEFT", "2,8": "KC_DOWN", "2,9": "KC_RGHT",
  "1,9": "KC_HOME", "1,10": "KC_PGUP", "2,10": "KC_END", "2,11": "KC_PGDN",
};

const keys: KeyPos[] = ANSI60.flatMap((row, r) => {
  let x = 0;
  return row.map(([, w], c) => {
    const pos = { row: r, col: c, x, y: r, w };
    x += w;
    return pos;
  });
});

function defaultKeymap(): Keymap {
  const make = (fill: (r: number, c: number) => number): number[][] =>
    ANSI60.map((row, r) => Array.from({ length: COLS }, (_, c) => (c < row.length ? fill(r, c) : 0)));

  const base = make((r, c) => code(ANSI60[r]![c]![0]));
  const fn = make((r, c) => code(FN_OVERRIDES[`${r},${c}`] ?? "KC_TRNS"));
  const blank = () => make(() => code("KC_TRNS"));
  return [base, fn, blank(), blank()];
}

export const ansi60: Layout = {
  name: "ANSI 60% (mock)",
  rows: ANSI60.length,
  cols: COLS,
  layers: LAYERS,
  keys,
  defaultKeymap,
};
