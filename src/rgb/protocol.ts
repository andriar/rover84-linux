/**
 * Evision lighting protocol as used by the PressPlay Rover 84 V3 (320f:5055).
 *
 * Sources: OpenRGB's EVisionKeyboardController and a static read of the vendor's Windows app.
 * Verified on the real keyboard: Begin/End/Read/Write framing, unsigned checksum, and that a 21-byte
 * record at offset 0 changes the backlight (mode 6 + red lit the keys).
 * NOT verified: modes other than Static, the meaning of speed, and record bytes 0 and 4.
 */

export const REPORT_LEN = 64;
export const RECORD_LEN = 21;
export const RECORD_OFFSET = 0;
const MAX_PAYLOAD = REPORT_LEN - 8;

export const CMD = { begin: 0x01, end: 0x02, read: 0x05, write: 0x06 } as const;

export interface Color {
  r: number;
  g: number;
  b: number;
}

export interface LightSettings {
  mode: number;
  /** 0 (off) to 4. */
  brightness: number;
  /** 0 to 4, written as-is. Which end is faster has not been verified. */
  speed: number;
  /** Record byte 5. The vendor app's "MultiColor" flag. */
  multicolor: boolean;
  color: Color;
}

export interface ModeInfo {
  id: number;
  name: string;
}

/** Mode ids from the vendor's own light table (they match OpenRGB). Custom (0x14) needs per-key data and is never written. */
export const MODES: readonly ModeInfo[] = [
  { id: 0x06, name: "Static" },
  { id: 0x05, name: "Breathing" },
  { id: 0x04, name: "Spectrum cycle" },
  { id: 0x01, name: "Wave (short)" },
  { id: 0x02, name: "Wave (long)" },
  { id: 0x03, name: "Color wheel" },
  { id: 0x07, name: "Reactive" },
  { id: 0x08, name: "Ripple" },
  { id: 0x09, name: "Reactive line" },
  { id: 0x0a, name: "Starlight (fast)" },
  { id: 0x0f, name: "Starlight (slow)" },
  { id: 0x0b, name: "Blooming" },
  { id: 0x0c, name: "Rainbow wave" },
  { id: 0x0d, name: "Hurricane" },
  { id: 0x0e, name: "Accumulate" },
  { id: 0x10, name: "Visor" },
  { id: 0x11, name: "Surmount" },
  { id: 0x12, name: "Rainbow circle" },
];

export const CUSTOM_MODE = 0x14;

export class RgbError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 64-byte HID report: [4, sumLo, sumHi, cmd, length, offsetLo, offsetHi, 0, ...data]. The sum covers bytes 3..63, unsigned. */
export function buildPacket(cmd: number, length = 0, offset = 0, data: Uint8Array = new Uint8Array()): Uint8Array {
  if (data.length > MAX_PAYLOAD) throw new RgbError(500, "payload too large");
  const p = new Uint8Array(REPORT_LEN);
  p[0] = 0x04;
  p[3] = cmd;
  p[4] = length;
  p[5] = offset & 0xff;
  p[6] = (offset >> 8) & 0xff;
  p.set(data, 8);
  let sum = 0;
  for (let i = 3; i < REPORT_LEN; i++) sum += p[i]!;
  p[1] = sum & 0xff;
  p[2] = (sum >> 8) & 0xff;
  return p;
}

export function recordFromReply(reply: Uint8Array): Uint8Array {
  return reply.slice(8, 8 + RECORD_LEN);
}

export function knownMode(id: number): boolean {
  return id === CUSTOM_MODE || MODES.some((m) => m.id === id);
}

/** A record we are willing to overwrite: a mode we know and a brightness in range. Anything else means the layout guess is wrong. */
export function looksLikeLightRecord(rec: Uint8Array): boolean {
  return rec.length === RECORD_LEN && knownMode(rec[1]!) && rec[2]! <= 4;
}

export function decodeRecord(rec: Uint8Array): LightSettings {
  if (rec.length !== RECORD_LEN) throw new RgbError(500, "bad record length");
  return {
    mode: rec[1]!,
    brightness: rec[2]!,
    speed: rec[3]!,
    multicolor: rec[5] !== 0,
    color: { r: rec[6]!, g: rec[7]!, b: rec[8]! },
  };
}

/** Changes only the bytes we understand (1, 2, 3, 5, 6, 7, 8); every other byte of `base` is kept. */
export function encodeRecord(base: Uint8Array, s: LightSettings): Uint8Array {
  if (base.length !== RECORD_LEN) throw new RgbError(500, "bad record length");
  const rec = base.slice();
  rec[1] = s.mode;
  rec[2] = s.brightness;
  rec[3] = s.speed;
  rec[5] = s.multicolor ? 0xff : 0x00;
  rec[6] = s.color.r;
  rec[7] = s.color.g;
  rec[8] = s.color.b;
  return rec;
}

const isByte = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255;
const isLevel = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4;

export function parseSettings(input: unknown): LightSettings {
  const o = input as Record<string, unknown> | null;
  if (typeof o !== "object" || o === null) throw new RgbError(400, "settings must be an object");
  const color = o.color as Record<string, unknown> | null;
  if (typeof color !== "object" || color === null || !isByte(color.r) || !isByte(color.g) || !isByte(color.b)) throw new RgbError(400, "color must be {r,g,b} with values 0-255");
  if (typeof o.mode !== "number" || !MODES.some((m) => m.id === o.mode)) throw new RgbError(400, "unknown or unsupported mode");
  if (!isLevel(o.brightness)) throw new RgbError(400, "brightness must be an integer 0-4");
  if (!isLevel(o.speed)) throw new RgbError(400, "speed must be an integer 0-4");
  if (typeof o.multicolor !== "boolean") throw new RgbError(400, "multicolor must be a boolean");
  return { mode: o.mode, brightness: o.brightness, speed: o.speed, multicolor: o.multicolor, color: { r: color.r, g: color.g, b: color.b } };
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

export function fromHex(text: string): Uint8Array {
  const parts = text.trim().split(/\s+/);
  if (!parts.every((p) => /^[0-9a-f]{2}$/i.test(p))) throw new RgbError(500, "bad hex");
  return Uint8Array.from(parts, (p) => parseInt(p, 16));
}
