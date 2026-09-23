import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { scenario } from '@/data';
import { simulate } from '@/domain/simulation';
import { POST } from '@/app/api/analyze/route';
import { buildAnalysisInput } from '@/server/ai/facts';
import { AiError, analyzeWithProvider } from '@/server/ai/provider';
import { controlRequest } from '../data/source-fixture';

const originalKey = process.env.AI_API_KEY;
const originalModel = process.env.AI_MODEL;
afterEach(() => { vi.unstubAllGlobals(); if (originalKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = originalKey; if (originalModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = originalModel; });

const input = buildAnalysisInput(simulate(controlRequest), scenario);
const statement = { text: 'Улучшились условия в выбранном районе.', factIds: ['score-delta'] };
const analysis = { summary: statement, strengths: [statement], risks: [statement], consequences: [statement], recommendation: statement };

describe('AI-анализ', () => {
  it('передаёт проверяемые факты и не меняет математический результат', () => {
    expect(input.facts.some((fact) => fact.id === 'score-after' && fact.value === input.scenario.result.score)).toBe(true);
    expect(input.facts.some((fact) => fact.id === 'synergy-safe-feedback-nura')).toBe(true);
    expect(input.selectedMeasures).toHaveLength(5);
  });

  it('без ключа возвращает явную ошибку и не вызывает провайдера', async () => {
    delete process.env.AI_API_KEY;
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await POST(new NextRequest('http://localhost/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(controlRequest) }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('AI_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('принимает структурированный ответ и ссылки только на переданные факты', async () => {
    process.env.AI_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzeWithProvider(input);
    expect(result.analysis).toEqual(analysis);
    expect(result.model).toBe('gpt-4.1-mini');
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.parse(sent.messages[1].content).scenario.result.score).toBeCloseTo(56.54307, 8);
    expect(sent.messages[1].content).toContain('synergy-safe-feedback-nura');
  });

  it('отклоняет числовые литералы и вымышленные ссылки', async () => {
    process.env.AI_API_KEY = 'test-key';
    const invalid = { ...analysis, summary: { text: 'Score вырос на 7.', factIds: ['missing'] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) } }] }), { status: 200 })));
    await expect(analyzeWithProvider(input)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', status: 502 } satisfies Partial<AiError>);
  });
});
