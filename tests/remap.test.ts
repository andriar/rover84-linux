import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BOARD, KEYS, TARGETS, isProtectedSource, keyByCode } from "../src/remap/keys";
import { RemapError, XKB_LAYOUT, XKB_VARIANT, emptyConfig, generateHyprlandLua, generateXkbSymbols, hyprlandDeviceCalls, matchDevices, parseConfig } from "../src/remap/xkb";

const cfg = (mappings: Record<string, string>) => parseConfig({ ...emptyConfig(), mappings });

describe("key table", () => {
  it("has unique codes and unique non-empty xkb names", () => {
    const codes = TARGETS.map((k) => k.code);
    expect(new Set(codes).size).toBe(codes.length);
    const xkb = KEYS.map((k) => k.xkb);
    expect(new Set(xkb).size).toBe(xkb.length);
    expect(xkb.every((n) => n !== "")).toBe(true);
  });
  it("every board key exists in the table and appears once", () => {
    const seen = BOARD.map((b) => b.code);
    expect(new Set(seen).size).toBe(seen.length);
    for (const c of seen) expect(keyByCode(c), c).toBeDefined();
  });
  it("protects modifiers except CapsLock", () => {
    expect(isProtectedSource(keyByCode("ControlLeft")!)).toBe(true);
    expect(isProtectedSource(keyByCode("CapsLock")!)).toBe(false);
    expect(isProtectedSource(keyByCode("KeyA")!)).toBe(false);
  });
});

describe("parseConfig", () => {
  it("accepts a valid config and drops identity mappings", () => {
    expect(cfg({ CapsLock: "ControlLeft", KeyA: "KeyA" }).mappings).toEqual({ CapsLock: "ControlLeft" });
  });
  it.each([
    [null, /object/],
    [{ version: 2, deviceMatch: "rover", mappings: {} }, /version/],
    [{ version: 1, deviceMatch: 'x"; os.exit() --', mappings: {} }, /deviceMatch/],
    [{ version: 1, deviceMatch: "rover", mappings: { Nope: "KeyA" } }, /unknown source/],
    [{ version: 1, deviceMatch: "rover", mappings: { KeyA: "Nope" } }, /unknown target/],
    [{ version: 1, deviceMatch: "rover", mappings: { F13: "KeyA" } }, /unknown source/],
    [{ version: 1, deviceMatch: "rover", mappings: { ControlLeft: "KeyA" } }, /modifier/],
  ])("rejects bad input %#", (input, msg) => {
    expect(() => parseConfig(input)).toThrow(msg);
    expect(() => parseConfig(input)).toThrow(RemapError);
  });
});

describe("generators", () => {
  it("emits one replace key per mapping and modifier_map only for modifier targets", () => {
    const text = generateXkbSymbols(cfg({ CapsLock: "ControlLeft", Backquote: "Escape", KeyA: "KeyB" }));
    expect(text).toContain(`xkb_symbols "${XKB_VARIANT}"`);
    expect(text).toContain('replace key <CAPS> { type[Group1] = "ONE_LEVEL", symbols[Group1] = [ Control_L ] }');
    expect(text).toContain('replace key <TLDE> { type[Group1] = "ONE_LEVEL", symbols[Group1] = [ Escape ] }');
    expect(text).toContain('replace key <AC01> { type[Group1] = "ALPHABETIC", symbols[Group1] = [ b, B ] }');
    expect(text.match(/modifier_map/g)).toHaveLength(1);
    expect(text).toContain("modifier_map Control { <CAPS> };");
  });
  it("is deterministic regardless of insertion order", () => {
    expect(generateXkbSymbols(cfg({ KeyA: "KeyB", KeyC: "KeyD" }))).toBe(generateXkbSymbols(cfg({ KeyC: "KeyD", KeyA: "KeyB" })));
  });
  it("builds Lua for apply and revert, and refuses unsafe device names", () => {
    expect(generateHyprlandLua(["telink-rover-84-v3-"], true)).toContain(`kb_layout = "${XKB_LAYOUT}"`);
    expect(generateHyprlandLua(["telink-rover-84-v3-"], false)).toContain('kb_layout = "us"');
    expect(() => generateHyprlandLua(['a"}) os.execute("x'], true)).toThrow(/unsafe/);
  });
  it("eval statements never start with a dash (hyprctl would read it as a flag)", () => {
    for (const active of [true, false]) {
      const calls = hyprlandDeviceCalls(["telink-rover-84-v3-"], active);
      expect(calls).toHaveLength(1);
      expect(calls.every((l) => !l.startsWith("-"))).toBe(true);
    }
  });
  it("matches device names case-insensitively", () => {
    expect(matchDevices(["telink-rover-84-v3-", "telink-wireless-gaming-mouse-keyboard"], "ROVER-84")).toEqual(["telink-rover-84-v3-"]);
  });
});

