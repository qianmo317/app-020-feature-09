/**
 * 规则版本历史（对应需求：改一次记一版，旧版可对照、可一键恢复，恢复也记一版并写明操作人）：
 * - 每次修改/恢复默认/恢复旧版都追加历史版本，版本号只增不减，最后一条 = 当前生效版本；
 * - 历史条目记录改动字段（这次动了哪几个限值）与旧版完整限值（上一版是什么）；
 * - 同一楼层按新旧两版规则重算可得出不同结论（解释「上季度合格、这季度不合格」）；
 * - 恢复旧版生成新版本并记录操作人。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getState,
  addBuilding,
  addFloor,
  addRoom,
  addFacility,
  deleteBuilding,
  updateRules,
  resetRules,
  restoreRuleVersion,
} from '../src/store/store';
import { DEFAULT_RULES, diffRuleFields, ruleValuesOf } from '../src/rules/defaults';
import { validateFloor } from '../src/lib/engine';
import { rect } from './helpers';
import type { BuildingKind } from '../src/model';

const snap = () => getState();
const ALL_KINDS: BuildingKind[] = ['office', 'retail', 'factory', 'school'];
const lastOf = <T,>(arr: T[]): T => arr[arr.length - 1];

beforeEach(() => {
  for (const b of [...snap().buildings]) deleteBuilding(b.id);
});

describe('规则版本历史', () => {
  it('H1 每个类别都有基线版本，且历史最后一条始终对应当前生效规则', () => {
    for (const k of ALL_KINDS) {
      const hist = snap().ruleHistory[k];
      expect(hist.length).toBeGreaterThanOrEqual(1);
      const last = lastOf(hist);
      expect(last.version).toBe(snap().rules[k].version);
      expect(last.values).toEqual(ruleValuesOf(snap().rules[k]));
    }
  });

  it('H2 修改规则追加历史版本：记录改动字段，旧版限值完整保留可对照', () => {
    const r0 = snap().rules.retail;
    const n0 = snap().ruleHistory.retail.length;
    updateRules('retail', { maxTravelDistanceM: 25, deadEndDistanceM: 18 });
    const hist = snap().ruleHistory.retail;
    expect(hist.length).toBe(n0 + 1);
    const e = lastOf(hist);
    expect(e.version).toBe(r0.version + 1);
    expect(e.values.maxTravelDistanceM).toBe(25);
    expect(e.values.deadEndDistanceM).toBe(18);
    expect(e.changedFields).toEqual(['maxTravelDistanceM', 'deadEndDistanceM']);
    expect(typeof e.at).toBe('string');
    // 上一版仍完整保留（「上一版是什么」界面可查）
    const prev = hist[hist.length - 2];
    expect(prev.version).toBe(r0.version);
    expect(prev.values.maxTravelDistanceM).toBe(r0.maxTravelDistanceM);
    expect(prev.values.deadEndDistanceM).toBe(r0.deadEndDistanceM);
  });

  it('H3 一键恢复旧版：限值回到旧版、生成新版本、记录操作人与「恢复自 vN」', () => {
    const r0 = snap().rules.school;
    const v0 = r0.version;
    updateRules('school', { extinguisherRadiusM: 15 });
    updateRules('school', { maxTravelDistanceM: 28 });
    expect(restoreRuleVersion('school', v0, '王工')).toBe(true);
    const r = snap().rules.school;
    expect(r.version).toBe(v0 + 3); // 恢复本身也记一版，版本号只增不减
    expect(r.extinguisherRadiusM).toBe(r0.extinguisherRadiusM);
    expect(r.maxTravelDistanceM).toBe(r0.maxTravelDistanceM);
    const last = lastOf(snap().ruleHistory.school);
    expect(last.actor).toBe('王工');
    expect(last.note).toBe(`恢复自 v${v0}`);
    expect(last.changedFields).toEqual(['maxTravelDistanceM', 'extinguisherRadiusM']);
    // 不变式：历史最后一条 = 当前生效版本
    expect(last.values).toEqual(ruleValuesOf(r));
  });

  it('H4 恢复不存在的版本返回 false 且状态不变', () => {
    const before = snap().rules.factory;
    const n = snap().ruleHistory.factory.length;
    expect(restoreRuleVersion('factory', 9999, '任何人')).toBe(false);
    expect(snap().rules.factory).toBe(before);
    expect(snap().ruleHistory.factory.length).toBe(n);
  });

  it('H5 恢复默认值同样记为新版本（版本号不回退）', () => {
    const r0 = snap().rules.office;
    updateRules('office', { deadEndDistanceM: 15 });
    resetRules('office');
    const r = snap().rules.office;
    expect(r.version).toBe(r0.version + 2);
    expect(r.deadEndDistanceM).toBe(DEFAULT_RULES.office.deadEndDistanceM);
    const last = lastOf(snap().ruleHistory.office);
    expect(last.note).toBe('恢复默认值');
    expect(last.values).toEqual(ruleValuesOf(DEFAULT_RULES.office));
  });

  it('H6 同一楼层按新旧两版重算结论不同；恢复旧版后结论复原（上季度合格→这季度不合格的场景）', () => {
    // 21m 袋形走道：默认限值 22m 合格；收紧到 20m 后不合格
    const bid = addBuilding('对照楼', 'office');
    const fid = addFloor(bid, 1);
    addRoom(fid, rect(0, 0, 21, 2), '走道', 'corridor');
    addFacility(fid, 'exit', 20500, 1000);
    addFacility(fid, 'extinguisher', 10500, 1000);
    const floor = () => snap().floors[fid];

    // 现行（旧）规则下合格
    const v0 = snap().rules.office.version;
    expect(validateFloor(floor(), snap().rules.office).pass).toBe(true);

    // 收紧袋形走道限值 → 按新版重算不合格
    updateRules('office', { deadEndDistanceM: 20 });
    const cur = validateFloor(floor(), snap().rules.office);
    expect(cur.pass).toBe(false);
    expect(cur.items.some((i) => i.type === 'DEADEND_EXCEED')).toBe(true);

    // 用历史中的旧版重算 → 仍合格（规则页「按上一版」结论）
    const oldEntry = snap().ruleHistory.office.find((e) => e.version === v0)!;
    expect(oldEntry.values.deadEndDistanceM).toBe(22);
    const oldRules = { ...oldEntry.values, buildingKind: 'office' as const, version: oldEntry.version };
    expect(validateFloor(floor(), oldRules).pass).toBe(true);

    // 一键恢复旧版 → 现行规则回到旧限值，结论复原，且恢复记录署名
    expect(restoreRuleVersion('office', v0, '李工')).toBe(true);
    expect(validateFloor(floor(), snap().rules.office).pass).toBe(true);
    const last = lastOf(snap().ruleHistory.office);
    expect(last.actor).toBe('李工');
    expect(last.note).toBe(`恢复自 v${v0}`);
  });

  it('H7 diffRuleFields 按固定顺序列出差异字段；ruleValuesOf 只取限值字段', () => {
    const a = ruleValuesOf(DEFAULT_RULES.office);
    expect(diffRuleFields(a, a)).toEqual([]);
    const b = { ...a, extinguisherRadiusM: 12, source: 'X', maxTravelDistanceM: 30 };
    expect(diffRuleFields(a, b)).toEqual(['maxTravelDistanceM', 'extinguisherRadiusM', 'source']);
    expect(Object.keys(a).sort()).toEqual(
      ['deadEndDistanceM', 'exitMaxOccupants', 'exitMinAreaM2', 'extinguisherRadiusM', 'maxTravelDistanceM', 'source'].sort(),
    );
  });
});
