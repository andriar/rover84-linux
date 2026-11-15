import { describe, expect, it } from "vitest";
import { ansi60 } from "../src/layout";
import { code } from "../src/keycodes";
import { MockTransport } from "../src/via/mock";
import { ViaClient } from "../src/via/protocol";
import { WebHidTransport, type HidDeviceLike, type HidInputReportEvent } from "../src/via/webhid";

type Listener = (e: HidInputReportEvent) => void;

/** Fake HID device: answers each output report with the MockTransport's reply, like real firmware. */
class FakeHid implements HidDeviceLike {
  productName = "Fake Board";
  opened = false;
  listeners = new Set<Listener>();
  sent: Uint8Array[] = [];
  constructor(private readonly behavior: "reply" | "silent" | "fail" = "reply", private readonly backend = new MockTransport(ansi60.defaultKeymap)) {}

  async open() { this.opened = true; }
  async close() { this.opened = false; }
  addEventListener(_t: "inputreport", l: Listener) { this.listeners.add(l); }
  removeEventListener(_t: "inputreport", l: Listener) { this.listeners.delete(l); }

  async sendReport(_id: number, data: BufferSource) {
    const bytes = new Uint8Array(data as ArrayBuffer);
    this.sent.push(bytes);
    if (this.behavior === "fail") throw new Error("write failed");
    if (this.behavior === "silent") return;
    const reply = await this.backend.send(bytes);
    // Deliver asynchronously, as real devices do, and as a view with a non-zero offset.
    queueMicrotask(() => {
      const padded = new Uint8Array(reply.length + 4);
      padded.set(reply, 4);
      for (const l of [...this.listeners]) l({ data: new DataView(padded.buffer, 4, reply.length) });
    });
  }
}

describe("WebHidTransport", () => {
  it("drives ViaClient through a HID device", async () => {
    const hid = new FakeHid();
    const client = new ViaClient(new WebHidTransport(hid));
    expect(await client.getProtocolVersion()).toBe(9);
    await client.setKeycode(0, 2, 1, code("KC_ESC"));
    expect(await client.getKeycode(0, 2, 1)).toBe(code("KC_ESC"));
    expect(hid.sent.every((p) => p.length === 32)).toBe(true);
    expect(hid.listeners.size).toBe(0);
  });

  it("keeps concurrent requests paired with their own replies", async () => {
    const client = new ViaClient(new WebHidTransport(new FakeHid()));
    const [a, b, c] = await Promise.all([client.getKeycode(0, 0, 0), client.getKeycode(0, 2, 1), client.getKeycode(1, 1, 8)]);
    expect([a, b, c]).toEqual([code("KC_GRV"), code("KC_A"), code("KC_UP")]);
  });

  it("times out when the device stays silent, then recovers", async () => {
    const hid = new FakeHid("silent");
    const transport = new WebHidTransport(hid, 20);
    await expect(transport.send(new Uint8Array(32))).rejects.toThrow(/did not answer/);
    expect(hid.listeners.size).toBe(0);
    await expect(transport.send(new Uint8Array(32))).rejects.toThrow(/did not answer/);
  });

  it("propagates write failures and cleans up listeners", async () => {
    const hid = new FakeHid("fail");
    await expect(new WebHidTransport(hid).send(new Uint8Array(32))).rejects.toThrow("write failed");
    expect(hid.listeners.size).toBe(0);
  });

  it("opens and closes the device", async () => {
    const hid = new FakeHid();
    const t = new WebHidTransport(hid);
    await t.open();
    expect(hid.opened).toBe(true);
    await t.close();
    expect(hid.opened).toBe(false);
    expect(t.name).toBe("Fake Board");
  });
});
