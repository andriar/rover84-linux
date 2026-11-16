/**
 * Read-only view of the PressPlay Nova V3 2.4G dongle (248a:fb01), over hidraw output/input report 5.
 *
 * Worked out from a static read of the vendor's Windows app and confirmed on the real dongle with read commands only.
 * Packet, 33 bytes: [0x05, checksum, 0xFA, command, addrLo, addrHi, length, 0, data...], zero padded.
 * checksum = (sum of bytes 2..7 & 0xFF) ^ 0x66. Replies use the same framing, with byte 7 a status (always 0x14 so far).
 *
 * Only command 0x41 (read memory) is ever built here. Write commands exist (0x42, 0x44, 0x46) but their effects are
 * unverified, so this module cannot produce them.
 *
 * Verified: reads of 0x00-0xFF, and that the byte at 0x11 follows the DPI button (1,2,3,4,5,0,1...).
 * NOT verified: what byte 0x10 (0x1F so far) means; whether other firmware uses other addresses.
 */
export const NOVA_PACKET_LEN = 33;
export const NOVA_REPORT_ID = 0x05;
const MARKER = 0xfa;
const READ = 0x41;
const MAX_READ = 16;

/** Address of the status block: byte 0 = unknown (0x1F), byte 1 = DPI stage index. */
export const STATUS_ADDR = 0x10;
export const STATUS_LEN = 2;
export const DPI_STAGES = 6;

export class NovaError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const checksum = (b: Uint8Array) => (b.subarray(2, 8).reduce((a, v) => a + v, 0) & 0xff) ^ 0x66;

/** A read-memory request. Throws on anything that would not be a plain read. */
export function buildRead(addr: number, length: number): Uint8Array {
  if (!Number.isInteger(addr) || addr < 0 || addr > 0xff) throw new NovaError(400, "address out of range");
  if (!Number.isInteger(length) || length < 1 || length > MAX_READ) throw new NovaError(400, `length must be 1-${MAX_READ}`);
  const p = new Uint8Array(NOVA_PACKET_LEN);
  p.set([NOVA_REPORT_ID, 0, MARKER, READ, addr & 0xff, addr >> 8, length, 0]);
  p[1] = checksum(p);
  return p;
}

/** True when `reply` answers the read of (addr, length): right report, marker, command, address, length and checksum. */
export function isReadReply(reply: Uint8Array, addr: number, length: number): boolean {
  return (
    reply.length >= 8 + length &&
    reply[0] === NOVA_REPORT_ID &&
    reply[2] === MARKER &&
    reply[3] === READ &&
    reply[4] === (addr & 0xff) &&
    reply[5] === addr >> 8 &&
    reply[6] === length &&
    reply[1] === checksum(reply)
  );
}

export function replyData(reply: Uint8Array, length: number): Uint8Array {
  return reply.slice(8, 8 + length);
}

export interface NovaStatus {
  /** 1-based position of the active DPI stage, or null when the byte is outside 0..5. */
  dpiStage: number | null;
  stages: number;
}

export function parseStatus(block: Uint8Array): NovaStatus {
  const raw = block[1];
  return { dpiStage: raw !== undefined && raw < DPI_STAGES ? raw + 1 : null, stages: DPI_STAGES };
}
