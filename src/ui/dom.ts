export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const { class: cls, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  if (cls) node.className = cls;
  node.append(...children);
  return node;
}

/** Sets aria-*, role, data-* and other attributes that are not DOM properties. Undefined values are skipped. */
export function attrs<T extends Element>(node: T, values: Record<string, string | number | boolean | undefined>): T {
  for (const [k, v] of Object.entries(values)) if (v !== undefined) node.setAttribute(k, String(v));
  return node;
}
