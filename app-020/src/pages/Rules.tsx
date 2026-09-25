import { useEffect, useMemo, useState } from 'react';
import type { BuildingKind, RuleSet, RuleValueField, ValidationResult } from '../model';
import { resetRules, restoreRules, setOperator, updateRules, useStore } from '../store/store';
import { floorLabel } from '../store/id';
import { validateFloor } from '../lib/engine';
import { RULE_FIELDS, diffRules } from '../rules/diff';

const KINDS: { key: BuildingKind; label: string }[] = [
  { key: 'office', label: '办公楼' },
  { key: 'retail', label: '商业' },
  { key: 'factory', label: '厂房' },
  { key: 'school', label: '学校' },
];

const FIELD_INPUT: Record<RuleValueField, { min: number; step: number }> = {
  maxTravelDistanceM: { min: 5, step: 1 },
  deadEndDistanceM: { min: 5, step: 1 },
  extinguisherRadiusM: { min: 3, step: 1 },
  exitMinAreaM2: { min: 0, step: 50 },
  exitMaxOccupants: { min: 0, step: 5 },
};

type Draft = Pick<RuleSet, RuleValueField | 'source'>;

const toDraft = (r: RuleSet): Draft => ({
  maxTravelDistanceM: r.maxTravelDistanceM,
  deadEndDistanceM: r.deadEndDistanceM,
  extinguisherRadiusM: r.extinguisherRadiusM,
  exitMinAreaM2: r.exitMinAreaM2,
  exitMaxOccupants: r.exitMaxOccupants,
  source: r.source,
});

const REASON_LABEL: Record<string, string> = {
  init: '初始版本',
  edit: '编辑',
  restore: '恢复旧版',
  reset: '恢复默认',
};

/** 受规则限值驱动的校验项（其余如检查过期与规则版本无关，对照时不展示） */
const RULE_ITEM_TYPES = new Set([
  'TRAVEL_EXCEED',
  'DEADEND_EXCEED',
  'EXIT_COUNT',
  'EXIT_NOT_CONNECTED',
  'COVERAGE_UNCOVERED',
]);

const ITEM_TYPE_LABEL: Record<string, string> = {
  TRAVEL_EXCEED: '疏散距离超限',
  DEADEND_EXCEED: '袋形走道超限',
  EXIT_COUNT: '安全出口数量',
  EXIT_NOT_CONNECTED: '出口未连通',
  COVERAGE_UNCOVERED: '灭火器覆盖不足',
};

