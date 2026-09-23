import { z } from 'zod';
import type { AnalysisContent, AnalysisInput, ErrorCode } from '@/contracts';
import { toTenge } from '@/lib/budget';
import { validateAndRenderAnalysis } from './validation';

const statement = z.strictObject({ text: z.string().trim().min(1).max(1200), factIds: z.array(z.string()).min(1).max(8) });
const contentSchema = z.strictObject({ summary: statement, strengths: z.array(statement).min(1).max(4), risks: z.array(statement).min(1).max(4), consequences: z.array(statement).min(1).max(4), recommendation: statement });

function openAiResponseFormat(factIds: readonly string[]) {
  const statementSchema = { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, factIds: { type: 'array', items: { type: 'string', enum: factIds } } }, required: ['text', 'factIds'] };
  return { type: 'json_schema', json_schema: { name: 'city_analysis', strict: true, schema: { type: 'object', additionalProperties: false, properties: { summary: statementSchema, strengths: { type: 'array', items: statementSchema }, risks: { type: 'array', items: statementSchema }, consequences: { type: 'array', items: statementSchema }, recommendation: statementSchema }, required: ['summary', 'strengths', 'risks', 'consequences', 'recommendation'] } } };
}

export class AiError extends Error { constructor(public code: ErrorCode, message: string, public status: number) { super(message); } }

