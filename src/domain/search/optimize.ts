import { DISTRICT_IDS, INDICATOR_IDS, MEASURE_IDS } from '@/contracts';
import type { Decision, Effects, Measure, ScenarioResponse, SimulationResponse } from '@/contracts';
import { scenario as defaultScenario } from '@/data';
import { simulate } from '@/domain/simulation';

export interface OptimizationResult {
  readonly method: 'exhaustive';
  /** Complete, valid scenarios evaluated, including every district assignment. */
  readonly checkedCandidates: number;
  readonly simulation: SimulationResponse;
}

const effectVector = (effects: Effects, fraction = 1) => INDICATOR_IDS.map((id) => (effects[id] ?? 0) * fraction);

/**
 * Exhaust all feasible measure combinations and district assignments.
 * Equal scores prefer lower cost, then canonical measure/district order.
 * A district depends only on its local subset and the selected city measures,
 * so its score can be reused across assignments without pruning any candidate.
 */
export function optimizeScenario(scenario: ScenarioResponse = defaultScenario): OptimizationResult {
  const measures = [...scenario.measures].sort((a, b) => MEASURE_IDS.indexOf(a.id) - MEASURE_IDS.indexOf(b.id));
  const districtOrder = scenario.districts.map((district, index) => ({ id: district.id, index }))
    .sort((a, b) => DISTRICT_IDS.indexOf(a.id) - DISTRICT_IDS.indexOf(b.id));
  const realizedEffects = new Map(measures.map((measure) => [measure.id,
    effectVector(measure.effects, (scenario.horizonQuarters - measure.lagQuarters) / scenario.horizonQuarters)]));
  const weightedIndicators = scenario.indicators.map((indicator) => ({ index: INDICATOR_IDS.indexOf(indicator.id), weight: indicator.weight }));
  const directionCounts = new Map(scenario.directions.map((direction) => [direction.id, 0]));
  const selected: Measure[] = [];
  let checkedCandidates = 0;
  let bestScore = -Infinity;
  let bestCost = Infinity;
  let bestDecisions: Decision[] | null = null;

  function evaluateAssignments(cost: number) {
    const cityMask = selected.reduce((mask, measure, index) => measure.scope === 'city' ? mask | (1 << index) : mask, 0);
    const localPositions = selected.flatMap((measure, index) => measure.scope === 'district' ? [index] : []);
    const selectedEffects = selected.map((measure) => realizedEffects.get(measure.id)!);
    const synergies = scenario.rules.synergies.filter((rule) => rule.measureIds.every((id) => selected.some((measure) => measure.id === id)))
      .map((rule) => ({ targetBit: 1 << selected.findIndex((measure) => measure.id === rule.targetMeasureId), effects: effectVector(rule.effects) }));
    const conflictMasks = selected.map((measure) => scenario.rules.conflicts.reduce((mask, conflict) => {
      if (conflict.scope !== 'same-district' || !conflict.measureIds.includes(measure.id)) return mask;
      const other = selected.findIndex((candidate) => candidate.id !== measure.id && conflict.measureIds.includes(candidate.id));
      return other >= 0 && selected[other].scope === 'district' ? mask | (1 << other) : mask;
    }, 0));
    const tableSize = 1 << selected.length;
    const scores = scenario.districts.map(() => new Float64Array(tableSize));
    const criticalCounts = scenario.districts.map(() => new Uint8Array(tableSize));

    for (let mask = 0; mask < tableSize; mask++) {
      if (mask & cityMask) continue;
      const activeMask = mask | cityMask;
      // Match simulate(): sum measures in canonical order, sum synergies
      // separately in rule order, and clip only after adding both totals.
      const measureTotals = INDICATOR_IDS.map((_, indicator) => selectedEffects.reduce((sum, effects, index) => activeMask & (1 << index) ? sum + effects[indicator] : sum, 0));
      const synergyTotals = INDICATOR_IDS.map((_, indicator) => synergies.reduce((sum, synergy) => activeMask & synergy.targetBit ? sum + synergy.effects[indicator] : sum, 0));
      for (let district = 0; district < scenario.districts.length; district++) {
        const before = scenario.districts[district].indicators;
        const after = INDICATOR_IDS.map((id, indicator) => Math.max(0, Math.min(100, before[id] + measureTotals[indicator] + synergyTotals[indicator])));
        scores[district][mask] = weightedIndicators.reduce((sum, indicator) => sum + indicator.weight * after[indicator.index], 0);
        criticalCounts[district][mask] = after.filter((value) => value < scenario.rules.criticalThreshold).length;
      }
    }

    const localMasks = scenario.districts.map(() => 0);
    const assignedDistricts = selected.map(() => -1);
    function assign(position: number) {
      if (position === localPositions.length) {
        checkedCandidates++;
        let weightedAverage = 0;
        let minimum = Infinity;
        let criticalCount = 0;
        // Keep source district order to reproduce canonical floating-point sums.
        for (let district = 0; district < scenario.districts.length; district++) {
          const score = scores[district][localMasks[district]];
          weightedAverage += score * scenario.districts[district].populationShare;
          minimum = Math.min(minimum, score);
          criticalCount += criticalCounts[district][localMasks[district]];
        }
        const score = scenario.rules.averageWeight * weightedAverage + scenario.rules.minimumWeight * minimum - scenario.rules.criticalPenalty * criticalCount;
        if (score > bestScore || (score === bestScore && cost < bestCost)) {
          bestScore = score;
          bestCost = cost;
          bestDecisions = selected.map((measure, index) => measure.scope === 'city'
            ? { measureId: measure.id }
            : { measureId: measure.id, districtId: scenario.districts[assignedDistricts[index]].id });
        }
        return;
      }
      const selectedIndex = localPositions[position];
      const bit = 1 << selectedIndex;
      for (const district of districtOrder) {
        if (localMasks[district.index] & conflictMasks[selectedIndex]) continue;
        assignedDistricts[selectedIndex] = district.index;
        localMasks[district.index] |= bit;
        assign(position + 1);
        localMasks[district.index] ^= bit;
      }
    }
    assign(0);
  }

  function choose(start: number, cost: number) {
    if (selected.length === scenario.rules.requiredDecisions) {
      evaluateAssignments(cost);
      return;
    }
    const needed = scenario.rules.requiredDecisions - selected.length;
    for (let index = start; index <= measures.length - needed; index++) {
      const measure = measures[index];
      const nextCost = cost + measure.cost;
      const directionCount = directionCounts.get(measure.directionId) ?? 0;
      if (nextCost > scenario.budget || directionCount >= scenario.rules.maxPerDirection) continue;
      const forbidden = scenario.rules.conflicts.some((conflict) => conflict.measureIds.includes(measure.id)
        && selected.some((other) => conflict.measureIds.includes(other.id)
          && (conflict.scope === 'anywhere' || (measure.scope === 'city' && other.scope === 'city'))));
      if (forbidden) continue;
      selected.push(measure);
      directionCounts.set(measure.directionId, directionCount + 1);
      choose(index + 1, nextCost);
      directionCounts.set(measure.directionId, directionCount);
      selected.pop();
    }
  }

  choose(0, 0);
  if (!bestDecisions) throw new Error('NO_FEASIBLE_SCENARIO');
  const simulation = simulate({ datasetVersion: scenario.datasetVersion, decisions: bestDecisions }, scenario);
  if (simulation.result.score !== bestScore) throw new Error('OPTIMIZATION_SCORE_MISMATCH');
  return { method: 'exhaustive', checkedCandidates, simulation };
}
