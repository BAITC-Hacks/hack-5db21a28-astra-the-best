import { NextRequest, NextResponse } from 'next/server';
import { scenario } from '@/data';
import { validateScenarioRequest } from '@/domain/validation';
import { simulate } from '@/domain/simulation';
import { buildAnalysisInput } from '@/server/ai/facts';
import { AiError, analyzeWithProvider } from '@/server/ai/provider';
import type { ErrorCode, ErrorResponse } from '@/contracts';

const MAX_BYTES = 16 * 1024;
const attempts = new Map<string, { count: number; resetAt: number }>();

function error(status: number, code: ErrorCode, message: string) {
  const body: ErrorResponse = { error: { code, message, issues: [{ code, message }] } };
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error(400, 'INVALID_FORMAT', 'Ожидается JSON-запрос.');
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) return error(413, 'REQUEST_TOO_LARGE', 'Размер запроса превышает 16 КиБ.');
  let text: string;
  try { text = await request.text(); }
  catch { return error(400, 'INVALID_JSON', 'Не удалось прочитать JSON-запрос.'); }
  if (new TextEncoder().encode(text).length > MAX_BYTES) return error(413, 'REQUEST_TOO_LARGE', 'Размер запроса превышает 16 КиБ.');
  let input: unknown;
  try { input = JSON.parse(text); }
  catch { return error(400, 'INVALID_JSON', 'Невалидный JSON.'); }
  const validated = validateScenarioRequest(input, scenario);
  if (!validated.ok) return NextResponse.json(validated.body, { status: validated.status });

  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const now = Date.now();
  const limit = Math.max(1, Number(process.env.AI_MAX_REQUESTS_PER_MINUTE || 10));
  const current = attempts.get(client);
  if (current && current.resetAt > now && current.count >= limit) return NextResponse.json({ error: { code: 'AI_RATE_LIMITED', message: 'Слишком много AI-запросов. Повторите через минуту.', issues: [{ code: 'AI_RATE_LIMITED', message: 'Слишком много AI-запросов. Повторите через минуту.' }] } }, { status: 429, headers: { 'Retry-After': String(Math.ceil((current.resetAt - now) / 1000)) } });
  attempts.set(client, current && current.resetAt > now ? { ...current, count: current.count + 1 } : { count: 1, resetAt: now + 60000 });

  try {
    const result = simulate(validated.request, scenario);
    const analysisInput = buildAnalysisInput(result, scenario);
    const generated = await analyzeWithProvider(analysisInput);
    return NextResponse.json({ datasetVersion: result.datasetVersion, scenarioId: result.scenarioId, ...generated, facts: analysisInput.facts }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof AiError) return error(cause.status, cause.code, cause.message);
    return error(500, 'INTERNAL_ERROR', 'Не удалось выполнить AI-анализ.');
  }
}
