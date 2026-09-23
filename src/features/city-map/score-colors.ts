// One continuous 0–100 scale: bright fills and darker matching text tones.
// Gold keeps the yellow values readable on the light legend background.
export const SCORE_COLOR_STOPS = [
  { value: 0, color: [229, 74, 74], text: [200, 62, 56] },
  { value: 25, color: [239, 145, 52], text: [180, 93, 18] },
  { value: 50, color: [232, 199, 61], text: [148, 112, 0] },
  { value: 75, color: [79, 166, 89], text: [39, 131, 71] },
  { value: 100, color: [20, 83, 45], text: [20, 83, 45] },
] as const;

export const SCORE_GRADIENT = `linear-gradient(90deg, ${SCORE_COLOR_STOPS.map(
  ({ value, color }) => `rgb(${color.join(', ')}) ${value}%`,
).join(', ')})`;

export function scoreColor(value: number, tone: 'color' | 'text' = 'color'): string {
  const score = Math.max(0, Math.min(100, value));
  const upperIndex = SCORE_COLOR_STOPS.findIndex((stop) => score <= stop.value);
  const upper = SCORE_COLOR_STOPS[Math.max(0, upperIndex)];
  const lower = SCORE_COLOR_STOPS[Math.max(0, upperIndex - 1)];
  const fraction = upper.value === lower.value ? 0 : (score - lower.value) / (upper.value - lower.value);
  const color = lower[tone].map((channel, index) => Math.round(channel + (upper[tone][index] - channel) * fraction));
  return `rgb(${color.join(', ')})`;
}
