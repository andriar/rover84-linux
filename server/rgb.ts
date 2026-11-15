import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  CMD,
  RECORD_LEN,
  RECORD_OFFSET,
  RgbError,
  buildPacket,
  decodeRecord,
  encodeRecord,
  fromHex,
  looksLikeLightRecord,
  parseSettings,
  recordFromReply,
  toHex,
  type LightSettings,
} from "../src/rgb/protocol.ts";
import type { HidTransport } from "./hidraw.ts";

export interface RgbDeps {
  /** Opens the keyboard's vendor interface, or returns null when it is not plugged in or not accessible. */
  open: () => Promise<HidTransport | null>;
  /** Where the untouched original record is saved before the first write. */
  backupPath: string;
}

export interface RgbState {
  present: boolean;
  settings?: LightSettings;
  raw?: string;
  hasBackup?: boolean;
  /** True when the record on the keyboard is not one we are willing to overwrite. */
  unrecognized?: boolean;
}

export function createRgbService(deps: RgbDeps) {
  // One HID conversation at a time: interleaved Begin/End packets would confuse the firmware.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  async function session<T>(work: (t: HidTransport) => Promise<T>): Promise<T | null> {
    let t: HidTransport | null;
    try {
      t = await deps.open();
    } catch (e) {
      throw new RgbError(503, `cannot open the keyboard: ${(e as Error).message}`);
    }
    if (!t) return null;
    try {
      await t.transfer(buildPacket(CMD.begin));
      try {
        return await work(t);
      } finally {
        await t.transfer(buildPacket(CMD.end)).catch(() => undefined);
      }
    } catch (e) {
      if (e instanceof RgbError) throw e;
      throw new RgbError(502, `keyboard error: ${(e as Error).message}`);
    } finally {
      t.close();
    }
  }

  const readRecord = async (t: HidTransport) => recordFromReply(await t.transfer(buildPacket(CMD.read, RECORD_LEN, RECORD_OFFSET)));

  async function writeVerified(t: HidTransport, rec: Uint8Array): Promise<void> {
    const reply = await t.transfer(buildPacket(CMD.write, RECORD_LEN, RECORD_OFFSET, rec));
    if (reply[7] === 0xff) throw new RgbError(502, "the keyboard rejected the write");
    const back = await readRecord(t);
    if (toHex(back) !== toHex(rec)) throw new RgbError(502, `write did not stick. Wanted ${toHex(rec)} but the keyboard holds ${toHex(back)}`);
  }

  async function readBackup(): Promise<Uint8Array | null> {
    try {
      const j = JSON.parse(await readFile(deps.backupPath, "utf8")) as { record?: string };
      const rec = fromHex(j.record ?? "");
      return rec.length === RECORD_LEN ? rec : null;
    } catch {
      return null;
    }
  }

  async function saveBackupOnce(rec: Uint8Array): Promise<void> {
    await mkdir(dirname(deps.backupPath), { recursive: true });
    const body = JSON.stringify({ savedAt: new Date().toISOString(), offset: RECORD_OFFSET, record: toHex(rec) }, null, 2) + "\n";
    try {
      await writeFile(deps.backupPath, body, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }

  function describe(rec: Uint8Array, hasBackup: boolean): RgbState {
    return { present: true, settings: decodeRecord(rec), raw: toHex(rec), hasBackup, unrecognized: !looksLikeLightRecord(rec) };
  }

  return {
    read: () =>
      serial(async (): Promise<RgbState> => {
        const rec = await session(readRecord);
        return rec ? describe(rec, (await readBackup()) !== null) : { present: false };
      }),

    write: (input: unknown) =>
      serial(async (): Promise<RgbState> => {
        const settings = parseSettings(input);
        const rec = await session(async (t) => {
          const current = await readRecord(t);
          if (!looksLikeLightRecord(current)) throw new RgbError(409, `refusing to overwrite an unrecognized record (${toHex(current)})`);
          await saveBackupOnce(current);
          const next = encodeRecord(current, settings);
          await writeVerified(t, next);
          return next;
        });
        if (!rec) throw new RgbError(404, "keyboard not found");
        return describe(rec, true);
      }),

    restore: () =>
      serial(async (): Promise<RgbState> => {
        const original = await readBackup();
        if (!original) throw new RgbError(404, "no backup saved yet");
        const rec = await session(async (t) => {
          await writeVerified(t, original);
          return original;
        });
        if (!rec) throw new RgbError(404, "keyboard not found");
        return describe(rec, true);
      }),
  };
}

export type RgbService = ReturnType<typeof createRgbService>;
