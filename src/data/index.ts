import type { ScenarioResponse } from '@/contracts';
import { canonicalData } from './canonical';

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const datasetVersion = 'astana-s2-v1';
export const datasetHash = 'd0828831353be30ced3aaa942f3c17ad589a0240c4359e0ce4484872649b2c67';
export const scenario: ScenarioResponse = deepFreeze({ datasetVersion, datasetHash, ...canonicalData });
