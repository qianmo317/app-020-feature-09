import { useSyncExternalStore } from 'react';
import type {
  Building,
  BuildingKind,
  CheckRecord,
  Facility,
  FacilityKind,
  Floor,
  Pt,
  Room,
  RoomUsage,
  RuleSet,
  RuleVersionMeta,
  ValidationResult,
} from '../model';
import { DEFAULT_RULES } from '../rules/defaults';
import { rulesEqual } from '../rules/diff';
import { nextCode, uid } from './id';
import { polyAreaM2 } from '../lib/geometry';

const STORAGE_KEY = 'fem.v1';

export type AppState = {
  buildings: Building[];
  floors: Record<string, Floor>;
  rules: Record<BuildingKind, RuleSet>;
  /** 各建筑类别规则的全量版本链（按 version 升序）；rules[k] 始终等于末项 */
  ruleHistory: Record<BuildingKind, RuleVersionMeta[]>;
  /** 当前操作人：改动/恢复规则时记入版本溯源 */
  operator: string;
  /** 「您在此」标记（打印版疏散图），按楼层存 */
  marks: Record<string, Pt>;
};

/** 初始版本链：内置默认规则 v1（历史版本功能上线前的数据按此补齐） */
function initialRuleHistory(): Record<BuildingKind, RuleVersionMeta[]> {
  const kinds = Object.keys(DEFAULT_RULES) as BuildingKind[];
  return Object.fromEntries(
    kinds.map((k) => [
      k,
      [
        {
          buildingKind: k,
          version: DEFAULT_RULES[k].version,
          rules: structuredClone(DEFAULT_RULES[k]),
          changedAt: '',
          author: '',
          reason: 'init',
        },
      ],
    ]),
  ) as Record<BuildingKind, RuleVersionMeta[]>;
}

/**
 * 老数据迁移：旧版本只存当前规则、没有版本链。
 * 以当前规则补一条历史，版本号保留（可能已是 v3），标注为版本链功能上线前的规则。
 */
function migrateHistory(
  rules: Record<BuildingKind, RuleSet>,
  stored: Partial<Record<BuildingKind, RuleVersionMeta[]>> | undefined,
): Record<BuildingKind, RuleVersionMeta[]> {
  const seed = initialRuleHistory();
  for (const k of Object.keys(seed) as BuildingKind[]) {
    const hist = stored?.[k];
    if (Array.isArray(hist) && hist.length) {
      seed[k] = hist;
    } else if (rules[k].version > 1) {
      seed[k] = [
        {
          buildingKind: k,
          version: rules[k].version,
          rules: structuredClone(rules[k]),
          changedAt: '',
          author: '',
          reason: 'edit',
          note: '版本链功能上线前已生效的规则（改动明细未留档）',
        },
      ];
    }
  }
  return seed;
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<AppState>;
      // 缺失的节用默认值补齐（如旧版本数据没有 rules/marks），而不是整体丢弃用户数据
      if (s && Array.isArray(s.buildings) && s.floors) {
        const rules = { ...structuredClone(DEFAULT_RULES), ...(s.rules ?? {}) };
        return {
          buildings: s.buildings,
          floors: s.floors,
          rules,
          ruleHistory: migrateHistory(rules, s.ruleHistory),
          operator: s.operator ?? '',
          marks: s.marks ?? {},
        };
      }
    }
  } catch {
    /* 损坏则重新开始 */
  }
  return {
    buildings: [],
    floors: {},
    rules: structuredClone(DEFAULT_RULES),
    ruleHistory: initialRuleHistory(),
    operator: '',
    marks: {},
  };
}

let state: AppState = loadState();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* 存储满时忽略（照片/底图在 IndexedDB，不受影响） */
    }
  }, 200);
}

