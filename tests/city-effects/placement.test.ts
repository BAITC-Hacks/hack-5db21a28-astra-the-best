import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { DISTRICT_IDS, MEASURE_IDS, type DistrictId } from '@/contracts';
import { scenario } from '@/data';
import { effectCoordinates, effectLandmark } from '@/features/city-effects/positions';
import { deriveEffectMarkers } from '@/features/city-effects/model';

const zones = JSON.parse(readFileSync('public/geo/astana-game-zones.geojson', 'utf8')) as FeatureCollection<Polygon | MultiPolygon>;
function inRing(point: readonly number[], ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
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

describe('OSM references', () => {
  it('uses coordinates and identities from the saved public source, never guessed sites', () => {
    const source = JSON.parse(readFileSync('docs/sources/effect-landmarks-osm.json', 'utf8'));
    let linked = 0;
    for (const district of DISTRICT_IDS) for (const measure of MEASURE_IDS) {
      const landmark = effectLandmark(district, measure);
      if (!landmark) continue;
      linked++;
      expect(source.features).toContainEqual(landmark);
      expect(effectCoordinates(district, measure)).toEqual(landmark.coordinates);
      expect(['node', 'way', 'relation']).toContain(landmark.osmType);
      expect(landmark.name).not.toBe('');
      if (measure === 'M4' || measure === 'M6') expect(landmark.category).toBe('park');
      if (measure === 'M7') expect(landmark.category).toBe('school');
      if (measure === 'M8') expect(landmark.category).toBe('hospital');
    }
    expect(linked).toBe(20);
    expect(effectLandmark('nura', 'M12')).toBeUndefined();
  });
});
