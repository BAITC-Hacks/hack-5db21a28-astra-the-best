export type TourStep = 'district' | 'district-facts' | 'close-district-card' | 'select-map-layer'
  | 'compare-map-layer' | 'plan-district' | 'open-plan' | `measure-${number}` | 'budget'
  | 'calculate' | 'open-report' | 'score' | 'district-result' | 'ai' | 'complete';

interface TourStart {
  requiredDecisions: number;
  decisionCount: number;
  hasResult: boolean;
  hasDistrict: boolean;
  hasComparisonLayer: boolean;
  hasAnalysis: boolean;
}

// Build the route once per tour. Adding decisions or loading AI must not shrink it.
export function createTourSteps(start: TourStart): TourStep[] {
  const steps: TourStep[] = [];
  if (!start.hasDistrict) steps.push('district');
  steps.push('district-facts', 'close-district-card');
  if (!start.hasComparisonLayer) steps.push('select-map-layer');
  steps.push('compare-map-layer');
  if (start.hasResult) {
    steps.push('open-report');
  } else {
    steps.push('plan-district', 'open-plan');
    if (start.decisionCount > 0) steps.push('budget');
    for (let index = start.decisionCount; index < start.requiredDecisions; index++) {
      steps.push(`measure-${index}`);
      if (index === 0) steps.push('budget');
    }
    steps.push('calculate');
  }
  steps.push('score', 'district-result');
  if (!start.hasResult || !start.hasAnalysis) steps.push('ai');
  steps.push('complete');
  return steps;
}

// A user can revisit an action that was already satisfied when the tour began.
export function restoreTourStep(steps: readonly TourStep[], step: TourStep, requiredDecisions: number): TourStep[] {
  const order = createTourSteps({ requiredDecisions, decisionCount: 0, hasResult: false, hasDistrict: false, hasComparisonLayer: false, hasAnalysis: false });
  order.splice(order.indexOf('score'), 0, 'open-report');
  const next = order.slice(order.indexOf(step) + 1).find((item) => steps.includes(item));
  const index = next ? steps.indexOf(next) : steps.length;
  return [...steps.slice(0, index), step, ...steps.slice(index)];
}