function setState(patch: (s: AppState) => void) {
  patch(state);
  // 浅拷贝各容器：保证 s.buildings / s.floors / s.rules / s.ruleHistory / s.marks 选择器拿到新引用
  state = {
    buildings: [...state.buildings],
    floors: { ...state.floors },
    rules: { ...state.rules },
    ruleHistory: { ...state.ruleHistory },
    operator: state.operator,
    marks: { ...state.marks },
  };
  persist();
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getState(): AppState {
  return state;
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

/** 修改楼层并替换其引用 —— 保证 useStore(s => s.floors[id]) 的订阅者能感知更新 */
function updateFloor(floorId: string, mut: (f: Floor) => void) {
  setState((s) => {
    const f = s.floors[floorId];
    if (!f) return;
    mut(f);
    s.floors[floorId] = { ...f };
  });
}

// ---------- 建筑 ----------

export function addBuilding(name: string, kind: BuildingKind): string {
  const id = uid();
  const b: Building = { id, name, kind, floors: [], createdAt: new Date().toISOString() };
  setState((s) => s.buildings.push(b));
  return id;
}

export function updateBuilding(id: string, patch: Partial<Pick<Building, 'name' | 'kind'>>) {
  setState((s) => {
    const i = s.buildings.findIndex((x) => x.id === id);
    if (i >= 0) s.buildings[i] = { ...s.buildings[i], ...patch };
  });
}

export function deleteBuilding(id: string) {
  setState((s) => {
    const b = s.buildings.find((x) => x.id === id);
    if (!b) return;
    for (const fid of b.floors) delete s.floors[fid];
    s.buildings = s.buildings.filter((x) => x.id !== id);
  });
}

// ---------- 楼层 ----------

export function addFloor(buildingId: string, level: number): string {
  const id = uid();
  const floor: Floor = {
    id,
    buildingId,
    level,
    scaleMmPerUnit: 1,
    rooms: [],
    facilities: [],
    exits: [],
    version: 0,
  };
  setState((s) => {
    s.floors[id] = floor;
    const bi = s.buildings.findIndex((x) => x.id === buildingId);
    if (bi >= 0) s.buildings[bi] = { ...s.buildings[bi], floors: [...s.buildings[bi].floors, id] };
  });
  return id;
}

export function deleteFloor(floorId: string) {
  setState((s) => {
    const f = s.floors[floorId];
    if (!f) return;
    const bi = s.buildings.findIndex((x) => x.id === f.buildingId);
    if (bi >= 0) {
      s.buildings[bi] = { ...s.buildings[bi], floors: s.buildings[bi].floors.filter((x) => x !== floorId) };
    }
    delete s.floors[floorId];
    delete s.marks[floorId];
  });
}

// ---------- 房间 ----------

export function addRoom(floorId: string, polygon: Pt[], name: string, usage: RoomUsage): string {
  const id = uid();
  updateFloor(floorId, (f) => {
    f.version++;
    f.rooms.push({ id, polygon, name, usage, areaM2: polyAreaM2(polygon) });
  });
  return id;
}

export function updateRoom(floorId: string, roomId: string, patch: Partial<Pick<Room, 'name' | 'usage' | 'occupants'>>) {
  updateFloor(floorId, (f) => {
    const r = f.rooms.find((x) => x.id === roomId);
    if (r) {
      Object.assign(r, patch);
      f.version++;
    }
  });
}

export function deleteRoom(floorId: string, roomId: string) {
  updateFloor(floorId, (f) => {
    f.version++;
    f.rooms = f.rooms.filter((x) => x.id !== roomId);
  });
}

/** 拖动整体平移房间多边形（保留 id、人数等属性与数组顺序） */
export function moveRoom(floorId: string, roomId: string, dx: number, dy: number) {
  updateFloor(floorId, (f) => {
    const r = f.rooms.find((x) => x.id === roomId);
    if (!r) return;
    r.polygon = r.polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    f.version++;
  });
}

// ---------- 设施 ----------

export function addFacility(floorId: string, kind: FacilityKind, x: number, y: number): string {
  const id = uid();
  updateFloor(floorId, (f) => {
    const fac: Facility = { id, kind, x, y, code: nextCode(f, kind), checks: [] };
    if (kind === 'extinguisher') fac.spec = { extType: 'dry_powder', weightKg: 4 };
    f.version++;
    f.facilities.push(fac);
    if (kind === 'exit') f.exits.push(id);
  });
  return id;
}

export function moveFacility(floorId: string, facilityId: string, x: number, y: number) {
  updateFloor(floorId, (f) => {
    const fac = f.facilities.find((x2) => x2.id === facilityId);
    if (fac) {
      fac.x = x;
      fac.y = y;
      f.version++;
    }
  });
}

export function updateFacility(floorId: string, facilityId: string, patch: Partial<Pick<Facility, 'spec'>>) {
  updateFloor(floorId, (f) => {
    const fac = f.facilities.find((x) => x.id === facilityId);
    if (fac && patch.spec) {
      fac.spec = patch.spec;
      f.version++;
    }
  });
}

export function deleteFacility(floorId: string, facilityId: string) {
  updateFloor(floorId, (f) => {
    f.version++;
    f.facilities = f.facilities.filter((x) => x.id !== facilityId);
    f.exits = f.exits.filter((x) => x !== facilityId);
  });
}

export function addCheck(floorId: string, facilityId: string, check: CheckRecord) {
  updateFloor(floorId, (f) => {
    const fac = f.facilities.find((x) => x.id === facilityId);
    if (fac) {
      fac.checks.push(check);
      f.version++;
    }
  });
}

export function deleteCheck(floorId: string, facilityId: string, index: number) {
  updateFloor(floorId, (f) => {
    const fac = f.facilities.find((x) => x.id === facilityId);
    if (fac) {
      fac.checks.splice(index, 1);
      f.version++;
    }
  });
}

// ---------- 底图 / 标记 / 校验结果 ----------

export function setUnderlay(floorId: string, underlay: Floor['underlay']) {
  updateFloor(floorId, (f) => {
    f.underlay = underlay;
  });
}

export function setMark(floorId: string, pt: Pt) {
  setState((s) => {
    s.marks[floorId] = { ...pt };
  });
}

export function setLastValidation(floorId: string, result: ValidationResult) {
  updateFloor(floorId, (f) => {
    f.lastValidation = result;
  });
}

// ---------- 规则（带版本链） ----------

function currentAuthor(s: AppState, author?: string): string {
  return (author ?? s.operator).trim() || '未署名';
}

/**
 * 修改规则并记一版：与当前版完全相同则不升版（返回 false）。
 * 新条目记录时间、操作人与逐字段改动摘要。
 */
export function updateRules(
  kind: BuildingKind,
  patch: Partial<Omit<RuleSet, 'buildingKind' | 'version'>>,
  author?: string,
): boolean {
  let created = false;
  setState((s) => {
    const cur = s.rules[kind];
    const next: RuleSet = { ...cur, ...patch, buildingKind: kind };
    if (rulesEqual(next, cur)) return;
    next.version = cur.version + 1;
    const changes = [
      ...(['maxTravelDistanceM', 'deadEndDistanceM', 'extinguisherRadiusM', 'exitMinAreaM2', 'exitMaxOccupants'] as const)
        .filter((f) => cur[f] !== next[f])
        .map((f) => {
          const label = {
            maxTravelDistanceM: '疏散距离限值',
            deadEndDistanceM: '袋形走道限值',
            extinguisherRadiusM: '灭火器保护半径',
            exitMinAreaM2: '需 2 个出口的最小面积',
            exitMaxOccupants: '需 2 个出口的最大人数',
          }[f];
          const unit = {
            maxTravelDistanceM: 'm',
            deadEndDistanceM: 'm',
            extinguisherRadiusM: 'm',
            exitMinAreaM2: '㎡',
            exitMaxOccupants: '人',
          }[f];
          return `修改 ${label}（${cur[f]}→${next[f]}${unit}）`;
        }),
      ...(cur.source !== next.source ? [`修改依据文号（${cur.source || '空'}→${next.source || '空'}）`] : []),
    ];
    s.rules[kind] = next;
    s.ruleHistory[kind] = [
      ...s.ruleHistory[kind],
      {
        buildingKind: kind,
        version: next.version,
        rules: structuredClone(next),
        changedAt: new Date().toISOString(),
        author: currentAuthor(s, author),
        reason: 'edit',
        note: changes.join('；'),
      },
    ];
    created = true;
  });
  return created;
}

/**
 * 一键恢复某历史版本：以该版限值作为当前版，但版本号继续 +1（不回退），
 * 并记录恢复人与来源版本，事后可查「谁在何时把哪一版恢复了」。
 * 与当前版完全相同则不升版（返回 false）。
 */
export function restoreRules(kind: BuildingKind, fromVersion: number, author?: string): boolean {
  let done = false;
  setState((s) => {
    const src = s.ruleHistory[kind].find((m) => m.version === fromVersion);
    if (!src) return;
    const cur = s.rules[kind];
    if (rulesEqual(src.rules, cur)) return;
    const who = currentAuthor(s, author);
    const next: RuleSet = { ...structuredClone(src.rules), version: cur.version + 1 };
    s.rules[kind] = next;
    s.ruleHistory[kind] = [
      ...s.ruleHistory[kind],
      {
        buildingKind: kind,
        version: next.version,
        rules: structuredClone(next),
        changedAt: new Date().toISOString(),
        author: who,
        reason: 'restore',
        note: `${who} 从 v${src.version} 恢复`,
      },
    ];
    done = true;
  });
  return done;
}

/**
 * 恢复内置默认值：同样视为一次规则变更，版本号 +1 并留档，
 * 而不是把版本号抹回 1（历史版本不可丢失）。
 */
export function resetRules(kind: BuildingKind, author?: string) {
  setState((s) => {
    const cur = s.rules[kind];
    const def = DEFAULT_RULES[kind];
    const who = currentAuthor(s, author);
    const next: RuleSet = { ...structuredClone(def), version: cur.version + 1 };
    if (rulesEqual(next, cur)) return;
    s.rules[kind] = next;
    s.ruleHistory[kind] = [
      ...s.ruleHistory[kind],
      {
        buildingKind: kind,
        version: next.version,
        rules: structuredClone(next),
        changedAt: new Date().toISOString(),
        author: who,
        reason: 'reset',
        note: `${who} 恢复为内置默认值`,
      },
    ];
  });
}

/** 设置当前操作人（随状态持久化，后续规则改动自动带上） */
export function setOperator(name: string) {
  setState((s) => {
    s.operator = name;
  });
}

// ---------- 示例数据 ----------

const M = 1000;
function rect(x: number, y: number, w: number, h: number): Pt[] {
  return [
    { x: x * M, y: y * M },
    { x: (x + w) * M, y: y * M },
    { x: (x + w) * M, y: (y + h) * M },
    { x: x * M, y: (y + h) * M },
  ];
}

/** 载入示例：41m 走道双出口 + 10 个房间，办公楼规则全过；切换厂房规则后灭火器覆盖不合规 */
export function loadDemo(): string {
  let bid = '';
  setState((s) => {
    const buildingId = uid();
    bid = buildingId;
    const floorId = uid();
    s.buildings.push({
      id: buildingId,
      name: '示例办公楼',
      kind: 'office',
      floors: [floorId],
      createdAt: new Date().toISOString(),
    });
    const rooms: Room[] = [];
    const mk = (name: string, usage: RoomUsage, poly: Pt[], occupants?: number) => {
      rooms.push({ id: uid(), polygon: poly, name, usage, areaM2: polyAreaM2(poly), occupants });
    };
    mk('走道', 'corridor', rect(0, 0, 41, 2));
    const names = ['101', '102', '103', '104', '105'];
    for (let i = 0; i < 5; i++) {
      mk(`${names[i]}室`, i === 2 ? 'storage' : 'office', rect(i * 8, 2, 8, 6), i === 2 ? 2 : 10);
      mk(`${names[i]}B室`, i === 0 ? 'retail' : 'office', rect(i * 8, -5, 8, 5), i === 0 ? 15 : 10);
    }
    const facilities: Facility[] = [];
    const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    const mkF = (kind: FacilityKind, x: number, y: number, code: string, checks: Facility['checks'] = [], spec?: Facility['spec']) => {
      facilities.push({ id: uid(), kind, x: x * M, y: y * M, code, checks, spec });
    };
    mkF('exit', 0.5, 1, '1F-EXIT-01');
    mkF('exit', 40.5, 1, '1F-EXIT-02');
    mkF('extinguisher', 20.5, 1, '1F-EX-01', [{ date: dateStr(20), status: 'ok' }], { extType: 'dry_powder', weightKg: 4 });
    mkF('extinguisher', 4, 5, '1F-EX-02', [{ date: dateStr(45), status: 'ok' }], { extType: 'dry_powder', weightKg: 4 });
    mkF('extinguisher', 36, 5, '1F-EX-03', [], { extType: 'co2', weightKg: 2 });
    mkF('hydrant', 10, 1, '1F-HY-01', [{ date: dateStr(10), status: 'ok' }]);
    mkF('exit_sign', 1, 1.7, '1F-ES-01', [{ date: dateStr(15), status: 'ok' }]);
    mkF('exit_sign', 40, 1.7, '1F-ES-02', [{ date: dateStr(15), status: 'ok' }]);
    mkF('emergency_light', 20.5, 0.4, '1F-EL-01', [{ date: dateStr(15), status: 'ok' }]);
    const exits = facilities.filter((f) => f.kind === 'exit').map((f) => f.id);
    s.floors[floorId] = {
      id: floorId,
      buildingId,
      level: 1,
      scaleMmPerUnit: 1,
      rooms,
      facilities,
      exits,
      version: 0,
    };
  });
  persist();
  return bid;
}
