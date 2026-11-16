/**
 * Every page re-renders by replacing its whole subtree, which drops keyboard focus to <body>.
 * Run a render through this: it remembers the focused control's data-fid and focuses the same one afterwards.
 * Call requestFocus(fid) before a render to move focus somewhere on purpose (for example into a confirm box).
 */
let requested: string | null = null;

export function requestFocus(fid: string): void {
  requested = fid;
}

/**
 * While an async action runs the clicked button is disabled, and a disabled control can't hold focus.
 * holdFocus() remembers it so the render after the action puts focus back; releaseFocus() ends that.
 */
let held: string | null = null;

export function holdFocus(root: HTMLElement): void {
  const active = document.activeElement;
  held = active instanceof HTMLElement && root.contains(active) ? (active.dataset.fid ?? null) : null;
}

export function releaseFocus(): void {
  held = null;
}

export function renderKeepingFocus(root: HTMLElement, draw: () => void): void {
  const active = document.activeElement;
  const previous = active instanceof HTMLElement && root.contains(active) ? active.dataset.fid : undefined;
  const caret = active instanceof HTMLInputElement && (active.type === "search" || active.type === "text") ? active.selectionStart : null;
  draw();
  const fid = requested ?? previous ?? held ?? undefined;
  requested = null;
  if (!fid) return;
  const next = root.querySelector<HTMLElement>(`[data-fid="${CSS.escape(fid)}"]`);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (next instanceof HTMLInputElement && caret !== null && (next.type === "search" || next.type === "text") && fid === previous) next.setSelectionRange(caret, caret);
}
