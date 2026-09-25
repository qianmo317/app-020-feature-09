import type { BuildingKind, RuleSet, RuleValues } from '../model';

/**
 * 默认规则集（参考值，均标注依据，可在 /rules 页面按项目实际调整；修改后版本号 +1）。
 * 说明：
 * - 疏散距离：GB 50016-2014(2018年版) 表 5.5.17（民用建筑）与 3.7.4（厂房）；
 *   袋形走道两侧或尽端的疏散门至最近安全出口距离按同一表取值。
 * - 灭火器保护半径：GB 50140-2005 按火灾类别与危险等级的最大保护距离折算，此处为可配置参考值。
 */
export const DEFAULT_RULES: Record<BuildingKind, RuleSet> = {
  office: {
    buildingKind: 'office',
    maxTravelDistanceM: 40,
    deadEndDistanceM: 22,
    extinguisherRadiusM: 20,
    exitMinAreaM2: 200,
    exitMaxOccupants: 50,
    source: 'GB 50016-2014(2018年版) 表5.5.17；GB 50140-2005',
    version: 1,
  },
  retail: {
    buildingKind: 'retail',
    maxTravelDistanceM: 30,
    deadEndDistanceM: 20,
    extinguisherRadiusM: 20,
    exitMinAreaM2: 200,
    exitMaxOccupants: 50,
    source: 'GB 50016-2014(2018年版) 表5.5.17（商店建筑）；GB 50140-2005',
    version: 1,
  },
  factory: {
    buildingKind: 'factory',
    maxTravelDistanceM: 30,
    deadEndDistanceM: 20,
    extinguisherRadiusM: 12,
    exitMinAreaM2: 200,
    exitMaxOccupants: 50,
    source: 'GB 50016-2014(2018年版) 3.7.4（厂房疏散距离）；GB 50140-2005',
    version: 1,
  },
  school: {
    buildingKind: 'school',
    maxTravelDistanceM: 35,
    deadEndDistanceM: 22,
    extinguisherRadiusM: 20,
    exitMinAreaM2: 200,
    exitMaxOccupants: 50,
    source: 'GB 50099-2011、GB 50016-2014(2018年版) 表5.5.17；GB 50140-2005',
    version: 1,
  },
};

/** 人员密度估算（㎡/人），未填写人数的房间按此估算 —— 仅用于出口数量校验 */
export const OCCUPANCY_DENSITY_M2_PER_PERSON: Record<string, number> = {
  office: 10,
  retail: 3,
  storage: 50,
  ward: 8,
  corridor: 0, // 走道不计停留人数
  other: 20,
};

/** 检查周期（天），用于「下次检查日期」与过期判定 */
export const CHECK_INTERVAL_DAYS: Record<string, number> = {
  extinguisher: 30,
  hydrant: 30,
  exit_sign: 90,
  emergency_light: 90,
  exit: 180,
  sprinkler: 180,
};

/** 规则限值字段（顺序即对比表/表单的展示顺序） */
export const RULE_FIELD_KEYS: (keyof RuleValues)[] = [
  'maxTravelDistanceM',
  'deadEndDistanceM',
  'extinguisherRadiusM',
  'exitMinAreaM2',
  'exitMaxOccupants',
  'source',
];

export const RULE_FIELD_LABELS: Record<keyof RuleValues, string> = {
  maxTravelDistanceM: '疏散距离限值',
  deadEndDistanceM: '袋形走道限值',
  extinguisherRadiusM: '灭火器保护半径',
  exitMinAreaM2: '需 2 出口的最小面积',
  exitMaxOccupants: '需 2 出口的最小人数',
  source: '依据文号',
};

export const RULE_FIELD_UNITS: Record<keyof RuleValues, string> = {
  maxTravelDistanceM: 'm',
  deadEndDistanceM: 'm',
  extinguisherRadiusM: 'm',
  exitMinAreaM2: '㎡',
  exitMaxOccupants: '人',
  source: '',
};

/** 从规则集中取出可对照的限值快照（历史版本存的就是这个） */
export function ruleValuesOf(r: RuleValues): RuleValues {
  return {
    maxTravelDistanceM: r.maxTravelDistanceM,
    deadEndDistanceM: r.deadEndDistanceM,
    extinguisherRadiusM: r.extinguisherRadiusM,
    exitMinAreaM2: r.exitMinAreaM2,
    exitMaxOccupants: r.exitMaxOccupants,
    source: r.source,
  };
}

/** 两版限值的差异字段（按 RULE_FIELD_KEYS 顺序，用于历史记录「这次动了哪几项」） */
export function diffRuleFields(a: RuleValues, b: RuleValues): (keyof RuleValues)[] {
  return RULE_FIELD_KEYS.filter((k) => a[k] !== b[k]);
}