export async function analyzeWithProvider(input: AnalysisInput): Promise<{ provider: string; model: string; analysis: AnalysisContent }> {
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || 'gpt-6-sol';
  if (!apiKey) throw new AiError('AI_NOT_CONFIGURED', 'AI-анализ пока не настроен.', 503);
  const base = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const timeout = Number(process.env.AI_TIMEOUT_MS || 30000);
  const url = `${base.replace(/\/$/, '')}/chat/completions`;
  const nvidia = new URL(base).hostname === 'integrate.api.nvidia.com';
  const generationOptions = (model === 'gpt-6-sol' || model === 'gpt-6-luna') && !nvidia
    ? { reasoning_effort: 'none', max_completion_tokens: 2500 }
    : { temperature: 0.2 };
  const system = [
    'Ты аналитик учебного симулятора Астаны. Пиши по-русски.',
    'Верни только JSON с полями summary, strengths, risks, consequences, recommendation.',
    'Каждое утверждение — объект {text,factIds}. strengths/risks/consequences — массивы из 1–4 элементов.',
    'factIds — 1–8 существующих ID из facts, которые подтверждают именно это утверждение.',
    'Для чисел предпочтительно вставляй {{ID_факта}}, например «Score после: {{score-after}}». Сервер подставит значение и единицу: не дублируй единицу после шаблона. Для счётчиков с unit «шт.» сервер подставляет только число: название счётного объекта пиши в предложении. ID шаблона обязательно включай в factIds.',
    'Обычные числа тоже допустимы, но только значения из фактов, указанных в factIds этого утверждения, с правильной единицей. Score можно округлить до двух знаков. Не выводи новые проценты, суммы или прогнозы. Количества пиши цифрами, не словами.',
    'Деньги в facts и selectedMeasures.cost указаны в млрд ₸, это виртуальные ассигнования. Не называй их реальными сметами. Районные суммы уже рассчитаны в budget-<район>, общегородские отдельно в budget-city; не складывай суммы самостоятельно. Используй факты lag для лагов, horizon для горизонта, realized для доли эффекта, before/after/change для показателей.',
    'Не пересчитывай и не меняй Score. Не выдавай модель за реальный прогноз.',
    'Факты effect-<мера>-<район>-<показатель> — вклад выбранной меры в показатель с учётом лага до ограничения шкалой; синергии переданы отдельно. Это не отдельный вклад меры в городской Score: его нельзя получать сложением этих эффектов. Факты district-before/district-change содержат уже рассчитанные баллы района до и их изменение.',
    'Если есть факты critical-<район>-<показатель>, назови оставшиеся критические проблемы в рисках, даже когда change равен нулю. Отсутствие изменения не означает отсутствие проблемы. Используй effect для связи конкретной меры с пользой, а after/change — для фактического итогового изменения с учётом синергий и ограничения шкалы.',
    'Назови в рисках или последствиях конкретный компромисс: выбранное мероприятие, район и его стоимость или лаг относительно ожидаемой пользы.',
    'В рекомендации назови полное название конкретного выбранного мероприятия и район, объясни, что стоит сохранить или изменить, и привяжи совет к фактам о мере, районе и изменённом показателе.',
    'Не предлагай невыбранную меру как проверенное улучшение: её результат не рассчитывался.',
  ].join(' ');
  const factsOnly = { facts: input.facts, selectedMeasures: input.selectedMeasures.map((measure) => ({ id: measure.id, name: measure.name, cost: toTenge(measure.cost) / 1e9, costUnit: 'млрд ₸', lagQuarters: measure.lagQuarters })), disclaimer: input.disclaimer };
  const messages = [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(factsOnly) }];
  // At most one repair, sharing the original request's total time budget.
  const signal = AbortSignal.timeout(Number.isFinite(timeout) ? Math.min(Math.max(timeout, 1000), 60000) : 30000);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, ...generationOptions, ...(nvidia ? {} : { response_format: openAiResponseFormat(input.facts.map((fact) => fact.id)) }), messages }), signal });
    } catch (cause) {
      if (signal.aborted || (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError'))) throw new AiError('AI_TIMEOUT', 'Время ожидания AI истекло.', 504);
      throw new AiError('AI_UNAVAILABLE', 'AI-сервис недоступен.', 503);
    }
    if (response.status === 429) throw new AiError('AI_RATE_LIMITED', 'Лимит AI-запросов исчерпан. Повторите позже.', 429);
    if (!response.ok) throw new AiError('AI_UNAVAILABLE', 'AI-сервис не смог обработать запрос.', 503);
    let raw: unknown;
    try { raw = await response.json(); }
    catch {
      if (signal.aborted) throw new AiError('AI_TIMEOUT', 'Время ожидания AI истекло.', 504);
      throw new AiError('AI_INVALID_RESPONSE', 'AI вернул некорректный ответ. Повторите анализ.', 502);
    }
    const content = (raw as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    let parsed: unknown;
    try { if (typeof content === 'string' && content.length <= 30000) parsed = JSON.parse(content); }
    catch { /* Validation below provides bounded repair feedback. */ }
    const validated = contentSchema.safeParse(parsed);
    const checked = validated.success ? validateAndRenderAnalysis(validated.data, input) : undefined;
    if (checked && checked.issues.length === 0) return { provider: new URL(base).hostname, model, analysis: checked.analysis };
    const issues = checked?.issues ?? (validated.success ? [] : validated.error.issues.map((issue) => ({ path: issue.path.join('.'), code: 'invalid_structure' })));
    // A string survives Next's log serialization. Never log raw reports or keys.
    console.warn(`AI response rejected: ${JSON.stringify({ attempt: attempt + 1, issues })}`);
    if (attempt === 1) {
      const message = !checked ? 'ИИ вернул неполный отчёт.' : checked.issues.some((issue) => issue.code === 'unknown_fact' || issue.code === 'uncited_placeholder')
        ? 'ИИ сослался на факты, которых нет в расчёте или ссылках утверждения.'
        : 'Числа или единицы в ответе ИИ не совпали с указанными фактами расчёта.';
      throw new AiError('AI_INVALID_RESPONSE', `${message} Повторите AI-анализ; расчёт города сохранён.`, 502);
    }
    if (typeof content === 'string' && content.length <= 30000) messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: `Исправь отчёт целиком: ${JSON.stringify(issues)}. Используй только переданные facts. Для неподтверждённых чисел подставь {{ID_факта}} с правильной ссылкой или убери утверждение. Не меняй расчёт. Верни полный JSON по исходной схеме.` });
  }
  throw new AiError('AI_INVALID_RESPONSE', 'Не удалось проверить AI-анализ.', 502);
}
