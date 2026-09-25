import { useEffect, useMemo, useState } from 'react';
import type { Building, BuildingKind, Floor, RuleSet, RuleValues, RuleVersion, ValidationResult } from '../model';
import { resetRules, restoreRuleVersion, updateRules, useStore } from '../store/store';
import { RULE_FIELD_KEYS, RULE_FIELD_LABELS, RULE_FIELD_UNITS } from '../rules/defaults';
import { validateFloor } from '../lib/engine';
import { floorLabel } from '../store/id';

const KINDS: { key: BuildingKind; label: string }[] = [
  { key: 'office', label: '办公楼' },
  { key: 'retail', label: '商业' },
  { key: 'factory', label: '厂房' },
  { key: 'school', label: '学校' },
];

const fmtVal = (key: keyof RuleValues, v: number | string) => `${v}${RULE_FIELD_UNITS[key]}`;

export function RulesPage() {
  const [openKind, setOpenKind] = useState<BuildingKind>('office');

  return (
    <div className="page">
      <h2>校验规则配置</h2>
      <p className="hint">
        按建筑类别切换规则集；每次修改版本号自动 +1 并记入版本历史 —— 可与任一旧版逐项对照、按旧版重算当前楼层校验结论，也可一键恢复旧版（恢复本身也记一版并记录操作人）。
        数值为参考值，请结合项目实际与当地规范调整。
      </p>
      <div className="ruletabs">
        {KINDS.map((k) => (
          <button key={k.key} className={openKind === k.key ? 'on' : ''} onClick={() => setOpenKind(k.key)}>
            {k.label}
          </button>
        ))}
      </div>
      {KINDS.map((k) => (k.key === openKind ? <KindRules key={k.key} kind={k.key} label={k.label} /> : null))}
    </div>
  );
}