/** Real libxkbcommon: the same library Hyprland uses. Skipped when python3/libxkbcommon are missing. */
const probeAvailable = (() => {
  try {
    execFileSync("python3", ["-c", "import ctypes.util,sys; sys.exit(0 if ctypes.util.find_library('xkbcommon') else 1)"]);
    return true;
  } catch {
    return false;
  }
})();

const tmp = mkdtempSync(join(tmpdir(), "kbconfig-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function probe(mappings: Record<string, string>, steps: [string, number][]) {
  mkdirSync(join(tmp, "xkb", "symbols"), { recursive: true });
  writeFileSync(join(tmp, "xkb", "symbols", XKB_LAYOUT), generateXkbSymbols(cfg(mappings)));
  const out = execFileSync("python3", [new URL("./xkb_probe.py", import.meta.url).pathname], {
    input: JSON.stringify({ xdg: tmp, layout: XKB_LAYOUT, variant: XKB_VARIANT, steps }),
    encoding: "utf8",
  });
  return JSON.parse(out) as { sym: string; mods: string[] }[];
}

// evdev keycodes (linux/input-event-codes.h)
const K = { ESC: 1, GRAVE: 41, A: 30, B: 48, LSHIFT: 42, CAPS: 58, F1: 59 };

describe.skipIf(!probeAvailable)("compiled keymap behaviour (libxkbcommon)", () => {
  it("compiles and leaves every key alone with no mappings", () => {
    const [a, caps] = probe({}, [["down", K.A], ["up", K.A], ["down", K.CAPS]]);
    expect(a!.sym).toBe("a");
    expect(caps!.sym).toBe("Caps_Lock");
  });

  it("CapsLock -> LCtrl acts as a real Control modifier and not as Caps lock", () => {
    const [caps, a] = probe({ CapsLock: "ControlLeft" }, [["down", K.CAPS], ["down", K.A]]);
    expect(caps!.sym).toBe("Control_L");
    expect(caps!.mods).toContain("Control");
    expect(caps!.mods).not.toContain("Lock");
    expect(a!.sym).toBe("a");
    expect(a!.mods).toContain("Control");
  });

  it("CapsLock -> Esc, and Backquote -> Esc", () => {
    expect(probe({ CapsLock: "Escape" }, [["down", K.CAPS]])[0]!.sym).toBe("Escape");
    expect(probe({ Backquote: "Escape" }, [["down", K.GRAVE]])[0]!.sym).toBe("Escape");
  });

  it("letter swap keeps Shift levels, other keys untouched", () => {
    const r = probe({ KeyA: "KeyB", KeyB: "KeyA" }, [["down", K.A], ["up", K.A], ["down", K.B], ["up", K.B], ["down", K.LSHIFT], ["down", K.A]]);
    expect(r[0]!.sym).toBe("b");
    expect(r[1]!.sym).toBe("a");
    expect(r[3]!.sym).toBe("B");
  });

  it("maps to keys that do not exist on the board (F13, volume)", () => {
    expect(probe({ CapsLock: "F13" }, [["down", K.CAPS]])[0]!.sym).toBe("F13");
    expect(probe({ F1: "VolumeMute" }, [["down", K.F1]])[0]!.sym).toBe("XF86AudioMute");
  });
});
