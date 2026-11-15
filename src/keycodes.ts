export type Category = "Letters" | "Numbers" | "Punctuation" | "Modifiers" | "Function" | "Navigation" | "Layers" | "Special";

export interface Keycode {
  code: number;
  name: string;
  label: string;
  category: Category;
}

const list: Keycode[] = [];
const add = (code: number, name: string, label: string, category: Category) =>
  list.push({ code, name, label, category });

add(0x0000, "KC_NO", "None", "Special");
add(0x0001, "KC_TRNS", "▽", "Special");

for (let i = 0; i < 26; i++) {
  const ch = String.fromCharCode(65 + i);
  add(0x04 + i, `KC_${ch}`, ch, "Letters");
}

"1234567890".split("").forEach((ch, i) => add(0x1e + i, `KC_${ch}`, ch, "Numbers"));

add(0x28, "KC_ENT", "Enter", "Special");
add(0x29, "KC_ESC", "Esc", "Special");
add(0x2a, "KC_BSPC", "Bksp", "Special");
add(0x2b, "KC_TAB", "Tab", "Special");
add(0x2c, "KC_SPC", "Space", "Special");
add(0x39, "KC_CAPS", "Caps", "Special");
add(0x4c, "KC_DEL", "Del", "Special");

([
  [0x2d, "MINS", "-"], [0x2e, "EQL", "="], [0x2f, "LBRC", "["], [0x30, "RBRC", "]"],
  [0x31, "BSLS", "\\"], [0x33, "SCLN", ";"], [0x34, "QUOT", "'"], [0x35, "GRV", "`"],
  [0x36, "COMM", ","], [0x37, "DOT", "."], [0x38, "SLSH", "/"],
] as const).forEach(([code, n, label]) => add(code, `KC_${n}`, label, "Punctuation"));

for (let i = 1; i <= 12; i++) add(0x39 + i, `KC_F${i}`, `F${i}`, "Function");

([
  [0x4a, "HOME", "Home"], [0x4b, "PGUP", "PgUp"], [0x4d, "END", "End"], [0x4e, "PGDN", "PgDn"],
  [0x4f, "RGHT", "→"], [0x50, "LEFT", "←"], [0x51, "DOWN", "↓"], [0x52, "UP", "↑"],
] as const).forEach(([code, n, label]) => add(code, `KC_${n}`, label, "Navigation"));

([
  [0xe0, "LCTL", "LCtrl"], [0xe1, "LSFT", "LShift"], [0xe2, "LALT", "LAlt"], [0xe3, "LGUI", "LGui"],
  [0xe4, "RCTL", "RCtrl"], [0xe5, "RSFT", "RShift"], [0xe6, "RALT", "RAlt"], [0xe7, "RGUI", "RGui"],
] as const).forEach(([code, n, label]) => add(code, `KC_${n}`, label, "Modifiers"));

/** QMK layer keycode bases (QK_TO / QK_MOMENTARY / QK_TOGGLE_LAYER). */
export const LAYER_BASE = { TO: 0x5200, MO: 0x5220, TG: 0x5260 } as const;
export const MAX_LAYER_KEYS = 16;

export function layerKeycodes(layerCount: number): Keycode[] {
  const out: Keycode[] = [];
  for (const kind of ["MO", "TO", "TG"] as const) {
    for (let n = 0; n < Math.min(layerCount, MAX_LAYER_KEYS); n++) {
      out.push({ code: LAYER_BASE[kind] + n, name: `${kind}(${n})`, label: `${kind}(${n})`, category: "Layers" });
    }
  }
  return out;
}

const byCode = new Map(list.map((k) => [k.code, k]));
const byName = new Map(list.map((k) => [k.name, k]));

export const KEYCODES: readonly Keycode[] = list;

/** Look up a keycode by QMK name; throws on typos so default keymaps fail loudly. */
export function code(name: string): number {
  const layer = /^(MO|TO|TG)\((\d+)\)$/.exec(name);
  if (layer) return LAYER_BASE[layer[1] as "MO" | "TO" | "TG"] + Number(layer[2]);
  const k = byName.get(name);
  if (!k) throw new Error(`unknown keycode: ${name}`);
  return k.code;
}

export function describe(keycode: number): { label: string; known: boolean } {
  const k = byCode.get(keycode);
  if (k) return { label: k.label, known: true };
  for (const kind of ["TO", "MO", "TG"] as const) {
    const base = LAYER_BASE[kind];
    if (keycode >= base && keycode < base + 0x20) return { label: `${kind}(${keycode - base})`, known: true };
  }
  return { label: `0x${keycode.toString(16).toUpperCase().padStart(4, "0")}`, known: false };
}

export function pickerKeycodes(layerCount: number): Keycode[] {
  return [...list, ...layerKeycodes(layerCount)];
}
