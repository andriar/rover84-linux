import { Cmd, PACKET_SIZE, type Keymap, type Transport } from "./protocol";

const PROTOCOL_VERSION = 0x0009;

/**
 * In-memory device that speaks the same raw 32-byte packets as a real VIA
 * keyboard, so ViaClient is exercised end to end without hardware.
 */
export class MockTransport implements Transport {
  private keymap: Keymap;

  constructor(
    private readonly factory: () => Keymap,
    private readonly latencyMs = 0,
  ) {
    this.keymap = factory();
  }

  async send(packet: Uint8Array): Promise<Uint8Array> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    const res = new Uint8Array(PACKET_SIZE);
    res.set(packet);
    const [cmd = 0, layer = 0, row = 0, col = 0, hi = 0, lo = 0] = packet;

    switch (cmd) {
      case Cmd.GET_PROTOCOL_VERSION:
        res[1] = PROTOCOL_VERSION >> 8;
        res[2] = PROTOCOL_VERSION & 0xff;
        return res;
      case Cmd.DYNAMIC_KEYMAP_GET_LAYER_COUNT:
        res[1] = this.keymap.length;
        return res;
      case Cmd.DYNAMIC_KEYMAP_GET_KEYCODE: {
        const code = this.keymap[layer]?.[row]?.[col];
        if (code === undefined) return this.unhandled(res);
        res[4] = code >> 8;
        res[5] = code & 0xff;
        return res;
      }
      case Cmd.DYNAMIC_KEYMAP_SET_KEYCODE: {
        const cells = this.keymap[layer]?.[row];
        if (!cells || cells[col] === undefined) return this.unhandled(res);
        cells[col] = (hi << 8) | lo;
        return res;
      }
      case Cmd.DYNAMIC_KEYMAP_RESET:
        this.keymap = this.factory();
        return res;
      default:
        return this.unhandled(res);
    }
  }

  private unhandled(res: Uint8Array): Uint8Array {
    res[0] = Cmd.UNHANDLED;
    return res;
  }
}
