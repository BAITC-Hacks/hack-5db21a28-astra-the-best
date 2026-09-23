import type { FilterSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { EffectMarker } from './model';

export const IMPACT_LAYERS = ['measure-impact-fill', 'measure-impact-halo', 'measure-impact-outline'] as const;
const COLOR = '#913af0';

/** Highlight the actual model scope, not an invented radius around the pin. */
export function createImpactHighlight(map: MapLibreMap) {
  return {
    show(markers: readonly EffectMarker[]) {
      if (!map.getSource('game-zones')) return;
      const filter: FilterSpecification = ['in', ['get', 'id'], ['literal', [...new Set(markers.map(item => item.districtId))]]];
      if (!map.getLayer(IMPACT_LAYERS[0])) {
        map.addLayer({ id: IMPACT_LAYERS[0], type: 'fill', source: 'game-zones', paint: { 'fill-color': COLOR, 'fill-opacity': 0.3 }, filter });
        map.addLayer({ id: IMPACT_LAYERS[1], type: 'line', source: 'game-zones', paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.85 }, filter });
        map.addLayer({ id: IMPACT_LAYERS[2], type: 'line', source: 'game-zones', paint: { 'line-color': COLOR, 'line-width': 3, 'line-opacity': 1 }, filter });
      }
      for (const id of IMPACT_LAYERS) {
        map.setFilter(id, filter);
        // Append above the district fill, its outline, and any subsequently
        // added map decoration. No layer reordering on camera movement.
        map.moveLayer(id);
      }
    },
    remove() { for (const id of [...IMPACT_LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id); },
  };
}
