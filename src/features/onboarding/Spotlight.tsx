'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './MayorGuide.module.css';

export interface TourTarget { selector: string; text?: string; measureId?: string }
interface Position { x: number; y: number; width: number; height: number; cardX: number; cardY: number; cardMaxHeight: number; arrow: string; tipX: number; tipY: number }

function findTarget(target: TourTarget) {
  let candidates = [...document.querySelectorAll<HTMLElement>(target.selector)];
  if (target.measureId) candidates = candidates.filter((element) => element.closest('article')?.textContent?.startsWith(`${target.measureId} ·`));
  return candidates.find((element) => (!target.text || element.textContent?.trim() === target.text) && element.getBoundingClientRect().width > 0);
}

export function Spotlight({ target, stepKey, children }: { target: TourTarget; stepKey: string; children: ReactNode }) {
  const card = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const selector = target.selector;
  const text = target.text;
  const measureId = target.measureId;

  useEffect(() => {
    let frame = 0;
    let scrolled: HTMLElement | null = null;
    let observed: HTMLElement | null = null;
    const originalAttributes = new Map<HTMLElement, { tabIndex: string | null; describedBy: string | null }>();
    let cancelled = false;
    const resize = new ResizeObserver(() => schedule());
    function update() {
      if (cancelled) return;
      const element = findTarget({ selector, text, measureId });
      if (!element || !card.current) { setPosition(null); return; }
      if (observed !== element) {
        if (observed) resize.unobserve(observed);
        resize.observe(element);
        observed = element;
      }
      const vw = innerWidth;
      const vh = innerHeight;
      const cardWidth = Math.min(350, vw - 24);
      const cardHeight = Math.min(card.current.scrollHeight, vh < 500 ? vh - 155 : vh - 24);
      if (scrolled !== element) {
        originalAttributes.set(element, { tabIndex: element.getAttribute('tabindex'), describedBy: element.getAttribute('aria-describedby') });
        element.setAttribute('aria-describedby', [element.getAttribute('aria-describedby'), 'mayor-tour-description'].filter(Boolean).join(' '));
        element.scrollIntoView({ block: 'center', behavior: 'instant' });
        if (!element.matches('button, [tabindex], a[href]')) element.setAttribute('tabindex', '-1');
        element.focus({ preventScroll: true });
        // On narrow screens reserve a clear space below the target for the instruction.
        if (vw < 700 && !element.closest('nav')) {
          const navBottom = document.querySelector('nav')?.getBoundingClientRect().bottom ?? 58;
          const offset = element.getBoundingClientRect().top - Math.max(72, navBottom + 12);
          let scrollContainer = element.parentElement;
          while (scrollContainer && !(scrollContainer.scrollHeight > scrollContainer.clientHeight && /auto|scroll/.test(getComputedStyle(scrollContainer).overflowY))) scrollContainer = scrollContainer.parentElement;
          if (element.closest('[aria-label="Редактор городских решений"]') && !element.closest('footer') && scrollContainer) scrollContainer.scrollTop += offset;
          else window.scrollBy({ top: offset, behavior: 'instant' });
        }
        scrolled = element;
      }
      const r = element.getBoundingClientRect();
      const x = Math.max(4, r.left - 5), y = Math.max(4, r.top - 5);
      const width = Math.min(vw - x - 4, r.width + 10), height = Math.min(vh - y - 4, r.height + 10);
      const gap = vh < 500 ? 18 : 35;
      let cardMaxHeight = vh < 500 ? vh - 155 : vh - 24;
      let cardX: number, cardY: number, startX: number, startY: number, endX: number, endY: number;
      if (vw - (x + width) >= cardWidth + gap + 12) {
        cardX = x + width + gap; cardY = Math.max(12, Math.min(vh - cardHeight - 12, y + height / 2 - cardHeight / 2));
        startX = cardX - 5; startY = cardY + Math.min(cardHeight / 2, 70); endX = x + width + 3; endY = y + height / 2;
      } else if (x >= cardWidth + gap + 12) {
        cardX = x - cardWidth - gap; cardY = Math.max(12, Math.min(vh - cardHeight - 12, y + height / 2 - cardHeight / 2));
        startX = cardX + cardWidth + 5; startY = cardY + Math.min(cardHeight / 2, 70); endX = x - 3; endY = y + height / 2;
      } else {
        cardX = Math.max(12, Math.min(vw - cardWidth - 12, x + width / 2 - cardWidth / 2));
        const spaceBelow = vh - (y + height + gap) - 12;
        const spaceAbove = y - gap - 12;
        const below = spaceBelow >= cardHeight || spaceBelow >= spaceAbove;
        cardMaxHeight = Math.max(65, Math.min(cardMaxHeight, below ? spaceBelow : spaceAbove));
        const fittedHeight = Math.min(cardHeight, cardMaxHeight);
        cardY = below ? y + height + gap : Math.max(12, y - fittedHeight - gap);
        startX = cardX + cardWidth / 2; startY = below ? cardY - 5 : cardY + fittedHeight + 5;
        endX = x + width / 2; endY = below ? y + height + 3 : y - 3;
      }
      const arrow = `M ${startX} ${startY} Q ${startX} ${endY} ${endX} ${endY}`;
      const next = { x, y, width, height, cardX, cardY, cardMaxHeight, arrow, tipX: endX, tipY: endY };
      setPosition((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); }
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true });
    if (card.current) resize.observe(card.current);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelled = true; cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
      originalAttributes.forEach((attributes, element) => {
        for (const [name, value] of [['tabindex', attributes.tabIndex], ['aria-describedby', attributes.describedBy]]) {
          if (value === null) element.removeAttribute(name!); else element.setAttribute(name!, value!);
        }
      });
    };
  }, [selector, text, measureId, stepKey]);

  return <>
    <div className={styles.tourSpace} aria-hidden="true" />
    {position && <div className={styles.spotlight} aria-hidden="true">
      <div className={styles.targetRing} data-tour-spotlight style={{ left: position.x, top: position.y, width: position.width, height: position.height }} />
      <svg className={styles.arrow} width="100%" height="100%"><defs><marker id="mayor-arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L6,3 z" fill="#a6efbb" /></marker></defs><path d={position.arrow} fill="none" stroke="#a6efbb" strokeWidth="3" strokeLinecap="round" markerEnd="url(#mayor-arrow-head)" /><circle cx={position.tipX} cy={position.tipY} r="4" fill="#a6efbb" /></svg>
    </div>}
    <aside ref={card} data-tour-card className={styles.tourCard} aria-label="Помощник градоначальника" style={position ? { left: position.cardX, top: position.cardY, maxHeight: position.cardMaxHeight } : { right: 12, bottom: 12 }}>
      {children}
      {!position && <p className={styles.locating}>Ищем элемент на экране… Можно открыть нужный раздел через верхнее меню.</p>}
    </aside>
  </>;
}
