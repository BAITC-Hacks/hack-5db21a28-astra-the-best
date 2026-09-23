'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { DistrictId, IndicatorId, ScenarioResponse, SimulationResponse } from '@/contracts';
import { SelectMenu } from '@/components/SelectMenu';
import styles from './CityMap.module.css';

const CITY_BOUNDS: [[number, number], [number, number]] = [[71.217973, 50.857608], [71.785191, 51.35111]];
const ZONES = [
  { id: 'esil', name: 'Есиль', color: '#56b4a9' },
  { id: 'almaty', name: 'Алматы + Сарайшык', color: '#eeaa77' },
  { id: 'saryarka', name: 'Сарыарка', color: '#a09ade' },
  { id: 'baikonur', name: 'Байконур', color: '#e6c46a' },
  { id: 'nura', name: 'Нура', color: '#88c995' },
] as const;

type ZoneId = DistrictId;

export interface CityMapProps {
  scenario: ScenarioResponse;
  result?: SimulationResponse | null;
  comparison?: 'before' | 'after';
  selectedDistrictId?: DistrictId | null;
  onDistrictSelect?: (districtId: DistrictId | null) => void;
  onMapReady?: (map: MapLibreMap) => void;
}

export function CityMap({ scenario, result, comparison = 'before', selectedDistrictId, onDistrictSelect, onMapReady }: CityMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const callbacks = useRef({ onDistrictSelect, onMapReady });
  useEffect(() => { callbacks.current = { onDistrictSelect, onMapReady }; }, [onDistrictSelect, onMapReady]);
  const [internalSelected, setInternalSelected] = useState<ZoneId | null>(null);
  const selected = selectedDistrictId === undefined ? internalSelected : selectedDistrictId;
  const selectDistrict = (id: DistrictId | null) => { setInternalSelected(id); callbacks.current.onDistrictSelect?.(id); };
  const [indicatorId, setIndicatorId] = useState<IndicatorId | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const after = comparison === 'after' && result?.datasetVersion === scenario.datasetVersion ? result.result : null;
  const valuesFor = useCallback((districtId: DistrictId) => after?.districts.find((district) => district.districtId === districtId)?.indicators ?? scenario.districts.find((district) => district.id === districtId)!.indicators, [after, scenario]);

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    import('maplibre-gl').then((maplibregl) => {
      if (cancelled || !container.current) return;
      maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs');
      const instance = new maplibregl.Map({
        container: container.current,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [71.43, 51.12],
        zoom: 9,
        pitch: 45,
        bearing: -17,
        attributionControl: false,
      });
      map = instance;
      mapRef.current = instance;
      instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      instance.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
      instance.on('load', async () => {
        if (cancelled) return;
        try {
          const response = await fetch('/geo/astana-game-zones.geojson');
          if (!response.ok) throw new Error('Границы игровых зон недоступны');
          const geojson = await response.json();
          if (cancelled) return;
          instance.addSource('game-zones', { type: 'geojson', data: geojson, promoteId: 'id' });
          instance.addLayer({ id: 'game-zones-fill', type: 'fill', source: 'game-zones', paint: {
            'fill-color': ['match', ['get', 'id'], 'esil', '#56b4a9', 'almaty', '#eeaa77', 'saryarka', '#a09ade', 'baikonur', '#e6c46a', 'nura', '#88c995', '#95b8bd'],
            'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.34, 0.11],
          } });
          instance.addLayer({ id: 'game-zones-outline', type: 'line', source: 'game-zones', paint: { 'line-color': '#167e76', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 13, 3], 'line-opacity': 0.75 } });
          instance.on('click', 'game-zones-fill', (event) => {
            const id = event.features?.[0]?.properties?.id as ZoneId | undefined;
            if (id && ZONES.some((zone) => zone.id === id)) { setInternalSelected(id); callbacks.current.onDistrictSelect?.(id); }
          });
          instance.on('mouseenter', 'game-zones-fill', () => { instance.getCanvas().style.cursor = 'pointer'; });
          instance.on('mouseleave', 'game-zones-fill', () => { instance.getCanvas().style.cursor = ''; });
          instance.fitBounds(CITY_BOUNDS, { padding: 55, pitch: 45, bearing: -17, duration: 0 });
          setState('ready');
          callbacks.current.onMapReady?.(instance);
        } catch { setState('error'); }
      });
      instance.on('error', (event) => {
        if (!cancelled && !instance.loaded()) { console.error('MapLibre:', event.error); setState('error'); }
      });
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; map?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('game-zones')) return;
    for (const zone of ZONES) map.setFeatureState({ source: 'game-zones', id: zone.id }, { selected: zone.id === selected });
  }, [selected, state]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('game-zones-fill')) return;
    if (!indicatorId) {
      map.setPaintProperty('game-zones-fill', 'fill-color', ['match', ['get', 'id'], 'esil', '#56b4a9', 'almaty', '#eeaa77', 'saryarka', '#a09ade', 'baikonur', '#e6c46a', 'nura', '#88c995', '#95b8bd']);
      map.setPaintProperty('game-zones-fill', 'fill-opacity', ['case', ['boolean', ['feature-state', 'selected'], false], 0.34, 0.11]);
      return;
    }
    const values = Object.fromEntries(scenario.districts.map((district) => [district.id, valuesFor(district.id)[indicatorId]])) as Record<ZoneId, number>;
    map.setPaintProperty('game-zones-fill', 'fill-color', ['interpolate', ['linear'], ['match', ['get', 'id'], 'esil', values.esil, 'almaty', values.almaty, 'saryarka', values.saryarka, 'baikonur', values.baikonur, 'nura', values.nura, 0], 30, '#d46d60', 50, '#ecc47f', 70, '#91c9a8', 90, '#55b6a9']);
    map.setPaintProperty('game-zones-fill', 'fill-opacity', ['case', ['boolean', ['feature-state', 'selected'], false], 0.68, 0.45]);
  }, [indicatorId, scenario, state, valuesFor]);

  const resetView = () => mapRef.current?.fitBounds(CITY_BOUNDS, { padding: 55, pitch: 45, bearing: -17, duration: 800 });
  const showCityCenter = () => mapRef.current?.flyTo({ center: [71.43, 51.126], zoom: 15, pitch: 60, bearing: -20, duration: 1200 });
  const selectedZone = ZONES.find((zone) => zone.id === selected);
  const selectedDistrict = scenario.districts.find((district) => district.id === selected);
  const selectedValues = selected ? valuesFor(selected) : null;
  const activeIndicator = scenario.indicators.find((indicator) => indicator.id === indicatorId);

  return <section className={styles.shell} aria-label="3D-карта Астаны">
    <div ref={container} className={styles.map} />
    <div className={styles.controls}><button type="button" onClick={resetView}>Весь город</button><button type="button" onClick={showCityCenter}>3D центр</button></div>
    <div className={styles.legend} aria-label="Игровые зоны"><strong>Игровые зоны</strong><SelectMenu label="Слой показателей" value={indicatorId ?? ''} onChange={(id) => setIndicatorId(id ? id as IndicatorId : null)} options={[{ value: '', label: 'Обзор зон' }, ...scenario.indicators.map((indicator) => ({ value: indicator.id, label: indicator.name }))]} />{ZONES.map((zone) => <button key={zone.id} type="button" aria-pressed={selected === zone.id} onClick={() => selectDistrict(zone.id)}><span style={{ background: zone.color }} />{zone.name}{indicatorId && <strong>{valuesFor(zone.id)[indicatorId].toFixed(2)}</strong>}</button>)}{activeIndicator && <p className={styles.scale}>Ниже 40 — критично · выше 70 — хорошо. Значения в баллах.</p>}<small>Границы адаптированы для модели из 5 районов. Это не официальное деление.</small></div>
    {selectedZone && selectedDistrict && selectedValues && <div className={styles.zoneCard}><span>ВЫБРАНА ЗОНА · {after ? 'ПОСЛЕ' : 'ДО'}</span><h2>{selectedZone.name}</h2><p>{selectedDistrict.profile}</p><dl>{scenario.indicators.map((indicator) => <div key={indicator.id}><dt>{indicator.name}</dt><dd className={selectedValues[indicator.id] < scenario.rules.criticalThreshold ? styles.critical : undefined}>{selectedValues[indicator.id].toFixed(2)} / 100</dd></div>)}</dl><button type="button" onClick={() => selectDistrict(null)}>Закрыть</button></div>}
    {state === 'loading' && <div className={styles.status} role="status">Загружаем карту Астаны…</div>}
    {state === 'error' && <div className={styles.status} role="alert">Не удалось загрузить карту или её геоданные. Проверьте подключение к сети.</div>}
    <div className={styles.credit}>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors · ODbL</a> · <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a></div>
  </section>;
}
