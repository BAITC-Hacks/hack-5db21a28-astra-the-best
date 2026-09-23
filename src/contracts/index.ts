export const DISTRICT_IDS = ['esil', 'almaty', 'saryarka', 'baikonur', 'nura'] as const;
export const DIRECTION_IDS = ['transport', 'ecology', 'social', 'safety', 'services'] as const;
export const INDICATOR_IDS = ['T1', 'T2', 'E1', 'E2', 'S1', 'S2', 'B1', 'B2', 'C1', 'C2'] as const;
export const MEASURE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14'] as const;

export type DistrictId = typeof DISTRICT_IDS[number];
export type DirectionId = typeof DIRECTION_IDS[number];
export type IndicatorId = typeof INDICATOR_IDS[number];
export type MeasureId = typeof MEASURE_IDS[number];
export type IndicatorValues = Readonly<Record<IndicatorId, number>>;
export type Effects = Readonly<Partial<Record<IndicatorId, number>>>;

export interface District {
  readonly id: DistrictId;
  readonly name: string;
  readonly populationShare: number;
  readonly profile: string;
  readonly indicators: IndicatorValues;
}
export interface Indicator {
  readonly id: IndicatorId;
  readonly directionId: DirectionId;
  readonly name: string;
  readonly description: string;
  readonly unit: 'баллы';
  readonly weight: number;
  readonly higherIsBetter: true;
}
export interface Direction {
  readonly id: DirectionId;
  readonly name: string;
}
export interface Measure {
  readonly id: MeasureId;
  readonly directionId: DirectionId;
  readonly name: string;
  readonly scope: 'district' | 'city';
  readonly cost: number;
  readonly lagQuarters: number;
  readonly effects: Effects;
}
export interface SynergyRule {
  readonly id: string;
  readonly measureIds: readonly [MeasureId, MeasureId];
  readonly targetMeasureId: MeasureId;
  readonly effects: Effects;
}
export interface ConflictRule {
  readonly measureIds: readonly [MeasureId, MeasureId];
  readonly scope: 'anywhere' | 'same-district';
  readonly message: string;
}
export interface Rules {
  readonly requiredDecisions: 5;
  readonly maxPerDirection: 2;
  readonly criticalThreshold: 40;
  readonly criticalPenalty: 1;
  readonly averageWeight: 0.7;
  readonly minimumWeight: 0.3;
  readonly synergies: readonly SynergyRule[];
  readonly conflicts: readonly ConflictRule[];
}
export interface ScenarioResponse {
  readonly datasetVersion: string;
  readonly datasetHash: string;
  readonly budget: 100;
  readonly horizonQuarters: 8;
  readonly synthetic: true;
  readonly directions: readonly Direction[];
  readonly indicators: readonly Indicator[];
  readonly districts: readonly District[];
  readonly measures: readonly Measure[];
  readonly rules: Rules;
}
export interface Decision {
  readonly measureId: MeasureId;
  readonly districtId?: DistrictId;
}
export interface ScenarioRequest {
  readonly datasetVersion: string;
  readonly decisions: readonly Decision[];
}
export type ErrorCode =
  | 'INVALID_JSON' | 'INVALID_FORMAT' | 'UNKNOWN_MEASURE' | 'UNKNOWN_DISTRICT'
  | 'DATASET_VERSION_MISMATCH' | 'DECISION_COUNT' | 'DUPLICATE_MEASURE'
  | 'DISTRICT_REQUIRED' | 'DISTRICT_FORBIDDEN' | 'BUDGET_EXCEEDED'
  | 'DIRECTION_LIMIT' | 'INCOMPATIBLE_MEASURES' | 'REQUEST_TOO_LARGE'
  | 'AI_NOT_CONFIGURED' | 'AI_RATE_LIMITED' | 'AI_TIMEOUT'
  | 'AI_UNAVAILABLE' | 'AI_INVALID_RESPONSE' | 'INTERNAL_ERROR';
