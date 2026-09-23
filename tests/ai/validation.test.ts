import { describe, expect, it } from 'vitest';
import type { AnalysisContent, AnalysisInput } from '@/contracts';
import { scenario } from '@/data';
import { simulate } from '@/domain/simulation';
import { buildAnalysisInput } from '@/server/ai/facts';
import { validateAndRenderAnalysis } from '@/server/ai/validation';
import { cheapestRequest, controlRequest } from '../data/source-fixture';

const input = buildAnalysisInput(simulate(controlRequest), scenario);
const quiet = { text: 'Выбранный план меняет показатели города.', factIds: ['score-delta'] };
function check(text: string, factIds: string[], data: AnalysisInput = input) {
  const analysis: AnalysisContent = { summary: { text, factIds }, strengths: [quiet], risks: [quiet], consequences: [quiet], recommendation: quiet };
  return validateAndRenderAnalysis(analysis, data);
}

describe('числа и ссылки в AI-отчёте', () => {
  it.each([
    ['Score вырос с 52,56 до 56.54 балла; прирост +3,99 балла.', ['score-before', 'score-after', 'score-delta']],
    ['Потрачено 9,5 млрд ₸; осталось 500 млн тенге.', ['budget-spent', 'budget-left']],
    ['Потрачено 9 500 000 000 ₸.', ['budget-spent']],
    ['Осталось 0,5 млрд ₸.', ['budget-left']],
    ['Горизонт 8 кварталов, лаг школы 3 квартала.', ['horizon', 'lag-M7']],
    ['Доля эффекта школы — 62,5%.', ['realized-M7']],
    ['На районные меры Нуры направлено 5,6 млрд ₸.', ['budget-nura']],
    ['Выбрано 5 мероприятий.', ['decision-count']],
    ['M10 улучшает B1 на 12,5 балла с учётом синергии.', ['change-nura-B1']],
    ['Синергия M10 и M12 добавляет B1 ещё 2 балла.', ['synergy-safe-feedback-nura-B1']],
  ])('принимает подтверждённое утверждение: %s', (text, ids) => {
    expect(check(text, ids).issues).toEqual([]);
  });

  it('подставляет значения серверных фактов и единицы, сохраняя контракт', () => {
    const result = check('Score: {{score-after}}. Остаток: {{budget-left}}.', ['score-after', 'budget-left']);
    expect(result.issues).toEqual([]);
    expect(result.analysis.summary.text).toBe('Score: 56,54 балла. Остаток: 0,5 млрд ₸.');
    expect(input.scenario.result.score).toBeCloseTo(56.54307, 8);
  });

  it('склоняет единицы и оставляет название счётного объекта предложению', () => {
    const result = check('Лаг: {{lag-M10}}. Порог: {{critical-threshold}}. Выбрано {{decision-count}} мероприятий.', ['lag-M10', 'critical-threshold', 'decision-count']);
    expect(result.issues).toEqual([]);
    expect(result.analysis.summary.text).toBe('Лаг: 1 квартал. Порог: 40 баллов. Выбрано 5 мероприятий.');
  });

  it.each([
    ['Score вырос на 7 баллов.', ['score-delta'], 'unsupported_number'],
    ['Score после: 56,54 балла.', ['budget-spent'], 'unsupported_number'],
    ['Потрачено 9,5 балла.', ['budget-spent'], 'unsupported_number'],
    ['Score вырос на 3,99%.', ['score-delta'], 'unsupported_number'],
    ['Потрачено 95 млрд ₸.', ['budget-spent'], 'unsupported_number'],
    ['Потрачено 9,5 млрд долларов.', ['budget-spent'], 'unsupported_number'],
    ['Осталось 5 млрд ₸.', ['budget-left'], 'unsupported_number'],
    ['Горизонт 8 лет.', ['horizon'], 'unsupported_number'],
    ['Score изменился на -3,99 балла.', ['score-delta'], 'unsupported_number'],
    ['M99 улучшает город.', ['score-delta'], 'unknown_identifier'],
    ['Город улучшился.', ['missing'], 'unknown_fact'],
    ['Score: {{score-after}}.', ['score-before'], 'uncited_placeholder'],
    ['Score: {{missing}}.', ['score-after'], 'unknown_fact'],
    ['Score: {score-after}.', ['score-after'], 'invalid_placeholder'],
  ])('отклоняет неподтверждённое утверждение: %s', (text, ids, code) => {
    expect(check(text, ids).issues).toContainEqual(expect.objectContaining({ path: 'summary', code }));
  });

  it('не разрешает число из чужого, не процитированного факта', () => {
    expect(check('Лаг 3 квартала.', ['horizon']).issues[0].code).toBe('unsupported_number');
  });

  it('проверяет отрицательные последствия и Unicode-минус', () => {
    const data = buildAnalysisInput(simulate(cheapestRequest), scenario);
    expect(check('Изменение T1: −1,75 балла.', ['change-nura-T1'], data).issues).toEqual([]);
    expect(check('Изменение T1: +1,75 балла.', ['change-nura-T1'], data).issues).not.toEqual([]);
  });

  it('не округляет цену до произвольного целого', () => {
    expect(check('Стоимость — 1 млрд ₸.', ['measure-M10']).issues).not.toEqual([]);
  });

  it('проверяет каждый раздел, а не только сводку', () => {
    const analysis = { summary: quiet, strengths: [quiet], risks: [{ text: 'Потребуется 999 млрд ₸.', factIds: ['budget-spent'] }], consequences: [quiet], recommendation: quiet };
    expect(validateAndRenderAnalysis(analysis, input).issues).toEqual([{ path: 'risks.0', code: 'unsupported_number', value: '999' }]);
  });
});
