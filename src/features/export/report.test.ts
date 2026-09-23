import { describe, expect, it } from 'vitest';
import { scenario } from '@/data';
import { simulate } from '@/domain/simulation';
import { buildAnalysisInput } from '@/server/ai/facts';
import type { AnalysisState, ScenarioRequest } from '@/contracts';
import { buildReportHtml, buildReportJson, prepareReport } from './report';

const request: ScenarioRequest = { datasetVersion: scenario.datasetVersion, decisions: [{ measureId: 'M7', districtId: 'nura' }, { measureId: 'M8', districtId: 'nura' }, { measureId: 'M10', districtId: 'nura' }, { measureId: 'M5', districtId: 'saryarka' }, { measureId: 'M12' }] };
const simulation = simulate(request);
const statement = { text: 'Меры улучшили условия выбранного района.', factIds: ['score-delta'] };
const analysis: AnalysisState = { status: 'success', response: { datasetVersion: scenario.datasetVersion, scenarioId: simulation.scenarioId, provider: 'fixture', model: 'fixture', analysis: { summary: statement, strengths: [statement], risks: [statement], consequences: [statement], recommendation: statement }, facts: buildAnalysisInput(simulation, scenario).facts } };
const input = { scenario, simulation, analysis };

describe('portable report', () => {
  it('exports the exact valid control scenario and all five district results', () => {
    const json = JSON.parse(buildReportJson(input));
    expect(json.simulation.result.score).toBeCloseTo(56.54307, 8);
    expect(json.simulation.cost).toBe(95);
    expect(json.money).toEqual({ currency: 'KZT', tengePerBudgetUnit: 100_000_000, budgetTenge: 10_000_000_000, spentTenge: 9_500_000_000, remainingTenge: 500_000_000 });
    expect(json.decisions.find((item: { measureId: string }) => item.measureId === 'M7').costTenge).toBe(2_400_000_000);
    expect(buildReportHtml(input)).toContain('9,5 млрд ₸ / 10 млрд ₸');
    expect(buildReportHtml(input)).toContain('500 млн ₸');
    expect(json.decisions).toHaveLength(5);
    expect(json.simulation.result.districts).toHaveLength(5);
    expect(json.simulation).toEqual(simulation);
    expect(json.analysis.scenarioId).toBe(simulation.scenarioId);
    expect(buildReportHtml(input)).toContain(String(simulation.result.score));
    expect(buildReportHtml(input)).toContain('Синтетическая учебная модель');
  });
  it('rejects stale, invalid or tampered simulation results', () => {
    expect(() => prepareReport({ ...input, simulation: { ...simulation, datasetVersion: 'old' } })).toThrow();
    expect(() => prepareReport({ ...input, simulation: { ...simulation, decisions: simulation.decisions.slice(0, 4) } })).toThrow();
    expect(() => prepareReport({ ...input, simulation: { ...simulation, result: { ...simulation.result, score: 100 } } })).toThrow();
  });
  it('omits stale AI and facts that disagree with deterministic calculation', () => {
    if (analysis.status !== 'success') throw new Error('fixture');
    const response = analysis.response;
    expect(prepareReport({ ...input, analysis: { status: 'success', response: { ...response, scenarioId: 'other' } } }).analysis).toBeNull();
    expect(prepareReport({ ...input, analysis: { status: 'success', response: { ...response, facts: response.facts.map((fact) => fact.id === 'score-after' ? { ...fact, value: 100 } : fact) } } }).analysis).toBeNull();
    expect(prepareReport({ ...input, analysis: { status: 'success', response: { ...response, analysis: { ...response.analysis, summary: { ...statement, factIds: ['invented'] } } } } }).analysis).toBeNull();
  });
  it('escapes provider text and has no executable or external resources', () => {
    if (analysis.status !== 'success') throw new Error('fixture');
    const html = buildReportHtml({ ...input, analysis: { status: 'success', response: { ...analysis.response, analysis: { ...analysis.response.analysis, summary: { ...statement, text: '<script>alert("x")</script><img src=x onerror=alert(1)>' } } } } });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/<script|<img|<link|<iframe/);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('@media print');
  });
  it('labels absent or loading AI explicitly and makes no AI request', () => {
    const html = buildReportHtml({ ...input, analysis: { status: 'loading', scenarioId: simulation.scenarioId } });
    expect(html).toContain('Проверенный AI-анализ для этого сценария отсутствует');
  });
});
