import { z } from 'zod';
import type { AnalysisContent, AnalysisInput, ErrorCode } from '@/contracts';

const statement = z.strictObject({ text: z.string().min(1).max(1200), factIds: z.array(z.string()).min(1).max(8) });
const contentSchema = z.strictObject({ summary: statement, strengths: z.array(statement).min(1).max(4), risks: z.array(statement).min(1).max(4), consequences: z.array(statement).min(1).max(4), recommendation: statement });

export class AiError extends Error { constructor(public code: ErrorCode, message: string, public status: number) { super(message); } }

export async function analyzeWithProvider(input: AnalysisInput): Promise<{ provider: string; model: string; analysis: AnalysisContent }> {
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || 'gpt-4.1-mini';
  if (!apiKey) throw new AiError('AI_NOT_CONFIGURED', 'AI-анализ пока не настроен.', 503);
  const base = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const timeout = Number(process.env.AI_TIMEOUT_MS || 30000);
  const url = `${base.replace(/\/$/, '')}/chat/completions`;
  const nvidia = new URL(base).hostname === 'integrate.api.nvidia.com';
  const system = [
    'Ты аналитик учебного симулятора Астаны. Пиши по-русски.',
    'Верни только JSON с полями summary, strengths, risks, consequences, recommendation.',
    'Каждое утверждение — объект {text,factIds}. strengths/risks/consequences — массивы из 1–4 элементов.',
    'factIds — 1–8 существующих ID из facts. Не пиши числовые литералы в text: все числа UI выведет из facts.',
    'Не пересчитывай и не меняй Score. Не выдавай модель за реальный прогноз.',
    'Назови в рисках или последствиях конкретный компромисс: выбранное мероприятие, район и его стоимость или лаг относительно ожидаемой пользы.',
    'В рекомендации назови конкретное выбранное мероприятие и район, объясни, что стоит сохранить или изменить, и привяжи совет к фактам о мере, районе и изменённом показателе.',
    'Не предлагай невыбранную меру как проверенное улучшение: её результат не рассчитывался.',
  ].join(' ');
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, temperature: 0.2, ...(nvidia ? {} : { response_format: { type: 'json_object' } }), messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] }), signal: AbortSignal.timeout(Number.isFinite(timeout) ? Math.min(Math.max(timeout, 1000), 60000) : 30000) });
  } catch (cause) {
    if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) throw new AiError('AI_TIMEOUT', 'Время ожидания AI истекло.', 504);
    throw new AiError('AI_UNAVAILABLE', 'AI-сервис недоступен.', 503);
  }
  if (response.status === 429) throw new AiError('AI_RATE_LIMITED', 'Лимит AI-запросов исчерпан. Повторите позже.', 429);
  if (!response.ok) throw new AiError('AI_UNAVAILABLE', 'AI-сервис не смог обработать запрос.', 503);
  let raw: unknown;
  try { raw = await response.json(); }
  catch { throw new AiError('AI_INVALID_RESPONSE', 'AI вернул некорректный ответ.', 502); }
  const content = (raw as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  let parsed: unknown;
  try { if (typeof content !== 'string') throw new Error(); parsed = JSON.parse(content); }
  catch { throw new AiError('AI_INVALID_RESPONSE', 'AI вернул некорректный ответ.', 502); }
  const validated = contentSchema.safeParse(parsed);
  if (!validated.success) throw new AiError('AI_INVALID_RESPONSE', 'AI вернул неполный анализ.', 502);
  const all = [validated.data.summary, ...validated.data.strengths, ...validated.data.risks, ...validated.data.consequences, validated.data.recommendation];
  const factIds = new Set(input.facts.map((fact) => fact.id));
  if (all.some((item) => /\d/.test(item.text) || item.factIds.some((id) => !factIds.has(id)))) throw new AiError('AI_INVALID_RESPONSE', 'AI-анализ не прошёл проверку фактов.', 502);
  return { provider: new URL(base).hostname, model, analysis: validated.data };
}
