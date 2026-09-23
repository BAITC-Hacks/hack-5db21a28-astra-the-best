import { describe, expect, it } from 'vitest';
import { DISTRICT_IDS, MEASURE_IDS } from '@/contracts';
import type { Decision, MeasureId, ScenarioResponse, SimulationResponse } from '@/contracts';
import { scenario } from '@/data';
import { optimizeScenario } from '@/domain/search/optimize';
import { simulate } from '@/domain/simulation';
import { validateDecisions } from '@/domain/validation';

function fixture(ids: readonly MeasureId[]): ScenarioResponse {
  return {
    ...scenario,
    measures: scenario.measures.filter((measure) => ids.includes(measure.id)),
    districts: scenario.districts.filter((district) => district.id === 'esil' || district.id === 'nura')
      .map((district) => ({ ...district, populationShare: 0.5 })),
  };
}

/** Independent slow oracle: no search pruning, tables, or alternate scoring. */
function bruteForce(input: ScenarioResponse) {
  const measures = [...input.measures].sort((a, b) => MEASURE_IDS.indexOf(a.id) - MEASURE_IDS.indexOf(b.id));
  const districts = [...input.districts].sort((a, b) => DISTRICT_IDS.indexOf(a.id) - DISTRICT_IDS.indexOf(b.id));
  let best: SimulationResponse | null = null;
  let checkedCandidates = 0;
  function visit(start: number, decisions: Decision[]) {
    if (decisions.length === input.rules.requiredDecisions) {
      if (!validateDecisions(decisions, { mode: 'final', scenario: input }).valid) return;
      checkedCandidates++;
      const candidate = simulate({ datasetVersion: input.datasetVersion, decisions }, input);
      if (!best || candidate.result.score > best.result.score
        || (candidate.result.score === best.result.score && candidate.cost < best.cost)) best = candidate;
      return;
    }
    for (let index = start; index < measures.length; index++) {
      const measure = measures[index];
      const alternatives: Decision[] = measure.scope === 'city' ? [{ measureId: measure.id }]
        : districts.map((district) => ({ measureId: measure.id, districtId: district.id }));
      for (const decision of alternatives) visit(index + 1, [...decisions, decision]);
    }
  }
  visit(0, []);
  return { simulation: best, checkedCandidates };
}

function expectOracleMatch(input: ScenarioResponse) {
  const expected = bruteForce(input);
  expect(expected.simulation).not.toBeNull();
  const actual = optimizeScenario(input);
  expect(actual.method).toBe('exhaustive');
  expect(actual.checkedCandidates).toBe(expected.checkedCandidates);
  expect(actual.simulation).toEqual(expected.simulation);
  return actual;
}

describe('complete scenario optimization', () => {
  it('exhausts the canonical space and returns the independently verified global maximum', () => {
    const unchanged = JSON.stringify(scenario);
    const optimized = optimizeScenario();
    expect(optimized.checkedCandidates).toBe(694395);
    expect(optimized.simulation.decisions).toEqual([
      { measureId: 'M2' },
      { measureId: 'M3', districtId: 'nura' },
      { measureId: 'M8', districtId: 'nura' },
      { measureId: 'M9', districtId: 'nura' },
      { measureId: 'M14' },
    ]);
    expect(optimized.simulation.cost).toBe(98);
    expect(optimized.simulation.result.score).toBeCloseTo(57.236735, 10);
    expect(optimized.simulation.result.criticalCount).toBe(0);
    expect(optimized.simulation).toEqual(simulate({ datasetVersion: scenario.datasetVersion, decisions: optimized.simulation.decisions }));
    expect(JSON.stringify(scenario)).toBe(unchanged);
  });

  it.each([
    ['M1', 'M2', 'M3', 'M4', 'M7', 'M11', 'M12'],
    ['M5', 'M6', 'M8', 'M10', 'M12', 'M13'],
    ['M7', 'M8', 'M9', 'M10', 'M11', 'M14'],
  ] as const)('matches canonical brute force with budget, direction limits, conflicts and synergies (%j)', (...ids) => {
    expectOracleMatch(fixture(ids));
  });

  it('matches negative effects, lag, clipping after totals, and the strict critical threshold', () => {
    const input = fixture(['M1', 'M2', 'M10', 'M11', 'M12']);
    const edge: ScenarioResponse = {
      ...input,
      districts: input.districts.map((district) => ({
        ...district,
        indicators: { ...district.indicators, T1: 99, B1: 98, S1: 39.999, S2: 40 },
      })),
      measures: input.measures.map((measure) => measure.id === 'M1' ? { ...measure, effects: { T1: 100, T2: 9 } }
        : measure.id === 'M11' ? { ...measure, effects: { T1: -120, B2: 12 } } : measure),
      rules: {
        ...input.rules,
        synergies: [...input.rules.synergies, { id: 'city-target', measureIds: ['M2', 'M12'], targetMeasureId: 'M2', effects: { T1: 5 } }],
      },
    };
    const result = expectOracleMatch(edge);
    expect(result.simulation.ledger.synergies.filter((entry) => entry.id === 'city-target')).toHaveLength(2);
    expect(result.simulation.result.criticalIndicators.filter((entry) => entry.indicatorId === 'S1')).toHaveLength(2);
    expect(result.simulation.result.criticalIndicators.filter((entry) => entry.indicatorId === 'S2')).toHaveLength(0);
  });

  it('prefers the cheapest exact tie and a stable order without mutating or depending on catalog order', () => {
    const input = fixture(['M4', 'M9', 'M10', 'M11', 'M12', 'M14']);
    const neutral: ScenarioResponse = {
      ...input,
      measures: input.measures.map((measure) => ({ ...measure, effects: {} })),
      rules: { ...input.rules, synergies: [] },
    };
    const first = expectOracleMatch(neutral);
    expect(first.simulation.cost).toBe(61);
    expect(first.simulation.decisions.filter((decision) => decision.districtId).every((decision) => decision.districtId === 'esil')).toBe(true);
    expect(optimizeScenario({ ...neutral, measures: [...neutral.measures].reverse() })).toEqual(first);
    expect(optimizeScenario(neutral)).toEqual(first);
  });

  it('honors exact budget equality and handles city/district conflict scopes like the validator', () => {
    const input = fixture(['M1', 'M2', 'M9', 'M10', 'M12']);
    const exactBudget: ScenarioResponse = {
      ...input,
      measures: input.measures.map((measure) => measure.id === 'M1' ? { ...measure, cost: 42 } : measure),
      rules: { ...input.rules, conflicts: [{ measureIds: ['M1', 'M2'], scope: 'same-district', message: 'Fixture' }] },
    };
    expect(expectOracleMatch(exactBudget).simulation.cost).toBe(100);
    const cityConflict: ScenarioResponse = {
      ...exactBudget,
      rules: { ...input.rules, conflicts: [{ measureIds: ['M2', 'M12'], scope: 'same-district', message: 'Fixture' }] },
    };
    expect(bruteForce(cityConflict).checkedCandidates).toBe(0);
    expect(() => optimizeScenario(cityConflict)).toThrow('NO_FEASIBLE_SCENARIO');
    expect(() => optimizeScenario({ ...input, measures: input.measures.slice(1) })).toThrow('NO_FEASIBLE_SCENARIO');
  });
});
