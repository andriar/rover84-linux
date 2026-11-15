import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "../server/app";
import type { HidTransport } from "../server/hidraw";
import { createRgbService } from "../server/rgb";
import { CMD, MODES, RgbError, buildPacket, decodeRecord, encodeRecord, fromHex, parseSettings, toHex, type LightSettings } from "../src/rgb/protocol";

// Records read from / written to the real keyboard on 2026-11-16.
const ORIGINAL = fromHex("00 14 00 00 ff 00 28 28 28 00 00 00 00 00 00 00 00 00 00 00 01");
const STATIC_RED = fromHex("00 06 04 02 ff 00 ff 00 00 00 00 00 00 00 00 00 00 00 00 00 01");
const red: LightSettings = { mode: 6, brightness: 4, speed: 2, multicolor: false, color: { r: 255, g: 0, b: 0 } };

/** A keyboard that keeps one config record in memory and speaks the same framing as the real one. */
function fakeKeyboard(initial: Uint8Array) {
  const kb = {
    memory: initial.slice(),
    log: [] as string[],
    ignoreWrites: false,
    rejectWrites: false,
    open: 0,
    closed: 0,
    transport(): HidTransport {
      kb.open++;
      return {
        async transfer(p) {
          let sum = 0;
          for (let i = 3; i < 64; i++) sum += p[i]!;
          if (p[1] !== (sum & 0xff) || p[2] !== sum >> 8) throw new Error("bad checksum");
          const reply = new Uint8Array(64);
          reply.set(p.slice(0, 8));
          if (p[3] === CMD.begin) kb.log.push("begin");
          else if (p[3] === CMD.end) kb.log.push("end");
          else if (p[3] === CMD.read) {
            kb.log.push("read");
            reply.set(kb.memory.slice(p[5]!, p[5]! + p[4]!), 8);
          } else if (p[3] === CMD.write) {
            kb.log.push("write");
            if (kb.rejectWrites) reply[7] = 0xff;
            else if (!kb.ignoreWrites) kb.memory.set(p.slice(8, 8 + p[4]!), p[5]);
          }
          return reply;
        },
        close() {
          kb.closed++;
        },
      };
    },
  };
  return kb;
}

describe("protocol framing", () => {
  it("matches the packets the keyboard accepted", () => {
    expect(toHex(buildPacket(CMD.begin).slice(0, 8))).toBe("04 01 00 01 00 00 00 00");
    expect(toHex(buildPacket(CMD.end).slice(0, 8))).toBe("04 02 00 02 00 00 00 00");
    // 8-byte parameter packet with the unsigned checksum 0x0117 that the keyboard echoed back
    const p = buildPacket(CMD.write, 8, 0, Uint8Array.from([6, 4, 0, 0, 0, 255, 0, 0]));
    expect(toHex(p.slice(0, 16))).toBe("04 17 01 06 08 00 00 00 06 04 00 00 00 ff 00 00");
  });
  it("splits the offset into two bytes", () => {
    const p = buildPacket(CMD.read, 21, 0x1234);
    expect([p[5], p[6]]).toEqual([0x34, 0x12]);
  });
  it("refuses a payload that does not fit", () => {
    expect(() => buildPacket(CMD.write, 60, 0, new Uint8Array(57))).toThrow(RgbError);
  });
});

describe("records", () => {
  it("decodes what was read and what was written on the real keyboard", () => {
    expect(decodeRecord(ORIGINAL)).toMatchObject({ mode: 0x14, brightness: 0, color: { r: 0x28, g: 0x28, b: 0x28 } });
    expect(decodeRecord(STATIC_RED)).toEqual(red);
  });
  it("turns the original into the verified static-red record and keeps every unknown byte", () => {
    expect(toHex(encodeRecord(ORIGINAL, red))).toBe(toHex(STATIC_RED));
    const odd = ORIGINAL.slice();
    odd[0] = 0x7e;
    odd[4] = 0x55;
    odd[20] = 0x99;
    const out = encodeRecord(odd, red);
    expect([out[0], out[4], out[20]]).toEqual([0x7e, 0x55, 0x99]);
  });
  it("does not offer the per-key Custom mode", () => {
    expect(MODES.some((m) => m.id === 0x14)).toBe(false);
  });
});

describe("parseSettings", () => {
  it("accepts valid input", () => expect(parseSettings(red)).toEqual(red));
  it.each([
    [null],
    [{ ...red, mode: 0x14 }],
    [{ ...red, mode: 99 }],
    [{ ...red, brightness: 5 }],
    [{ ...red, brightness: 1.5 }],
    [{ ...red, speed: -1 }],
    [{ ...red, multicolor: "yes" }],
    [{ ...red, color: { r: 256, g: 0, b: 0 } }],
    [{ ...red, color: null }],
  ])("rejects bad input %#", (input) => {
    expect(() => parseSettings(input)).toThrow(RgbError);
  });
});

