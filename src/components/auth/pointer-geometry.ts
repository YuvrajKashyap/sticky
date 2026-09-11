// Scope geometry to one native event: never reuse a transformed or scrolled
// rectangle on the next event, and never retain DOM nodes after the event dies.
const snapshots = new WeakMap<Event, Map<Element, DOMRect>>();

export function capturePointerGeometry(event: Event, elements: (Element | null)[]) {
  const bounds = new Map<Element, DOMRect>();
  for (const element of elements) {
    if (element && !bounds.has(element)) bounds.set(element, element.getBoundingClientRect());
  }
  snapshots.set(event, bounds);
}

export function pointerBounds(event: Event, element: Element): DOMRect {
  return snapshots.get(event)?.get(element) ?? element.getBoundingClientRect();
}

export function setPointerPercentage(style: CSSStyleDeclaration, name: string, value: number) {
  const next = `${(value * 100).toFixed(1)}%`;
  if (style.getPropertyValue(name) !== next) style.setProperty(name, next);
}
