import { scenario as defaultScenario } from '@/data';
import { INDICATOR_IDS, MEASURE_IDS } from '@/contracts';
import type { AppliedSynergy, Decision, DistrictId, DistrictSnapshot, EffectLedger, IndicatorChange, IndicatorId, IndicatorValues, MeasureEffectEntry, ScenarioRequest, ScenarioResponse, ScoreSnapshot, SimulationResponse } from '@/contracts';
import { validateDecisions } from './validation';

const clip = (value: number) => Math.max(0, Math.min(100, value));
const normalized = (decisions: readonly Decision[]) => [...decisions].sort((a, b) => MEASURE_IDS.indexOf(a.measureId) - MEASURE_IDS.indexOf(b.measureId)).map(({ measureId, districtId }) => districtId ? { measureId, districtId } : { measureId });

export function scenarioId(request: ScenarioRequest): string {
  return `${request.datasetVersion}:${JSON.stringify(normalized(request.decisions))}`;
}

export function calculateSnapshot(districts: readonly DistrictSnapshot[] | ScenarioResponse['districts'], scenario: ScenarioResponse = defaultScenario): ScoreSnapshot {
  const snapshots = districts.map((district) => {
    const score = scenario.indicators.reduce((sum, indicator) => sum + indicator.weight * district.indicators[indicator.id], 0);
    return { districtId: 'id' in district ? district.id : district.districtId, indicators: district.indicators, score } as DistrictSnapshot;
  });
  const weightedAverage = snapshots.reduce((sum, district) => sum + district.score * (scenario.districts.find((source) => source.id === district.districtId)?.populationShare ?? 0), 0);
  const minimumDistrictScore = Math.min(...snapshots.map((district) => district.score));
  const weakestDistrictIds = snapshots.filter((district) => Math.abs(district.score - minimumDistrictScore) < 1e-10).map((district) => district.districtId);
  const criticalIndicators = snapshots.flatMap((district) => INDICATOR_IDS.filter((id) => district.indicators[id] < scenario.rules.criticalThreshold).map((indicatorId) => ({ districtId: district.districtId, indicatorId, value: district.indicators[indicatorId] })));
  const criticalCount = criticalIndicators.length;
  const score = scenario.rules.averageWeight * weightedAverage + scenario.rules.minimumWeight * minimumDistrictScore - scenario.rules.criticalPenalty * criticalCount;
  return { districts: snapshots, weightedAverage, minimumDistrictScore, weakestDistrictIds, criticalIndicators, criticalCount, score };
}

export function simulate(request: ScenarioRequest, scenario: ScenarioResponse = defaultScenario): SimulationResponse {
  if (request.datasetVersion !== scenario.datasetVersion) throw new Error('DATASET_VERSION_MISMATCH');
  const validation = validateDecisions(request.decisions, { mode: 'final', scenario });
  if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.code).join(','));
  const decisions = normalized(request.decisions);
  const baseline = calculateSnapshot(scenario.districts, scenario);
  const measureEntries: MeasureEffectEntry[] = [];
  const synergyEntries: AppliedSynergy[] = [];
  const measureEffects = new Map<string, number>();
  const synergyEffects = new Map<string, number>();
  const key = (districtId: DistrictId, indicatorId: IndicatorId) => `${districtId}:${indicatorId}`;
  for (const decision of decisions) {
    const measure = scenario.measures.find((item) => item.id === decision.measureId)!;
    const targets = measure.scope === 'city' ? scenario.districts.map((district) => district.id) : [decision.districtId!];
    const realizedFraction = (scenario.horizonQuarters - measure.lagQuarters) / scenario.horizonQuarters;
    for (const districtId of targets) for (const [indicatorId, fullEffect] of Object.entries(measure.effects) as [IndicatorId, number][]) {
      const realizedEffect = fullEffect * realizedFraction;
      measureEntries.push({ measureId: measure.id, districtId, indicatorId, fullEffect, lagQuarters: measure.lagQuarters, realizedFraction, realizedEffect });
      const effectKey = key(districtId, indicatorId);
      measureEffects.set(effectKey, (measureEffects.get(effectKey) ?? 0) + realizedEffect);
    }
  }
  for (const synergy of scenario.rules.synergies) {
    if (!synergy.measureIds.every((id) => decisions.some((decision) => decision.measureId === id))) continue;
    const target = decisions.find((decision) => decision.measureId === synergy.targetMeasureId)!;
    const targetMeasure = scenario.measures.find((measure) => measure.id === target.measureId)!;
    const targets = targetMeasure.scope === 'city' ? scenario.districts.map((district) => district.id) : [target.districtId!];
    for (const districtId of targets) {
      synergyEntries.push({ id: synergy.id, measureIds: synergy.measureIds, districtId, effects: synergy.effects });
      for (const [indicatorId, effect] of Object.entries(synergy.effects) as [IndicatorId, number][]) {
        const effectKey = key(districtId, indicatorId);
        synergyEffects.set(effectKey, (synergyEffects.get(effectKey) ?? 0) + effect);
      }
    }
  }
  const indicatorEntries: IndicatorChange[] = [];
  const finalDistricts = scenario.districts.map((district) => {
    const indicators = {} as Record<IndicatorId, number>;
    for (const indicatorId of INDICATOR_IDS) {
      const before = district.indicators[indicatorId];
      const measureEffect = measureEffects.get(key(district.id, indicatorId)) ?? 0;
      const synergyEffect = synergyEffects.get(key(district.id, indicatorId)) ?? 0;
      const unclipped = before + measureEffect + synergyEffect;
      const after = clip(unclipped);
      indicators[indicatorId] = after;
      indicatorEntries.push({ districtId: district.id, indicatorId, before, measureEffect, synergyEffect, unclipped, after, delta: after - before });
    }
    return { districtId: district.id, indicators: indicators as IndicatorValues, score: 0 };
  });
  const result = calculateSnapshot(finalDistricts, scenario);
  const ledger: EffectLedger = { measures: measureEntries, synergies: synergyEntries, indicators: indicatorEntries };
  return { datasetVersion: scenario.datasetVersion, scenarioId: scenarioId(request), decisions, cost: validation.cost, remainingBudget: validation.remainingBudget, baseline, result, scoreDelta: result.score - baseline.score, ledger };
}
