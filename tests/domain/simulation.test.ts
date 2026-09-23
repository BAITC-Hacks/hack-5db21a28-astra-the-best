import { describe, expect, it } from 'vitest';
import { scenario } from '@/data';
import type { Decision, ScenarioRequest } from '@/contracts';
import { calculateSnapshot, scenarioId, simulate } from '@/domain/simulation';
import { parseScenarioRequest, validateDecisions, validateScenarioRequest } from '@/domain/validation';
import { controlRequest } from '../data/source-fixture';

const request = (decisions: readonly Decision[]): ScenarioRequest => ({ datasetVersion: scenario.datasetVersion, decisions });
const code = (decisions: readonly Decision[], mode: 'draft' | 'final' = 'final') => validateDecisions(decisions, { mode }).issues.map((issue) => issue.code);

describe('детерминированная симуляция', () => {
  it('воспроизводит базу и контрольный пример из ТЗ', () => {
    const result = simulate(controlRequest);
    expect(calculateSnapshot(scenario.districts).score).toBeCloseTo(52.55768, 8);
    expect(result.cost).toBe(95);
    expect(result.remainingBudget).toBe(5);
    expect(result.baseline.score).toBeCloseTo(52.55768, 8);
    expect(result.result.score).toBeCloseTo(56.54307, 8);
    expect(result.scoreDelta).toBeCloseTo(3.98539, 8);
    expect(result.result.criticalCount).toBe(0);
    expect(result.ledger.indicators).toHaveLength(50);
  });

  it('не зависит от порядка решений и не меняет базу', () => {
    const original = JSON.stringify(scenario);
    const a = simulate(controlRequest);
    const b = simulate(request([...controlRequest.decisions].reverse()));
    expect(a).toEqual(b);
    expect(scenarioId(controlRequest)).toBe(scenarioId(request([...controlRequest.decisions].reverse())));
    expect(JSON.stringify(scenario)).toBe(original);
  });

  it('учитывает синергию M10 + M12 только в районе M10', () => {
    const result = simulate(controlRequest);
    expect(result.ledger.synergies).toContainEqual({ id: 'safe-feedback', measureIds: ['M10', 'M12'], districtId: 'nura', effects: { B1: 2 } });
    expect(result.ledger.indicators.find((entry) => entry.districtId === 'nura' && entry.indicatorId === 'B1')?.synergyEffect).toBe(2);
    expect(result.ledger.indicators.find((entry) => entry.districtId === 'esil' && entry.indicatorId === 'B1')?.synergyEffect).toBe(0);
  });

  it('городская мера применяется ко всем пяти районам, лаг учитывается', () => {
    const result = simulate(controlRequest);
    const cityEntries = result.ledger.measures.filter((entry) => entry.measureId === 'M12');
    expect(cityEntries).toHaveLength(5);
    expect(cityEntries.every((entry) => entry.realizedFraction === 7 / 8 && entry.realizedEffect === 5 * 7 / 8)).toBe(true);
  });

  it('применяет две остальные синергии ровно один раз в целевом районе', () => {
    const bus = simulate(request([{ measureId: 'M1', districtId: 'esil' }, { measureId: 'M2' }, { measureId: 'M9', districtId: 'nura' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }]));
    expect(bus.ledger.synergies.find((item) => item.id === 'bus-signals')).toMatchObject({ districtId: 'esil', effects: { T1: 2 } });
    expect(bus.ledger.synergies.filter((item) => item.id === 'bus-signals')).toHaveLength(1);
    const green = simulate(request([{ measureId: 'M5', districtId: 'saryarka' }, { measureId: 'M6' }, { measureId: 'M9', districtId: 'nura' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }]));
    expect(green.ledger.synergies.find((item) => item.id === 'clean-green')).toMatchObject({ districtId: 'saryarka', effects: { E2: 2 } });
  });

  it('сохраняет отрицательный эффект M11', () => {
    const result = simulate(request([{ measureId: 'M11', districtId: 'nura' }, { measureId: 'M9', districtId: 'esil' }, { measureId: 'M4', districtId: 'nura' }, { measureId: 'M12' }, { measureId: 'M2' }]));
    const entry = result.ledger.measures.find((item) => item.measureId === 'M11' && item.indicatorId === 'T1');
    expect(entry?.fullEffect).toBe(-2);
    expect(entry?.realizedEffect).toBe(-2 * 7 / 8);
  });

  it('обрезает показатель только после суммирования мер и синергий', () => {
    const custom = structuredClone(scenario);
    (custom.districts as unknown as { indicators: Record<string, number> }[])[0].indicators.T1 = 99;
    const result = simulate(request([{ measureId: 'M1', districtId: 'esil' }, { measureId: 'M2' }, { measureId: 'M9', districtId: 'nura' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }]), custom);
    const entry = result.ledger.indicators.find((item) => item.districtId === 'esil' && item.indicatorId === 'T1')!;
    expect(entry.unclipped).toBeGreaterThan(100);
    expect(entry.after).toBe(100);
    expect(entry.delta).toBe(1);
  });

  it('порог критичности строго ниже 40', () => {
    const custom = structuredClone(scenario);
    const editableDistricts = custom.districts as unknown as { indicators: Record<string, number> }[];
    editableDistricts[4].indicators.S2 = 39.999;
    const below = calculateSnapshot(custom.districts, custom);
    expect(below.criticalIndicators.some((item) => item.districtId === 'nura' && item.indicatorId === 'S2')).toBe(true);
    editableDistricts[4].indicators.S2 = 40;
    const at = calculateSnapshot(custom.districts, custom);
    expect(at.criticalIndicators.some((item) => item.districtId === 'nura' && item.indicatorId === 'S2')).toBe(false);
  });

  it('валидирует черновик и финальную заявку раздельно', () => {
    expect(code(controlRequest.decisions.slice(0, 4), 'draft')).not.toContain('DECISION_COUNT');
    expect(code(controlRequest.decisions.slice(0, 4))).toContain('DECISION_COUNT');
    expect(code([...controlRequest.decisions, { measureId: 'M14' }])).toContain('DECISION_COUNT');
  });

  it('отклоняет дубли, превышение бюджета, лимит направления и конфликт', () => {
    expect(code([...controlRequest.decisions.slice(0, 4), controlRequest.decisions[0]])).toContain('DUPLICATE_MEASURE');
    expect(code([{ measureId: 'M3', districtId: 'esil' }, { measureId: 'M5', districtId: 'saryarka' }, { measureId: 'M7', districtId: 'nura' }, { measureId: 'M8', districtId: 'nura' }, { measureId: 'M13', districtId: 'esil' }])).toContain('BUDGET_EXCEEDED');
    expect(code([{ measureId: 'M7', districtId: 'nura' }, { measureId: 'M8', districtId: 'nura' }, { measureId: 'M9', districtId: 'esil' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }])).toContain('DIRECTION_LIMIT');
    expect(code([{ measureId: 'M1', districtId: 'nura' }, { measureId: 'M3', districtId: 'esil' }, { measureId: 'M9', districtId: 'nura' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }])).toContain('INCOMPATIBLE_MEASURES');
  });

  it('различает конфликт в одном и разных районах', () => {
    const base: Decision[] = [{ measureId: 'M4', districtId: 'esil' }, { measureId: 'M7', districtId: 'esil' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M12' }, { measureId: 'M14' }];
    expect(code(base)).toContain('INCOMPATIBLE_MEASURES');
    expect(code([{ ...base[0], districtId: 'nura' }, ...base.slice(1)])).not.toContain('INCOMPATIBLE_MEASURES');
  });

  it('отклоняет лишние поля, неизвестные ID и устаревшую версию', () => {
    expect(parseScenarioRequest({ ...controlRequest, cost: 0 }).ok).toBe(false);
    expect(validateScenarioRequest({ ...controlRequest, datasetVersion: 'old' })).toMatchObject({ ok: false, status: 409 });
    expect(validateScenarioRequest({ ...controlRequest, decisions: [{ measureId: 'M99' }, ...controlRequest.decisions.slice(1)] })).toMatchObject({ ok: false, status: 422, body: { error: { code: 'UNKNOWN_MEASURE' } } });
    expect(code([{ measureId: 'M12', districtId: 'nura' }, ...controlRequest.decisions.slice(0, 4)])).toContain('DISTRICT_FORBIDDEN');
  });
});
