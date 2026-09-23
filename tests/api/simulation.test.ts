import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/scenario/route';
import { POST } from '@/app/api/simulate/route';
import { controlRequest } from '../data/source-fixture';

const post = (body: string, contentType = 'application/json') => POST(new NextRequest('http://localhost/api/simulate', { method: 'POST', headers: { 'content-type': contentType }, body }));

describe('API сценария и расчёта', () => {
  it('возвращает один канонический сценарий', async () => {
    const response = GET();
    const scenario = await response.json();
    expect(response.status).toBe(200);
    expect(scenario.budget).toBe(100);
    expect(scenario.districts).toHaveLength(5);
    expect(scenario.measures).toHaveLength(14);
    expect(scenario.datasetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('считает контрольный пример на сервере', async () => {
    const response = await post(JSON.stringify(controlRequest));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.cost).toBe(95);
    expect(body.result.score).toBeCloseTo(56.54307, 8);
    expect(body.baseline.score).toBeCloseTo(52.55768, 8);
    expect(body.ledger.indicators).toHaveLength(50);
  });

  it('отклоняет невалидный JSON и подменённые цены', async () => {
    expect((await post('{')).status).toBe(400);
    const response = await post(JSON.stringify({ ...controlRequest, cost: 0 }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_FORMAT');
  });

  it('запрещает даже пустой район у городской меры, но принимает отсутствие поля', async () => {
    const decisions = controlRequest.decisions.map((decision) => decision.measureId === 'M12' ? { ...decision, districtId: '' } : decision);
    const rejected = await post(JSON.stringify({ ...controlRequest, decisions }));
    const body = await rejected.json();
    expect(rejected.status).toBe(422);
    expect(body.error.code).toBe('DISTRICT_FORBIDDEN');
    expect(body.error.issues).toContainEqual(expect.objectContaining({ measureIds: ['M12'], districtId: '' }));
    expect(body.result).toBeUndefined();
    expect(body.score).toBeUndefined();

    const accepted = await post(JSON.stringify(controlRequest));
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).result.score).toBeCloseTo(56.54307, 8);
  });

  it('отклоняет старую версию, неизвестную меру и неполный набор без Score', async () => {
    const stale = await post(JSON.stringify({ ...controlRequest, datasetVersion: 'old' }));
    expect(stale.status).toBe(409);
    const unknown = await post(JSON.stringify({ ...controlRequest, decisions: [{ measureId: 'M99' }, ...controlRequest.decisions.slice(1)] }));
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).error.code).toBe('UNKNOWN_MEASURE');
    const incomplete = await post(JSON.stringify({ ...controlRequest, decisions: controlRequest.decisions.slice(0, 4) }));
    const body = await incomplete.json();
    expect(incomplete.status).toBe(422);
    expect(body.error.code).toBe('DECISION_COUNT');
    expect(body.score).toBeUndefined();
  });

  it('ограничивает размер тела', async () => {
    const response = await post(JSON.stringify({ ...controlRequest, filler: 'x'.repeat(17000) }));
    expect(response.status).toBe(413);
  });
});
