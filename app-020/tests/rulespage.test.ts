/**
 * 规则页渲染冒烟（node 环境 renderToStaticMarkup，无需 jsdom）：
 * 版本对比表逐项列出五个限值、改动行标出「旧值 → 新值」、
 * 版本历史含恢复记录（操作人）、恢复按钮与楼层选择器出现。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { RulesPage } from '../src/pages/Rules';
import {
  getState,
  addBuilding,
  addFloor,
  addRoom,
  deleteBuilding,
  updateRules,
  restoreRuleVersion,
} from '../src/store/store';
import { rect } from './helpers';

const snap = () => getState();
const render = () => renderToStaticMarkup(createElement(RulesPage));

beforeEach(() => {
  for (const b of [...snap().buildings]) deleteBuilding(b.id);
});

describe('规则页渲染', () => {
  it('U1 无历史版本时显示提示，不出现对比表', () => {
    const html = render();
    expect(html).toContain('校验规则配置');
    expect(html).toContain('还没有历史版本');
    expect(html).not.toContain('恢复 v');
  });

  it('U2 修改限值后：对比表逐项列出，改动行标出旧值 → 新值', () => {
    updateRules('office', { maxTravelDistanceM: 35, extinguisherRadiusM: 15 });
    const html = render();
    // 五个限值项逐项并排
    for (const label of ['疏散距离限值', '袋形走道限值', '灭火器保护半径', '需 2 出口的最小面积', '需 2 出口的最小人数']) {
      expect(html).toContain(label);
    }
    // 旧版（v1）对照现行（v2），改动项给出 旧 → 新
    expect(html).toContain('v1（旧）');
    expect(html).toContain('v2（现行）');
    expect(html).toContain('40m → 35m'); // 疏散距离 40 → 35
    expect(html).toContain('20m → 15m'); // 灭火器半径 20 → 15
    expect(html).toContain('未变'); // 未改动项
    // 历史表记录改动项
    expect(html).toContain('版本历史');
    expect(html).toContain('疏散距离限值、灭火器保护半径');
    // 一键恢复入口
    expect(html).toContain('恢复 v1 为当前版本');
  });

  it('U3 恢复旧版后：历史出现「恢复自 vN · 操作人」，版本号继续 +1', () => {
    updateRules('office', { deadEndDistanceM: 15 });
    restoreRuleVersion('office', 1, '王工');
    const html = render();
    expect(html).toContain('恢复自 v1');
    expect(html).toContain('王工');
    expect(html).toContain(`v${snap().rules.office.version}（现行）`);
  });

  it('U4 有楼层时出现楼层选择器（用于按新旧两版重算校验结论）', () => {
    updateRules('office', { maxTravelDistanceM: 35 });
    const bid = addBuilding('对照楼', 'office');
    const fid = addFloor(bid, 1);
    addRoom(fid, rect(0, 0, 10, 2), '走道', 'corridor');
    const html = render();
    expect(html).toContain('楼层校验对照');
    expect(html).toContain('对照楼 · 1F层');
    // 没有该类别楼层时给出引导
    deleteBuilding(bid);
    expect(render()).toContain('还没有楼层');
  });
});
