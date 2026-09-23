import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { DISTRICT_IDS, MEASURE_IDS, type DistrictId } from '@/contracts';
import { scenario } from '@/data';
import { effectCoordinates } from '@/features/city-effects/positions';
import { deriveEffectMarkers } from '@/features/city-effects/model';
import { layoutEffectMarkers, MARKER_HEIGHT, MARKER_WIDTH, type ScreenPoint } from '@/features/city-effects/layout';

const zones = JSON.parse(readFileSync('public/geo/astana-game-zones.geojson', 'utf8')) as FeatureCollection<Polygon | MultiPolygon>;
function inRing(point: readonly number[], ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function assertSpaced(points: ScreenPoint[]) {
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    expect(Math.abs(points[i].x - points[j].x) >= MARKER_WIDTH + 9 || Math.abs(points[i].y - points[j].y) >= MARKER_HEIGHT + 9, `overlap ${i}/${j}`).toBe(true);
  }
}

describe('effect geography', () => {
  it('keeps all 70 sites inside the corresponding zone and widely separated', () => {
    for (const district of DISTRICT_IDS) {
      const geometry = zones.features.find(f => f.properties?.id === district)!.geometry;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      const points = MEASURE_IDS.map(id => effectCoordinates(district, id));
      for (const p of points) expect(polygons.some(poly => inRing(p, poly[0]) && !poly.slice(1).some(hole => inRing(p, hole))), `${district}: ${p}`).toBe(true);
      for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
        expect(Math.hypot((points[i][0] - points[j][0]) * 70000, (points[i][1] - points[j][1]) * 111000)).toBeGreaterThan(1400);
      }
    }
  });

  it('keeps geographic positions stable through reordering, preview and before/after', () => {
    const decisions = [{ measureId: 'M12' as const }, { measureId: 'M7' as const, districtId: 'nura' as DistrictId }];
    const original = deriveEffectMarkers({ scenario, decisions, comparison: 'before' });
    const updated = deriveEffectMarkers({ scenario, decisions: [...decisions].reverse(), preview: { measureId: 'M10', districtId: 'nura' }, comparison: 'after' });
    for (const marker of original) expect(updated.find(m => m.key === marker.key)?.coordinates).toEqual(marker.coordinates);
  });
});

describe('screen spacing', () => {
  const dense = Array.from({ length: 22 }, (_, i) => ({ key: String(i).padStart(2, '0'), preview: i === 21, x: 195, y: 195 }));

  it.each([[390, 700], [480, 400], [1280, 700]])('separates all 22 badges in a %i×%i viewport', (width, height) => {
    const points = [...layoutEffectMarkers(dense, width, height).values()];
    assertSpaced(points);
    expect(points.every(p => p.x >= MARKER_WIDTH / 2 && p.x <= width - MARKER_WIDTH / 2 && p.y >= MARKER_HEIGHT / 2 && p.y <= height - MARKER_HEIGHT / 2)).toBe(true);
  });

  it('avoids the legend and controls when screen space is available', () => {
    const obstacle = { left: 0, right: 390, top: 390, bottom: 800 };
    const points = [...layoutEffectMarkers(dense, 390, 800, [obstacle]).values()];
    assertSpaced(points);
    expect(points.every(p => p.y + MARKER_HEIGHT / 2 < obstacle.top)).toBe(true);
  });

  it('does not drag offscreen projects into view; ignores their collisions', () => {
    const offscreen = { key: 'offscreen', preview: false, x: -20, y: 195 };
    const result = layoutEffectMarkers([...dense, offscreen], 390, 700);
    expect(result.get('offscreen')).toMatchObject({ x: -20, y: 195 });
    for (const [key, point] of layoutEffectMarkers(dense, 390, 700)) expect(result.get(key)).toEqual(point);
  });

  it('is deterministic and preview does not move existing markers', () => {
    const before = layoutEffectMarkers(dense.slice(0, 21), 390, 700);
    const withPreview = layoutEffectMarkers([...dense].reverse(), 390, 700);
    for (const [key, point] of before) expect(withPreview.get(key)).toEqual(point);
    expect(withPreview).toEqual(layoutEffectMarkers(dense, 390, 700));
  });
});
