import type { AnalysisContent, AnalysisFact, AnalysisInput, AnalysisStatement } from '@/contracts';

export interface FactIssue {
  path: string;
  code: 'unknown_fact' | 'uncited_placeholder' | 'invalid_placeholder' | 'unsupported_number' | 'unknown_identifier';
  value: string;
}

type Unit = { kind: string; scale: number };

function readUnit(text: string): Unit | undefined {
  const unit = text.trimStart().toLowerCase();
  if (/^(?:(?:млрд|миллиард\S*|млн|миллион\S*|тыс\.?)\s*)?(?:рубл|доллар|евро|usd|eur|rub|[$€₽])/u.test(unit)) return { kind: 'other', scale: 1 };
  if (/^(?:млрд|миллиард)/u.test(unit)) return { kind: 'money', scale: 1e9 };
  if (/^(?:млн|миллион)/u.test(unit)) return { kind: 'money', scale: 1e6 };
  if (/^(?:тыс\.?\s*(?:₸|тенге)|тысяч\S*\s+тенге)/u.test(unit)) return { kind: 'money', scale: 1e3 };
  if (/^(?:₸|тенге|kzt)/u.test(unit)) return { kind: 'money', scale: 1 };
  if (/^(?:%|процент)/u.test(unit)) return { kind: 'percent', scale: 1 };
  if (/^(?:балл|пункт)/u.test(unit)) return { kind: 'score', scale: 1 };
  if (/^квартал/u.test(unit)) return { kind: 'quarters', scale: 1 };
  if (/^(?:шт\.|показател|мероприяти|мер(?:ы|а|у|\s|$)|решени)/u.test(unit)) return { kind: 'count', scale: 1 };
  // Do not accept a matching scalar with a different, unsupported unit.
  if (/^(?:лет|год|года|месяц|рубл|доллар|евро|км|метр|человек|жител|единиц)/u.test(unit)) return { kind: 'other', scale: 1 };
  return undefined;
}

function matchesNumber(token: string, unit: Unit | undefined, fact: AnalysisFact): boolean {
  if (typeof fact.value !== 'number' || !Number.isFinite(fact.value)) return false;
  const sourceUnit = readUnit(fact.unit);
  if (unit && unit.kind !== sourceUnit?.kind) return false;
  const normalized = token.replace(/[\s\u00a0\u202f]/gu, '').replace(',', '.').replace('−', '-');
  const value = Number(normalized);
  const expected = fact.value * (sourceUnit?.scale ?? 1) / (unit?.scale ?? sourceUnit?.scale ?? 1);
  if (Math.abs(value - expected) < 1e-8) return true;
  if (/[eE]/u.test(normalized)) return false;
  // Scores/percentages may be rounded as in the UI. Counts and money must not
  // turn into a different whole value simply because the model omitted decimals.
  if (sourceUnit?.kind !== 'score' && sourceUnit?.kind !== 'percent') return false;
  if (value !== 0 && Math.sign(value) !== Math.sign(expected)) return false;
  const precision = normalized.split('.')[1]?.length ?? 0;
  return Math.abs(value - Number(expected.toFixed(Math.min(precision, 10)))) < 1e-8;
}

function displayFact(fact: AnalysisFact): string {
  const value = typeof fact.value === 'number'
    ? fact.value.toLocaleString('ru-RU', { maximumFractionDigits: 2, useGrouping: false })
    : fact.value;
  let unit = fact.unit;
  if (typeof fact.value === 'number') {
    const rounded = Math.abs(Number(value.replace(',', '.')));
    const form = (one: string, few: string, many: string) => !Number.isInteger(rounded) ? few
      : rounded % 100 >= 11 && rounded % 100 <= 14 ? many
        : rounded % 10 === 1 ? one : rounded % 10 >= 2 && rounded % 10 <= 4 ? few : many;
    if (unit === 'кварталов') unit = form('квартал', 'квартала', 'кварталов');
    if (unit === 'балла') unit = form('балл', 'балла', 'баллов');
    // The surrounding sentence names the counted entity (indicators/measures).
    if (unit === 'шт.') unit = '';
  }
  return `${value}${unit ? ` ${unit}` : ''}`;
}

/** Checks references, quantities and units. This is not a semantic truth judge:
 * qualitative conclusions still need to be read in the context of their facts. */
export function validateAndRenderAnalysis(analysis: AnalysisContent, input: AnalysisInput): { analysis: AnalysisContent; issues: FactIssue[] } {
  const byId = new Map(input.facts.map((fact) => [fact.id, fact]));
  const identifiers = new Set<string>([
    ...input.selectedMeasures.map((measure) => measure.id),
    ...input.facts.flatMap((fact) => fact.indicatorId ? [fact.indicatorId] : []),
  ]);
  const issues: FactIssue[] = [];
  const check = (statement: AnalysisStatement, path: string): AnalysisStatement => {
    const cited = new Set(statement.factIds);
    const facts = statement.factIds.flatMap((id) => {
      const fact = byId.get(id);
      if (!fact) issues.push({ path, code: 'unknown_fact', value: id });
      return fact ? [fact] : [];
    });
    const placeholder = /\{\{([^{}]+)\}\}/gu;
    const render = (match: string, id: string) => {
      const fact = byId.get(id);
      if (!fact || !cited.has(id)) return match;
      return displayFact(fact);
    };
    let text = statement.text.replace(placeholder, (match, id: string) => {
      if (!byId.has(id)) issues.push({ path, code: 'unknown_fact', value: id });
      else if (!cited.has(id)) issues.push({ path, code: 'uncited_placeholder', value: id });
      return ' '.repeat(match.length);
    });
    if (/[{}]/u.test(text)) issues.push({ path, code: 'invalid_placeholder', value: 'Use {{fact-id}} with an existing cited fact.' });
    // Codes such as M10 and B1 are identifiers, not quantitative claims.
    text = text.replace(/(?<![\p{L}\p{N}_])[A-Z]\d+(?![\p{L}\p{N}_])/gu, (id) => {
      if (!identifiers.has(id)) issues.push({ path, code: 'unknown_identifier', value: id });
      return ' '.repeat(id.length);
    });
    const numbers = /[+−-]?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d+)?(?:[eE][+-]?\d+)?/gu;
    for (const match of text.matchAll(numbers)) {
      const unit = readUnit(text.slice(match.index + match[0].length));
      if (!facts.some((fact) => matchesNumber(match[0], unit, fact))) {
        issues.push({ path, code: 'unsupported_number', value: match[0] });
      }
    }
    return { text: statement.text.replace(placeholder, render), factIds: [...cited] };
  };
  return {
    analysis: {
      summary: check(analysis.summary, 'summary'),
      strengths: analysis.strengths.map((statement, index) => check(statement, `strengths.${index}`)),
      risks: analysis.risks.map((statement, index) => check(statement, `risks.${index}`)),
      consequences: analysis.consequences.map((statement, index) => check(statement, `consequences.${index}`)),
      recommendation: check(analysis.recommendation, 'recommendation'),
    },
    issues,
  };
}
