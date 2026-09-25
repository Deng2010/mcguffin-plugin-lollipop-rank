/**
 * 榜榜糖核心纯逻辑 —— 无 React / 无 DOM / 无 SDK 依赖，便于单测与推理。
 *
 * 约定：
 *  - 所有「天 / 周」均以北京时间（UTC+8）计算，与需求「每周一 0:00 北京时间结算」一致；
 *  - 玩法参数由 {@link CandyConfig} 描述，默认值与 v1 硬编码值完全一致，
 *    可由管理员在插件页面调整（越界值一律夹紧，见 {@link normalizeConfig}）；
 *  - 存储读写通过 {@link CandyReader} / {@link CandyWriter} 注入，本文件不碰网络。
 */

/** 北京时间相对 UTC 的偏移（毫秒） */
export const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;

// ── 玩法参数 ──

/** 可调玩法参数（默认 = v1 的硬编码取值，保证行为不变） */
export interface CandyConfig {
  /** 糖数为 0 时的基础成功率，区间 [0.01, 1] */
  successBase: number;
  /** 每多 1 颗糖，成功率乘性衰减系数，区间 [0.01, 1]（越小衰减越快） */
  successDecay: number;
  /** 成功率下限，区间 [0, 1]，避免糖数很高时永远失败 */
  successFloor: number;
  /** 每个用户每天可点出的糖次数上限，区间 [0, 1000] */
  dailyLimit: number;
}

/** 默认玩法参数（= v1 行为） */
export const DEFAULT_CONFIG: CandyConfig = {
  successBase: 0.6,
  successDecay: 0.8,
  successFloor: 0.05,
  dailyLimit: 10,
};

/** 各参数允许的区间（越界夹紧而非报错，避免脏数据把玩法算崩） */
export const CONFIG_BOUNDS = {
  successBase: { min: 0.01, max: 1 },
  successDecay: { min: 0.01, max: 1 },
  successFloor: { min: 0, max: 1 },
  dailyLimit: { min: 0, max: 1000 },
} as const;

/** 冠军两侧的棒棒糖 emoji */
export const CHAMPION_EMOJI = "🍭";

/** 糖数展示用的 emoji */
export const CANDY_EMOJI = "🍬";

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed =
    typeof value === "string" ? Number(value.trim()) : (value as number);
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * 把任意输入规整为一份合法配置：
 *  - 缺失 / 非数字 / NaN 字段回退默认值；
 *  - 越界数值夹紧到 {@link CONFIG_BOUNDS}；
 *  - `dailyLimit` 向下取整（宁可少给一次，也不给出半次）。
 */
export function normalizeConfig(input: unknown): CandyConfig {
  const raw = (
    input && typeof input === "object" ? input : {}
  ) as Record<string, unknown>;
  return {
    successBase: clampNumber(
      raw.successBase,
      DEFAULT_CONFIG.successBase,
      CONFIG_BOUNDS.successBase.min,
      CONFIG_BOUNDS.successBase.max,
    ),
    successDecay: clampNumber(
      raw.successDecay,
      DEFAULT_CONFIG.successDecay,
      CONFIG_BOUNDS.successDecay.min,
      CONFIG_BOUNDS.successDecay.max,
    ),
    successFloor: clampNumber(
      raw.successFloor,
      DEFAULT_CONFIG.successFloor,
      CONFIG_BOUNDS.successFloor.min,
      CONFIG_BOUNDS.successFloor.max,
    ),
    dailyLimit: Math.floor(
      clampNumber(
        raw.dailyLimit,
        DEFAULT_CONFIG.dailyLimit,
        CONFIG_BOUNDS.dailyLimit.min,
        CONFIG_BOUNDS.dailyLimit.max,
      ),
    ),
  };
}

