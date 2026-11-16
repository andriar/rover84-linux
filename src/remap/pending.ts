import type { RemapConfig } from "./xkb.ts";

export interface Pending {
  keys: number;
  swap: boolean;
  name: boolean;
  total: number;
}

/** What differs between the edited config and the last applied one. Each changed key, the swap and the filter count as 1. */
export function pendingChanges(edited: RemapConfig, saved: RemapConfig): Pending {
  const codes = new Set([...Object.keys(edited.mappings), ...Object.keys(saved.mappings)]);
  let keys = 0;
  for (const c of codes) if (edited.mappings[c] !== saved.mappings[c]) keys++;
  const swap = edited.swapAltSuper !== saved.swapAltSuper;
  const name = edited.deviceMatch !== saved.deviceMatch;
  return { keys, swap, name, total: keys + (swap ? 1 : 0) + (name ? 1 : 0) };
}

export function describePending(p: Pending): string {
  const parts: string[] = [];
  if (p.keys) parts.push(`${p.keys} ${p.keys === 1 ? "key" : "keys"}`);
  if (p.swap) parts.push("Alt/Super swap");
  if (p.name) parts.push("keyboard name");
  return parts.join(", ");
}

/** "telink-rover-84-v3--keyboard" -> "Rover 84 V3". Appends the input count when the same keyboard shows up more than once. */
export function friendlyDeviceName(names: string[]): string {
  const first = names[0];
  if (!first) return "";
  let parts = first.split("-").filter(Boolean);
  if (parts.length > 2) parts = parts.slice(1);
  if (parts.at(-1)?.toLowerCase() === "keyboard") parts = parts.slice(0, -1);
  const pretty = parts.map((p) => (/^v\d+$/i.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
  return names.length > 1 ? `${pretty} (${names.length} inputs)` : pretty;
}
