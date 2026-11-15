import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "../server/app";

let dir: string;
let server: Server;
let base: string;
let calls: string[][];
let keyboards: { name: string; layout: string }[];
let evalReply: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kbserver-"));
  calls = [];
  keyboards = [
    { name: "telink-rover-84-v3-", layout: "us" },
    { name: "telink-rover-84-v3--keyboard", layout: "us" },
    { name: "telink-wireless-gaming-mouse-keyboard", layout: "us" },
  ];
  evalReply = "ok";
  let port = 0;
  const handler = createHandler({
    configDir: join(dir, "kb"),
    xkbDir: join(dir, "xkb"),
    get allowedHosts() {
      return [`127.0.0.1:${port}`];
    },
    hyprctl: async (args) => {
      calls.push(args);
      if (args[0] === "devices") return JSON.stringify({ keyboards });
      if (args[0] === "eval") {
        if ((args[1] ?? "").startsWith("-")) throw new Error("hyprctl would parse this as a flag");
        if (evalReply === "ok") for (const k of keyboards) if ((args[1] ?? "").includes(`"${k.name}"`)) k.layout = (args[1] ?? "").includes('kb_layout = "kbconfig"') ? "kbconfig" : "us";
        if (evalReply === "THROW") throw new Error("error: syntax error (exit 7)");
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

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

const config = { version: 1, deviceMatch: "rover-84", mappings: { CapsLock: "ControlLeft" } };

describe("API", () => {
  it("reports devices and no active remap initially", async () => {
    const s = await (await fetch(base + "/api/state")).json();
    expect(s.matched).toEqual(["telink-rover-84-v3-", "telink-rover-84-v3--keyboard"]);
    expect(s.active).toBe(false);
    expect(s.config.mappings).toEqual({});
  });

  it("apply writes xkb + config + lua and targets only matched keyboards", async () => {
    const res = await post("/api/apply", { config });
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s.active).toBe(true);
    expect(readFileSync(join(dir, "xkb", "symbols", "kbconfig"), "utf8")).toContain("<CAPS>");
    expect(JSON.parse(readFileSync(join(dir, "kb", "remap.json"), "utf8")).mappings).toEqual(config.mappings);
    const lua = readFileSync(join(dir, "kb", "hyprland.lua"), "utf8");
    expect(lua).toContain("telink-rover-84-v3-");
    expect(lua).not.toContain("mouse");
    expect(keyboards.find((k) => k.name.includes("mouse"))!.layout).toBe("us");
  });

  it("revert puts matched keyboards back on us but keeps the saved mappings", async () => {
    await post("/api/apply", { config });
    const s = await (await post("/api/revert", {})).json();
    expect(s.active).toBe(false);
    expect(s.config.mappings).toEqual(config.mappings);
    expect(keyboards.every((k) => k.layout === "us")).toBe(true);
  });

  it("persists swapAltSuper in the lua file and sends it to Hyprland, also on revert", async () => {
    const withSwap = { ...config, mappings: {}, swapAltSuper: true };
    await post("/api/apply", { config: withSwap });
    expect(readFileSync(join(dir, "kb", "hyprland.lua"), "utf8")).toContain('kb_options = "altwin:swap_alt_win"');
    expect(calls.some((c) => c[0] === "eval" && (c[1] ?? "").includes("altwin:swap_alt_win"))).toBe(true);
    const s = await (await post("/api/revert", {})).json();
    expect(s.config.swapAltSuper).toBe(true);
    expect(readFileSync(join(dir, "kb", "hyprland.lua"), "utf8")).toContain('kb_layout = "us", kb_variant = "", kb_options = "altwin:swap_alt_win"');
  });

  it("does not write anything when no keyboard matches", async () => {
    const res = await post("/api/apply", { config: { ...config, deviceMatch: "nothing-here" } });
    expect(res.status).toBe(409);
    expect(existsSync(join(dir, "xkb"))).toBe(false);
  });

  it("surfaces a Hyprland rejection instead of claiming success", async () => {
    evalReply = "lua error: boom";
    const res = await post("/api/apply", { config });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("boom");
  });

  it("reports a failing hyprctl (non-zero exit) as 502 with its message", async () => {
    evalReply = "THROW";
    const res = await post("/api/apply", { config });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("exit 7");
  });

  it("rejects invalid config with 400 and writes nothing", async () => {
    const res = await post("/api/apply", { config: { ...config, mappings: { ControlLeft: "KeyA" } } });
    expect(res.status).toBe(400);
    expect(existsSync(join(dir, "kb"))).toBe(false);
  });
});

describe("request guards", () => {
  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const r = await new Promise<number>((resolve) => {
      import("node:http").then(({ request }) => {
        const addr = server.address() as AddressInfo;
        const req = request({ host: "127.0.0.1", port: addr.port, path: "/api/state", headers: { host: "evil.example" } }, (res) => resolve(res.statusCode ?? 0));
        req.end();
      });
    });
    expect(r).toBe(403);
  });
  it("rejects a cross-site Origin", async () => {
    expect((await post("/api/apply", { config }, { origin: "http://evil.example" })).status).toBe(403);
  });
  it("rejects non-JSON content types", async () => {
    const res = await fetch(base + "/api/apply", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    expect(res.status).toBe(415);
  });
  it("rejects oversized bodies", async () => {
    expect((await post("/api/apply", { pad: "x".repeat(70_000) })).status).toBe(413);
  });
  it("returns 404 for unknown routes and never serves outside the static dir", async () => {
    expect((await fetch(base + "/api/nope")).status).toBe(404);
    expect((await fetch(base + "/../../etc/passwd")).status).toBe(404);
  });
});