/** 解析 KV 里存的原始配置字符串（空 / 坏 JSON / 非法值都回退默认） */
export function parseConfig(raw: string | null | undefined): CandyConfig {
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 是否等于默认参数（设置面板用于提示「当前为默认值」） */
export function isDefaultConfig(config: CandyConfig): boolean {
  const keys = Object.keys(DEFAULT_CONFIG) as Array<keyof CandyConfig>;
  return keys.every((key) => config[key] === DEFAULT_CONFIG[key]);
}

// ── 北京时间工具 ──

/** 当前北京时间对应的 Date（仅用于取 UTC 年月日/周，勿用于本地展示） */
export function bjDate(now: Date = new Date()): Date {
  return new Date(now.getTime() + BJ_OFFSET_MS);
}

/** 北京时间日期 key，形如 2026-02-02（用于每日次数计数，按天自然过期） */
export function bjDateKey(now: Date = new Date()): string {
  return bjDate(now).toISOString().slice(0, 10);
}

/**
 * ISO 周计算（对给定日期取其 UTC 字段，见 {@link bjDate} 的平移语义），
 * 返回形如 `2026-W06` 的周标识。
 */
export function isoWeekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // 将周对齐到「周一为一周开始」的 ISO 语义
  const dayNum = d.getUTCDay() || 7; // 周日=7，周一=1 … 周六=6
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // 移到本周四（ISO 周归属该周四所在年）
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 当前「北京时间周」标识，形如 2026-W06 */
export function bjWeekKey(now: Date = new Date()): string {
  return isoWeekKey(bjDate(now));
}

// ── 点糖概率 ──

/**
 * 给已有 `candies` 颗糖的成员点糖的成功率：
 * `p = clamp(base × decay^candies, floor, 1)` —— 糖越多越难成功。
 */
export function successProbability(
  candies: number,
  config: CandyConfig = DEFAULT_CONFIG,
): number {
  const c = Number.isFinite(candies) ? Math.max(0, candies) : 0;
  const p = config.successBase * Math.pow(config.successDecay, c);
  return Math.max(config.successFloor, Math.min(1, p));
}

/** 成功率格式化（界面展示，如 "48%"） */
export function formatProbability(p: number): string {
  return `${Math.round(p * 100)}%`;
}

/** 数值展示（抹掉浮点尾巴：0.8000000000000001 → 0.8） */
export function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** 今日剩余点糖次数（用于展示与按钮可用性） */
export function remainingAttempts(used: number, config: CandyConfig): number {
  const safeUsed = Number.isFinite(used) ? Math.max(0, used) : 0;
  return Math.max(0, config.dailyLimit - safeUsed);
}

// ── 排名 ──

/** 参与排名所需的最小成员字段 */
export interface RankableMember {
  user_id: string;
  display_name: string;
}

/**
 * 按糖数降序排名；糖数相同按显示名（中文）排序，保证顺序稳定。
 *
 * 注意返回的是**新数组**：v1 直接 `members.sort(...)` 原地排序了 React state，
 * 属于副作用 bug，这里不再复现。
 */
export function rankMembers<T extends RankableMember>(
  members: readonly T[],
  candies: ReadonlyMap<string, number>,
): T[] {
  return [...members].sort(
    (a, b) =>
      (candies.get(b.user_id) ?? 0) - (candies.get(a.user_id) ?? 0) ||
      a.display_name.localeCompare(b.display_name, "zh"),
  );
}

// ── 周结算 ──

/** 结算所需的数据读接口（由调用方注入，便于测试与解耦） */
export interface CandyReader {
  getCandies(userId: string): Promise<number>;
}

/** 结算所需的数据写接口（由调用方注入） */
export interface CandyWriter {
  setCandies(userId: string, n: number): Promise<void>;
  setChampions(userIds: string[]): Promise<void>;
  setLastSettled(weekKey: string): Promise<void>;
}

export interface SettleResult {
  /** 本次是否真正执行了结算（false = 本周已结算 / 无人参与，幂等跳过） */
  settled: boolean;
  /** 上周冠军 userId 列表（并列全部包含；无人有糖则为空数组） */
  champions: string[];
}

/**
 * 懒结算：若 `lastSettled` 不是当前周，则执行结算。
 * 结算 = 找糖数最高的参与者（并列全取）→ 写冠军 → 有糖者糖数清零。
 *
 * 参与者应传「当前团队成员 ∪ KV 中仍有糖记录的用户」：v1 只按当前成员结算，
 * 中途退队的成员既无法夺冠，其糖数也永远清不掉（重新入队会带着旧糖数回来）。
 *
 * 并发说明：多人同时打开页面可能重复触发。为缩小「重复结算 / 冠军算错」窗口，
 * 先写入 lastSettled（占位锁）再读糖数结算；此后其他打开页面的用户会因
 * lastSettled 已更新而直接跳过。读-算-写仍非原子，理论上极小概率交错下
 * 冠军结果以最后一次写入为准（内部工具可接受，数据幂等）。
 */
export async function settleIfDue(
  lastSettled: string | null,
  currentWeek: string,
  participantIds: readonly string[],
  reader: CandyReader,
  writer: CandyWriter,
): Promise<SettleResult> {
  const ids = [...new Set(participantIds)];
  if (lastSettled === currentWeek || ids.length === 0) {
    return { settled: false, champions: [] };
  }

  // 先占位：记录本周已结算，作为简易锁，防止并发重复结算；
  // 若后续任一步失败，catch 中回滚占位锁，使重试可再次结算。
  await writer.setLastSettled(currentWeek);

  try {
    const scores = await Promise.all(
      ids.map(async (id) => [id, await reader.getCandies(id)] as const),
    );

    let max = 0;
    for (const [, candies] of scores) {
      if (candies > max) max = candies;
    }
    const champions =
      max > 0
        ? scores.filter(([, candies]) => candies === max).map(([id]) => id)
        : [];

    // 只清零确实有糖的人，减少无谓写入
    for (const [id, candies] of scores) {
      if (candies > 0) await writer.setCandies(id, 0);
    }

    // 仅在有冠军时写 champion_ids：并发交错下若读到被清零后的全 0 数据，
    // 不覆盖他人刚写入的真实冠军；若整周确无人有糖，旧冠军会继续展示，
    // 直至某周产生新冠军（与 v1 语义一致，可接受）
    if (champions.length > 0) {
      await writer.setChampions(champions);
    }

    return { settled: true, champions };
  } catch (error) {
    // 尽力回滚占位锁：网络短暂抖动后可重试重新结算；
    // 若回滚本身也失败（网络持续不可用），本周结算将被跳过，属极端情况下的可接受降级
    await writer.setLastSettled(lastSettled ?? "").catch(() => {});
    throw error;
  }
}
