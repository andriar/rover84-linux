/**
 * VIA raw-HID protocol (the subset needed to edit a keymap).
 * Packets are 32 bytes. Request byte 0 is the command id; the device echoes it
 * back in the response. 0xFF in byte 0 means the device did not handle it.
 */
export const PACKET_SIZE = 32;

export const Cmd = {
  GET_PROTOCOL_VERSION: 0x01,
  DYNAMIC_KEYMAP_GET_KEYCODE: 0x04,
  DYNAMIC_KEYMAP_SET_KEYCODE: 0x05,
  DYNAMIC_KEYMAP_RESET: 0x06,
  DYNAMIC_KEYMAP_GET_LAYER_COUNT: 0x11,
  UNHANDLED: 0xff,
} as const;

/** Anything that can exchange one 32-byte packet with a device. */
export interface Transport {
  send(packet: Uint8Array): Promise<Uint8Array>;
}

/** keymap[layer][row][col] -> 16-bit QMK keycode */
export type Keymap = number[][][];

export class ViaError extends Error {}

function packet(...bytes: number[]): Uint8Array {
  const p = new Uint8Array(PACKET_SIZE);
  p.set(bytes);
  return p;
}

export class ViaClient {
  constructor(private readonly transport: Transport) {}

  private async request(cmd: number, ...args: number[]): Promise<Uint8Array> {
    const res = await this.transport.send(packet(cmd, ...args));
    if (res[0] === Cmd.UNHANDLED) {
      throw new ViaError(`device did not handle command 0x${cmd.toString(16)}`);
    }
    if (res[0] !== cmd) {
      throw new ViaError(`unexpected response id 0x${(res[0] ?? 0).toString(16)} for 0x${cmd.toString(16)}`);
    }
    return res;
  }

  async getProtocolVersion(): Promise<number> {
    const r = await this.request(Cmd.GET_PROTOCOL_VERSION);
    return ((r[1] ?? 0) << 8) | (r[2] ?? 0);
  }

  async getLayerCount(): Promise<number> {
    const r = await this.request(Cmd.DYNAMIC_KEYMAP_GET_LAYER_COUNT);
    return r[1] ?? 0;
  }

  async getKeycode(layer: number, row: number, col: number): Promise<number> {
    const r = await this.request(Cmd.DYNAMIC_KEYMAP_GET_KEYCODE, layer, row, col);
    return ((r[4] ?? 0) << 8) | (r[5] ?? 0);
  }

  async setKeycode(layer: number, row: number, col: number, keycode: number): Promise<void> {
    if (!Number.isInteger(keycode) || keycode < 0 || keycode > 0xffff) {
      throw new ViaError(`keycode out of range: ${keycode}`);
    }
    await this.request(Cmd.DYNAMIC_KEYMAP_SET_KEYCODE, layer, row, col, keycode >> 8, keycode & 0xff);
  }

  async resetKeymap(): Promise<void> {
    await this.request(Cmd.DYNAMIC_KEYMAP_RESET);
  }

  async readKeymap(rows: number, cols: number): Promise<Keymap> {
    const layers = await this.getLayerCount();
    const keymap: Keymap = [];
    for (let l = 0; l < layers; l++) {
      const layer: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const row: number[] = [];
        for (let c = 0; c < cols; c++) row.push(await this.getKeycode(l, r, c));
        layer.push(row);
      }
      keymap.push(layer);
    }
    return keymap;
  }

  /** Writes only cells that differ from `current`, to keep EEPROM wear and traffic low. */
  async writeKeymap(next: Keymap, current?: Keymap): Promise<number> {
    let written = 0;
    for (const [l, layer] of next.entries()) {
      for (const [r, row] of layer.entries()) {
        for (const [c, code] of row.entries()) {
          if (current?.[l]?.[r]?.[c] === code) continue;
          await this.setKeycode(l, r, c, code);
          written++;
        }
      }
    }
    return written;
  }
}
