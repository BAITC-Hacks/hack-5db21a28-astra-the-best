import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scenario } from '@/data';
import { optimizeScenario, type OptimizationResult } from '@/domain/search/optimize';
import type { ErrorCode, ErrorResponse } from '@/contracts';

export const runtime = 'nodejs';

const MAX_BYTES = 1024;
const inputSchema = z.strictObject({ datasetVersion: z.string(), datasetHash: z.string() });
let cached: { key: string; result: Promise<OptimizationResult> } | undefined;

function error(status: number, code: ErrorCode, message: string) {
  const body: ErrorResponse = { error: { code, message, issues: [{ code, message }] } };
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// The optimum depends only on the canonical dataset, never on a user's draft.
// Concurrent visitors share the calculation; a failed calculation is retryable.
function getOptimum() {
  const key = `${scenario.datasetVersion}:${scenario.datasetHash}`;
  if (!cached || cached.key !== key) {
    const result = Promise.resolve().then(() => optimizeScenario(scenario));
    cached = { key, result };
    void result.catch(() => { if (cached?.result === result) cached = undefined; });
  }
  return cached.result;
}

export async function POST(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return error(400, 'INVALID_FORMAT', 'Ожидается JSON-запрос.');
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) return error(413, 'REQUEST_TOO_LARGE', 'Слишком большой запрос поиска.');
  let raw: string;
  try { raw = await request.text(); }
  catch { return error(400, 'INVALID_JSON', 'Не удалось прочитать запрос поиска.'); }
  if (new TextEncoder().encode(raw).length > MAX_BYTES) return error(413, 'REQUEST_TOO_LARGE', 'Слишком большой запрос поиска.');
  let input: unknown;
  try { input = JSON.parse(raw); }
  catch { return error(400, 'INVALID_JSON', 'Невалидный JSON.'); }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return error(400, 'INVALID_FORMAT', 'Для поиска нужны только версия и идентификатор набора данных.');
  if (parsed.data.datasetVersion !== scenario.datasetVersion || parsed.data.datasetHash !== scenario.datasetHash) {
    return error(409, 'DATASET_VERSION_MISMATCH', 'Данные города обновились. Перезагрузите страницу перед поиском.');
  }
  try {
    const result = await getOptimum();
    return NextResponse.json({ datasetVersion: scenario.datasetVersion, datasetHash: scenario.datasetHash, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return error(500, 'INTERNAL_ERROR', 'Не удалось найти лучший план. Попробуйте ещё раз.');
  }
}
