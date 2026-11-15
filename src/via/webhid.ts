import { PACKET_SIZE, type Transport } from "./protocol";

/** VIA firmware exposes a vendor raw-HID interface on this usage page/usage. */
export const VIA_USAGE_PAGE = 0xff60;
export const VIA_USAGE = 0x61;

/** Minimal slice of the WebHID API we use (lib.dom does not ship these types). */
export interface HidInputReportEvent {
  data: DataView;
}
export interface HidDeviceLike {
  productName: string;
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: "inputreport", listener: (e: HidInputReportEvent) => void): void;
  removeEventListener(type: "inputreport", listener: (e: HidInputReportEvent) => void): void;
}
interface HidApi {
  requestDevice(options: { filters: { usagePage: number; usage: number }[] }): Promise<HidDeviceLike[]>;
}

export function webHidSupported(): boolean {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

export class WebHidTransport implements Transport {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly device: HidDeviceLike,
    private readonly timeoutMs = 1000,
  ) {}

  get name(): string {
    return this.device.productName || "HID keyboard";
  }

  /** Opens the device if needed. Must run inside a user gesture the first time. */
  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  /** VIA is strictly request/response, so requests are serialized to avoid mixing up replies. */
  send(packet: Uint8Array): Promise<Uint8Array> {
    const run = this.queue.then(() => this.exchange(packet));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private exchange(packet: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => {
        clearTimeout(timer);
        this.device.removeEventListener("inputreport", onReport);
        fn();
      };
      const onReport = (e: HidInputReportEvent) => {
        const res = new Uint8Array(PACKET_SIZE);
        res.set(new Uint8Array(e.data.buffer, e.data.byteOffset, Math.min(e.data.byteLength, PACKET_SIZE)));
        done(() => resolve(res));
      };
      const timer = setTimeout(
        () => done(() => reject(new Error(`device did not answer within ${this.timeoutMs} ms`))),
        this.timeoutMs,
      );
      // Listen before sending: a fast device can answer before sendReport resolves.
      this.device.addEventListener("inputreport", onReport);
      this.device.sendReport(0, new Uint8Array(packet)).catch((err: unknown) => done(() => reject(err instanceof Error ? err : new Error(String(err)))));
    });
  }
}

/** Shows the browser's device chooser filtered to VIA-capable interfaces. */
export async function requestViaDevice(): Promise<WebHidTransport> {
  if (!webHidSupported()) throw new Error("WebHID is not available. Use Chrome or Edge over HTTPS or localhost.");
  const hid = (navigator as unknown as { hid: HidApi }).hid;
  const [device] = await hid.requestDevice({ filters: [{ usagePage: VIA_USAGE_PAGE, usage: VIA_USAGE }] });
  if (!device) throw new Error("No device selected, or the keyboard has no VIA interface (firmware needs VIA_ENABLE).");
  const transport = new WebHidTransport(device);
  await transport.open();
  return transport;
}
