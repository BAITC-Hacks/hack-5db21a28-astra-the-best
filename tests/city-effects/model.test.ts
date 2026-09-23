import { describe, expect, it } from 'vitest';
import { MEASURE_IDS } from '@/contracts';
import type { Decision } from '@/contracts';
import { scenario } from '@/data';
import { simulate } from '@/domain/simulation';
import { deriveEffectMarkers, EFFECT_DESCRIPTIONS, EFFECT_ICONS } from '@/features/city-effects/model';

const control: Decision[] = [
  { measureId: 'M7', districtId: 'nura' },
  { measureId: 'M8', districtId: 'nura' },
  { measureId: 'M10', districtId: 'nura' },
  { measureId: 'M12' },
  { measureId: 'M5', districtId: 'saryarka' },
];

describe('city effects scene', () => {
  it('has a unique readable representation for every measure', () => {
    expect(Object.keys(EFFECT_ICONS)).toEqual([...MEASURE_IDS]);
    expect(Object.keys(EFFECT_DESCRIPTIONS)).toEqual([...MEASURE_IDS]);
    expect(new Set(Object.values(EFFECT_ICONS)).size).toBe(14);
  });

  it('places district measures once and city measures in five zones', () => {
    for (const measure of scenario.measures) {
      const decision: Decision = measure.scope === 'city' ? { measureId: measure.id } : { measureId: measure.id, districtId: 'nura' };
      const markers = deriveEffectMarkers({ scenario, decisions: [decision], comparison: 'before' });
      expect(markers).toHaveLength(measure.scope === 'city' ? 5 : 1);
      expect(new Set(markers.map((marker) => marker.districtId)).size).toBe(markers.length);
      expect(markers.every((marker) => marker.status === 'planned')).toBe(true);
    }
  });

  it('refreshes on removal, replacement and preview without accumulating markers', () => {
    const before = deriveEffectMarkers({ scenario, decisions: control, comparison: 'before' });
    expect(before).toHaveLength(9);
    const removed = deriveEffectMarkers({ scenario, decisions: control.filter((item) => item.measureId !== 'M12'), comparison: 'before' });
    expect(removed).toHaveLength(4);
    const previewed = deriveEffectMarkers({ scenario, decisions: control, preview: { measureId: 'M11', districtId: 'nura' }, comparison: 'before' });
    expect(previewed).toHaveLength(10);
    expect(previewed.find((item) => item.measureId === 'M11')?.status).toBe('preview');
  });

  it('uses simulation ledger for after values, negative effects and synergy', () => {
    const result = simulate({ datasetVersion: scenario.datasetVersion, decisions: control }, scenario);
    const before = deriveEffectMarkers({ scenario, decisions: control, result, comparison: 'before' });
    const after = deriveEffectMarkers({ scenario, decisions: control, result, comparison: 'after' });
    expect(before.every((item) => item.status === 'planned')).toBe(true);
    expect(after.every((item) => item.status === 'applied')).toBe(true);
    expect(after.find((item) => item.measureId === 'M7')?.realizedEffects[0].value).toBe(10);
    expect(after.find((item) => item.measureId === 'M10')?.synergies.some((item) => item.name === 'Освещение и камеры (расширение Safe City) + Единая цифровая платформа обращений')).toBe(true);
    const stale = deriveEffectMarkers({ scenario, decisions: control.slice(0, 4), result, comparison: 'after' });
    expect(stale.every((item) => item.status === 'planned')).toBe(true);
    const negative = deriveEffectMarkers({ scenario, decisions: [{ measureId: 'M11', districtId: 'nura' }], comparison: 'before' });
    expect(negative[0].fullEffects.find((item) => item.indicatorId === 'T1')?.value).toBe(-2);
  });
});
