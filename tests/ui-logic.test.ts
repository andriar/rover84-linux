import { describe, expect, it } from "vitest";
import { describePending, friendlyDeviceName, pendingChanges } from "../src/remap/pending";
import { emptyConfig, type RemapConfig } from "../src/remap/xkb";

const base = (over: Partial<RemapConfig> = {}): RemapConfig => ({ ...emptyConfig(), ...over });

describe("pendingChanges", () => {
  it("is zero for identical configs", () => expect(pendingChanges(base(), base()).total).toBe(0));
  it("counts added, changed and removed keys once each", () => {
    const saved = base({ mappings: { CapsLock: "Escape", KeyA: "KeyB" } });
    const edited = base({ mappings: { CapsLock: "ControlLeft", KeyC: "KeyD" } });
    expect(pendingChanges(edited, saved).keys).toBe(3); // CapsLock changed, KeyA removed, KeyC added
  });
  it("counts the swap and the filter as one change each", () => {
    const p = pendingChanges(base({ swapAltSuper: true, deviceMatch: "other" }), base());
    expect(p).toMatchObject({ keys: 0, swap: true, name: true, total: 2 });
  });
  it("only the swap changed reads as 1 change", () => {
    const p = pendingChanges(base({ swapAltSuper: true }), base());
    expect(p.total).toBe(1);
    expect(describePending(p)).toBe("Alt/Super swap");
  });
  it("describes keys and swap together", () => {
    const p = pendingChanges(base({ swapAltSuper: true, mappings: { KeyA: "KeyB", KeyC: "KeyD" } }), base());
    expect(p.total).toBe(3);
    expect(describePending(p)).toBe("2 keys, Alt/Super swap");
  });
});

describe("friendlyDeviceName", () => {
  it("cleans the Hyprland name and counts inputs", () => {
    expect(friendlyDeviceName(["telink-rover-84-v3-", "telink-rover-84-v3--keyboard"])).toBe("Rover 84 V3 (2 inputs)");
  });
  it("handles one input and an empty list", () => {
    expect(friendlyDeviceName(["telink-rover-84-v3--keyboard"])).toBe("Rover 84 V3");
    expect(friendlyDeviceName([])).toBe("");
  });
});
