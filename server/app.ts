import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import {
  RemapError,
  emptyConfig,
  generateHyprlandLua,
  hyprlandDeviceCalls,
  generateXkbSymbols,
  matchDevices,
  parseConfig,
  XKB_LAYOUT,
  type RemapConfig,
} from "../src/remap/xkb.ts";
import {
  MouseError,
  emptyMouseConfig,
  isPointerName,
  mouseDeviceCall,
  mouseLuaSection,
  mouseResetCall,
  parseMouseConfig,
  stripMouseSection,
  type GlobalPointer,
  type MouseConfig,
} from "../src/mouse/config.ts";
import { RgbError } from "../src/rgb/protocol.ts";
import { createRgbService, type RgbDeps } from "./rgb.ts";

export interface Deps {
  /** Keyboard lighting over raw HID. Omit to disable the /api/rgb routes. */
  rgb?: RgbDeps;
  /** Holds remap.json and hyprland.lua (normally ~/.config/keyboard-config). */
  configDir: string;
  /** Directory that contains `symbols/` (normally ~/.config/xkb). */
  xkbDir: string;
  /** Built UI to serve, if present. */
  staticDir?: string;
  /** Hostnames (with port) the request's Host/Origin must match. */
  allowedHosts: string[];
  /** Runs `hyprctl <args>` without a shell and returns stdout. */
  hyprctl: (args: string[]) => Promise<string>;
}

interface HyprKeyboard {
  name: string;
  layout: string;
}

interface HyprMouse {
  name: string;
  speed: number;
  scrollFactor: number;
}

interface SavedMouse {
  config: MouseConfig;
  active: boolean;
}

const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

