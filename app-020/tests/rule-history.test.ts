/**
 * 规则版本链验收用例：
 * - 每次实质改动记一版（时间/操作人/改动摘要），无改动不升版；
 * - 旧版一键恢复 = 以旧限值生成新版本，版本号继续 +1 且写明谁恢复的；
 * - 两版逐项 diff；同一楼层按不同版本重算，结论可能翻转。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_RULES } from '../src/rules/defaults';
import { diffRules, changedFields, describeChanges, rulesEqual } from '../src/rules/diff';
import { mkRoom, rect, mkFloor, validateFloor } from './helpers';

// 每个用例重新加载 store：loadState 无 localStorage 时回到内置默认（v1）
let store: typeof import('../src/store/store');
beforeEach(async () => {
  vi.resetModules();
  store = await import('../src/store/store');
});

describe('版本链（ruleHistory）', () => {
  it('H1 初始：每类建筑只有内置 v1，reason=init，rules 与末项一致', () => {
    const s = store.getState();
    for (const k of ['office', 'retail', 'factory', 'school'] as const) {
      expect(s.ruleHistory[k]).toHaveLength(1);
      expect(s.ruleHistory[k][0]).toMatchObject({ version: 1, reason: 'init' });
      expect(s.rules[k]).toEqual(s.ruleHistory[k][0].rules);
    }
  });

  it('H2 实质改动：版本 +1、追加历史并记录操作人/时间/逐项改动摘要', () => {
    store.setOperator('张工');
    const v0 = store.getState().rules.office.version;
    const ok = store.updateRules('office', { maxTravelDistanceM: 30, deadEndDistanceM: 18 });
    expect(ok).toBe(true);
    const s = store.getState();
    expect(s.ruleHistory.office).toHaveLength(2);
    const m = s.ruleHistory.office[1];
    expect(m.version).toBe(v0 + 1);
    expect(m.author).toBe('张工');
    expect(m.reason).toBe('edit');
    expect(m.changedAt).toBeTypeOf('string');
    expect(m.note).toContain('疏散距离限值（40→30m）');
    expect(m.note).toContain('袋形走道限值（22→18m）');
    expect(m.rules.maxTravelDistanceM).toBe(30);
  });

  it('H3 与当前版完全相同的提交不升版（返回 false）', () => {
    store.setOperator('李工');
    const before = store.getState().ruleHistory.office.length;
    const ok = store.updateRules('office', {
      maxTravelDistanceM: DEFAULT_RULES.office.maxTravelDistanceM,
      source: DEFAULT_RULES.office.source,
    });
    expect(ok).toBe(false);
    expect(store.getState().ruleHistory.office).toHaveLength(before);
  });

  it('H4 未署名时回落为「未署名」，不影响版本生成', () => {
    store.setOperator('   ');
    store.updateRules('retail', { extinguisherRadiusM: 15 });
    const hist = store.getState().ruleHistory.retail;
    expect(hist[hist.length - 1].author).toBe('未署名');
  });

  it('H5 一键恢复旧版：限值回到旧版，版本号继续 +1，并写明谁从哪版恢复', () => {
    store.setOperator('张工');
    store.updateRules('office', { maxTravelDistanceM: 30 }); // v2：40→30
    const v2 = store.getState().rules.office.version;
    store.updateRules('office', { maxTravelDistanceM: 25 }); // v3：30→25
    expect(store.getState().rules.office.maxTravelDistanceM).toBe(25);

    store.setOperator('王工');
    const ok = store.restoreRules('office', v2); // 恢复到 v2 的限值
    expect(ok).toBe(true);

    const s = store.getState();
    expect(s.rules.office.version).toBe(4); // 不是回退到 2
    expect(s.rules.office.maxTravelDistanceM).toBe(30);
    const m = s.ruleHistory.office[s.ruleHistory.office.length - 1];
    expect(m.reason).toBe('restore');
    expect(m.author).toBe('王工');
    expect(m.note).toContain('王工');
    expect(m.note).toContain('v2');
    // 历史版本一个都没丢
    expect(s.ruleHistory.office.map((x) => x.version)).toEqual([1, 2, 3, 4]);
  });

  it('H6 恢复一个与当前限值相同的版本 → 不升版', () => {
    store.setOperator('张工');
    store.updateRules('office', { maxTravelDistanceM: 30 }); // v2
    store.updateRules('office', { maxTravelDistanceM: 40 }); // v3（与 v1 同限值）
    const before = store.getState().ruleHistory.office.length;
    expect(store.restoreRules('office', 1)).toBe(false);
    expect(store.getState().ruleHistory.office).toHaveLength(before);
  });

  it('H7 恢复内置默认值 = reset 新版本（版本号不抹回 1）', () => {
    store.setOperator('张工');
    store.updateRules('factory', { extinguisherRadiusM: 5 });
    store.resetRules('factory');
    const s = store.getState();
    expect(s.rules.office).toEqual(DEFAULT_RULES.office); // 其他类别不受影响
    expect(s.rules.factory.version).toBe(3);
    expect(s.rules.factory).toEqual(s.ruleHistory.factory[s.ruleHistory.factory.length - 1].rules);
    expect(s.ruleHistory.factory[s.ruleHistory.factory.length - 1].reason).toBe('reset');
    expect(s.ruleHistory.factory[s.ruleHistory.factory.length - 1].note).toContain('张工');
  });
});

describe('两版逐项对照（diff）', () => {
  it('D1 五个限值逐项给出旧值/新值并标出改动项', () => {
    const v1 = { ...DEFAULT_RULES.office };
    const v2 = { ...v1, maxTravelDistanceM: 30, extinguisherRadiusM: 15, version: 2 };
    const d = diffRules(v1, v2);
    expect(d.map((x) => x.key)).toEqual([
      'maxTravelDistanceM',
      'deadEndDistanceM',
      'extinguisherRadiusM',
      'exitMinAreaM2',
      'exitMaxOccupants',
    ]);
    expect(changedFields(v1, v2).map((x) => x.key)).toEqual([
      'maxTravelDistanceM',
      'extinguisherRadiusM',
    ]);
    expect(describeChanges(v1, v2)).toBe('疏散距离限值（40→30m）；灭火器保护半径（20→15m）');
    expect(rulesEqual(v1, v2)).toBe(false);
  });
});

describe('对照版本重算同一楼层（结论翻转）', () => {
  it('V1 21m 袋形走道：旧版 22m 限值合规，新版 20m 限值不合规', () => {
    const { floor } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 21, 2))], [
      { kind: 'exit', x: 20.5, y: 1 },
      { kind: 'extinguisher', x: 10.5, y: 1 },
    ]);
    const oldRules = { ...DEFAULT_RULES.office, deadEndDistanceM: 22, version: 1 };
    const newRules = { ...DEFAULT_RULES.office, deadEndDistanceM: 20, version: 2 };
    const old = validateFloor(floor, oldRules);
    const now = validateFloor(floor, newRules);
    expect(old.pass).toBe(true);
    expect(now.pass).toBe(false);
    expect(now.items.some((i) => i.type === 'DEADEND_EXCEED')).toBe(true);
    expect(now.rulesSnapshot.version).toBe(2);
    expect(old.rulesSnapshot.version).toBe(1);
  });
});
