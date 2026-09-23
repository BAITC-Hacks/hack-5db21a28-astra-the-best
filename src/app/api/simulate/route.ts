import { NextRequest, NextResponse } from 'next/server';
import { scenario } from '@/data';
import { validateScenarioRequest } from '@/domain/validation';
import { simulate } from '@/domain/simulation';
import type { ErrorCode, ErrorResponse } from '@/contracts';

const MAX_BYTES = 16 * 1024;

function error(status: number, code: ErrorCode, message: string) {
  const body: ErrorResponse = { error: { code, message, issues: [{ code, message }] } };
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error(400, 'INVALID_FORMAT', 'Ожидается JSON-запрос.');
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) return error(413, 'REQUEST_TOO_LARGE', 'Размер запроса превышает 16 КиБ.');
  let raw: string;
  try { raw = await request.text(); }
  catch { return error(400, 'INVALID_JSON', 'Не удалось прочитать JSON-запрос.'); }
  if (new TextEncoder().encode(raw).length > MAX_BYTES) return error(413, 'REQUEST_TOO_LARGE', 'Размер запроса превышает 16 КиБ.');
  let input: unknown;
  try { input = JSON.parse(raw); }
  catch { return error(400, 'INVALID_JSON', 'Невалидный JSON.'); }
  const validated = validateScenarioRequest(input, scenario);
  if (!validated.ok) return NextResponse.json(validated.body, { status: validated.status });
  try { return NextResponse.json(simulate(validated.request, scenario), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return error(500, 'INTERNAL_ERROR', 'Не удалось рассчитать сценарий.'); }
}
