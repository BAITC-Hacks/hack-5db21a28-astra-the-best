import type { Decision, ScenarioRequest, ScenarioResponse, SimulationResponse } from '@/contracts';
import { scenarioId, simulate } from '@/domain/simulation';
import { validateScenarioRequest } from '@/domain/validation';

export interface Improvement {
  readonly removed: Decision;
  readonly added: Decision;
  readonly simulation: SimulationResponse;
  readonly gain: number;
}

/** Exhaustive one-decision neighbourhood, not a claim of global optimality. */
export function findImprovement(request: ScenarioRequest, scenario: ScenarioResponse): {
  readonly baseline: SimulationResponse;
  readonly checked: number;
  readonly validCandidates: number;
  readonly best: Improvement | null;
} {
  const input = validateScenarioRequest(request, scenario);
  if (!input.ok) throw new Error(input.body.error.message);
  const baseline = simulate(input.request, scenario);
  const alternatives: Decision[] = scenario.measures.flatMap((measure) => measure.scope === 'city'
    ? [{ measureId: measure.id }]
    : scenario.districts.map((district) => ({ measureId: measure.id, districtId: district.id })));
  const visited = new Set([baseline.scenarioId]);
  let checked = 0;
  let validCandidates = 0;
  let best: Improvement | null = null;
  for (let index = 0; index < baseline.decisions.length; index++) {
    for (const added of alternatives) {
      const decisions = baseline.decisions.map((decision, position) => position === index ? added : decision);
      const candidateRequest = { datasetVersion: scenario.datasetVersion, decisions };
      const id = scenarioId(candidateRequest);
      if (visited.has(id)) continue;
      visited.add(id);
      checked++;
      if (!validateScenarioRequest(candidateRequest, scenario).ok) continue;
      validCandidates++;
      const result = simulate(candidateRequest, scenario);
      const gain = result.result.score - baseline.result.score;
      if (gain <= 1e-10) continue;
      if (!best || gain > best.gain + 1e-10 || (Math.abs(gain - best.gain) <= 1e-10
        && (result.cost < best.simulation.cost || (result.cost === best.simulation.cost && result.scenarioId < best.simulation.scenarioId)))) {
        best = { removed: baseline.decisions[index], added, simulation: result, gain };
      }
    }
  }
  return { baseline, checked, validCandidates, best };
}
