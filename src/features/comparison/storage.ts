import { z } from 'zod';
import type { Decision, ScenarioRequest, ScenarioResponse } from '@/contracts';
import { scenarioId } from '@/domain/simulation';
import { validateScenarioRequest } from '@/domain/validation';

export const COMPARISON_STORAGE_KEY = 'hackalem:scenarios:v1';
export const MAX_SAVED_SCENARIOS = 6;
export interface SavedScenario {
  readonly name: string;
  readonly savedAt: string;
  readonly datasetHash: string;
  readonly request: ScenarioRequest;
}
export type ScenarioStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface SavedCollection {
  readonly entries: readonly SavedScenario[];
  readonly warning: string | null;
}
const itemSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  savedAt: z.iso.datetime(),
  datasetHash: z.string(),
  request: z.unknown(),
});

export function readSavedScenarios(storage: ScenarioStorage, scenario: ScenarioResponse): SavedCollection {
  try {
    const text = storage.getItem(COMPARISON_STORAGE_KEY);
    if (!text) return { entries: [], warning: null };
    if (text.length > 100_000) throw new Error('Storage exceeds limit');
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data) || data.length > MAX_SAVED_SCENARIOS) throw new Error('Invalid collection');
    const entries: SavedScenario[] = [];
    const ids = new Set<string>();
    for (const value of data) {
      const item = itemSchema.safeParse(value);
      if (!item.success || item.data.datasetHash !== scenario.datasetHash) continue;
      const request = validateScenarioRequest(item.data.request, scenario);
      if (!request.ok) continue;
      const id = scenarioId(request.request);
      if (ids.has(id)) continue;
      ids.add(id);
      entries.push({ ...item.data, request: request.request });
    }
    return { entries, warning: entries.length !== data.length ? 'Некоторые сохранения устарели или повреждены и не участвуют в сравнении.' : null };
  } catch {
    return { entries: [], warning: 'Не удалось прочитать сохранения браузера. Текущий расчёт доступен.' };
  }
}

export function saveScenario(storage: ScenarioStorage, scenario: ScenarioResponse, decisions: readonly Decision[], name: string): SavedCollection {
  const parsed = validateScenarioRequest({ datasetVersion: scenario.datasetVersion, decisions }, scenario);
  if (!parsed.ok) throw new Error(parsed.body.error.message);
  const current = readSavedScenarios(storage, scenario);
  const id = scenarioId(parsed.request);
  const existing = current.entries.findIndex((entry) => scenarioId(entry.request) === id);
  if (existing < 0 && current.entries.length >= MAX_SAVED_SCENARIOS) throw new Error('Сохранено шесть сценариев. Удалите один, чтобы добавить новый.');
  const entry: SavedScenario = {
    name: name.trim().slice(0, 60) || `Сценарий ${existing < 0 ? current.entries.length + 1 : existing + 1}`,
    savedAt: new Date().toISOString(), datasetHash: scenario.datasetHash, request: parsed.request,
  };
  const entries = existing < 0 ? [...current.entries, entry] : current.entries.map((item, index) => index === existing ? entry : item);
  try { storage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(entries)); }
  catch { throw new Error('Браузер не разрешил сохранение. Расчёт остаётся на экране.'); }
  return { entries, warning: current.warning };
}

export function deleteSavedScenario(storage: ScenarioStorage, scenario: ScenarioResponse, id: string): SavedCollection {
  const current = readSavedScenarios(storage, scenario);
  const entries = current.entries.filter((entry) => scenarioId(entry.request) !== id);
  try { storage.setItem(COMPARISON_STORAGE_KEY, JSON.stringify(entries)); }
  catch { throw new Error('Не удалось удалить сохранение. Попробуйте ещё раз.'); }
  return { entries, warning: current.warning };
}
