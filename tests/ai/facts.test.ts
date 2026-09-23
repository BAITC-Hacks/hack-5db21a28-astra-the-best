import { describe, expect, it } from 'vitest';
import type { ScenarioRequest } from '@/contracts';
import { scenario } from '@/data';
import { simulate } from '@/domain/simulation';
import { buildAnalysisInput } from '@/server/ai/facts';
import { controlRequest } from '../data/source-fixture';

const untouchedSocial: ScenarioRequest = {
  datasetVersion: scenario.datasetVersion,
  decisions: [
    { measureId: 'M1', districtId: 'esil' },
    { measureId: 'M2' },
    { measureId: 'M4', districtId: 'esil' },
    { measureId: 'M10', districtId: 'esil' },
    { measureId: 'M12' },
  ],
};

describe('полнота фактов для объяснения AI', () => {
  it('сохраняет обе критические соцпроблемы Нуры, даже если меры их не меняют', () => {
    const { facts } = buildAnalysisInput(simulate(untouchedSocial), scenario);
    for (const [indicatorId, value] of [['S1', 38], ['S2', 35]] as const) {
      expect(facts.find((fact) => fact.id === `critical-nura-${indicatorId}`)).toMatchObject({ value, districtId: 'nura', indicatorId });
      expect(facts.find((fact) => fact.id === `before-nura-${indicatorId}`)?.value).toBe(value);
      expect(facts.find((fact) => fact.id === `after-nura-${indicatorId}`)?.value).toBe(value);
      expect(facts.find((fact) => fact.id === `change-nura-${indicatorId}`)?.value).toBe(0);
    }
    expect(facts.filter((fact) => fact.id.startsWith('critical-nura-'))).toHaveLength(2);
  });

  it('передаёт реализованный вклад школы с учётом лага, а не полный эффект', () => {
    const { facts } = buildAnalysisInput(simulate(controlRequest), scenario);
    expect(facts.find((fact) => fact.id === 'effect-M7-nura-S1')).toMatchObject({ value: 10, measureId: 'M7', districtId: 'nura', indicatorId: 'S1', unit: 'балла' });
    expect(facts.find((fact) => fact.id === 'lag-M7')?.value).toBe(3);
    expect(facts.find((fact) => fact.id === 'realized-M7')?.value).toBe(62.5);
  });

  it('покрывает эффект городской меры во всех районах без дублирования ID', () => {
    const { facts } = buildAnalysisInput(simulate(untouchedSocial), scenario);
    const cityEffects = facts.filter((fact) => fact.id.startsWith('effect-M2-'));
    expect(cityEffects).toHaveLength(10);
    expect(new Set(cityEffects.map((fact) => fact.districtId))).toEqual(new Set(scenario.districts.map((district) => district.id)));
    for (const district of scenario.districts) {
      expect(facts.find((fact) => fact.id === `effect-M2-${district.id}-T1`)?.value).toBe(3);
      expect(facts.find((fact) => fact.id === `effect-M2-${district.id}-B2`)?.value).toBe(2.25);
    }
    expect(new Set(facts.map((fact) => fact.id)).size).toBe(facts.length);
  });

  it('передаёт исходный и итоговый балл района и рассчитанную разницу', () => {
    const { facts } = buildAnalysisInput(simulate(controlRequest), scenario);
    expect(facts.find((fact) => fact.id === 'district-before-nura')?.value).toBeCloseTo(49.18, 8);
    // 10*.11 + 8.75*.11 + (10.5+2)*.09 + 1.75*.09 + 4.375*.10.
    expect(facts.find((fact) => fact.id === 'district-nura')?.value).toBeCloseTo(52.9625, 8);
    expect(facts.find((fact) => fact.id === 'district-change-nura')?.value).toBeCloseTo(3.7825, 8);
    expect(facts.find((fact) => fact.id === 'score-after')?.value).toBeCloseTo(56.54307, 8);
    expect(facts.some((fact) => fact.id.startsWith('critical-nura-'))).toBe(false);
  });

  it('различает вклад меры до ограничения шкалы и итоговую дельту', () => {
    const clippedScenario = { ...scenario, districts: scenario.districts.map((district) => district.id === 'nura' ? { ...district, indicators: { ...district.indicators, S1: 98 } } : district) };
    const { facts } = buildAnalysisInput(simulate(controlRequest, clippedScenario), clippedScenario);
    expect(facts.find((fact) => fact.id === 'effect-M7-nura-S1')?.value).toBe(10);
    expect(facts.find((fact) => fact.id === 'change-nura-S1')?.value).toBe(2);
    expect(facts.find((fact) => fact.id === 'after-nura-S1')?.value).toBe(100);
  });
});