export interface ApiIssue {
  readonly code: ErrorCode;
  readonly message: string;
  readonly measureIds?: readonly string[];
  readonly districtId?: string;
  readonly path?: string;
}
export interface ErrorResponse {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly issues: readonly ApiIssue[];
  };
}
export interface ValidationResult {
  readonly valid: boolean;
  readonly complete: boolean;
  readonly cost: number;
  readonly remainingBudget: number;
  readonly directionCounts: Readonly<Record<DirectionId, number>>;
  readonly issues: readonly ApiIssue[];
}
export interface CriticalIndicator {
  readonly districtId: DistrictId;
  readonly indicatorId: IndicatorId;
  readonly value: number;
}
export interface DistrictSnapshot {
  readonly districtId: DistrictId;
  readonly indicators: IndicatorValues;
  readonly score: number;
}
export interface ScoreSnapshot {
  readonly districts: readonly DistrictSnapshot[];
  readonly weightedAverage: number;
  readonly minimumDistrictScore: number;
  readonly weakestDistrictIds: readonly DistrictId[];
  readonly criticalIndicators: readonly CriticalIndicator[];
  readonly criticalCount: number;
  readonly score: number;
}
export interface MeasureEffectEntry {
  readonly measureId: MeasureId;
  readonly districtId: DistrictId;
  readonly indicatorId: IndicatorId;
  readonly fullEffect: number;
  readonly lagQuarters: number;
  readonly realizedFraction: number;
  readonly realizedEffect: number;
}
export interface AppliedSynergy {
  readonly id: string;
  readonly measureIds: readonly [MeasureId, MeasureId];
  readonly districtId: DistrictId;
  readonly effects: Effects;
}
export interface IndicatorChange {
  readonly districtId: DistrictId;
  readonly indicatorId: IndicatorId;
  readonly before: number;
  readonly measureEffect: number;
  readonly synergyEffect: number;
  readonly unclipped: number;
  readonly after: number;
  readonly delta: number;
}
export interface EffectLedger {
  readonly measures: readonly MeasureEffectEntry[];
  readonly synergies: readonly AppliedSynergy[];
  readonly indicators: readonly IndicatorChange[];
}
export interface SimulationResponse {
  readonly datasetVersion: string;
  readonly scenarioId: string;
  readonly decisions: readonly Decision[];
  readonly cost: number;
  readonly remainingBudget: number;
  readonly baseline: ScoreSnapshot;
  readonly result: ScoreSnapshot;
  readonly scoreDelta: number;
  readonly ledger: EffectLedger;
}
export interface AnalysisFact {
  readonly id: string;
  readonly label: string;
  readonly value: number | string;
  readonly unit: string;
  readonly measureId?: MeasureId;
  readonly districtId?: DistrictId;
  readonly indicatorId?: IndicatorId;
}
export interface AnalysisInput {
  readonly scenario: SimulationResponse;
  readonly selectedMeasures: readonly Measure[];
  readonly facts: readonly AnalysisFact[];
  readonly disclaimer: string;
}
export interface AnalysisStatement {
  readonly text: string;
  readonly factIds: readonly string[];
}
export interface AnalysisContent {
  readonly summary: AnalysisStatement;
  readonly strengths: readonly AnalysisStatement[];
  readonly risks: readonly AnalysisStatement[];
  readonly consequences: readonly AnalysisStatement[];
  readonly recommendation: AnalysisStatement;
}
export interface AnalyzeResponse {
  readonly datasetVersion: string;
  readonly scenarioId: string;
  readonly provider: string;
  readonly model: string;
  readonly analysis: AnalysisContent;
  readonly facts: readonly AnalysisFact[];
}
export type AnalysisState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly scenarioId: string }
  | { readonly status: 'success'; readonly response: AnalyzeResponse }
  | { readonly status: 'error'; readonly scenarioId: string; readonly error: ErrorResponse };
export type IndicatorLayer =
  | { readonly kind: 'indicator'; readonly indicatorId: IndicatorId }
  | { readonly kind: 'direction'; readonly directionId: DirectionId };
export interface MapCamera {
  readonly longitude: number;
  readonly latitude: number;
  readonly zoom: number;
  readonly pitch: number;
  readonly bearing: number;
}
export interface CityViewProps {
  readonly scenario: ScenarioResponse;
  readonly selectedDistrictId: DistrictId | null;
  readonly selectedMeasureId: MeasureId | null;
  readonly decisions: readonly Decision[];
  readonly preview: Decision | null;
  readonly result: SimulationResponse | null;
  readonly comparison: 'before' | 'after';
  readonly indicatorLayer: IndicatorLayer;
  readonly camera: MapCamera | null;
  readonly active: boolean;
  readonly onDistrictSelect: (districtId: DistrictId) => void;
  readonly onMeasureSelect: (measureId: MeasureId | null) => void;
  readonly onCameraChange: (camera: MapCamera) => void;
}
