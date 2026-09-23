import { z } from 'zod';
import { scenario as defaultScenario } from '@/data';
import type { ApiIssue, Decision, ErrorResponse, ScenarioRequest, ScenarioResponse, ValidationResult } from '@/contracts';

const requestSchema = z.strictObject({
  datasetVersion: z.string(),
  decisions: z.array(z.strictObject({ measureId: z.string(), districtId: z.string().optional() })),
});

type RequestResult = { ok: true; request: ScenarioRequest } | { ok: false; status: number; body: ErrorResponse };

function failure(status: number, issues: ApiIssue[]): RequestResult {
  return { ok: false, status, body: { error: { code: issues[0].code, message: issues[0].message, issues } } };
}

export function parseScenarioRequest(input: unknown): RequestResult {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return failure(400, [{ code: 'INVALID_FORMAT', message: 'Неверный формат запроса: разрешены только datasetVersion и массив решений с measureId и districtId.', path: parsed.error.issues[0]?.path.join('.') }]);
  return { ok: true, request: parsed.data as ScenarioRequest };
}

export function validateDecisions(decisions: readonly Decision[], { mode, scenario = defaultScenario }: { mode: 'draft' | 'final'; scenario?: ScenarioResponse }): ValidationResult {
  const issues: ApiIssue[] = [];
  const measures = new Map(scenario.measures.map((measure) => [measure.id, measure]));
  const districts = new Set(scenario.districts.map((district) => district.id));
  const counts = Object.fromEntries(scenario.directions.map((direction) => [direction.id, 0])) as Record<typeof scenario.directions[number]['id'], number>;
  const seen = new Set<string>();
  let cost = 0;
  if ((mode === 'final' && decisions.length !== scenario.rules.requiredDecisions) || (mode === 'draft' && decisions.length > scenario.rules.requiredDecisions)) issues.push({ code: 'DECISION_COUNT', message: `Нужно выбрать ровно ${scenario.rules.requiredDecisions} решений.` });
  for (const decision of decisions) {
    const measure = measures.get(decision.measureId);
    if (!measure) { issues.push({ code: 'UNKNOWN_MEASURE', message: `Неизвестная мера ${decision.measureId}.`, measureIds: [decision.measureId] }); continue; }
    if (seen.has(decision.measureId)) issues.push({ code: 'DUPLICATE_MEASURE', message: `Мера ${decision.measureId} выбрана повторно.`, measureIds: [decision.measureId] });
    seen.add(decision.measureId);
    cost += measure.cost;
    counts[measure.directionId]++;
    if (measure.scope === 'district' && !decision.districtId) issues.push({ code: 'DISTRICT_REQUIRED', message: `Для меры ${decision.measureId} выберите район.`, measureIds: [decision.measureId] });
    if (measure.scope === 'city' && decision.districtId) issues.push({ code: 'DISTRICT_FORBIDDEN', message: `Городской мере ${decision.measureId} район не нужен.`, measureIds: [decision.measureId], districtId: decision.districtId });
    if (decision.districtId && !districts.has(decision.districtId)) issues.push({ code: 'UNKNOWN_DISTRICT', message: `Неизвестный район ${decision.districtId}.`, measureIds: [decision.measureId], districtId: decision.districtId });
  }
  if (cost > scenario.budget) issues.push({ code: 'BUDGET_EXCEEDED', message: `Бюджет превышен на ${cost - scenario.budget} единиц.` });
  for (const direction of scenario.directions) if (counts[direction.id] > scenario.rules.maxPerDirection) issues.push({ code: 'DIRECTION_LIMIT', message: `Не более ${scenario.rules.maxPerDirection} мер направления «${direction.name}».` });
  for (const conflict of scenario.rules.conflicts) {
    const first = decisions.find((decision) => decision.measureId === conflict.measureIds[0]);
    const second = decisions.find((decision) => decision.measureId === conflict.measureIds[1]);
    if (first && second && (conflict.scope === 'anywhere' || first.districtId === second.districtId)) issues.push({ code: 'INCOMPATIBLE_MEASURES', message: conflict.message, measureIds: conflict.measureIds, districtId: conflict.scope === 'same-district' ? first.districtId : undefined });
  }
  return { valid: issues.length === 0, complete: decisions.length === scenario.rules.requiredDecisions, cost, remainingBudget: scenario.budget - cost, directionCounts: counts, issues };
}

export function validateScenarioRequest(input: unknown, scenario: ScenarioResponse = defaultScenario): RequestResult {
  const parsed = parseScenarioRequest(input);
  if (!parsed.ok) return parsed;
  if (parsed.request.datasetVersion !== scenario.datasetVersion) return failure(409, [{ code: 'DATASET_VERSION_MISMATCH', message: 'Версия данных изменилась. Обновите сценарий.' }]);
  const idIssues: ApiIssue[] = [];
  for (const decision of parsed.request.decisions) {
    if (!scenario.measures.some((measure) => measure.id === decision.measureId)) idIssues.push({ code: 'UNKNOWN_MEASURE', message: `Неизвестная мера ${decision.measureId}.`, measureIds: [decision.measureId] });
    if (decision.districtId && !scenario.districts.some((district) => district.id === decision.districtId)) idIssues.push({ code: 'UNKNOWN_DISTRICT', message: `Неизвестный район ${decision.districtId}.`, districtId: decision.districtId });
  }
  if (idIssues.length) return failure(422, idIssues);
  const validation = validateDecisions(parsed.request.decisions, { mode: 'final', scenario });
  if (!validation.valid) return failure(422, [...validation.issues]);
  return parsed;
}
