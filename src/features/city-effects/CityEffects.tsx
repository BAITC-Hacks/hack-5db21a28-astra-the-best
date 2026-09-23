'use client';

import { useEffect } from 'react';
import type { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import type { Decision, ScenarioResponse, SimulationResponse } from '@/contracts';
import { deriveEffectMarkers, signed, type EffectMarker } from './model';
import { layoutEffectMarkers, type ScreenPoint, type ScreenRect } from './layout';
import styles from './CityEffects.module.css';

export interface CityEffectsProps {
  map: MapLibreMap | null;
  scenario: ScenarioResponse;
  decisions: readonly Decision[];
  preview?: Decision | null;
  result?: SimulationResponse | null;
  comparison: 'before' | 'after';
}

function detail(marker: EffectMarker): HTMLElement {
  const root = document.createElement('div');
  root.className = styles.detail;
  const heading = document.createElement('h3');
  heading.textContent = `${marker.icon} ${marker.title}`;
  root.append(heading);
  const scope = document.createElement('p');
  scope.textContent = `${marker.districtName} · ${marker.status === 'preview' ? 'Черновик' : marker.status === 'applied' ? 'После расчёта' : 'Запланировано'}`;
  root.append(scope);
  const lag = document.createElement('p');
  lag.textContent = `${marker.lagQuarters === 0 ? 'Действует сразу.' : `Начало действия: через ${marker.lagQuarters * 3} мес.`} За два года учитывается ${(marker.realizedFraction * 100).toLocaleString('ru-RU')}% полного эффекта.`;
  root.append(lag);
  const effectLabel = document.createElement('p');
  effectLabel.className = styles.effectLabel;
  effectLabel.textContent = marker.status === 'applied' ? 'Учтённое изменение за два года' : 'Полный эффект на показатели';
  root.append(effectLabel);
  const effects = document.createElement('ul');
  const values = marker.status === 'applied' ? marker.realizedEffects : marker.fullEffects;
  for (const effect of values) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = effect.name;
    const value = document.createElement('strong');
    value.textContent = `${signed(effect.value)} балла`;
    item.append(name, value);
    if (effect.value < 0) item.className = styles.negative;
    effects.append(item);
  }
  root.append(effects);
  for (const synergy of marker.synergies) {
    const item = document.createElement('p');
    item.className = styles.synergy;
    item.textContent = `Совместный бонус — ${synergy.name}: ${synergy.effects}`;
    root.append(item);
  }
  if (marker.critical.length) {
    const critical = document.createElement('p');
    critical.className = styles.critical;
    critical.textContent = `Критические показатели района: ${marker.critical.join('; ')}.`;
    root.append(critical);
  }
  const disclaimer = document.createElement('small');
  disclaimer.textContent = 'Точка иллюстративная; место строительства не определено.';
  root.append(disclaimer);
  return root;
}

