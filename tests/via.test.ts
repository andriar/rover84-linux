import { describe, expect, it } from "vitest";
import { code, describe as describeKey } from "../src/keycodes";
import { ansi60 } from "../src/layout";
import { exportKeymap, importKeymap } from "../src/storage";
import { MockTransport } from "../src/via/mock";
import { Cmd, PACKET_SIZE, ViaClient, ViaError } from "../src/via/protocol";

const setup = () => {
  const transport = new MockTransport(ansi60.defaultKeymap);
  return { transport, client: new ViaClient(transport) };
};

describe("ViaClient over MockTransport", () => {
  it("reports protocol version and layer count", async () => {
    const { client } = setup();
    expect(await client.getProtocolVersion()).toBe(9);
    expect(await client.getLayerCount()).toBe(ansi60.layers);
  });

  it("reads the default keymap with the right shape", async () => {
    const { client } = setup();
    const km = await client.readKeymap(ansi60.rows, ansi60.cols);
    expect(km).toHaveLength(ansi60.layers);
    expect(km[0]).toHaveLength(ansi60.rows);
    expect(km[0]![0]).toHaveLength(ansi60.cols);
    expect(km[0]![2]![1]).toBe(code("KC_A"));
    expect(km[0]![4]![6]).toBe(code("MO(1)"));
    expect(km[1]![1]![8]).toBe(code("KC_UP"));
  });

  it("writes a keycode and reads it back (including >0xFF values)", async () => {
    const { client } = setup();
    await client.setKeycode(0, 2, 1, code("MO(2)"));
    expect(await client.getKeycode(0, 2, 1)).toBe(0x5222);
  });

  it("rejects out-of-range keycodes before sending", async () => {
    const { client } = setup();
    await expect(client.setKeycode(0, 0, 0, 0x10000)).rejects.toBeInstanceOf(ViaError);
    await expect(client.setKeycode(0, 0, 0, -1)).rejects.toBeInstanceOf(ViaError);
  });

  it("surfaces unhandled commands as ViaError", async () => {
    const { client } = setup();
    await expect(client.getKeycode(99, 0, 0)).rejects.toBeInstanceOf(ViaError);
  });

  it("resets to defaults", async () => {
    const { client } = setup();
    await client.setKeycode(0, 0, 0, code("KC_Z"));
    await client.resetKeymap();
    expect(await client.getKeycode(0, 0, 0)).toBe(code("KC_GRV"));
  });

  it("writeKeymap only sends changed cells", async () => {
    const { client } = setup();
    const current = await client.readKeymap(ansi60.rows, ansi60.cols);
    const next = structuredClone(current);
    next[0]![0]![0] = code("KC_ESC");
    next[3]![1]![1] = code("KC_F1");
    expect(await client.writeKeymap(next, current)).toBe(2);
    expect(await client.readKeymap(ansi60.rows, ansi60.cols)).toEqual(next);
  });
});

describe("MockTransport packet handling", () => {
  it("always answers with a 32-byte packet", async () => {
    const t = new MockTransport(ansi60.defaultKeymap);
    const res = await t.send(new Uint8Array(PACKET_SIZE).fill(0).map((_, i) => (i === 0 ? Cmd.GET_PROTOCOL_VERSION : 0)));
    expect(res).toHaveLength(PACKET_SIZE);
  });

  it("flags unknown commands with 0xFF", async () => {
    const t = new MockTransport(ansi60.defaultKeymap);
    const req = new Uint8Array(PACKET_SIZE);
    req[0] = 0x7e;
    expect((await t.send(req))[0]).toBe(Cmd.UNHANDLED);
  });
});

describe("keycodes", () => {
  it("throws on unknown names", () => {
    expect(() => code("KC_NOPE")).toThrow();
  });
  it("describes known, layer and unknown codes", () => {
    expect(describeKey(code("KC_A"))).toEqual({ label: "A", known: true });
    expect(describeKey(0x5221)).toEqual({ label: "MO(1)", known: true });
    expect(describeKey(0x7c00)).toEqual({ label: "0x7C00", known: false });
  });
  it("default keymap uses only known keycodes", () => {
    for (const layer of ansi60.defaultKeymap())
      for (const [r, row] of layer.entries())
        for (const [c, k] of row.entries())
          if (c < (ansi60.keys.filter((p) => p.row === r).length)) expect(describeKey(k).known).toBe(true);
  });
});

describe("keymap import/export", () => {
  const dims = [ansi60.layers, ansi60.rows, ansi60.cols] as const;
  it("round-trips", () => {
    const km = ansi60.defaultKeymap();
    expect(importKeymap(exportKeymap("x", km), ...dims)).toEqual(km);
  });
  it("rejects bad JSON, wrong shape and bad keycodes", () => {
    expect(() => importKeymap("nope", ...dims)).toThrow(/JSON/);
    expect(() => importKeymap('{"version":2}', ...dims)).toThrow(/keymap file/);
    const km = ansi60.defaultKeymap();
    expect(() => importKeymap(exportKeymap("x", km.slice(1)), ...dims)).toThrow(/layers/);
    km[0]![0]![0] = 70000;
    expect(() => importKeymap(exportKeymap("x", km), ...dims)).toThrow(/Invalid keycode/);
  });
});
