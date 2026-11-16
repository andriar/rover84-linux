import { attrs, el } from "./dom";

export type PageId = "remap" | "rgb" | "via";
export type Tone = "good" | "warn" | "bad" | "neutral";

export interface BannerSpec {
  tone: "bad" | "warn";
  title: string;
  body: string;
  detailsLabel?: string;
  details?: string;
  retry?: () => void;
}

export interface ShellParts {
  page: PageId;
  title: string;
  chip: { text: string; tone: Tone };
  banner?: BannerSpec | null;
  main: (Node | string)[];
  bar?: HTMLElement | null;
}

const NAV: { id: PageId; href: string; label: string; secondary?: boolean }[] = [
  { id: "remap", href: "/", label: "Key remap" },
  { id: "rgb", href: "/rgb.html", label: "Lighting" },
  { id: "via", href: "/via.html", label: "VIA editor", secondary: true },
];

/** Live regions live outside #app so screen readers keep announcing after the page subtree is replaced. */
function liveRegions(): { status: HTMLElement; alert: HTMLElement } {
  let status = document.getElementById("live-status");
  let alert = document.getElementById("live-alert");
  if (!status) {
    status = attrs(el("div", { id: "live-status", class: "sr-only" }), { role: "status" });
    document.body.append(status);
  }
  if (!alert) {
    alert = attrs(el("div", { id: "live-alert", class: "sr-only" }), { role: "alert" });
    document.body.append(alert);
  }
  return { status, alert };
}

export function announce(text: string, error = false): void {
  const { status, alert } = liveRegions();
  const target = error ? alert : status;
  target.textContent = "";
  window.setTimeout(() => (target.textContent = text), 20);
}

export function badge(text: string, tone: Tone | "untested"): HTMLElement {
  return el("span", { class: `badge ${tone === "neutral" ? "" : tone}`.trim(), textContent: text });
}

/**
 * The banner is rebuilt on every render, so it carries no live-region role of its own (a fresh node with a role is
 * announced again each time). It is announced once, through the persistent regions, when its text changes.
 */
let lastBannerKey = "";

function announceBannerOnce(spec: BannerSpec | null | undefined): void {
  const key = spec ? `${spec.tone}|${spec.title}|${spec.body}` : "";
  if (key === lastBannerKey) return;
  lastBannerKey = key;
  if (spec) announce(`${spec.title}. ${spec.body}`, spec.tone === "bad");
}

export function banner(spec: BannerSpec): HTMLElement {
  const node = el("div", { class: `banner ${spec.tone}` }, el("h2", { textContent: spec.title }), el("p", { textContent: spec.body }));
  if (spec.retry) {
    const retry = attrs(el("button", { textContent: "Try again" }), { "data-fid": "banner-retry" });
    retry.onclick = spec.retry;
    node.append(el("div", { class: "actions" }, retry));
  }
  if (spec.details) node.append(el("details", {}, el("summary", { textContent: spec.detailsLabel ?? "Technical details" }), el("pre", { textContent: spec.details })));
  return node;
}

export function shell(parts: ShellParts): HTMLElement {
  document.title = `${parts.title} · keyboard-config`;
  liveRegions();

  const nav = attrs(el("nav"), { "aria-label": "Tools" });
  for (const item of NAV) {
    if (item.secondary) nav.append(attrs(el("span", { class: "nav-sep" }), { "aria-hidden": "true" }));
    const a = el("a", { href: item.href, textContent: item.label, class: item.secondary ? "secondary" : "" });
    if (item.id === parts.page) a.setAttribute("aria-current", "page");
    nav.append(a);
  }

  const header = el(
    "header",
    { class: "app-header" },
    el("span", { class: "brand", textContent: "keyboard-config" }),
    nav,
    el("span", { class: `badge chip ${parts.chip.tone === "neutral" ? "" : parts.chip.tone}`.trim(), textContent: parts.chip.text }),
  );

  announceBannerOnce(parts.banner);
  const slot = el("div", { class: "banner-slot" });
  if (parts.banner) slot.append(banner(parts.banner));

  const main = attrs(el("main", { id: "main", class: "shell" }, el("h1", { textContent: parts.title }), ...parts.main), {});
  const root = el("div", {}, el("a", { class: "skip", href: "#main", textContent: "Skip to content" }), header, slot, main);
  if (parts.bar) root.append(parts.bar);
  return root;
}

export interface ApplyBarSpec {
  summary: string;
  result: { text: string; tone: "good" | "bad" | "info" };
  secondary?: HTMLElement;
  primary: HTMLElement;
}

export function applyBar(spec: ApplyBarSpec): HTMLElement {
  const result = el("p", { class: `result ${spec.result.tone === "info" ? "" : spec.result.tone}`.trim(), textContent: spec.result.text });
  if (!spec.result.text) result.hidden = true;
  const buttons = el("div", { class: "buttons" });
  if (spec.secondary) buttons.append(spec.secondary);
  buttons.append(spec.primary);
  return el("div", { class: "apply-bar" }, el("div", { class: "text" }, el("p", { class: "summary", textContent: spec.summary }), result), buttons);
}

/** Switch with a real label and helper; `id` must be unique on the page. */
export function switchRow(opts: { id: string; label: string; helper: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }): HTMLElement {
  const helperId = `${opts.id}-help`;
  const btn = attrs(el("button", { type: "button", id: opts.id, class: "switch", disabled: !!opts.disabled }, el("span", { class: "track" }, el("span", { class: "thumb" }))), {
    role: "switch",
    "aria-checked": opts.checked,
    "aria-describedby": helperId,
    "data-fid": opts.id,
  });
  btn.onclick = () => opts.onChange(!opts.checked);
  return el(
    "div",
    { class: "switch-row" },
    el("label", { htmlFor: opts.id, class: "label", textContent: opts.label }),
    btn,
    el("p", { id: helperId, class: "helper", textContent: opts.helper }),
  );
}

/** Replaces a danger button with "question [Yes] [Cancel]". Focus goes to Cancel (the safe default); Esc cancels. */
export function confirmInline(opts: { question: string; yes: string; busy?: boolean; onYes: () => void; onCancel: () => void }): HTMLElement {
  const yes = attrs(el("button", { class: "danger-confirm", textContent: opts.yes, disabled: !!opts.busy }), { "data-fid": "confirm-yes" });
  yes.onclick = opts.onYes;
  const cancel = attrs(el("button", { textContent: "Cancel" }), { "data-fid": "confirm-cancel" });
  cancel.onclick = opts.onCancel;
  const qid = `q-${Math.random().toString(36).slice(2, 8)}`;
  const box = attrs(el("div", { class: "confirm" }, el("p", { id: qid, textContent: opts.question }), yes, cancel), { role: "group", "aria-labelledby": qid });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      opts.onCancel();
    }
  });
  return box;
}
