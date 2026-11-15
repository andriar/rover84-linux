/**
 * Physical key table for OS-level remapping.
 * `code` is KeyboardEvent.code (layout independent, so the browser can identify a
 * physical key); `xkb` is the matching xkb keycode name used in the generated symbols file.
 * Note: modules under src/remap are loaded by Node directly (type stripping), so no
 * enums or parameter properties here, and relative imports carry the .ts extension.
 */
export type Category = "Letters" | "Numbers" | "Punctuation" | "Modifiers" | "Function" | "Navigation" | "Media" | "Special";
export type Modifier = "Shift" | "Control" | "Mod1" | "Mod4" | "Lock";

export interface KeyDef {
  code: string;
  xkb: string;
  label: string;
  /** keysyms for [unshifted, shifted]; one entry for keys without a shifted level */
  levels: string[];
  category: Category;
  mod?: Modifier;
}

const keys: KeyDef[] = [];
const add = (code: string, xkb: string, label: string, levels: string[], category: Category, mod?: Modifier) =>
  keys.push({ code, xkb, label, levels, category, ...(mod ? { mod } : {}) });

add("Escape", "ESC", "Esc", ["Escape"], "Special");
for (let i = 1; i <= 12; i++) add(`F${i}`, `FK${String(i).padStart(2, "0")}`, `F${i}`, [`F${i}`], "Function");

add("Backquote", "TLDE", "`", ["grave", "asciitilde"], "Punctuation");
const digitShift = ["exclam", "at", "numbersign", "dollar", "percent", "asciicircum", "ampersand", "asterisk", "parenleft", "parenright"];
for (let i = 1; i <= 10; i++) {
  const d = String(i % 10);
  add(`Digit${d}`, `AE${String(i).padStart(2, "0")}`, d, [d, digitShift[i - 1]!], "Numbers");
}
add("Minus", "AE11", "-", ["minus", "underscore"], "Punctuation");
add("Equal", "AE12", "=", ["equal", "plus"], "Punctuation");
add("Backspace", "BKSP", "Bksp", ["BackSpace"], "Special");

add("Tab", "TAB", "Tab", ["Tab", "ISO_Left_Tab"], "Special");
"qwertyuiop".split("").forEach((c, i) => add(`Key${c.toUpperCase()}`, `AD${String(i + 1).padStart(2, "0")}`, c.toUpperCase(), [c, c.toUpperCase()], "Letters"));
add("BracketLeft", "AD11", "[", ["bracketleft", "braceleft"], "Punctuation");
add("BracketRight", "AD12", "]", ["bracketright", "braceright"], "Punctuation");
add("Backslash", "BKSL", "\\", ["backslash", "bar"], "Punctuation");

add("CapsLock", "CAPS", "Caps", ["Caps_Lock"], "Special", "Lock");
"asdfghjkl".split("").forEach((c, i) => add(`Key${c.toUpperCase()}`, `AC${String(i + 1).padStart(2, "0")}`, c.toUpperCase(), [c, c.toUpperCase()], "Letters"));
add("Semicolon", "AC10", ";", ["semicolon", "colon"], "Punctuation");
add("Quote", "AC11", "'", ["apostrophe", "quotedbl"], "Punctuation");
add("Enter", "RTRN", "Enter", ["Return"], "Special");

add("ShiftLeft", "LFSH", "LShift", ["Shift_L"], "Modifiers", "Shift");
"zxcvbnm".split("").forEach((c, i) => add(`Key${c.toUpperCase()}`, `AB${String(i + 1).padStart(2, "0")}`, c.toUpperCase(), [c, c.toUpperCase()], "Letters"));
add("Comma", "AB08", ",", ["comma", "less"], "Punctuation");
add("Period", "AB09", ".", ["period", "greater"], "Punctuation");
add("Slash", "AB10", "/", ["slash", "question"], "Punctuation");
add("ShiftRight", "RTSH", "RShift", ["Shift_R"], "Modifiers", "Shift");

add("ControlLeft", "LCTL", "LCtrl", ["Control_L"], "Modifiers", "Control");
add("MetaLeft", "LWIN", "LSuper", ["Super_L"], "Modifiers", "Mod4");
add("AltLeft", "LALT", "LAlt", ["Alt_L"], "Modifiers", "Mod1");
add("Space", "SPCE", "Space", ["space"], "Special");
add("AltRight", "RALT", "RAlt", ["Alt_R"], "Modifiers", "Mod1");
add("MetaRight", "RWIN", "RSuper", ["Super_R"], "Modifiers", "Mod4");
add("ContextMenu", "MENU", "Menu", ["Menu"], "Special");
add("ControlRight", "RCTL", "RCtrl", ["Control_R"], "Modifiers", "Control");

