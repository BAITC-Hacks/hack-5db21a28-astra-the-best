import type { ScenarioRequest } from '@/contracts';

export const controlRequest: ScenarioRequest = {
  datasetVersion: 'astana-s2-v1',
  decisions: [
    { measureId: 'M7', districtId: 'nura' },
    { measureId: 'M8', districtId: 'nura' },
    { measureId: 'M10', districtId: 'nura' },
    { measureId: 'M12' },
    { measureId: 'M5', districtId: 'saryarka' },
  ],
};

export const cheapestRequest: ScenarioRequest = {
  datasetVersion: 'astana-s2-v1',
  decisions: [
    { measureId: 'M9', districtId: 'nura' },
    { measureId: 'M11', districtId: 'nura' },
    { measureId: 'M10', districtId: 'nura' },
    { measureId: 'M12' },
    { measureId: 'M4', districtId: 'nura' },
  ],
};

export const sourceDistrictRows = [
  ['esil', 0.27, 45, 62, 68, 72, 48, 55, 78, 60, 75, 70, 62.99],
  ['almaty', 0.24, 40, 75, 50, 55, 60, 65, 62, 52, 50, 60, 57.06],
  ['saryarka', 0.20, 50, 70, 42, 40, 62, 68, 58, 55, 45, 55, 54.65],
  ['baikonur', 0.13, 52, 68, 55, 50, 58, 60, 52, 58, 55, 58, 56.63],
  ['nura', 0.16, 55, 40, 45, 65, 38, 35, 55, 50, 60, 50, 49.18],
] as const;

export const sourceMeasureRows = [
  ['M1', 'transport', 'district', 18, 2, { T1: 6, T2: 9 }],
  ['M2', 'transport', 'city', 22, 2, { T1: 4, B2: 3 }],
  ['M3', 'transport', 'district', 30, 4, { T1: 16, T2: 20, E2: 4 }],
  ['M4', 'ecology', 'district', 15, 2, { E1: 12, E2: 3, B1: 2 }],
  ['M5', 'ecology', 'district', 25, 3, { E2: 14, C1: 4 }],
  ['M6', 'ecology', 'city', 20, 4, { E1: 5, E2: 3 }],
  ['M7', 'social', 'district', 24, 3, { S1: 16 }],
  ['M8', 'social', 'district', 20, 3, { S2: 14 }],
  ['M9', 'social', 'district', 10, 1, { S1: 3, S2: 3, B1: 3 }],
  ['M10', 'safety', 'district', 12, 1, { B1: 12, B2: 2 }],
  ['M11', 'safety', 'district', 10, 1, { B2: 12, T1: -2 }],
  ['M12', 'services', 'city', 14, 1, { C2: 5 }],
  ['M13', 'services', 'district', 28, 4, { C1: 18, E2: 2 }],
  ['M14', 'services', 'city', 16, 1, { C1: 5, C2: 2 }],
] as const;
