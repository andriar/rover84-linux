import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "../server/app";
import {
  MOUSE_BEGIN,
  emptyMouseConfig,
  friendlyMouseName,
  isPointerName,
  mouseDeviceCall,
  mouseLuaSection,
  mouseResetCall,
  parseMouseConfig,
  stripMouseSection,
} from "../src/mouse/config";

const good = { ...emptyMouseConfig("telink-wireless-gaming-mouse"), sensitivity: -0.4, accelProfile: "flat" as const, scrollFactor: 1.5, leftHanded: true };

describe("mouse config", () => {
  it("accepts a valid config and rounds to one decimal", () => {
    expect(parseMouseConfig({ ...good, sensitivity: -0.4000001 }).sensitivity).toBe(-0.4);
  });

  it.each([
    [{ ...good, sensitivity: 1.5 }, /sensitivity/],
    [{ ...good, sensitivity: "0" }, /sensitivity/],
    [{ ...good, scrollFactor: 0.1 }, /scrollFactor/],
    [{ ...good, scrollFactor: Number.NaN }, /scrollFactor/],
    [{ ...good, accelProfile: "custom 1 2" }, /accelProfile/],
    [{ ...good, device: 'x"}) os.execute("id") --' }, /device/],
    [{ ...good, version: 2 }, /version/],
    [{ ...good, leftHanded: "yes" }, /true or false/],
    [null, /object/],
  ])("rejects bad input %#", (input, msg) => {
    expect(() => parseMouseConfig(input)).toThrow(msg);
  });

  it("builds a Lua statement with every field and no leading dash", () => {
    const call = mouseDeviceCall(parseMouseConfig(good));
    expect(call).toBe('hl.device({ name = "telink-wireless-gaming-mouse", sensitivity = -0.4, accel_profile = "flat", scroll_factor = 1.5, natural_scroll = false, left_handed = true })');
    expect(call.startsWith("-")).toBe(false);
  });

  it("uses the adaptive profile for the default setting", () => {
    expect(mouseDeviceCall(emptyMouseConfig())).toContain('accel_profile = "adaptive"');
  });

  it("refuses an unsafe name or value even if validation was skipped", () => {
    expect(() => mouseDeviceCall({ ...good, device: 'a" b' })).toThrow(/unsafe/);
    expect(() => mouseResetCall("ok-name", { sensitivity: 0, accelProfile: 'x"y', scrollFactor: 1, naturalScroll: false, leftHanded: false })).toThrow(/unsafe/);
  });

  it("resets to the global values, allowing an empty accel profile", () => {
    expect(mouseResetCall("m-1", { sensitivity: 0, accelProfile: "", scrollFactor: 1, naturalScroll: false, leftHanded: false })).toBe(
      'hl.device({ name = "m-1", sensitivity = 0, accel_profile = "", scroll_factor = 1, natural_scroll = false, left_handed = false })',
    );
  });

  it("adds and strips its section without touching the rest", () => {
    const kb = "-- kb\nhl.device({ name = \"k\" })\n";
    const withMouse = kb + mouseLuaSection(parseMouseConfig(good));
    expect(withMouse).toContain(MOUSE_BEGIN);
    expect(stripMouseSection(withMouse)).toBe(kb);
    expect(stripMouseSection(kb)).toBe(kb);
    expect(mouseLuaSection(null)).toBe("");
  });

  it("names devices and drops keyboard and media interfaces", () => {
    expect(friendlyMouseName("telink-wireless-gaming-mouse")).toBe("Wireless Gaming Mouse");
    expect(isPointerName("telink-wireless-gaming-mouse")).toBe(true);
    expect(isPointerName("telink-wireless-gaming-mouse-consumer-control-1")).toBe(false);
    expect(isPointerName("telink-rover-84-v3--keyboard-1")).toBe(false);
  });
});

