import type { Decision, DistrictId, IndicatorId, MeasureId, ScenarioResponse, SimulationResponse } from '@/contracts';
import { effectCoordinates, effectLandmark, type Landmark } from './positions';

export const EFFECT_ICONS: Record<MeasureId, string> = {
  M1: '⇢', M2: '◉', M3: '═', M4: '♣', M5: '♨', M6: '✿', M7: '▣', M8: '✚', M9: '●', M10: '✦', M11: '▥', M12: '✉', M13: '≈', M14: '⚑',
};

export const EFFECT_DESCRIPTIONS: Record<MeasureId, string> = {
  M1: 'Автобусные полосы', M2: 'Умные светофоры', M3: 'Линия ЛРТ', M4: 'Парк и сквер', M5: 'Чистое топливо', M6: 'Городское озеленение', M7: 'Школа и детсад', M8: 'Поликлиника', M9: 'Спорт-хабы', M10: 'Освещение и камеры', M11: 'Безопасные переходы', M12: 'Платформа обращений', M13: 'Тепло- и водосети', M14: 'Аварийные бригады',
};

export const DISTRICT_ANCHORS: Record<DistrictId, readonly [number, number]> = {
  esil: [71.464585, 51.039974], almaty: [71.542241, 51.14413], saryarka: [71.321075, 51.199591], baikonur: [71.458097, 51.226469], nura: [71.316036, 51.100896],
};

export interface EffectMarker {
  key: string;
  measureId: MeasureId;
  districtId: DistrictId;
  coordinates: readonly [number, number];
  landmark?: Landmark;
  scope: 'city' | 'district';
  status: 'preview' | 'planned' | 'applied';
  icon: string;
  title: string;
  districtName: string;
  directionId: string;
  lagQuarters: number;
  realizedFraction: number;
  fullEffects: readonly { indicatorId: IndicatorId; name: string; value: number }[];
  realizedEffects: readonly { indicatorId: IndicatorId; name: string; value: number }[];
  synergies: readonly { name: string; effects: string }[];
  critical: readonly string[];
}

export interface EffectSceneInput {
  scenario: ScenarioResponse;
  decisions: readonly Decision[];
  preview?: Decision | null;
  result?: SimulationResponse | null;
  comparison: 'before' | 'after';
}

export function deriveEffectMarkers({ scenario, decisions, preview, result, comparison }: EffectSceneInput): EffectMarker[] {
  const sameDecisions = result?.decisions.length === decisions.length && decisions.every((decision) => result.decisions.some((saved) => saved.measureId === decision.measureId && saved.districtId === decision.districtId));
  const current = result?.datasetVersion === scenario.datasetVersion && sameDecisions && comparison === 'after' ? result : null;
  const districtNames = new Map(scenario.districts.map((district) => [district.id, district.name]));
  const indicators = new Map(scenario.indicators.map((indicator) => [indicator.id, indicator.name]));
  const measures = new Map(scenario.measures.map((measure) => [measure.id, measure]));
  const entries = decisions.map((decision) => ({ decision, preview: false }));
  if (preview && !decisions.some((decision) => decision.measureId === preview.measureId && decision.districtId === preview.districtId)) entries.push({ decision: preview, preview: true });
  const markers: EffectMarker[] = [];

  for (const { decision, preview: isPreview } of entries) {
    const measure = measures.get(decision.measureId);
    if (!measure || (measure.scope === 'district' && !decision.districtId)) continue;
    const targets = measure.scope === 'city' ? scenario.districts.map((district) => district.id) : [decision.districtId!];
    for (const districtId of targets) {
      const districtName = districtNames.get(districtId);
      if (!districtName) continue;
      const coordinates = effectCoordinates(districtId, measure.id);
      const fullEffects = Object.entries(measure.effects).map(([id, value]) => ({ indicatorId: id as IndicatorId, name: indicators.get(id as IndicatorId) ?? id, value: value ?? 0 }));
      const realizedEffects = current?.ledger.measures.filter((entry) => entry.measureId === measure.id && entry.districtId === districtId).map((entry) => ({ indicatorId: entry.indicatorId, name: indicators.get(entry.indicatorId) ?? entry.indicatorId, value: entry.realizedEffect })) ?? [];
      const synergies = current?.ledger.synergies.filter((entry) => entry.districtId === districtId && entry.measureIds.includes(measure.id)).map((entry) => ({ name: entry.measureIds.map((id) => measures.get(id)?.name ?? id).join(' + '), effects: Object.entries(entry.effects).map(([id, value]) => `${indicators.get(id as IndicatorId) ?? id} ${signed(value ?? 0)} балла`).join(', ') })) ?? [];
      const critical = current?.result.criticalIndicators.filter((entry) => entry.districtId === districtId).map((entry) => `${indicators.get(entry.indicatorId) ?? entry.indicatorId}: ${entry.value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} балла`) ?? [];
      markers.push({ key: `${measure.id}-${districtId}-${isPreview ? 'preview' : 'decision'}`, measureId: measure.id, districtId, coordinates, landmark: effectLandmark(districtId, measure.id), scope: measure.scope, status: isPreview ? 'preview' : current ? 'applied' : 'planned', icon: EFFECT_ICONS[measure.id], title: EFFECT_DESCRIPTIONS[measure.id], districtName, directionId: measure.directionId, lagQuarters: measure.lagQuarters, realizedFraction: (scenario.horizonQuarters - measure.lagQuarters) / scenario.horizonQuarters, fullEffects, realizedEffects, synergies, critical });
    }
  }
  return markers;
}

export function signed(value: number): string { return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