describe("service", () => {
  let dir: string;
  let kb: ReturnType<typeof fakeKeyboard>;
  const backupPath = () => join(dir, "kb", "rgb-backup.json");
  const make = (present = true) => createRgbService({ backupPath: backupPath(), open: async () => (present ? kb.transport() : null) });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kbrgb-"));
    kb = fakeKeyboard(ORIGINAL);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the current settings and always closes with End", async () => {
    const s = await make().read();
    expect(s).toMatchObject({ present: true, hasBackup: false, unrecognized: false });
    expect(s.settings?.mode).toBe(0x14);
    expect(kb.log).toEqual(["begin", "read", "end"]);
    expect(kb.closed).toBe(1);
  });

  it("reports an absent keyboard without throwing", async () => {
    expect(await make(false).read()).toEqual({ present: false });
  });

  it("writes, verifies by reading back, and saves the original once", async () => {
    const svc = make();
    const s = await svc.write(red);
    expect(toHex(kb.memory)).toBe(toHex(STATIC_RED));
    expect(s.settings).toEqual(red);
    expect(kb.log).toEqual(["begin", "read", "write", "read", "end"]);
    expect(JSON.parse(readFileSync(backupPath(), "utf8")).record).toBe(toHex(ORIGINAL));

    await svc.write({ ...red, color: { r: 0, g: 0, b: 255 } });
    expect(JSON.parse(readFileSync(backupPath(), "utf8")).record).toBe(toHex(ORIGINAL)); // not overwritten by our own record
  });

  it("restores the original record", async () => {
    const svc = make();
    await svc.write(red);
    const s = await svc.restore();
    expect(toHex(kb.memory)).toBe(toHex(ORIGINAL));
    expect(s.settings?.mode).toBe(0x14);
  });

  it("refuses to restore when nothing was saved", async () => {
    await expect(make().restore()).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to overwrite a record it does not recognize, and writes nothing", async () => {
    kb = fakeKeyboard(fromHex("ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff"));
    await expect(make().write(red)).rejects.toMatchObject({ status: 409 });
    expect(kb.log).not.toContain("write");
    expect(existsSync(backupPath())).toBe(false);
    expect(kb.log.at(-1)).toBe("end");
  });

  it("fails loudly when the write does not stick", async () => {
    kb.ignoreWrites = true;
    await expect(make().write(red)).rejects.toThrow(/did not stick/);
    expect(kb.log.at(-1)).toBe("end");
  });

  it("fails loudly when the keyboard rejects the write", async () => {
    kb.rejectWrites = true;
    await expect(make().write(red)).rejects.toThrow(/rejected/);
  });

  it("never interleaves two conversations", async () => {
    const svc = make();
    await Promise.all([svc.write(red), svc.write({ ...red, brightness: 1 })]);
    expect(kb.log).toEqual(["begin", "read", "write", "read", "end", "begin", "read", "write", "read", "end"]);
  });
});

describe("HTTP routes", () => {
  let dir: string;
  let server: Server;
  let base: string;
  let kb: ReturnType<typeof fakeKeyboard>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "kbrgbhttp-"));
    kb = fakeKeyboard(ORIGINAL);
    let port = 0;
    const handler = createHandler({
      configDir: join(dir, "kb"),
      xkbDir: join(dir, "xkb"),
      rgb: { backupPath: join(dir, "kb", "rgb-backup.json"), open: async () => kb.transport() },
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

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("GET /api/rgb returns the decoded record", async () => {
    const s = await (await fetch(base + "/api/rgb")).json();
    expect(s.present).toBe(true);
    expect(s.settings.mode).toBe(0x14);
  });
  it("POST /api/rgb writes and returns the new settings", async () => {
    const res = await post("/api/rgb", red);
    expect(res.status).toBe(200);
    expect((await res.json()).settings).toEqual(red);
    expect(toHex(kb.memory)).toBe(toHex(STATIC_RED));
  });
  it("rejects invalid settings with 400 and touches nothing", async () => {
    const res = await post("/api/rgb", { ...red, brightness: 9 });
    expect(res.status).toBe(400);
    expect(kb.open).toBe(0);
  });
  it("rejects a cross-site Origin", async () => {
    expect((await post("/api/rgb", red, { origin: "http://evil.example" })).status).toBe(403);
    expect(kb.open).toBe(0);
  });
  it("POST /api/rgb/restore brings the original back", async () => {
    await post("/api/rgb", red);
    const res = await post("/api/rgb/restore", {});
    expect(res.status).toBe(200);
    expect(toHex(kb.memory)).toBe(toHex(ORIGINAL));
  });
});