/** Mounts a bounded set of map markers; every update removes the previous scene. */
export function CityEffects({ map, scenario, decisions, preview, result, comparison }: CityEffectsProps) {
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const markers: Marker[] = [];
    const popups: Popup[] = [];
    const scene = deriveEffectMarkers({ scenario, decisions, preview, result, comparison });
    const container = map.getContainer();
    const svgNS = 'http://www.w3.org/2000/svg';
    const leaders = document.createElementNS(svgNS, 'svg');
    leaders.classList.add(styles.leaders);
    leaders.setAttribute('aria-hidden', 'true');
    // Markers also live in canvasContainer: insert leaders first so their lines
    // stay below the opaque badges, without raising badges above map panels.
    map.getCanvasContainer().append(leaders);
    const lines: SVGLineElement[] = [];
    const dots: SVGCircleElement[] = [];
    const buttons: HTMLButtonElement[] = [];
    let positions = new Map<string, ScreenPoint>();
    let frame = 0;
    const panelRoots = [container.parentElement, container.parentElement?.parentElement?.parentElement].filter((el): el is HTMLElement => Boolean(el));
    const layout = () => {
      frame = 0;
      if (cancelled || markers.length !== scene.length) return;
      const bounds = container.getBoundingClientRect();
      // Avoid map controls and sibling panels (legend / selected district).
      // Read their real size so responsive layouts and tutorial panels still fit.
      const panels = [...panelRoots.flatMap(root => [...root.children]), ...container.querySelectorAll('.maplibregl-ctrl')].filter(el => !el.contains(container));
      const obstacles: ScreenRect[] = panels.map(el => {
        observer.observe(el);
        const rect = el.getBoundingClientRect();
        return { left: rect.left - bounds.left, right: rect.right - bounds.left, top: rect.top - bounds.top, bottom: rect.bottom - bounds.top };
      }).filter(r => r.right > r.left && r.bottom > r.top);
      const projected = scene.map(item => ({ ...map.project([...item.coordinates]), key: item.key, preview: item.status === 'preview' }));
      positions = layoutEffectMarkers(projected, container.clientWidth, container.clientHeight, obstacles);
      scene.forEach((item, index) => {
        const origin = projected[index];
        const position = positions.get(item.key)!;
        const dx = position.x - origin.x;
        const dy = position.y - origin.y;
        markers[index].setOffset([dx, dy]);
        // Do not leave a clipped half-badge overlapping an in-view project.
        buttons[index].style.visibility = origin.x >= 0 && origin.x <= container.clientWidth && origin.y >= 0 && origin.y <= container.clientHeight ? '' : 'hidden';
        const moved = Math.hypot(dx, dy) > 8;
        lines[index].style.display = dots[index].style.display = moved ? '' : 'none';
        lines[index].setAttribute('x1', String(origin.x));
        lines[index].setAttribute('y1', String(origin.y));
        lines[index].setAttribute('x2', String(position.x));
        lines[index].setAttribute('y2', String(position.y));
        dots[index].setAttribute('cx', String(origin.x));
        dots[index].setAttribute('cy', String(origin.y));
      });
    };
    const scheduleLayout = () => { if (!frame && !cancelled) frame = requestAnimationFrame(layout); };
    map.on('move', scheduleLayout);
    map.on('resize', scheduleLayout);
    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(container);
    const panelObserver = new MutationObserver(scheduleLayout);
    for (const root of panelRoots) panelObserver.observe(root, { childList: true });
    import('maplibre-gl').then(({ Marker: MapMarker, Popup: MapPopup }) => {
      if (cancelled) return;
      for (const item of scene) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${styles.marker} ${styles[item.directionId as keyof typeof styles] ?? ''} ${styles[item.status]}`;
        button.setAttribute('aria-label', `${item.measureId}: ${item.title}, ${item.districtName}, ${item.status === 'preview' ? 'черновик' : item.status === 'applied' ? 'после расчёта' : 'запланировано'}`);
        button.title = `${item.measureId} · ${item.title}`;
        const icon = document.createElement('span');
        icon.className = styles.icon;
        icon.textContent = item.icon;
        const id = document.createElement('span');
        id.className = styles.id;
        id.textContent = item.measureId;
        button.append(icon, id);
        buttons.push(button);
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          for (const popup of popups) popup.remove();
          const position = positions.get(item.key);
          const popupAnchor = position ? map.unproject([position.x, position.y]) : [...item.coordinates] as [number, number];
          const popup = new MapPopup({ offset: 26, closeOnMove: true, className: styles.popup, maxWidth: 'min(360px, calc(100vw - 32px))' }).setLngLat(popupAnchor).setDOMContent(detail(item)).addTo(map);
          popups.push(popup);
        });
        const line = document.createElementNS(svgNS, 'line');
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('r', '3');
        leaders.append(line, dot);
        lines.push(line);
        dots.push(dot);
        markers.push(new MapMarker({ element: button, anchor: 'center' }).setLngLat([...item.coordinates]).addTo(map));
      }
      layout();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      map.off('move', scheduleLayout);
      map.off('resize', scheduleLayout);
      observer.disconnect();
      panelObserver.disconnect();
      leaders.remove();
      for (const popup of popups) popup.remove();
      for (const marker of markers) marker.remove();
    };
  }, [map, scenario, decisions, preview, result, comparison]);
  return null;
}
