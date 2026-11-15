import { closeSync, constants, openSync, readdirSync, readFileSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";
import { REPORT_LEN } from "../src/rgb/protocol.ts";

export interface HidTransport {
  /** Sends one 64-byte report and returns the reply whose command byte (index 3) matches. */
  transfer(packet: Uint8Array): Promise<Uint8Array>;
  close(): void;
}

const VID = "0000320F";
const PID = "00005055";
const VENDOR_PAGE = Buffer.from([0x06, 0x1c, 0xff]); // usage page 0xFF1C
const REPLY_TIMEOUT_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The vendor interface of the Rover 84 V3: right VID/PID and a report descriptor that declares usage page 0xFF1C. */
export function findVendorNode(sysRoot = "/sys/class/hidraw", devRoot = "/dev"): string | null {
  let names: string[];
  try {
    names = readdirSync(sysRoot).filter((n) => /^hidraw\d+$/.test(n));
  } catch {
    return null;
  }
  for (const name of names.sort()) {
    try {
      const dev = join(sysRoot, name, "device");
      const uevent = readFileSync(join(dev, "uevent"), "utf8");
      if (!uevent.toUpperCase().includes(`HID_ID=0003:${VID}:${PID}`)) continue;
      if (readFileSync(join(dev, "report_descriptor")).includes(VENDOR_PAGE)) return join(devRoot, name);
    } catch {
      // device vanished while scanning
    }
  }
  return null;
}

export function openHidraw(path: string): HidTransport {
  const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);

  async function readReport(deadline: number): Promise<Uint8Array | null> {
    const buf = Buffer.alloc(REPORT_LEN);
    while (Date.now() < deadline) {
      try {
        const n = readSync(fd, buf, 0, REPORT_LEN, null);
        if (n > 0) return Uint8Array.from(buf.subarray(0, n));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
      }
      await sleep(5);
    }
    return null;
  }

  return {
    async transfer(packet) {
      writeSync(fd, packet);
      const deadline = Date.now() + REPLY_TIMEOUT_MS;
      for (;;) {
        const reply = await readReport(deadline);
        if (!reply) throw new Error("keyboard did not reply in time");
        if (reply[3] === packet[3]) return reply; // skip unrelated reports from the same interface
      }
    },
    close() {
      closeSync(fd);
    },
  };
}