function KindRules({ kind, label }: { kind: BuildingKind; label: string }) {
  const r = useStore((s) => s.rules[kind]);
  const history = useStore((s) => s.ruleHistory)[kind] ?? [];
  const buildings = useStore((s) => s.buildings);
  const floors = useStore((s) => s.floors);
  const [compareSel, setCompareSel] = useState<number | null>(null);
  const [floorSel, setFloorSel] = useState<string>('');

  // 可对照的旧版本（新→旧）；默认选「上一版」
  const past = useMemo(
    () => history.filter((e) => e.version !== r.version).slice().reverse(),
    [history, r.version],
  );
  const compareEntry = past.find((e) => e.version === compareSel) ?? past[0];

  // 该建筑类别下的楼层：切换对比版本时，按旧规则重算其校验结论
  const candidates = useMemo(
    () =>
      buildings
        .filter((b) => b.kind === kind)
        .flatMap((b) => b.floors.map((fid) => ({ b, f: floors[fid] })).filter((x): x is { b: Building; f: Floor } => Boolean(x.f))),
    [buildings, floors, kind],
  );
  const sel = candidates.find((c) => c.f.id === floorSel) ?? candidates[0];
  const floor = sel?.f;

  // 双版本重算（防抖：规则编辑每次击键都会变版本，避免每次击键全量校验）
  const [recheck, setRecheck] = useState<{ old: ValidationResult; cur: ValidationResult } | null>(null);
  const [recheckBusy, setRecheckBusy] = useState(false);
  useEffect(() => {
    if (!floor || !compareEntry) {
      setRecheck(null);
      setRecheckBusy(false);
      return;
    }
    setRecheckBusy(true);
    const t = setTimeout(() => {
      const oldRules: RuleSet = { ...compareEntry.values, buildingKind: kind, version: compareEntry.version };
      setRecheck({ old: validateFloor(floor, oldRules), cur: validateFloor(floor, r) });
      setRecheckBusy(false);
    }, 300);
    return () => clearTimeout(t);
  }, [floor, compareEntry, r, kind]);

  const onRestore = (entry: RuleVersion) => {
    const who = window.prompt(
      `将「${label}」规则恢复为 v${entry.version} 的限值（恢复会生成新版本 v${r.version + 1} 并记入历史）。\n请输入操作人姓名：`,
      '',
    );
    if (who === null) return;
    restoreRuleVersion(kind, entry.version, who);
  };

  return (
    <>
      <div className="section ruleform">
        <h3>{label} · 规则 v{r.version}</h3>
        <label className="row">
          疏散距离限值（m，沿路径）
          <input
            type="number" min={5} step={1} value={r.maxTravelDistanceM}
            onChange={(e) => updateRules(kind, { maxTravelDistanceM: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          袋形走道限值（m）
          <input
            type="number" min={5} step={1} value={r.deadEndDistanceM}
            onChange={(e) => updateRules(kind, { deadEndDistanceM: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          灭火器保护半径（m）
          <input
            type="number" min={3} step={1} value={r.extinguisherRadiusM}
            onChange={(e) => updateRules(kind, { extinguisherRadiusM: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          需 2 个出口的最小面积（㎡）
          <input
            type="number" min={0} step={50} value={r.exitMinAreaM2}
            onChange={(e) => updateRules(kind, { exitMinAreaM2: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          需 2 个出口的最小人数
          <input
            type="number" min={0} step={5} value={r.exitMaxOccupants}
            onChange={(e) => updateRules(kind, { exitMaxOccupants: Number(e.target.value) })}
          />
        </label>
        <label className="row">
          依据文号（打印在报告上）
          <input value={r.source} onChange={(e) => updateRules(kind, { source: e.target.value })} style={{ flex: 1 }} />
        </label>
        <button className="ghost" onClick={() => resetRules(kind)}>恢复默认值</button>
      </div>

      <div className="section">
        <h3>版本对比</h3>
        {!compareEntry ? (
          <p className="hint">还没有历史版本。修改任一限值后，这里可以逐项对照新旧两版（旧值 → 新值）。</p>
        ) : (
          <>
            <label className="row">
              对比版本
              <select value={compareEntry.version} onChange={(e) => setCompareSel(Number(e.target.value))}>
                {past.map((e) => (
                  <option key={e.version} value={e.version}>
                    v{e.version} · {new Date(e.at).toLocaleString('zh-CN')}
                    {[e.note, e.actor].filter(Boolean).length ? ` · ${[e.note, e.actor].filter(Boolean).join(' · ')}` : ''}
                  </option>
                ))}
              </select>
              <span className="hint">对照现行 v{r.version}</span>
            </label>
            <table className="table cmp">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>v{compareEntry.version}（旧）</th>
                  <th>v{r.version}（现行）</th>
                  <th>变化</th>
                </tr>
              </thead>
              <tbody>
                {RULE_FIELD_KEYS.map((key) => {
                  const ov = compareEntry.values[key];
                  const nv = r[key];
                  const changed = ov !== nv;
                  return (
                    <tr key={key} className={changed ? 'changed' : ''}>
                      <td>{RULE_FIELD_LABELS[key]}</td>
                      <td>{fmtVal(key, ov)}</td>
                      <td>{fmtVal(key, nv)}</td>
                      <td>{changed ? <b className="bad">{fmtVal(key, ov)} → {fmtVal(key, nv)}</b> : <span className="hint">未变</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="toolbar">
              <button onClick={() => onRestore(compareEntry)}>恢复 v{compareEntry.version} 为当前版本</button>
              <span className="hint">恢复会生成新版本 v{r.version + 1}，并记录操作人</span>
            </div>

            <h4 className="cmpsub">楼层校验对照（按两版规则分别重算）</h4>
            {candidates.length === 0 ? (
              <p className="hint">「{label}」类别下还没有楼层。在「建筑」页新建该类别建筑并添加楼层后，这里会显示同一楼层按新旧两版规则的校验结论。</p>
            ) : (
              <>
                <label className="row">
                  楼层
                  <select value={floor?.id ?? ''} onChange={(e) => setFloorSel(e.target.value)}>
                    {candidates.map((c) => (
                      <option key={c.f.id} value={c.f.id}>{c.b.name} · {floorLabel(c.f.level)}层</option>
                    ))}
                  </select>
                  {recheckBusy && <span className="spinner">重算中…</span>}
                </label>
                {recheck && (
                  <>
                    <div className="verdictpair">
                      <VerdictCard title={`按 v${compareEntry.version}（旧版）`} result={recheck.old} />
                      <span className="flip-arrow">→</span>
                      <VerdictCard title={`按 v${r.version}（现行）`} result={recheck.cur} />
                    </div>
                    {recheck.old.pass !== recheck.cur.pass && (
                      <p className="flipnote">
                        结论不同：该楼层按 v{compareEntry.version} {recheck.old.pass ? '合格' : '不合规'}，按 v{r.version} {recheck.cur.pass ? '合格' : '不合规'}
                        —— 差异由这次规则调整引起，可对照上表改动项定位原因。
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="section">
        <h3>版本历史（{label}）</h3>
        <table className="table">
          <thead>
            <tr>
              <th>版本</th>
              <th>时间</th>
              <th>改动项</th>
              <th>备注 / 操作人</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((e) => (
              <tr key={e.version} className={e.version === r.version ? 'currow' : ''}>
                <td>v{e.version} {e.version === r.version && <span className="tag">现行</span>}</td>
                <td>{new Date(e.at).toLocaleString('zh-CN')}</td>
                <td>{e.changedFields.length ? e.changedFields.map((f) => RULE_FIELD_LABELS[f]).join('、') : '—'}</td>
                <td>{[e.note, e.actor].filter(Boolean).join(' · ') || '—'}</td>
                <td>
                  {e.version !== r.version && (
                    <button className="ghost" onClick={() => setCompareSel(e.version)}>对比此版</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function VerdictCard({ title, result }: { title: string; result: ValidationResult }) {
  const errors = result.items.filter((i) => i.severity === 'error');
  const warnings = result.items.filter((i) => i.severity === 'warning');
  const shown = [...errors, ...warnings].slice(0, 4);
  const rest = errors.length + warnings.length - shown.length;
  return (
    <div className={`cmpverdict ${result.pass ? 'pass' : 'fail'}`}>
      <div className="cmpverdict-head">
        <span>{title}</span>
        <b>{result.pass ? '✔ 合格' : '✘ 不合规'}</b>
      </div>
      <div className="hint">超限 {errors.length} 项 · 警告 {warnings.length} 项</div>
      {shown.length > 0 && (
        <ul>
          {shown.map((it, i) => (
            <li key={i} className={it.severity}>{it.message}</li>
          ))}
          {rest > 0 && <li className="hint">…另有 {rest} 项</li>}
        </ul>
      )}
    </div>
  );
}
