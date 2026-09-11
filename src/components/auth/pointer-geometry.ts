// Schedule in Motion's read phase, before its springs and DOM rendering, rather
// than adding a second requestAnimationFrame after Motion has already rendered.
export function createPointerFrame<T>(consume: (value: T) => void, schedule: (callback: () => void) => void, unschedule: (callback: () => void) => void) {
  let latest: T;
  let pending = false;
  const flush = () => {
    if (!pending) return;
    pending = false;
    unschedule(flush);
    consume(latest);
  };
  return {
    push(value: T) {
      latest = value;
      if (pending) return;
      pending = true;
      schedule(flush);
    },
    flush,
    cancel() {
      pending = false;
      unschedule(flush);
    },
  };
}

export function setPointerPercentage(style: CSSStyleDeclaration, name: string, value: number) {
  const next = `${(value * 100).toFixed(1)}%`;
  if (style.getPropertyValue(name) !== next) style.setProperty(name, next);
}
