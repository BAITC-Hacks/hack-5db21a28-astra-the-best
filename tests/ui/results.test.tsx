import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { scenario } from '@/data';
import type { AnalysisState, SimulationResponse } from '@/contracts';
import { ReportView } from '@/features/results/ReportView';

const baselineDistricts = scenario.districts.map((district) => ({ districtId: district.id, indicators: district.indicators, score: 50 }));
const baseline = {
  districts: baselineDistricts,
  weightedAverage: 50,
  minimumDistrictScore: 50,
  weakestDistrictIds: ['nura' as const],
  criticalIndicators: [],
  criticalCount: 0,
  score: 50,
};
const simulation: SimulationResponse = {
  datasetVersion: scenario.datasetVersion,
  scenarioId: 'current-scenario',
  decisions: [{ measureId: 'M1', districtId: 'esil' }, { measureId: 'M4', districtId: 'nura' }, { measureId: 'M7', districtId: 'nura' }, { measureId: 'M10', districtId: 'saryarka' }, { measureId: 'M12' }],
  cost: 83,
  remainingBudget: 17,
  baseline,
  result: { ...baseline, score: 55, weightedAverage: 55, minimumDistrictScore: 55, criticalIndicators: [{ districtId: 'nura', indicatorId: 'S2', value: 35 }], criticalCount: 1 },
  scoreDelta: 5,
  ledger: { measures: [{ measureId: 'M1', districtId: 'esil', indicatorId: 'T1', fullEffect: 6, lagQuarters: 2, realizedFraction: 1, realizedEffect: 6 }], synergies: [], indicators: [] },
};
const render = (analysis: AnalysisState, result: SimulationResponse | null = simulation) => renderToStaticMarkup(<ReportView scenario={scenario} simulation={result} analysis={analysis} onAnalyze={() => {}} onRetryAnalysis={() => {}} />);

describe('ReportView', () => {
  it('shows score, budget, all districts and measure effects on one page', () => {
    const html = render({ status: 'idle' });
    expect(html).toContain('55,00');
    expect(html).toContain('83,00 / 100,00');
    for (const district of scenario.districts) expect(html).toContain(district.name);
    expect(html).toContain('Критические значения');
    expect(html).toContain('Учтено за 8 кв.');
  });

  it('keeps numerical results visible when AI fails', () => {
    const html = render({ status: 'error', scenarioId: simulation.scenarioId, error: { error: { code: 'AI_UNAVAILABLE', message: 'AI временно недоступен', issues: [] } } });
    expect(html).toContain('55,00');
    expect(html).toContain('AI временно недоступен');
    expect(html).toContain('Повторить AI-анализ');
  });

  it('does not display analysis from another scenario', () => {
    const html = render({ status: 'success', response: { datasetVersion: scenario.datasetVersion, scenarioId: 'old-scenario', provider: 'test', model: 'test', facts: [], analysis: { summary: { text: 'OLD ANALYSIS', factIds: [] }, strengths: [], risks: [], consequences: [], recommendation: { text: 'OLD ADVICE', factIds: [] } } } });
    expect(html).not.toContain('OLD ANALYSIS');
    expect(html).toContain('Получить AI-анализ');
  });

  it('hides stale numerical results when the dataset version changes', () => {
    const html = render({ status: 'idle' }, { ...simulation, datasetVersion: 'old-version' });
    expect(html).toContain('Отчёт появится после расчёта');
    expect(html).not.toContain('55,00');
  });
});
