import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { scenario } from '@/data';
import { simulate } from '@/domain/simulation';
import { controlRequest } from '../data/source-fixture';

const engine = vi.hoisted(() => vi.fn());
vi.mock('@/domain/search/optimize', () => ({ optimizeScenario: engine }));

const input = { datasetVersion: scenario.datasetVersion, datasetHash: scenario.datasetHash };
const result = { method: 'exhaustive', checkedCandidates: 100, simulation: simulate(controlRequest) };

async function post(body: unknown = input, headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/optimize/route');
  return POST(new NextRequest('http://localhost/api/optimize', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

beforeEach(() => { vi.resetModules(); engine.mockReset().mockReturnValue(result); });

describe('global optimization API', () => {
  it('uses only canonical data and shares the result across concurrent requests', async () => {
    const responses = await Promise.all([post(), post()]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(engine).toHaveBeenCalledTimes(1);
    expect(engine.mock.calls[0][0]).toEqual(scenario);
    expect(await responses[0].json()).toEqual({ ...input, ...result });
    expect(await responses[1].json()).toEqual({ ...input, ...result });
    expect(responses[0].headers.get('cache-control')).toBe('no-store');
  });

  it('rejects stale version/hash and supplied prices or decisions without running search', async () => {
    expect((await post({ ...input, datasetVersion: 'old' })).status).toBe(409);
    expect((await post({ ...input, datasetHash: 'old' })).status).toBe(409);
    expect((await post({ ...input, budget: 1000 })).status).toBe(400);
    expect((await post({ ...input, decisions: controlRequest.decisions })).status).toBe(400);
    expect((await post({ datasetVersion: input.datasetVersion })).status).toBe(400);
    expect(engine).not.toHaveBeenCalled();
  });

  it('bounds and validates JSON input before running search', async () => {
    expect((await post('{')).status).toBe(400);
    expect((await post(input, { 'content-type': 'text/plain' })).status).toBe(400);
    expect((await post({ ...input, extra: 'x'.repeat(1024) })).status).toBe(413);
    expect((await post(input, { 'content-length': '1025' })).status).toBe(413);
    expect(engine).not.toHaveBeenCalled();
  });

  it('does not cache failures or expose internal diagnostics', async () => {
    engine.mockImplementationOnce(() => { throw new Error('private diagnostic'); });
    const failed = await post();
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain('private diagnostic');
    expect((await post()).status).toBe(200);
    expect(engine).toHaveBeenCalledTimes(2);
  });
});
