'use client';

import {useEffect} from 'react';

// Only surfaces/controls, never media, text nodes or the full page.
const surfaces = [
  'button', 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color])',
  'select', 'textarea', '.ref-card', '.ref-list-row', '.mission-existing-card',
  '.mission-review-card', '.exact-stat', '.metric-card', '.panel', '.post-card',
  '.history-row', '.review-card', '.bulk-review-card', '.mission-create-panel',
  '.mission-create-card', '.mission-existing', '.mission-profile-grid > article',
  '.settings-page article', '.reward-card', '.settings-lower article', '.activity-list article',
  '.admin-user-disclosure', '.admin-post-card', '.mission-period-definition',
  '.mission-sheets-month', '.action-group', '.exact-hero', '.formula-strip', '.mission-table',
  '.tracker-stat', '.tracker-panel', '.tracker-report', '.preview-box', '.disabled-bonuses',
  '.close-period', '.reference-list-item', '.tracker-section', '.tracker-stat-row > div',
].join(',');

function visible(color: string) {
  return color !== 'transparent' && !/^rgba\(.*,[\s]*0(?:\.0+)?\s*\)$|\/\s*0(?:\.0+)?\s*\)$/.test(color);
}

function ownColor(style: CSSStyleDeclaration) {
  // The wider accent edge (e.g. a mission card's left border) takes priority.
  const borders = ['left', 'top', 'right', 'bottom'].map(side => ({
    color: style.getPropertyValue(`border-${side}-color`),
    width: parseFloat(style.getPropertyValue(`border-${side}-width`)),
    type: style.getPropertyValue(`border-${side}-style`),
  })).filter(border => border.width > 0 && border.type !== 'none' && visible(border.color));
  borders.sort((a, b) => b.width - a.width);
  return borders[0]?.color || (visible(style.backgroundColor) ? style.backgroundColor : style.color);
}

export function useOwnColorGlow() {
  useEffect(() => {
    const hover = window.matchMedia('(hover: hover) and (pointer: fine)');
    const prepare = (event: PointerEvent | FocusEvent) => {
      if (event instanceof PointerEvent && (!hover.matches || event.pointerType === 'touch')) return;
      const previous = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      const samples: {element: HTMLElement; color: string}[] = [];
      let element = event.target instanceof Element ? event.target.closest<HTMLElement>(surfaces) : null;
      while (element) {
        // Moving between children of the same card does not read its styles again.
        if (!previous || !element.contains(previous)) {
          if (!element.matches(':disabled, [aria-disabled="true"]')) {
            samples.push({element, color: ownColor(getComputedStyle(element))});
          }
        }
        element = element.parentElement?.closest<HTMLElement>(surfaces) || null;
      }
      // Batch reads before writes. No React updates, observers, timers or move/scroll listeners.
      for (const {element, color} of samples) {
        if (element.style.getPropertyValue('--own-color-glow') !== color) {
          element.style.setProperty('--own-color-glow', color);
        }
        if (!element.hasAttribute('data-own-color-glow')) element.setAttribute('data-own-color-glow', '');
      }
    };
    document.addEventListener('pointerover', prepare, {passive: true});
    document.addEventListener('focusin', prepare);
    return () => {
      document.removeEventListener('pointerover', prepare);
      document.removeEventListener('focusin', prepare);
      document.querySelectorAll<HTMLElement>('[data-own-color-glow]').forEach(element => {
        element.removeAttribute('data-own-color-glow');
        element.style.removeProperty('--own-color-glow');
      });
    };
  }, []);
}
