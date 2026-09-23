'use client';

import { useEffect } from 'react';
import type { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import type { Decision, ScenarioResponse, SimulationResponse } from '@/contracts';
import { scoreColor } from '@/features/city-map/score-colors';
import { deriveEffectMarkers, signed, type EffectMarker } from './model';
import { createImpactHighlight } from './impact';
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
  const area = document.createElement('p');
  area.className = styles.scope;
  area.textContent = `Область действия: ${marker.scope === 'city' ? 'все пять игровых районов' : marker.districtName}. Выделена фиолетовым на карте.`;
  root.append(area);
  const location = document.createElement('p');
  location.className = styles.location;
  if (marker.landmark) {
    const link = document.createElement('a');
    link.href = `https://www.openstreetmap.org/${marker.landmark.osmType}/${marker.landmark.osmId}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = marker.landmark.name;
    location.append('Геоориентир: ', link, '. Координаты объекта из OpenStreetMap.');
  } else {
    location.textContent = 'Условная точка внутри района. Точный объект для этой меры не привязан.';
  }
  root.append(location);
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
    critical.append('Критические показатели района: ');
    marker.critical.forEach((entry, index) => {
      if (index > 0) critical.append('; ');
      critical.append(`${entry.name}: `);
      const value = document.createElement('strong');
      value.textContent = entry.value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      value.style.color = scoreColor(entry.value, 'text');
      critical.append(value, ' балла');
    });
    critical.append('.');
    root.append(critical);
  }
  const disclaimer = document.createElement('small');
  disclaimer.textContent = 'Метка показывает проект симулятора. Геоориентир не означает утверждённый участок строительства; эффект считается по области действия.';
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
    const buttons = new Map<string, HTMLButtonElement>();
    const highlight = createImpactHighlight(map);
    let hovered: EffectMarker | null = null;
    let selected: EffectMarker | null = null;
    const syncHighlight = () => {
      if (cancelled) return;
      const active = hovered ?? selected ?? scene.find(item => item.status === 'preview') ?? null;
      const targets = active ? scene.filter(item => item.measureId === active.measureId && item.status === active.status) : [];
      highlight.show(targets);
      for (const item of scene) {
        const isActive = targets.some(target => target.key === item.key);
        buttons.get(item.key)?.classList.toggle(styles.selected, isActive);
        buttons.get(item.key)?.setAttribute('aria-pressed', String(selected?.key === item.key));
      }
    };
    const dismiss = () => { selected = null; hovered = null; for (const popup of popups) popup.remove(); syncHighlight(); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    map.getContainer().addEventListener('keydown', keydown);
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
        buttons.set(item.key, button);
        button.dataset.measure = item.measureId;
        button.dataset.district = item.districtId;
        button.dataset.longitude = String(item.coordinates[0]);
        button.dataset.latitude = String(item.coordinates[1]);
        button.addEventListener('mouseenter', () => { hovered = item; syncHighlight(); });
        button.addEventListener('mouseleave', () => { hovered = null; syncHighlight(); });
        button.addEventListener('focus', () => { hovered = item; syncHighlight(); });
        button.addEventListener('blur', () => { hovered = null; syncHighlight(); });
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          for (const popup of popups) popup.remove();
          selected = item;
          const content = detail(item);
          // Leave room for a popup above or below a central pin. Mobile uses
          // its own bottom sheet; desktop content scrolls inside the map.
          content.style.setProperty('--popup-max-height', `${Math.max(100, map.getContainer().clientHeight / 2 - 100)}px`);
          const popup = new MapPopup({ offset: 48, closeOnMove: false, className: styles.popup, maxWidth: 'min(360px, calc(100vw - 32px))' }).setLngLat([...item.coordinates]).setDOMContent(content).addTo(map);
          popup.on('close', () => { if (selected?.key === item.key) { selected = null; hovered = null; syncHighlight(); } });
          popups.push(popup);
          syncHighlight();
        });
        // The bottom of the pin always follows its geographic coordinate. No
        // screen-space offsets, repacking or camera-dependent site selection.
        markers.push(new MapMarker({ element: button, anchor: 'bottom' }).setLngLat([...item.coordinates]).addTo(map));
      }
      syncHighlight();
    });
    return () => {
      cancelled = true;
      map.getContainer().removeEventListener('keydown', keydown);
      for (const popup of popups) popup.remove();
      for (const marker of markers) marker.remove();
      highlight.remove();
    };
  }, [map, scenario, decisions, preview, result, comparison]);
  return null;
}
