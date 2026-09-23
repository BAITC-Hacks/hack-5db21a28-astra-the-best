import { describe, expect, it } from 'vitest';
import { scenario } from '@/data';
import type { Decision } from '@/contracts';
import { simulate } from '@/domain/simulation';
import { validateScenarioRequest } from '@/domain/validation';
import { findImprovement } from '@/domain/search/improve';
import { COMPARISON_STORAGE_KEY, deleteSavedScenario, readSavedScenarios, saveScenario } from '@/features/comparison/storage';

const decisions: readonly Decision[] = [{ measureId: 'M7', districtId: 'nura' }, { measureId: 'M8', districtId: 'nura' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }, { measureId: 'M5', districtId: 'saryarka' }];
const request = { datasetVersion: scenario.datasetVersion, decisions };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('verified local improvement', () => {
  it('returns a valid positive one-decision gain, reproducible regardless of input order', () => {
    const result = findImprovement(request, scenario);
    expect(result.best).not.toBeNull();
    expect(result.checked).toBeGreaterThan(result.validCandidates);
    expect(result.validCandidates).toBeGreaterThan(0);
    const best = result.best!;
    expect(best.gain).toBeGreaterThan(0);
    const candidate = { datasetVersion: scenario.datasetVersion, decisions: best.simulation.decisions };
    expect(validateScenarioRequest(candidate, scenario).ok).toBe(true);
    expect(best.simulation).toEqual(simulate(candidate, scenario));
    expect(best.gain).toBeCloseTo(best.simulation.result.score - simulate(request, scenario).result.score, 12);
    expect(best.simulation.decisions.filter((decision) => !decisions.some((old) => old.measureId === decision.measureId && old.districtId === decision.districtId))).toHaveLength(1);
    expect(findImprovement({ ...request, decisions: [...decisions].reverse() }, scenario)).toEqual(result);
  });
  it('rejects incomplete and stale input before search', () => {
    expect(() => findImprovement({ ...request, decisions: decisions.slice(1) }, scenario)).toThrow();
    expect(() => findImprovement({ ...request, datasetVersion: 'old' }, scenario)).toThrow();
  });
  it('does not invent an improvement when all effects are zero', () => {
    const neutral = { ...scenario, measures: scenario.measures.map((measure) => ({ ...measure, effects: {} })), rules: { ...scenario.rules, synergies: [] } };
    expect(findImprovement(request, neutral).best).toBeNull();
  });
});

describe('saved scenario integrity', () => {
  it('persists decisions only, deduplicates input order and deletes selected scenario', () => {
    const local = storage();
    saveScenario(local, scenario, decisions, 'Первый');
    saveScenario(local, scenario, [...decisions].reverse(), 'Переименованный');
    const saved = readSavedScenarios(local, scenario);
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0].name).toBe('Переименованный');
    expect(local.getItem(COMPARISON_STORAGE_KEY)).not.toContain('score');
    deleteSavedScenario(local, scenario, simulate(request, scenario).scenarioId);
    expect(readSavedScenarios(local, scenario).entries).toHaveLength(0);
  });
  it('excludes incompatible dataset versions, hashes and invalid decisions', () => {
    const local = storage();
    const entry = saveScenario(local, scenario, decisions, 'Верный').entries[0];
    local.setItem(COMPARISON_STORAGE_KEY, JSON.stringify([
      entry,
      { ...entry, datasetHash: 'old' },
      { ...entry, request: { ...request, datasetVersion: 'old' } },
      { ...entry, request: { ...request, decisions: [...decisions.slice(1), decisions[1]] } },
      { ...entry, request: { ...request, score: 100 } },
      { ...entry, request: { ...request, decisions: [{ measureId: 'M99' }] } },
    ]));
    const saved = readSavedScenarios(local, scenario);
    expect(saved.entries).toHaveLength(1);
    expect(saved.warning).not.toBeNull();
  });
  it('recovers from corrupt JSON and communicates unavailable storage without fake success', () => {
    const local = storage();
    local.setItem(COMPARISON_STORAGE_KEY, '{broken');
    expect(readSavedScenarios(local, scenario)).toMatchObject({ entries: [], warning: expect.any(String) });
    const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(readSavedScenarios(denied, scenario).warning).not.toBeNull();
    expect(() => saveScenario(denied, scenario, decisions, 'Plan')).toThrow(/не разрешил/);
    expect(() => saveScenario(local, scenario, decisions.slice(1), 'Invalid')).toThrow();
  });
  it('limits storage to six distinct valid scenarios', () => {
    const local = storage();
    for (const [index, district] of scenario.districts.entries()) saveScenario(local, scenario, decisions.map((decision) => decision.measureId === 'M7' ? { ...decision, districtId: district.id } : decision), `Вариант ${index}`);
    const sixth = decisions.map((decision) => decision.measureId === 'M8' ? { ...decision, districtId: 'esil' as const } : decision);
    saveScenario(local, scenario, sixth, 'Шестой');
    const seventh = decisions.map((decision) => decision.measureId === 'M8' ? { ...decision, districtId: 'almaty' as const } : decision);
    expect(() => saveScenario(local, scenario, seventh, 'Седьмой')).toThrow(/шесть/);
    expect(readSavedScenarios(local, scenario).entries).toHaveLength(6);
  });
});
