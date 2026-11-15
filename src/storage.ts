import type { Keymap } from "./via/protocol";

export interface KeymapFile {
  version: 1;
  name: string;
  layers: Keymap;
}

export function exportKeymap(name: string, layers: Keymap): string {
  const file: KeymapFile = { version: 1, name, layers };
  return JSON.stringify(file, null, 2);
}

/** Parses and validates an exported keymap against the connected device's shape. */
export function importKeymap(text: string, layers: number, rows: number, cols: number): Keymap {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON");
  }
  const file = data as Partial<KeymapFile>;
  if (file.version !== 1 || !Array.isArray(file.layers)) throw new Error("Not a keyboard-config keymap file");
  const km = file.layers;
  if (km.length !== layers) throw new Error(`Expected ${layers} layers, file has ${km.length}`);
  for (const layer of km) {
    if (!Array.isArray(layer) || layer.length !== rows) throw new Error(`Each layer needs ${rows} rows`);
    for (const row of layer) {
      if (!Array.isArray(row) || row.length !== cols) throw new Error(`Each row needs ${cols} columns`);
      for (const k of row) {
        if (!Number.isInteger(k) || k < 0 || k > 0xffff) throw new Error(`Invalid keycode: ${String(k)}`);
      }
    }
  }
  return km;
}