export function RulesPage() {
  const rules = useStore((s) => s.rules);
  const history = useStore((s) => s.ruleHistory);
  const operator = useStore((s) => s.operator);
  const buildings = useStore((s) => s.buildings);
  const floorsMap = useStore((s) => s.floors);

  const [openKind, setOpenKind] = useState<BuildingKind>('office');
  const [draft, setDraft] = useState<Draft>(() => toDraft(rules.office));
  const [oldVer, setOldVer] = useState(1);
  const [newVer, setNewVer] = useState(1);
  const [floorId, setFloorId] = useState('');

  const current = rules[openKind];
  const versions = history[openKind] ?? [];
  const latestVer = versions.length ? versions[versions.length - 1].version : current.version;

  // 切换建筑类别 / 当前版本变化（保存或恢复后）→ 草稿与对照选择复位
  useEffect(() => {
    setDraft(toDraft(rules[openKind]));
    const vs = history[openKind] ?? [];
    const latest = vs.length ? vs[vs.length - 1].version : rules[openKind].version;
    const prev = vs.length >= 2 ? vs[vs.length - 2].version : latest;
    setNewVer(latest);
    setOldVer(prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKind, latestVer]);

  // 默认选中第一个楼层；已选楼层被删除时回退
  const floorOptions = useMemo(
    () =>
      buildings.flatMap((b) =>
        b.floors
          .map((id) => floorsMap[id])
          .filter(Boolean)
          .map((f) => ({ id: f.id, label: `${b.name} · ${floorLabel(f.level)}` })),
      ),
    [buildings, floorsMap],
  );
  useEffect(() => {
    if (!floorOptions.some((o) => o.id === floorId)) setFloorId(floorOptions[0]?.id ?? '');
  }, [floorOptions, floorId]);

  const numbersValid = RULE_FIELDS.every((f) => Number.isFinite(draft[f.key]) && draft[f.key] >= 0);
  const draftChanged =
    RULE_FIELDS.some((f) => draft[f.key] !== current[f.key]) || draft.source !== current.source;
  const hasOperator = operator.trim().length > 0;

  const oldMeta = versions.find((m) => m.version === oldVer) ?? versions[versions.length - 1];
  const newMeta = versions.find((m) => m.version === newVer) ?? versions[versions.length - 1];
  const diffs = oldMeta && newMeta ? diffRules(oldMeta.rules, newMeta.rules) : [];
  const sourceChanged = oldMeta && newMeta && oldMeta.rules.source !== newMeta.rules.source;

  // 切换对照版本：同一楼层分别按两版规则重算（仅用于对照展示，不覆盖楼层已保存的校验结论）
  const cmp = useMemo(() => {
    const floor = floorsMap[floorId];
    if (!floor || !oldMeta || !newMeta) return null;
    return {
      floor,
      old: validateFloor(floor, oldMeta.rules),
      new: validateFloor(floor, newMeta.rules),
    };
  }, [floorsMap, floorId, oldMeta, newMeta]);

  const save = () => {
    if (!hasOperator || !numbersValid || !draftChanged) return;
    updateRules(openKind, { ...draft });
  };

  const restore = (ver: number) => {
    if (!hasOperator) return;
    if (confirm(`以 v${ver} 的限值生成新版本并恢复为当前规则？操作人：${operator.trim()}`)) {
      restoreRules(openKind, ver);
    }
  };

  const resetDefault = () => {
    if (!hasOperator) return;
    if (confirm('恢复为内置默认值？将生成新版本并记录操作人。')) resetRules(openKind);
  };

  return (
    <div className="page">
      <h2>校验规则配置</h2>
      <p className="hint">
        每次保存生成新版本（版本号 +1），旧版本完整保留；可任选两版逐项对照限值改动，并按旧规则对楼层重新校验。
        恢复旧版同样记一版并写明操作人。数值为参考值，请结合项目实际与当地规范调整。
      </p>

      <div className="toolbar opbar">
        <label className="row">
          当前操作人（改动/恢复规则时署名）
          <input
            value={operator}
            placeholder="如：张工"
            onChange={(e) => setOperator(e.target.value)}
            style={{ width: 160 }}
          />
        </label>
        {!hasOperator && <span className="warn">填写操作人后才能保存、恢复规则</span>}
      </div>

      <div className="ruletabs">
        {KINDS.map((k) => (
          <button key={k.key} className={openKind === k.key ? 'on' : ''} onClick={() => setOpenKind(k.key)}>
            {k.label}
          </button>
        ))}
      </div>

      {/* 当前版本编辑：改完点保存才出新版，避免一次调整产生一串版本 */}
      <div className="section ruleform">
        <h3>{KINDS.find((k) => k.key === openKind)?.label} · 当前规则 v{current.version}</h3>
        {RULE_FIELDS.map((f) => (
          <label className="row" key={f.key}>
            {f.label}（{f.unit}）
            <input
              type="number"
              min={FIELD_INPUT[f.key].min}
              step={FIELD_INPUT[f.key].step}
              value={draft[f.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))}
            />
          </label>
        ))}
        <label className="row">
          依据文号（打印在报告上）
          <input value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))} style={{ flex: 1 }} />
        </label>
        <div className="toolbar">
          <button onClick={save} disabled={!hasOperator || !numbersValid || !draftChanged}>
            保存为 v{current.version + 1}
          </button>
          <button className="ghost" onClick={resetDefault} disabled={!hasOperator}>
            恢复内置默认值
          </button>
          {!draftChanged && <span className="hint">与当前版本一致，无改动</span>}
        </div>
      </div>

      {/* 两版对照 */}
      <div className="section">
        <h3>版本对照</h3>
        <div className="toolbar">
          <label className="row">
            旧版
            <select value={oldMeta?.version} onChange={(e) => setOldVer(Number(e.target.value))}>
              {versions.map((m) => (
                <option key={m.version} value={m.version}>v{m.version}（{REASON_LABEL[m.reason]}）</option>
              ))}
            </select>
          </label>
          <label className="row">
            新版
            <select value={newMeta?.version} onChange={(e) => setNewVer(Number(e.target.value))}>
              {versions.map((m) => (
                <option key={m.version} value={m.version}>v{m.version}（{REASON_LABEL[m.reason]}）</option>
              ))}
            </select>
          </label>
          {oldMeta && newMeta && (
            <span className="hint">
              {oldMeta.changedAt ? new Date(oldMeta.changedAt).toLocaleString('zh-CN') : '内置版本'} →{' '}
              {newMeta.changedAt ? new Date(newMeta.changedAt).toLocaleString('zh-CN') : '内置版本'}
            </span>
          )}
        </div>

        {oldMeta && newMeta && (
          <table className="table diff-table">
            <thead>
              <tr>
                <th>限值项</th>
                <th>旧版 v{oldMeta.version}</th>
                <th />
                <th>新版 v{newMeta.version}</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => (
                <tr key={d.key} className={d.changed ? 'changed' : ''}>
                  <td>{d.label}</td>
                  <td className={d.changed ? 'oldval' : ''}>{d.oldValue}{d.unit}</td>
                  <td className="arrow">{d.changed ? '→' : ''}</td>
                  <td className={d.changed ? 'newval' : ''}>{d.newValue}{d.unit}</td>
                </tr>
              ))}
              <tr className={sourceChanged ? 'changed' : ''}>
                <td>依据文号</td>
                <td className={sourceChanged ? 'oldval' : ''}>{oldMeta.rules.source}</td>
                <td className="arrow">{sourceChanged ? '→' : ''}</td>
                <td className={sourceChanged ? 'newval' : ''}>{newMeta.rules.source}</td>
              </tr>
            </tbody>
          </table>
        )}

        {/* 同一楼层按两版规则分别重算 */}
        <h4>用对照版本重算楼层</h4>
        {floorOptions.length === 0 ? (
          <p className="hint">暂无楼层。先在首页创建建筑与楼层，或载入示例，再回到这里对照。</p>
        ) : (
          <>
            <label className="row">
              对照楼层
              <select value={floorId} onChange={(e) => setFloorId(e.target.value)} style={{ maxWidth: 320 }}>
                {floorOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </label>
            {cmp && (
              <div className="cmpgrid">
                <VerdictCard title={`旧版 v${oldMeta!.version}`} result={cmp.old} />
                <VerdictCard title={`新版 v${newMeta!.version}`} result={cmp.new} />
              </div>
            )}
            {cmp && cmp.old.pass !== cmp.new.pass && (
              <p className="warn">
                ⚠ 结论翻转：同一楼层按 v{oldMeta!.version} {cmp.old.pass ? '合规' : '不合规'}，
                按 v{newMeta!.version} {cmp.new.pass ? '合规' : '不合规'}。
              </p>
            )}
          </>
        )}
      </div>

      {/* 版本历史：旧版一键恢复 */}
      <div className="section">
        <h3>版本历史</h3>
        <ul className="hist">
          {[...versions].reverse().map((m) => {
            const isCurrent = m.version === current.version;
            return (
              <li key={m.version} className={isCurrent ? 'current' : ''}>
                <div className="hist-head">
                  <b>v{m.version}</b>
                  <span className="tag">{REASON_LABEL[m.reason]}</span>
                  <span className="hint">
                    {m.changedAt ? new Date(m.changedAt).toLocaleString('zh-CN') : '内置初始版本'}
                    {m.author ? ` · ${m.author}` : ''}
                  </span>
                  {isCurrent && <span className="badge st-ok">当前版本</span>}
                  {!isCurrent && (
                    <button disabled={!hasOperator} onClick={() => restore(m.version)}>
                      恢复为当前版本
                    </button>
                  )}
                </div>
                {m.note && <div className="hint hist-note">{m.note}</div>}
                <div className="hint hist-vals">
                  {RULE_FIELDS.map((f) => `${f.label.replace('限值', '').replace('需 2 个出口的', '')} ${m.rules[f.key]}${f.unit}`).join(' · ')}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function VerdictCard({ title, result }: { title: string; result: ValidationResult }) {
  const ruleItems = result.items.filter((i) => RULE_ITEM_TYPES.has(i.type));
  return (
    <div className={`verdict-card ${result.pass ? 'pass' : 'fail'}`}>
      <div className="vc-head">
        <span>{title}</span>
        <b>{result.pass ? '✔ 合规' : '✘ 不合规'}</b>
      </div>
      <div className="vc-stats">
        <span>
          疏散最远 {result.travelWorstM != null ? `${result.travelWorstM.toFixed(1)}m` : '—'}
        </span>
        <span>
          袋形 {result.deadEndM != null ? `${result.deadEndM.toFixed(1)}m` : '—'}
        </span>
        <span>
          未覆盖 {result.coverage ? `${result.coverage.uncoveredM2.toFixed(1)}㎡` : '—'}
        </span>
        <span>
          出口 {result.exits.present}/{result.exits.required}
        </span>
      </div>
      {ruleItems.length === 0 ? (
        <p className="hint">无规则相关不合规项</p>
      ) : (
        <ul className="vc-items">
          {ruleItems.map((it, i) => (
            <li key={i} className={it.severity}>
              <b>{ITEM_TYPE_LABEL[it.type] ?? it.type}</b> {it.message}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">依据：{result.rulesSnapshot.source}</p>
    </div>
  );
}
