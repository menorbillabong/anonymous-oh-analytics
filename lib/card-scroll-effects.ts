// A DOM-only flag avoids re-rendering every post on each scroll event.
// Never disable pointer events: buttons and native video controls remain usable.
export function suspendCardEffectsWhileScrolling(grid: HTMLElement) {
 const doc = grid.ownerDocument;
 const win = doc.defaultView;
 if (!win) return () => {};
 let timer: number | undefined;
 let active = false;
 const restore = () => {
  timer = undefined;
  active = false;
  grid.removeAttribute('data-scroll-active');
 };
 const scrolling = () => {
  if (!active) {
   active = true;
   grid.setAttribute('data-scroll-active', 'true');
  }
  win.clearTimeout(timer);
  timer = win.setTimeout(restore, 180);
 };
 const wheel = (event: WheelEvent) => {
  if (!event.ctrlKey && (event.deltaX || event.deltaY)) scrolling();
 };
 // Wheel disables hover before content moves; scroll covers keyboard, touch,
 // scrollbar dragging and nested scrolling containers as well.
 grid.addEventListener('wheel', wheel, {passive: true, capture: true});
 doc.addEventListener('scroll', scrolling, {passive: true, capture: true});
 return () => {
  grid.removeEventListener('wheel', wheel, true);
  doc.removeEventListener('scroll', scrolling, true);
  win.clearTimeout(timer);
  restore();
 };
}
