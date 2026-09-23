'use client';

import { useEffect } from 'react';
import type { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import type { Decision, ScenarioResponse, SimulationResponse } from '@/contracts';
import { deriveEffectMarkers, signed, type EffectMarker } from './model';
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
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          for (const popup of popups) popup.remove();
          const popup = new MapPopup({ offset: 20, closeOnMove: true, className: styles.popup, maxWidth: 'min(360px, calc(100vw - 32px))' }).setLngLat([...item.coordinates]).setDOMContent(detail(item)).addTo(map);
          popups.push(popup);
        });
        markers.push(new MapMarker({ element: button, anchor: 'bottom' }).setLngLat([...item.coordinates]).addTo(map));
      }
    });
    return () => { cancelled = true; for (const popup of popups) popup.remove(); for (const marker of markers) marker.remove(); };
  }, [map, scenario, decisions, preview, result, comparison]);
  return null;
}
