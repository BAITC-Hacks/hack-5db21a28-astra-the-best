import { describe, expect, it } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { scenario } from '@/data';
import { deriveEffectMarkers } from '@/features/city-effects/model';
import { createImpactHighlight, IMPACT_LAYERS } from '@/features/city-effects/impact';

describe('measure area highlighting', () => {
  it('keeps the district or city scope above base layers and removes only its own layers', () => {
    const layers: { id: string; filter?: unknown }[] = [{ id: 'game-zones-fill' }, { id: 'game-zones-outline' }];
    const map = {
      getSource: () => ({}),
      getLayer: (id: string) => layers.find(layer => layer.id === id),
      addLayer: (layer: { id: string }) => layers.push(layer),
      setFilter: (id: string, filter: unknown) => { layers.find(layer => layer.id === id)!.filter = filter; },
      moveLayer: (id: string) => { const index = layers.findIndex(layer => layer.id === id); layers.push(...layers.splice(index, 1)); },
      removeLayer: (id: string) => layers.splice(layers.findIndex(layer => layer.id === id), 1),
    } as unknown as MapLibreMap;
    const highlight = createImpactHighlight(map);
    highlight.show(deriveEffectMarkers({ scenario, decisions: [{ measureId: 'M4', districtId: 'nura' }], comparison: 'before' }));
    expect(layers.slice(-3).map(layer => layer.id)).toEqual(IMPACT_LAYERS);
    expect(layers.at(-1)?.filter).toEqual(['in', ['get', 'id'], ['literal', ['nura']]]);
    layers.push({ id: 'later-decoration' });
    highlight.show(deriveEffectMarkers({ scenario, decisions: [{ measureId: 'M12' }], comparison: 'before' }));
    expect(layers.slice(-3).map(layer => layer.id)).toEqual(IMPACT_LAYERS);
    expect(layers.at(-1)?.filter).toEqual(['in', ['get', 'id'], ['literal', scenario.districts.map(district => district.id)]]);
    highlight.show([]);
    expect(layers.at(-1)?.filter).toEqual(['in', ['get', 'id'], ['literal', []]]);
    highlight.remove();
    expect(layers.map(layer => layer.id)).toEqual(['game-zones-fill', 'game-zones-outline', 'later-decoration']);
  });
});
