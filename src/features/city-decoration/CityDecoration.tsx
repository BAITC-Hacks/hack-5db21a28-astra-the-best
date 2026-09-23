'use client';

import { useEffect } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';

const SOURCE = 'decorative-city-traffic';
const LAYER = 'decorative-city-traffic-dots';
const MAX_VEHICLES = 16;
const UPDATE_MS = 125;
type Route = number[][];

/** Ping-pong motion on actual rendered road geometry; never a traffic forecast. */
export function positionAlongRoad(route: Route, progress: number): number[] {
  const phase = ((progress % 2) + 2) % 2;
  const fraction = phase <= 1 ? phase : 2 - phase;
  const lengths = route.slice(1).map((point, i) => Math.hypot(
    (point[0] - route[i][0]) * Math.cos(route[i][1] * Math.PI / 180),
    point[1] - route[i][1],
  ));
  let distance = lengths.reduce((sum, length) => sum + length, 0) * fraction;
  for (let i = 0; i < lengths.length; i += 1) {
    if (distance <= lengths[i] && lengths[i] > 0) {
      const t = distance / lengths[i];
      return [route[i][0] + (route[i + 1][0] - route[i][0]) * t,
        route[i][1] + (route[i + 1][1] - route[i][1]) * t];
    }
    distance -= lengths[i];
  }
  return route.at(-1)?.slice(0, 2) ?? [0, 0];
}

export interface CityDecorationProps {
  map: MapLibreMap | null;
  active: boolean;
  enabled?: boolean;
}

/** A single bounded GeoJSON layer. No React updates or requests per animation tick. */
export function CityDecoration({ map, active, enabled = true }: CityDecorationProps) {
  useEffect(() => {
    if (!map || !active || !enabled) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let removed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let routes: Route[] = [];
    let phase = 0;
    const empty: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
    const stop = () => { clearInterval(timer); timer = undefined; };
    const source = () => map.getSource(SOURCE) as GeoJSONSource | undefined;
    const clear = () => { stop(); if (!removed) source()?.setData(empty); };
    const tick = () => {
      if (removed) return;
      phase += UPDATE_MS / 30000;
      source()?.setData({ type: 'FeatureCollection', features: routes.map((route, i) => ({
        type: 'Feature', properties: {}, geometry: {
          type: 'Point', coordinates: positionAlongRoad(route, phase + i * 0.137),
        },
      })) });
    };
    const refresh = () => {
      stop();
      if (removed || !map.isStyleLoaded()) return;
      if (!source()) {
        map.addSource(SOURCE, { type: 'geojson', data: empty });
        map.addLayer({ id: LAYER, type: 'circle', source: SOURCE, minzoom: 11.5, paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 2, 15, 3.5],
          'circle-color': '#fff5ce', 'circle-stroke-color': '#4e5968',
          'circle-stroke-width': 1, 'circle-pitch-alignment': 'map',
        } });
      }
      if (document.hidden || motion.matches || map.isMoving() || map.getZoom() < 11.5) {
        source()?.setData(empty);
        return;
      }
      const layers = map.getStyle().layers.filter((layer) => layer.type === 'line'
        && 'source-layer' in layer && layer['source-layer'] === 'transportation').map((layer) => layer.id);
      const seen = new Set<string>();
      routes = [];
      if (layers.length) for (const feature of map.queryRenderedFeatures({ layers })) {
        if (!['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'].includes(String(feature.properties?.class))) continue;
        const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates]
          : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [];
        for (const line of lines) {
          if (line.length < 2 || line.length > 150) continue;
          const key = JSON.stringify(line);
          if (seen.has(key)) continue;
          seen.add(key);
          routes.push(line);
          if (routes.length >= MAX_VEHICLES) break;
        }
        if (routes.length >= MAX_VEHICLES) break;
      }
      tick();
      if (routes.length) timer = setInterval(tick, UPDATE_MS);
    };
    const afterMove = () => { map.off('idle', refresh); map.once('idle', refresh); };
    map.on('movestart', clear);
    map.on('moveend', afterMove);
    map.once('idle', refresh);
    const onRemove = () => { removed = true; stop(); };
    map.on('remove', onRemove);
    document.addEventListener('visibilitychange', refresh);
    motion.addEventListener('change', refresh);
    refresh();
    return () => {
      stop();
      map.off('movestart', clear);
      map.off('moveend', afterMove);
      map.off('idle', refresh);
      map.off('remove', onRemove);
      document.removeEventListener('visibilitychange', refresh);
      motion.removeEventListener('change', refresh);
      if (!removed) {
        if (map.getLayer(LAYER)) map.removeLayer(LAYER);
        if (source()) map.removeSource(SOURCE);
      }
    };
  }, [map, active, enabled]);
  return null;
}