add("ArrowUp", "UP", "↑", ["Up"], "Navigation");
add("ArrowDown", "DOWN", "↓", ["Down"], "Navigation");
add("ArrowLeft", "LEFT", "←", ["Left"], "Navigation");
add("ArrowRight", "RGHT", "→", ["Right"], "Navigation");
add("Home", "HOME", "Home", ["Home"], "Navigation");
add("End", "END", "End", ["End"], "Navigation");
add("PageUp", "PGUP", "PgUp", ["Prior"], "Navigation");
add("PageDown", "PGDN", "PgDn", ["Next"], "Navigation");
add("Insert", "INS", "Ins", ["Insert"], "Navigation");
add("Delete", "DELE", "Del", ["Delete"], "Navigation");
add("PrintScreen", "PRSC", "PrtSc", ["Print"], "Special");
add("ScrollLock", "SCLK", "ScrLk", ["Scroll_Lock"], "Special");
add("Pause", "PAUS", "Pause", ["Pause"], "Special");

/** Keys that exist only as remap targets (they have no spot on this keyboard). */
const extras: KeyDef[] = [];
for (let i = 13; i <= 24; i++) extras.push({ code: `F${i}`, xkb: `FK${i}`, label: `F${i}`, levels: [`F${i}`], category: "Function" });
const media: [string, string, string][] = [
  ["VolumeUp", "Vol+", "XF86AudioRaiseVolume"],
  ["VolumeDown", "Vol−", "XF86AudioLowerVolume"],
  ["VolumeMute", "Mute", "XF86AudioMute"],
  ["MediaPlayPause", "Play/Pause", "XF86AudioPlay"],
  ["MediaTrackNext", "Next", "XF86AudioNext"],
  ["MediaTrackPrevious", "Prev", "XF86AudioPrev"],
];
for (const [code, label, sym] of media) extras.push({ code, xkb: "", label, levels: [sym], category: "Media" });

/** Physical keys on the board (valid remap sources and targets). */
export const KEYS: readonly KeyDef[] = keys;
/** Everything the picker can assign. */
export const TARGETS: readonly KeyDef[] = [...keys, ...extras];

const byCode = new Map(TARGETS.map((k) => [k.code, k]));
export const keyByCode = (code: string): KeyDef | undefined => byCode.get(code);

const physical = new Set(keys.map((k) => k.code));
/** True for keys that exist on the board; extras (F13+, media) are targets only. */
export const isPhysical = (code: string): boolean => physical.has(code);

/**
 * Modifier keys cannot be remapped *away* in v1: xkb keeps a key's modifier_map even when its
 * keysym changes, so LCtrl -> "A" would still act as Ctrl. CapsLock is the one safe exception
 * (the stock ctrl:nocaps option relies on the same pattern).
 */
export function isProtectedSource(key: KeyDef): boolean {
  return key.mod !== undefined && key.code !== "CapsLock";
}

export interface BoardKey {
  code: string;
  x: number;
  y: number;
  w: number;
}

/** Approximate 75% layout used only for drawing; the real board may differ slightly. */
export const BOARD: readonly BoardKey[] = (() => {
  const rows: [string, number][][] = [
    [["Escape", 1], ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 1] as [string, number]), ["Insert", 1], ["Delete", 1]],
    [["Backquote", 1], ...Array.from({ length: 10 }, (_, i) => [`Digit${(i + 1) % 10}`, 1] as [string, number]), ["Minus", 1], ["Equal", 1], ["Backspace", 2], ["Home", 1]],
    [["Tab", 1.5], ..."QWERTYUIOP".split("").map((c) => [`Key${c}`, 1] as [string, number]), ["BracketLeft", 1], ["BracketRight", 1], ["Backslash", 1.5], ["PageUp", 1]],
    [["CapsLock", 1.75], ..."ASDFGHJKL".split("").map((c) => [`Key${c}`, 1] as [string, number]), ["Semicolon", 1], ["Quote", 1], ["Enter", 2.25], ["PageDown", 1]],
    [["ShiftLeft", 2.25], ..."ZXCVBNM".split("").map((c) => [`Key${c}`, 1] as [string, number]), ["Comma", 1], ["Period", 1], ["Slash", 1], ["ShiftRight", 1.75], ["ArrowUp", 1], ["End", 1]],
    [["ControlLeft", 1.25], ["MetaLeft", 1.25], ["AltLeft", 1.25], ["Space", 6.25], ["AltRight", 1], ["ControlRight", 1], ["ArrowLeft", 1], ["ArrowDown", 1], ["ArrowRight", 1]],
  ];
  return rows.flatMap((row, y) => {
    let x = 0;
    return row.map(([code, w]) => {
      const pos = { code, x, y, w };
      x += w;
      return pos;
    });
  });
})();
