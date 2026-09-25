/**
 * 榜榜糖的 KV 存储层 —— 所有 `plugin_data` 访问集中在这里。
 *
 * namespace / key 布局（**与 v1 完全一致**，因此从旧版升级不会丢数据）：
 *  - `candies` / `{userId}`          → 当前周糖数（数字字符串）
 *  - `attempts` / `{日期}:{userId}`   → 该用户当天已用点糖次数（原子计数器，按天自然过期）
 *  - `week` / `last_settled`         → 已结算的周标识（如 2026-W06，幂等）
 *  - `week` / `champion_ids`         → 上周冠军 userId 列表（JSON 数组）
 *  - `config` / `params`             → 玩法参数 JSON（v2 新增，旧数据无此键 → 用默认参数）
 *
 * 所有接口都依赖 `storage` 权限；团队成员列表在 `read:team`（见 src/useCandyRank.ts）。
 */
import {
  parseConfig,
  type CandyConfig,
  type CandyReader,
  type CandyWriter,
} from "./logic";
import { PLUGIN_ID } from "./meta";
import { sdk } from "./sdk";

/** KV 命名空间（改这里等于改数据布局，务必考虑向后兼容） */
export const NS = {
  candies: "candies",
  attempts: "attempts",
  week: "week",
  config: "config",
} as const;

/** `week` 命名空间下的 key */
export const WEEK_KEY = {
  lastSettled: "last_settled",
  champions: "champion_ids",
} as const;

/** `config` 命名空间下的 key */
export const CONFIG_KEY = "params";

/** 每日次数计数 key：按天隔离，天然过期，无需清理 */
export function attemptsKey(dateKey: string, userId: string): string {
  return `${dateKey}:${userId}`;
}

/** 把 KV 里的字符串解析为非负整数（空 / 坏数据 / 负数一律当 0） */
function toCount(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function safeJsonArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

// ── 糖数 ──

/** 读取某成员当前周的糖数 */
export async function readCandies(userId: string): Promise<number> {
  return toCount(await sdk().getPluginData(PLUGIN_ID, NS.candies, userId));
}

/** 并行读取一批成员的糖数（成员榜一次拉全） */
export async function readCandiesMap(
  userIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(userIds)];
  const values = await Promise.all(ids.map((id) => readCandies(id)));
  return new Map(ids.map((id, index) => [id, values[index]]));
}

/** 写入某成员当前周的糖数（负数按 0 处理） */
export async function writeCandies(userId: string, n: number): Promise<void> {
  const safe = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  await sdk().setPluginData(PLUGIN_ID, NS.candies, userId, String(safe));
}

/**
 * 列出 KV 中仍有糖记录的 userId —— 用作周结算的参与者。
 *
 * 为什么需要它：v1 只按当前成员列表结算，中途退队的成员会被漏掉
 * （既拿不到冠军，糖数也永远清不掉，重新入队时会带着旧糖数回来）。
 */
export async function listCandyUserIds(): Promise<string[]> {
  const keys = await sdk().pluginKeys(PLUGIN_ID, NS.candies);
  return keys.filter((key) => key.length > 0);
}

// ── 周结算状态 ──

/** 最近一次已结算的周标识（从未结算过则返回 null） */
export async function readLastSettled(): Promise<string | null> {
  const raw = await sdk().getPluginData(
    PLUGIN_ID,
    NS.week,
    WEEK_KEY.lastSettled,
  );
  return raw || null;
}

/** 记录已结算的周标识（同时充当并发占位锁） */
export async function writeLastSettled(weekKey: string): Promise<void> {
  await sdk().setPluginData(PLUGIN_ID, NS.week, WEEK_KEY.lastSettled, weekKey);
}

/** 读取当前展示的冠军列表 */
export async function readChampions(): Promise<string[]> {
  const raw = await sdk().getPluginData(
    PLUGIN_ID,
    NS.week,
    WEEK_KEY.champions,
  );
  return raw ? safeJsonArray(raw) : [];
}

/** 写入冠军列表 */
export async function writeChampions(userIds: readonly string[]): Promise<void> {
  await sdk().setPluginData(
    PLUGIN_ID,
    NS.week,
    WEEK_KEY.champions,
    JSON.stringify([...userIds]),
  );
}

// ── 每日次数（原子计数器）──

/** 读取某用户今日已用次数（仅用于展示；占用额度走 {@link consumeAttempt}） */
export async function readAttempts(
  dateKey: string,
  userId: string,
): Promise<number> {
  return toCount(
    await sdk().getPluginData(
      PLUGIN_ID,
      NS.attempts,
      attemptsKey(dateKey, userId),
    ),
  );
}

/**
 * 占用一次今日额度。
 *
 * 用宿主提供的**原子计数器**（服务端 `/data/add`）自增，取代 v1 的 KV「读-改-写」：
 *  - v1 的读-改-写在多 Tab / 多设备并发时会互相覆盖，可能超额点糖；
 *  - 服务端自增天然原子。若自增后超出上限，则回退一次并拒绝，
 *    保证计数最终停在上限而不是无限增长。
 */
export async function consumeAttempt(
  dateKey: string,
  userId: string,
  dailyLimit: number,
): Promise<{ allowed: boolean; used: number }> {
  const key = attemptsKey(dateKey, userId);
  const used = await sdk().pluginIncr(PLUGIN_ID, NS.attempts, key);
  if (used > dailyLimit) {
    const rolledBack = await sdk()
      .pluginAdd(PLUGIN_ID, NS.attempts, key, -1)
      .catch(() => dailyLimit);
    return { allowed: false, used: Math.min(rolledBack, dailyLimit) };
  }
  return { allowed: true, used };
}

/** 退还一次额度（点糖流程抛错时回滚，避免白扣次数） */
export async function refundAttempt(
  dateKey: string,
  userId: string,
): Promise<number> {
  const left = await sdk().pluginAdd(
    PLUGIN_ID,
    NS.attempts,
    attemptsKey(dateKey, userId),
    -1,
  );
  return Math.max(0, left);
}

// ── 玩法参数 ──

/** 读取玩法参数（缺失 / 坏数据回退默认值） */
export async function readConfig(): Promise<CandyConfig> {
  return parseConfig(
    await sdk().getPluginData(PLUGIN_ID, NS.config, CONFIG_KEY),
  );
}

/** 保存玩法参数（调用方应先用 normalizeConfig 规整） */
export async function writeConfig(config: CandyConfig): Promise<void> {
  await sdk().setPluginData(
    PLUGIN_ID,
    NS.config,
    CONFIG_KEY,
    JSON.stringify(normalizeConfigShape(config)),
  );
}

/** 写入前的形状收敛（只保留已知字段，避免脏字段被一起写回） */
function normalizeConfigShape(config: CandyConfig): CandyConfig {
  return {
    successBase: config.successBase,
    successDecay: config.successDecay,
    successFloor: config.successFloor,
    dailyLimit: config.dailyLimit,
  };
}

// ── 结算适配器 ──

/** 注入给逻辑层的读适配器 */
export const candyReader: CandyReader = { getCandies: readCandies };

/** 注入给逻辑层的写适配器 */
export const candyWriter: CandyWriter = {
  setCandies: writeCandies,
  setChampions: writeChampions,
  setLastSettled: writeLastSettled,
};
