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
const originalBase = process.env.AI_BASE_URL;
afterEach(() => { vi.unstubAllGlobals(); if (originalKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = originalKey; if (originalModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = originalModel; if (originalBase === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = originalBase; });

const input = buildAnalysisInput(simulate(controlRequest), scenario);
const statement = { text: 'Улучшились условия в выбранном районе.', factIds: ['score-delta'] };
const analysis = { summary: statement, strengths: [statement], risks: [statement], consequences: [statement], recommendation: statement };

describe('AI-анализ', () => {
  it('передаёт проверяемые факты и не меняет математический результат', () => {
    expect(input.facts.some((fact) => fact.id === 'score-after' && fact.value === input.scenario.result.score)).toBe(true);
    expect(input.facts.some((fact) => fact.id === 'synergy-safe-feedback-nura')).toBe(true);
    expect(input.selectedMeasures).toHaveLength(5);
    expect(input.facts.find((fact) => fact.id === 'budget-spent')).toMatchObject({ value: 9.5, unit: 'млрд ₸' });
    expect(input.facts.find((fact) => fact.id === 'budget-left')).toMatchObject({ value: 0.5, unit: 'млрд ₸' });
    expect(input.facts.find((fact) => fact.id === 'lag-M7')).toMatchObject({ value: 3, unit: 'кварталов' });
    expect(input.facts.find((fact) => fact.id === 'horizon')).toMatchObject({ value: 8, unit: 'кварталов' });
    expect(input.facts.find((fact) => fact.id === 'before-nura-S1')?.value).toBe(38);
    expect(input.facts.find((fact) => fact.id === 'after-nura-S1')?.value).toBe(48);
    expect(input.facts.find((fact) => fact.id === 'budget-nura')).toMatchObject({ value: 5.6, unit: 'млрд ₸' });
    expect(input.facts.find((fact) => fact.id === 'budget-city')).toMatchObject({ value: 1.4, unit: 'млрд ₸' });
    expect(new Set(input.facts.map((fact) => fact.id)).size).toBe(input.facts.length);
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
    delete process.env.AI_MODEL;
    delete process.env.AI_BASE_URL;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzeWithProvider(input);
    expect(result.analysis).toEqual(analysis);
    expect(result.model).toBe('gpt-6-sol');
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe('gpt-6-sol');
    expect(sent.reasoning_effort).toBe('none');
    expect(sent.max_completion_tokens).toBe(2500);
    expect(sent.temperature).toBeUndefined();
    const promptFacts = JSON.parse(sent.messages[1].content);
    expect(promptFacts.facts.find((fact: { id: string }) => fact.id === 'score-after').value).toBeCloseTo(56.54307, 8);
    expect(promptFacts.scenario).toBeUndefined();
    expect(promptFacts.selectedMeasures.find((measure: { id: string }) => measure.id === 'M7')).toMatchObject({ cost: 2.4, costUnit: 'млрд ₸' });
    expect(sent.messages[1].content).toContain('synergy-safe-feedback-nura');
    expect(sent.messages[0].content).toContain('конкретный компромисс');
    expect(sent.messages[0].content).toContain('Не предлагай невыбранную меру');
    expect(sent.response_format.type).toBe('json_schema');
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.response_format.json_schema.schema.properties.summary.properties.factIds.items.enum).toContain('score-after');
  });

  it('отклоняет вымышленные числа и ссылки после одной неуспешной коррекции', async () => {
    process.env.AI_API_KEY = 'test-key';
    const invalid = { ...analysis, summary: { text: 'Score вырос на 7.', factIds: ['missing'] } };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(invalid) } }] }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzeWithProvider(input)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE', status: 502 } satisfies Partial<AiError>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('исправляет один неверный ответ и возвращает только прошедший проверку', async () => {
    process.env.AI_API_KEY = 'test-key';
    const invalid = { ...analysis, summary: { text: 'Score после: 999 баллов.', factIds: ['score-after'] } };
    const corrected = { ...analysis, summary: { text: 'Score после: {{score-after}}.', factIds: ['score-after'] } };
    const reply = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(invalid)).mockResolvedValueOnce(reply(corrected));
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await analyzeWithProvider(input);
    expect(result.analysis.summary.text).toBe('Score после: 56,54 балла.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].signal).toBe(fetchMock.mock.calls[0][1].signal);
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent.messages.at(-1).content).toContain('unsupported_number');
    expect(sent.messages.at(-1).content).toContain('summary');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"code":"unsupported_number"'));
    expect(log.mock.calls.flat().join('')).not.toContain('test-key');
  });

  it.each([null, { ...analysis, summary: { text: '   ', factIds: ['score-delta'] } }, { ...analysis, risks: [] }])('исправляет нарушение схемы: %j', async (invalid) => {
    process.env.AI_API_KEY = 'test-key';
    const reply = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(invalid)).mockResolvedValueOnce(reply(analysis));
    vi.stubGlobal('fetch', fetchMock);
    expect((await analyzeWithProvider(input)).analysis).toEqual(analysis);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([[429, 'AI_RATE_LIMITED'], [503, 'AI_UNAVAILABLE']])('не повторяет HTTP %s', async (status, code) => {
    process.env.AI_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: Number(status) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzeWithProvider(input)).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('не повторяет истекший таймаут', async () => {
    process.env.AI_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(analyzeWithProvider(input)).rejects.toMatchObject({ code: 'AI_TIMEOUT', status: 504 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('отдаёт API-отчёт с проверенными числами и серверными денежными фактами', async () => {
    process.env.AI_API_KEY = 'test-key';
    const valid = { ...analysis, summary: { text: 'Потрачено 9,5 млрд ₸; Score после — 56,54 балла.', factIds: ['budget-spent', 'score-after'] } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(valid) } }] }))));
    const response = await POST(new NextRequest('http://localhost/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(controlRequest) }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.analysis).toEqual(valid);
    expect(body.facts.find((fact: { id: string }) => fact.id === 'budget-spent')).toMatchObject({ value: 9.5, unit: 'млрд ₸' });
    expect(body.scenarioId).toBe(input.scenario.scenarioId);
  });

  it('использует NVIDIA chat endpoint без неподтверждённого JSON-mode поля', async () => {
    process.env.AI_API_KEY = 'test-nvidia-key';
    process.env.AI_BASE_URL = 'https://integrate.api.nvidia.com/v1';
    process.env.AI_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await analyzeWithProvider(input);
    expect(result.provider).toBe('integrate.api.nvidia.com');
    expect(fetchMock.mock.calls[0][0]).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe('nvidia/nemotron-3-super-120b-a12b');
    expect(sent.temperature).toBe(0.2);
    expect(sent.reasoning_effort).toBeUndefined();
    expect(sent.response_format).toBeUndefined();
  });
});
