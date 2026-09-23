import { z } from 'zod';
import type { AnalyzeResponse, ScenarioResponse, SimulationResponse } from '@/contracts';
import { simulate } from '@/domain/simulation';
import { validateScenarioRequest } from '@/domain/validation';

export interface OptimizerResult {
  datasetVersion: string;
  datasetHash: string;
  method: 'exhaustive';
  checkedCandidates: number;
  simulation: SimulationResponse;
}

const candidateSchema = z.object({
  datasetVersion: z.string(), datasetHash: z.string(), method: z.literal('exhaustive'),
  checkedCandidates: z.number().int().positive().safe(),
  simulation: z.object({
    datasetVersion: z.string(), scenarioId: z.string(), decisions: z.unknown(),
    cost: z.number(), remainingBudget: z.number(), result: z.object({ score: z.number() }),
  }),
});

export function readCandidate(body: unknown, scenario: ScenarioResponse): OptimizerResult {
  const parsed = candidateSchema.safeParse(body);
  if (!parsed.success || parsed.data.datasetVersion !== scenario.datasetVersion || parsed.data.datasetHash !== scenario.datasetHash) {
    throw new Error('Данные поиска не совпали с текущей моделью. Повторите поиск.');
  }
  const candidate = parsed.data;
  const validated = validateScenarioRequest({ datasetVersion: candidate.simulation.datasetVersion, decisions: candidate.simulation.decisions }, scenario);
  if (!validated.ok) throw new Error('Найденный план не прошёл проверку правил. Повторите поиск.');
  // Recompute the displayed values from the current data, never from stale server totals.
  const simulation = simulate(validated.request, scenario);
  if (simulation.scenarioId !== candidate.simulation.scenarioId || simulation.cost !== candidate.simulation.cost || simulation.remainingBudget !== candidate.simulation.remainingBudget || Math.abs(simulation.result.score - candidate.simulation.result.score) > 1e-9) {
    throw new Error('Числа найденного плана не совпали с расчётом. Повторите поиск.');
  }
  return { ...candidate, simulation };
}

const statement = z.object({ text: z.string().min(1), factIds: z.array(z.string()) });
const analysisSchema = z.object({
  datasetVersion: z.string(), scenarioId: z.string(), provider: z.string(), model: z.string(),
  analysis: z.object({ summary: statement, strengths: z.array(statement), risks: z.array(statement), consequences: z.array(statement), recommendation: statement }),
  facts: z.array(z.object({ id: z.string(), label: z.string(), value: z.union([z.string(), z.number()]), unit: z.string() })),
});

export function readAnalysis(body: unknown, simulation: SimulationResponse): AnalyzeResponse {
  const parsed = analysisSchema.safeParse(body);
  if (!parsed.success || parsed.data.datasetVersion !== simulation.datasetVersion || parsed.data.scenarioId !== simulation.scenarioId) {
    throw new Error('Ответ ИИ не совпал с найденным планом. Повторите объяснение.');
  }
  const { analysis, facts } = parsed.data;
  const knownFacts = new Set(facts.map((fact) => fact.id));
  if ([analysis.summary, ...analysis.strengths, ...analysis.risks, ...analysis.consequences, analysis.recommendation].some((item) => item.factIds.some((id) => !knownFacts.has(id)))) {
    throw new Error('В объяснении ИИ не удалось проверить ссылки на расчёт. Повторите объяснение.');
  }
  return parsed.data;
}

export async function postJson(url: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const data: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ message: z.string().min(1) }) }).safeParse(data);
    throw new Error(parsed.success ? parsed.data.error.message : 'Не удалось получить ответ. Попробуйте ещё раз.');
  }
  return data;
}
