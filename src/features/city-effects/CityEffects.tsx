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
  lag.textContent = `Начало эффекта через ${marker.lagQuarters} кв. · учтено ${(marker.realizedFraction * 100).toFixed(0)}% за два года.`;
  root.append(lag);
  const effects = document.createElement('ul');
  const values = marker.status === 'applied' ? marker.realizedEffects : marker.fullEffects;
  for (const effect of values) {
    const item = document.createElement('li');
    item.textContent = `${effect.name}: ${signed(effect.value)} ${marker.status === 'applied' ? 'учтено' : 'полный эффект'}`;
    if (effect.value < 0) item.className = styles.negative;
    effects.append(item);
  }
  root.append(effects);
  for (const synergy of marker.synergies) {
    const item = document.createElement('p');
    item.className = styles.synergy;
    item.textContent = `Синергия ${synergy.name}: ${synergy.effects}`;
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
          const popup = new MapPopup({ offset: 20, closeOnMove: true }).setLngLat([...item.coordinates]).setDOMContent(detail(item)).addTo(map);
          popups.push(popup);
        });
        markers.push(new MapMarker({ element: button, anchor: 'bottom' }).setLngLat([...item.coordinates]).addTo(map));
      }
    });
    return () => { cancelled = true; for (const popup of popups) popup.remove(); for (const marker of markers) marker.remove(); };
  }, [map, scenario, decisions, preview, result, comparison]);
  return null;
}