export function createHandler(deps: Deps) {
  const remapPath = join(deps.configDir, "remap.json");
  const luaPath = join(deps.configDir, "hyprland.lua");
  const xkbPath = join(deps.xkbDir, "symbols", XKB_LAYOUT);
  const rgb = deps.rgb ? createRgbService(deps.rgb) : null;
  const mousePath = join(deps.configDir, "mouse.json");

  async function atomicWrite(path: string, text: string): Promise<void> {
    await mkdir(join(path, ".."), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, text, { mode: 0o600 });
    await rename(tmp, path);
  }

  async function loadConfig(): Promise<RemapConfig> {
    try {
      return parseConfig(JSON.parse(await readFile(remapPath, "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig();
      throw new HttpError(500, `saved config is unreadable: ${(e as Error).message}`);
    }
  }

  async function keyboards(): Promise<{ list: HyprKeyboard[]; error?: string }> {
    try {
      const data = JSON.parse(await deps.hyprctl(["devices", "-j"])) as { keyboards?: HyprKeyboard[] };
      return { list: (data.keyboards ?? []).map((k) => ({ name: k.name, layout: k.layout })) };
    } catch (e) {
      return { list: [], error: `Hyprland not reachable: ${(e as Error).message}` };
    }
  }

  /** hyprctl prints "ok" on success; anything else is an error message to surface. */
  async function evalLua(code: string): Promise<void> {
    let out: string;
    try {
      out = (await deps.hyprctl(["eval", code])).trim();
    } catch (e) {
      throw new HttpError(502, `Hyprland rejected the change: ${(e as Error).message}`);
    }
    if (out !== "ok" && out !== "") throw new HttpError(502, `Hyprland rejected the change: ${out}`);
  }

  async function state() {
    const config = await loadConfig();
    const { list, error } = await keyboards();
    const matched = matchDevices(list.map((k) => k.name), config.deviceMatch);
    const active = matched.length > 0 && list.filter((k) => matched.includes(k.name)).every((k) => k.layout === XKB_LAYOUT);
    return { config, devices: list.map((k) => k.name), matched, active, ...(error ? { warning: error } : {}) };
  }

  async function apply(body: unknown) {
    const config = parseConfig((body as { config?: unknown } | null)?.config);
    const { list, error } = await keyboards();
    if (error) throw new HttpError(503, error);
    const matched = matchDevices(list.map((k) => k.name), config.deviceMatch);
    if (matched.length === 0) throw new HttpError(409, `No keyboard matches "${config.deviceMatch}"`);

    // Order matters: the xkb file must exist before Hyprland is told to use it.
    await atomicWrite(xkbPath, generateXkbSymbols(config));
    await atomicWrite(remapPath, JSON.stringify(config, null, 2) + "\n");
    await atomicWrite(luaPath, generateHyprlandLua(matched, true, config.swapAltSuper) + (await mouseSection()));
    await evalLua(hyprlandDeviceCalls(matched, true, config.swapAltSuper).join("\n"));
    return state();
  }

  async function revert() {
    const config = await loadConfig();
    const { list, error } = await keyboards();
    if (error) throw new HttpError(503, error);
    const matched = matchDevices(list.map((k) => k.name), config.deviceMatch);
    if (matched.length === 0) throw new HttpError(409, `No keyboard matches "${config.deviceMatch}"`);
    await atomicWrite(luaPath, generateHyprlandLua(matched, false, config.swapAltSuper) + (await mouseSection()));
    await evalLua(hyprlandDeviceCalls(matched, false, config.swapAltSuper).join("\n"));
    return state();
  }

  /* ---------- mouse ---------- */

  async function loadMouse(): Promise<SavedMouse | null> {
    try {
      const raw = JSON.parse(await readFile(mousePath, "utf8")) as { config?: unknown; active?: unknown };
      return { config: parseMouseConfig(raw.config), active: raw.active === true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new HttpError(500, `saved mouse config is unreadable: ${(e as Error).message}`);
    }
  }

  /** The block the generated hyprland.lua carries for the mouse; empty unless the override is on. */
  async function mouseSection(): Promise<string> {
    const saved = await loadMouse();
    return saved?.active ? mouseLuaSection(saved.config) : "";
  }

  async function readLua(): Promise<string> {
    try {
      return await readFile(luaPath, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw e;
    }
  }

  async function mice(): Promise<{ list: HyprMouse[]; error?: string }> {
    try {
      const data = JSON.parse(await deps.hyprctl(["devices", "-j"])) as { mice?: { name: string; defaultSpeed?: number; scrollFactor?: number }[] };
      return {
        list: (data.mice ?? []).filter((m) => isPointerName(m.name)).map((m) => ({ name: m.name, speed: m.defaultSpeed ?? 0, scrollFactor: m.scrollFactor ?? -1 })),
      };
    } catch (e) {
      return { list: [], error: `Hyprland not reachable: ${(e as Error).message}` };
    }
  }

  async function globalPointer(): Promise<GlobalPointer> {
    const opt = async (name: string): Promise<Record<string, unknown>> => {
      try {
        return JSON.parse(await deps.hyprctl(["getoption", `input:${name}`, "-j"])) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    const num = (o: Record<string, unknown>, fallback: number) => (typeof o.float === "number" ? o.float : typeof o.int === "number" ? o.int : fallback);
    const accel = (await opt("accel_profile")).str;
    return {
      sensitivity: Math.round(num(await opt("sensitivity"), 0) * 10) / 10,
      accelProfile: typeof accel === "string" && /^[A-Za-z0-9._-]+$/.test(accel) ? accel : "",
      scrollFactor: Math.round(num(await opt("scroll_factor"), 1) * 10) / 10,
      naturalScroll: (await opt("natural_scroll")).bool === true,
      leftHanded: (await opt("left_handed")).bool === true,
    };
  }

  async function mouseState() {
    const saved = await loadMouse();
    const { list, error } = await mice();
    const fallback = list.find((m) => !/rover/i.test(m.name))?.name ?? list[0]?.name;
    const config = saved?.config ?? emptyMouseConfig(fallback);
    const live = list.find((m) => m.name === config.device);
    return { config, active: !!saved?.active && !!live, present: !!live, mice: list, ...(error ? { warning: error } : {}) };
  }

  async function mouseApply(body: unknown) {
    const config = parseMouseConfig((body as { config?: unknown } | null)?.config);
    const { list, error } = await mice();
    if (error) throw new HttpError(503, error);
    if (!list.some((m) => m.name === config.device)) throw new HttpError(409, "That mouse isn't connected right now.");
    const kb = stripMouseSection(await readLua());
    await atomicWrite(luaPath, (kb && !kb.endsWith("\n") ? kb + "\n" : kb) + mouseLuaSection(config));
    await atomicWrite(mousePath, JSON.stringify({ config, active: true }, null, 2) + "\n");
    await evalLua(mouseDeviceCall(config));
    return mouseState();
  }

  async function mouseRevert() {
    const saved = await loadMouse();
    if (!saved) return mouseState();
    const { error } = await mice();
    if (error) throw new HttpError(503, error);
    await atomicWrite(luaPath, stripMouseSection(await readLua()));
    await atomicWrite(mousePath, JSON.stringify({ config: saved.config, active: false }, null, 2) + "\n");
    await evalLua(mouseResetCall(saved.config.device, await globalPointer()));
    return mouseState();
  }

  async function readJson(req: IncomingMessage): Promise<unknown> {
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "content-type must be application/json");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, "body too large");
      chunks.push(chunk as Buffer);
    }
    try {
      return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    } catch {
      throw new HttpError(400, "invalid JSON");
    }
  }

  async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
    if (!deps.staticDir) return false;
    const rel = normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname)).replace(/^([/\\])+/, "");
    const full = join(deps.staticDir, rel);
    if (full !== deps.staticDir && !full.startsWith(deps.staticDir + sep)) throw new HttpError(403, "forbidden");
    try {
      if (!(await stat(full)).isFile()) return false;
      res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" });
      res.end(await readFile(full));
      return true;
    } catch {
      return false;
    }
  }

  function send(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // DNS-rebinding and cross-site guard: this server edits files, so only our own origin may talk to it.
      if (!deps.allowedHosts.includes(req.headers.host ?? "")) throw new HttpError(403, "host not allowed");
      const origin = req.headers.origin;
      if (origin !== undefined && !deps.allowedHosts.some((h) => origin === `http://${h}`)) throw new HttpError(403, "origin not allowed");

      const url = new URL(req.url ?? "/", "http://localhost");
      const route = `${req.method} ${url.pathname}`;
      if (route === "GET /api/state") return send(res, 200, await state());
      if (route === "POST /api/apply") return send(res, 200, await apply(await readJson(req)));
      if (route === "POST /api/revert") {
        await readJson(req);
        return send(res, 200, await revert());
      }
      if (route === "GET /api/mouse") return send(res, 200, await mouseState());
      if (route === "POST /api/mouse") return send(res, 200, await mouseApply(await readJson(req)));
      if (route === "POST /api/mouse/revert") {
        await readJson(req);
        return send(res, 200, await mouseRevert());
      }
      if (url.pathname === "/api/rgb" || url.pathname === "/api/rgb/restore") {
        if (!rgb) throw new HttpError(404, "lighting is not enabled");
        if (route === "GET /api/rgb") return send(res, 200, await rgb.read());
        if (route === "POST /api/rgb") return send(res, 200, await rgb.write(await readJson(req)));
        if (route === "POST /api/rgb/restore") {
          await readJson(req);
          return send(res, 200, await rgb.restore());
        }
      }
      if (req.method === "GET" && !url.pathname.startsWith("/api/") && (await serveStatic(url.pathname, res))) return;
      throw new HttpError(404, "not found");
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof MouseError) return send(res, 400, { error: e.message });
      if (e instanceof RemapError) return send(res, 400, { error: e.message });
      if (e instanceof RgbError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: "internal error" });
    }
  };
}
