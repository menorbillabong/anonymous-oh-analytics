// One observer for the whole grid. Once loaded, keep media mounted so scrolling
// never interrupts playback or discards a decoded identification frame.
const pending = new Map<Element, () => void>();
let observer: IntersectionObserver | undefined;

export function whenNearViewport(element: Element, ready: () => void) {
  if (typeof IntersectionObserver === 'undefined') { ready(); return () => {}; }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = pending.get(entry.target);
      pending.delete(entry.target);
      observer?.unobserve(entry.target);
      callback?.();
    }
    if (!pending.size) { observer?.disconnect(); observer = undefined; }
  }, {rootMargin: '600px 0px'});
  pending.set(element, ready);
  observer.observe(element);
  return () => {
    pending.delete(element);
    observer?.unobserve(element);
    if (!pending.size) { observer?.disconnect(); observer = undefined; }
  };
}
