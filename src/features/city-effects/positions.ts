import type { DistrictId, MeasureId } from '@/contracts';
import sites from './sites.json';
import landmarks from './landmarks.json';

const SITE_ORDER: readonly MeasureId[] = ['M2', 'M6', 'M12', 'M14', 'M1', 'M3', 'M4', 'M5', 'M7', 'M8', 'M9', 'M10', 'M11', 'M13'];
export interface Landmark {
  category: string;
  osmType: string;
  osmId: number;
  name: string;
  coordinates: number[];
}

export function effectLandmark(district: DistrictId, measure: MeasureId): Landmark | undefined {
  return (landmarks[district] as Partial<Record<MeasureId, Landmark>>)[measure];
}

/** Camera-independent sites: verified OSM reference when sufficiently separated,
 * otherwise the original farthest-point sample inside the model district. */
export function effectCoordinates(district: DistrictId, measure: MeasureId): readonly [number, number] {
  const point = effectLandmark(district, measure)?.coordinates ?? sites[district][SITE_ORDER.indexOf(measure)];
  return [point[0], point[1]];
}
