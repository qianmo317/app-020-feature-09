import type { RuleSet, RuleValueField } from '../model';

/** 五个参与逐项对照的限值字段（界面顺序） */
export const RULE_FIELDS: { key: RuleValueField; label: string; unit: string }[] = [
  { key: 'maxTravelDistanceM', label: '疏散距离限值', unit: 'm' },
  { key: 'deadEndDistanceM', label: '袋形走道限值', unit: 'm' },
  { key: 'extinguisherRadiusM', label: '灭火器保护半径', unit: 'm' },
  { key: 'exitMinAreaM2', label: '需 2 个出口的最小面积', unit: '㎡' },
  { key: 'exitMaxOccupants', label: '需 2 个出口的最大人数', unit: '人' },
];

export type RuleFieldDiff = {
  key: RuleValueField;
  label: string;
  unit: string;
  oldValue: number;
  newValue: number;
  changed: boolean;
};

/** 逐项对照两版规则：返回五个限值及是否改动（用于并排对照表） */
export function diffRules(oldRules: RuleSet, newRules: RuleSet): RuleFieldDiff[] {
  return RULE_FIELDS.map((f) => {
    const oldValue = oldRules[f.key];
    const newValue = newRules[f.key];
    return { ...f, oldValue, newValue, changed: oldValue !== newValue };
  });
}

/** 两版之间发生改动的字段 */
export function changedFields(oldRules: RuleSet, newRules: RuleSet): RuleFieldDiff[] {
  return diffRules(oldRules, newRules).filter((d) => d.changed);
}

/** 「疏散距离限值 40→30m」式的改动摘要；无改动返回空串 */
export function describeChanges(oldRules: RuleSet, newRules: RuleSet): string {
  return changedFields(oldRules, newRules)
    .map((d) => `${d.label}（${d.oldValue}→${d.newValue}${d.unit}）`)
    .join('；');
}

/** 规则是否与某版完全一致（含依据文号；恢复时判重） */
export function rulesEqual(a: RuleSet, b: RuleSet): boolean {
  return (
    a.maxTravelDistanceM === b.maxTravelDistanceM &&
    a.deadEndDistanceM === b.deadEndDistanceM &&
    a.extinguisherRadiusM === b.extinguisherRadiusM &&
    a.exitMinAreaM2 === b.exitMinAreaM2 &&
    a.exitMaxOccupants === b.exitMaxOccupants &&
    a.source === b.source
  );
}
