import { closeSync, constants, openSync, readdirSync, readFileSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";
import { NOVA_PACKET_LEN, NOVA_REPORT_ID, buildRead, isReadReply, replyData, NovaError } from "../src/mouse/nova.ts";

export interface NovaTransport {
  /** Reads `length` bytes of the dongle's memory at `addr`. */
  read(addr: number, length: number): Promise<Uint8Array>;
  close(): void;
}

const VID = "0000248A";
const PID = "0000FB01";
const REPLY_TIMEOUT_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Nova V3 dongle's hidraw node: right VID/PID and a descriptor that declares report ID 5. */
export function findNovaNode(sysRoot = "/sys/class/hidraw", devRoot = "/dev"): string | null {
  let names: string[];
  try {
    names = readdirSync(sysRoot).filter((n) => /^hidraw\d+$/.test(n));
  } catch {
    return null;
  }
  for (const name of names.sort()) {
    try {
      const dev = join(sysRoot, name, "device");
      if (!readFileSync(join(dev, "uevent"), "utf8").toUpperCase().includes(`HID_ID=0003:${VID}:${PID}`)) continue;
      if (readFileSync(join(dev, "report_descriptor")).includes(Buffer.from([0x85, NOVA_REPORT_ID]))) return join(devRoot, name);
    } catch {
      // device vanished while scanning
    }
  }
  return null;
}

export function openNova(path: string): NovaTransport {
  const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
  const buf = Buffer.alloc(64);

  function drain(): void {
    for (;;) {
      try {
        if (readSync(fd, buf, 0, 64, null) <= 0) return;
      } catch {
        return; // EAGAIN: nothing left
      }
    }
  }

  return {
    async read(addr, length) {
      const packet = buildRead(addr, length);
      drain(); // pointer reports pile up on the same node; start from a clean queue
      writeSync(fd, packet);
      const deadline = Date.now() + REPLY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        try {
          const n = readSync(fd, buf, 0, 64, null);
          if (n >= NOVA_PACKET_LEN) {
            const reply = Uint8Array.from(buf.subarray(0, n));
            if (isReadReply(reply, addr, length)) return replyData(reply, length);
          }
          if (n > 0) continue;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
        }
        await sleep(5);
      }
      throw new NovaError(504, "the mouse did not reply in time");
    },
    close() {
      closeSync(fd);
    },
  };
}
