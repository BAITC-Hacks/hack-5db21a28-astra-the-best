import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DIRECTION_IDS, DISTRICT_IDS, INDICATOR_IDS, MEASURE_IDS } from '@/contracts';
import { scenario, datasetVersion, datasetHash } from '@/data';
import { canonicalData } from '@/data/canonical';
import { sourceDistrictRows, sourceMeasureRows } from './source-fixture';

describe('Канонические данные S2', () => {
  it('содержат точный набор и порядок стабильных ID', () => {
    expect(scenario.districts.map(district => district.id)).toEqual(DISTRICT_IDS);
    expect(scenario.indicators.map(indicator => indicator.id)).toEqual(INDICATOR_IDS);
    expect(scenario.directions.map(direction => direction.id)).toEqual(DIRECTION_IDS);
    expect(scenario.measures.map(measure => measure.id)).toEqual(MEASURE_IDS);
    expect(new Set(scenario.measures.map(measure => measure.id)).size).toBe(14);
  });

  it.each(sourceDistrictRows)('район %s совпадает с исходной строкой', (districtId, population, ...values) => {
    const district = scenario.districts.find(item => item.id === districtId)!;
    expect(district.populationShare).toBe(population);
    expect(INDICATOR_IDS.map(indicatorId => district.indicators[indicatorId])).toEqual(values.slice(0, 10));
    const score = scenario.indicators.reduce((sum, indicator) => sum + indicator.weight * district.indicators[indicator.id], 0);
    expect(score).toBeCloseTo(Number(values[10]), 8);
  });

  it.each(sourceMeasureRows)('мера %s совпадает с исходной строкой', (id, directionId, scope, cost, lagQuarters, effects) => {
    expect(scenario.measures.find(measure => measure.id === id)).toMatchObject({ id, directionId, scope, cost, lagQuarters, effects });
    expect(scenario.measures.find(measure => measure.id === id)!.effects).toEqual(effects);
  });

  it('суммы долей и весов равны единице, показатели и эффекты допустимы', () => {
    expect(scenario.districts.reduce((sum, district) => sum + district.populationShare, 0)).toBeCloseTo(1, 12);
    expect(scenario.indicators.map(indicator => indicator.weight)).toEqual([.10, .10, .09, .11, .11, .11, .09, .09, .10, .10]);
    expect(scenario.indicators.reduce((sum, indicator) => sum + indicator.weight, 0)).toBeCloseTo(1, 12);
    for (const district of scenario.districts) {
      expect(Object.keys(district.indicators)).toEqual(INDICATOR_IDS);
      for (const value of Object.values(district.indicators)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
    for (const measure of scenario.measures) {
      expect(Number.isInteger(measure.cost) && measure.cost > 0).toBe(true);
      expect(Number.isInteger(measure.lagQuarters)).toBe(true);
      expect(measure.lagQuarters).toBeGreaterThanOrEqual(0);
      expect(measure.lagQuarters).toBeLessThanOrEqual(scenario.horizonQuarters);
      for (const [indicatorId, value] of Object.entries(measure.effects)) {
        expect(INDICATOR_IDS).toContain(indicatorId);
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('содержит все точные синергии и несовместимости', () => {
    expect(scenario.rules.synergies.map(({ measureIds, targetMeasureId, effects }) => [measureIds, targetMeasureId, effects])).toEqual([
      [['M1', 'M2'], 'M1', { T1: 2 }], [['M10', 'M12'], 'M10', { B1: 2 }], [['M5', 'M6'], 'M5', { E2: 2 }],
    ]);
    expect(scenario.rules.conflicts.map(({ measureIds, scope }) => [measureIds, scope])).toEqual([
      [['M1', 'M3'], 'anywhere'], [['M4', 'M7'], 'same-district'], [['M5', 'M13'], 'same-district'],
    ]);
  });

  it('фиксирует содержимое hash и защищает базу от мутаций', () => {
    expect(datasetVersion).toBe('astana-s2-v1');
    expect(datasetHash).toBe(createHash('sha256').update(JSON.stringify(canonicalData)).digest('hex'));
    expect(scenario.datasetHash).toBe(datasetHash);
    expect(Object.isFrozen(scenario)).toBe(true);
    expect(Object.isFrozen(scenario.districts[0].indicators)).toBe(true);
    expect(Object.isFrozen(scenario.measures[0].effects)).toBe(true);
    expect(() => Reflect.set(scenario.districts[0].indicators, 'T1', 99)).not.toThrow();
    expect(scenario.districts[0].indicators.T1).toBe(45);
  });
});
