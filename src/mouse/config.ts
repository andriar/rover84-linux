/** Persisted pointer settings for one mouse, applied through Hyprland's per-device options. */
export type AccelProfile = "default" | "flat";

export interface MouseConfig {
  version: 1;
  /** Exact Hyprland device name, for example "telink-wireless-gaming-mouse". */
  device: string;
  /** Hyprland `sensitivity`, -1 (slowest) to 1 (fastest), in steps of 0.1. */
  sensitivity: number;
  /** "flat" turns pointer acceleration off. "default" keeps libinput's adaptive curve. */
  accelProfile: AccelProfile;
  /** Hyprland `scroll_factor`, 0.5 to 3. */
  scrollFactor: number;
  naturalScroll: boolean;
  /** Swaps the left and right buttons. */
  leftHanded: boolean;
}

export class MouseError extends Error {}

export const SENSITIVITY = { min: -1, max: 1, step: 0.1 } as const;
export const SCROLL = { min: 0.5, max: 3, step: 0.1 } as const;

export const emptyMouseConfig = (device = "telink-wireless-gaming-mouse"): MouseConfig => ({
  version: 1,
  device,
  sensitivity: 0,
  accelProfile: "default",
  scrollFactor: 1,
  naturalScroll: false,
  leftHanded: false,
});

const DEVICE_NAME = /^[A-Za-z0-9._-]{2,80}$/;
const round1 = (n: number) => Math.round(n * 10) / 10;

function inRange(name: string, v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new MouseError(`${name} must be a number`);
  if (v < min - 1e-9 || v > max + 1e-9) throw new MouseError(`${name} must be between ${min} and ${max}`);
  return round1(v);
}

/** Validates untrusted input (HTTP body or file). Names are checked here because they end up inside Lua code. */
export function parseMouseConfig(input: unknown): MouseConfig {
  if (typeof input !== "object" || input === null) throw new MouseError("config must be an object");
  const raw = input as Record<string, unknown>;
  if (raw.version !== 1) throw new MouseError("unsupported config version");
  if (typeof raw.device !== "string" || !DEVICE_NAME.test(raw.device)) throw new MouseError("device must be 2-80 chars of letters, digits, dot, underscore or dash");
  if (raw.accelProfile !== "default" && raw.accelProfile !== "flat") throw new MouseError("accelProfile must be default or flat");
  if (typeof raw.naturalScroll !== "boolean" || typeof raw.leftHanded !== "boolean") throw new MouseError("naturalScroll and leftHanded must be true or false");
  return {
    version: 1,
    device: raw.device,
    sensitivity: inRange("sensitivity", raw.sensitivity, SENSITIVITY.min, SENSITIVITY.max),
    accelProfile: raw.accelProfile,
    scrollFactor: inRange("scrollFactor", raw.scrollFactor, SCROLL.min, SCROLL.max),
    naturalScroll: raw.naturalScroll,
    leftHanded: raw.leftHanded,
  };
}

/** What Hyprland uses when a device has no override: the global `input` values. */
export interface GlobalPointer {
  sensitivity: number;
  accelProfile: string;
  scrollFactor: number;
  naturalScroll: boolean;
  leftHanded: boolean;
}

const lua = (v: string | number | boolean) => (typeof v === "string" ? `"${v}"` : String(v));
const SAFE_STRING = /^[A-Za-z0-9._-]*$/;

function deviceCall(device: string, fields: Record<string, string | number | boolean>): string {
  if (!DEVICE_NAME.test(device)) throw new MouseError(`refusing unsafe device name: ${device}`);
  const parts = Object.entries(fields).map(([k, v]) => {
    if (typeof v === "string" && !SAFE_STRING.test(v)) throw new MouseError(`refusing unsafe value for ${k}`);
    return `${k} = ${lua(v)}`;
  });
  return `hl.device({ name = "${device}", ${parts.join(", ")} })`;
}

/** The `hl.device` statement for an active config. No leading "-": hyprctl would read it as a flag. */
export function mouseDeviceCall(c: MouseConfig): string {
  return deviceCall(c.device, {
    sensitivity: c.sensitivity,
    accel_profile: c.accelProfile === "flat" ? "flat" : "adaptive",
    scroll_factor: c.scrollFactor,
    natural_scroll: c.naturalScroll,
    left_handed: c.leftHanded,
  });
}

/** Puts the device back on the global input values. */
export function mouseResetCall(device: string, g: GlobalPointer): string {
  return deviceCall(device, {
    sensitivity: g.sensitivity,
    accel_profile: g.accelProfile,
    scroll_factor: g.scrollFactor,
    natural_scroll: g.naturalScroll,
    left_handed: g.leftHanded,
  });
}

export const MOUSE_BEGIN = "-- keyboard-config:mouse begin";
export const MOUSE_END = "-- keyboard-config:mouse end";

/** The block appended to the generated hyprland.lua. Empty when the mouse override is off. */
export function mouseLuaSection(c: MouseConfig | null): string {
  if (!c) return "";
  return `${MOUSE_BEGIN}\n${mouseDeviceCall(c)}\n${MOUSE_END}\n`;
}

/** Removes a previous mouse block from the generated file text. */
export function stripMouseSection(text: string): string {
  const start = text.indexOf(MOUSE_BEGIN);
  if (start === -1) return text;
  const end = text.indexOf(MOUSE_END, start);
  if (end === -1) return text.slice(0, start);
  return text.slice(0, start) + text.slice(end + MOUSE_END.length).replace(/^\n/, "");
}

/** "telink-wireless-gaming-mouse" -> "Wireless Gaming Mouse". */
export function friendlyMouseName(name: string): string {
  let parts = name.split("-").filter(Boolean);
  if (parts.length > 2 && parts[0]!.toLowerCase() === "telink") parts = parts.slice(1);
  return parts.map((p) => (/^v\d+$/i.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
}

/** Devices that are really a keyboard or media-key interface of the same dongle, not a pointer. */
export const isPointerName = (name: string): boolean => !/(consumer-control|system-control|keyboard)/i.test(name);