describe("mouse API", () => {
  let dir: string;
  let server: Server;
  let base: string;
  let evals: string[];
  let evalReply: string;
  let mice: { name: string; defaultSpeed: number; scrollFactor: number }[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "mouseserver-"));
    evals = [];
    evalReply = "ok";
    mice = [
      { name: "telink-wireless-gaming-mouse", defaultSpeed: 0, scrollFactor: -1 },
      { name: "telink-wireless-gaming-mouse-consumer-control-1", defaultSpeed: 0, scrollFactor: -1 },
    ];
    let port = 0;
    const handler = createHandler({
      configDir: join(dir, "kb"),
      xkbDir: join(dir, "xkb"),
      get allowedHosts() {
        return [`127.0.0.1:${port}`];
      },
      hyprctl: async (args) => {
        if (args[0] === "devices") return JSON.stringify({ keyboards: [{ name: "telink-rover-84-v3-", layout: "us" }], mice });
        if (args[0] === "getoption") {
          const o = args[1];
          if (o === "input:sensitivity") return '{"option":"input:sensitivity","float":0.000000,"set":true}';
          if (o === "input:accel_profile") return '{"option":"input:accel_profile","str":"[[EMPTY]]","set":false}';
          if (o === "input:scroll_factor") return '{"option":"input:scroll_factor","float":1.000000,"set":false}';
          return `{"option":"${o}","bool":false,"set":false}`;
        }
        if (args[0] === "eval") {
          if ((args[1] ?? "").startsWith("-")) throw new Error("hyprctl would parse this as a flag");
          evals.push(args[1] ?? "");
          return evalReply;
        }
        throw new Error("unexpected hyprctl call");
      },
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

  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const lua = () => join(dir, "kb", "hyprland.lua");

  it("lists only pointer devices and defaults to the first non-Rover mouse", async () => {
    const s = await (await fetch(base + "/api/mouse")).json();
    expect(s.mice.map((m: { name: string }) => m.name)).toEqual(["telink-wireless-gaming-mouse"]);
    expect(s.config.device).toBe("telink-wireless-gaming-mouse");
    expect(s).toMatchObject({ active: false, present: true });
  });

  it("applies: writes the lua block, the saved config, and evals the same statement", async () => {
    const res = await post("/api/mouse", { config: good });
    expect(res.status).toBe(200);
    expect(evals).toEqual([mouseDeviceCall(parseMouseConfig(good))]);
    expect(readFileSync(lua(), "utf8")).toContain(mouseDeviceCall(parseMouseConfig(good)));
    expect(JSON.parse(readFileSync(join(dir, "kb", "mouse.json"), "utf8"))).toMatchObject({ active: true });
    expect((await res.json()).active).toBe(true);
  });

  it("keeps the keyboard part of the file and the mouse part across each other's apply and revert", async () => {
    await post("/api/apply", { config: { version: 1, deviceMatch: "rover-84", mappings: { CapsLock: "ControlLeft" }, swapAltSuper: false } });
    expect(readFileSync(lua(), "utf8")).not.toContain(MOUSE_BEGIN);
    await post("/api/mouse", { config: good });
    let text = readFileSync(lua(), "utf8");
    expect(text).toContain("kbconfig");
    expect(text).toContain(MOUSE_BEGIN);
    await post("/api/revert", {});
    text = readFileSync(lua(), "utf8");
    expect(text).toContain('kb_layout = "us"');
    expect(text).toContain(MOUSE_BEGIN);
    await post("/api/mouse/revert", {});
    text = readFileSync(lua(), "utf8");
    expect(text).toContain('kb_layout = "us"');
    expect(text).not.toContain(MOUSE_BEGIN);
  });

  it("reverts to the global values and keeps the saved settings for next time", async () => {
    await post("/api/mouse", { config: good });
    evals.length = 0;
    const res = await post("/api/mouse/revert", {});
    expect(res.status).toBe(200);
    expect(evals).toEqual(['hl.device({ name = "telink-wireless-gaming-mouse", sensitivity = 0, accel_profile = "", scroll_factor = 1, natural_scroll = false, left_handed = false })']);
    const s = await res.json();
    expect(s.active).toBe(false);
    expect(s.config.sensitivity).toBe(-0.4);
  });

  it("revert with nothing saved does nothing", async () => {
    expect((await post("/api/mouse/revert", {})).status).toBe(200);
    expect(evals).toEqual([]);
    expect(existsSync(lua())).toBe(false);
  });

  it("409 when the chosen mouse is not connected, and nothing is written", async () => {
    const res = await post("/api/mouse", { config: { ...good, device: "some-other-mouse" } });
    expect(res.status).toBe(409);
    expect(existsSync(lua())).toBe(false);
    expect(evals).toEqual([]);
  });

  it("400 on invalid settings", async () => {
    expect((await post("/api/mouse", { config: { ...good, sensitivity: 9 } })).status).toBe(400);
    expect(evals).toEqual([]);
  });

  it("502 when Hyprland rejects the change", async () => {
    evalReply = "error: hl.device: unknown field";
    const res = await post("/api/mouse", { config: good });
    expect(res.status).toBe(502);
  });

  it("500 on a corrupt saved file instead of overwriting it", async () => {
    mkdirSync(join(dir, "kb"), { recursive: true });
    writeFileSync(join(dir, "kb", "mouse.json"), "{nope");
    expect((await fetch(base + "/api/mouse")).status).toBe(500);
  });
});
