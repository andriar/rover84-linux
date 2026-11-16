import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "../server/app";
import type { NovaTransport } from "../server/novahid";
import { DPI_STAGES, NovaError, buildRead, isReadReply, parseStatus, replyData } from "../src/mouse/nova";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (s: string) => Uint8Array.from(Buffer.from(s.replace(/\s+/g, ""), "hex"));
const pad = (s: string) => {
  const b = new Uint8Array(33);
  b.set(fromHex(s));
  return b;
};

describe("Nova read packets", () => {
  it("matches the packet that was sent to the real dongle (read 10 bytes at 0x32)", () => {
    const p = buildRead(0x32, 10);
    expect(p.length).toBe(33);
    expect(hex(p.subarray(0, 8))).toBe("0511fa4132000a00");
    expect(p.subarray(8).every((v) => v === 0)).toBe(true);
  });

  it("only ever builds command 0x41, whatever the address or length", () => {
    for (const [a, l] of [[0, 1], [0x10, 2], [0xff, 16], [0x7f, 1]] as const) expect(buildRead(a, l)[3]).toBe(0x41);
  });

  it.each([[-1, 4], [0x100, 4], [1.5, 4], [0, 0], [0, 17], [0, 2.5]])("rejects address %s length %s", (a, l) => {
    expect(() => buildRead(a, l)).toThrow(NovaError);
  });

  // Captured from the real dongle.
  const real = pad("05 ed fa 41 32 00 0a 14 ff ff ff ff ff ff ff ff ff ff");

  it("accepts the reply captured from the dongle", () => {
    expect(isReadReply(real, 0x32, 10)).toBe(true);
    expect(hex(replyData(real, 10))).toBe("ff".repeat(10));
  });

  it("rejects replies that do not answer this read", () => {
    expect(isReadReply(real, 0x33, 10)).toBe(false); // other address
    expect(isReadReply(real, 0x32, 9)).toBe(false); // other length
    const badSum = Uint8Array.from(real);
    badSum[1] = (badSum[1] ?? 0) ^ 1;
    expect(isReadReply(badSum, 0x32, 10)).toBe(false);
    const pointer = Uint8Array.from(real);
    pointer[0] = 1; // a pointer report
    expect(isReadReply(pointer, 0x32, 10)).toBe(false);
    const write = Uint8Array.from(real);
    write[3] = 0x42;
    expect(isReadReply(write, 0x32, 10)).toBe(false);
    expect(isReadReply(new Uint8Array(5), 0x32, 10)).toBe(false);
  });
});

describe("status", () => {
  it("maps the byte at 0x11 to a 1-based DPI stage, as seen while pressing the DPI button", () => {
    expect([1, 2, 3, 4, 5, 0].map((v) => parseStatus(Uint8Array.of(0x1f, v)).dpiStage)).toEqual([2, 3, 4, 5, 6, 1]);
    expect(parseStatus(Uint8Array.of(0x1f, 1)).stages).toBe(DPI_STAGES);
  });

  it("reports an unknown stage instead of guessing", () => {
    expect(parseStatus(Uint8Array.of(0x1f, 6)).dpiStage).toBeNull();
    expect(parseStatus(Uint8Array.of(0x1f, 0xff)).dpiStage).toBeNull();
    expect(parseStatus(new Uint8Array(1)).dpiStage).toBeNull();
  });
});

describe("GET /api/mouse/status", () => {
  let dir: string;
  let server: Server;
  let base: string;
  let reads: [number, number][];
  let closes: number;
  let transport: NovaTransport | null;
  let openError: Error | null;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "novaserver-"));
    reads = [];
    closes = 0;
    openError = null;
    transport = {
      read: async (addr, len) => {
        reads.push([addr, len]);
        return Uint8Array.of(0x1f, 2);
      },
      close: () => void closes++,
    };
    let port = 0;
    const handler = createHandler({
      configDir: join(dir, "kb"),
      xkbDir: join(dir, "xkb"),
      nova: {
        open: async () => {
          if (openError) throw openError;
          return transport;
        },
      },
      get allowedHosts() {
        return [`127.0.0.1:${port}`];
      },
      hyprctl: async () => "{}",
    });
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the DPI stage with one read of the status block, and closes the device", async () => {
    const res = await fetch(base + "/api/mouse/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ present: true, dpiStage: 3, stages: 6 });
    expect(reads).toEqual([[0x10, 2]]);
    expect(closes).toBe(1);
  });

  it("says not present when the dongle is absent", async () => {
    transport = null;
    expect(await (await fetch(base + "/api/mouse/status")).json()).toEqual({ present: false });
  });

  it("503 with a message when the device cannot be opened (no permission)", async () => {
    openError = new Error("EACCES: permission denied");
    const res = await fetch(base + "/api/mouse/status");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/EACCES/);
  });

  it("closes the device and reports the timeout when the mouse does not reply", async () => {
    transport = { read: async () => { throw new NovaError(504, "the mouse did not reply in time"); }, close: () => void closes++ };
    const res = await fetch(base + "/api/mouse/status");
    expect(res.status).toBe(504);
    expect(closes).toBe(1);
  });

  it("runs overlapping requests one at a time", async () => {
    let active = 0;
    let peak = 0;
    transport = {
      read: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return Uint8Array.of(0x1f, 0);
      },
      close: () => undefined,
    };
    await Promise.all([1, 2, 3].map(() => fetch(base + "/api/mouse/status")));
    expect(peak).toBe(1);
  });
});
