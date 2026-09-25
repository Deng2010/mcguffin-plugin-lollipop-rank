/**
 * 榜单状态机 —— 把页面交互与数据读写都收在这里，页面组件只负责渲染。
 *
 * 职责：
 *  - 用宿主的 SDK Hooks 拉当前用户与团队成员；
 *  - 打开页面时做一次「懒结算」（跨周才真正结算，见 logic.settleIfDue）；
 *  - 暴露点糖动作（原子扣额度 → 现读糖数 → 掷骰 → 写回）；
 *  - 暴露玩法参数的保存动作（仅管理员）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  PluginTeamMember,
  PluginUserInfo,
} from "../types/mcguffin-plugin-sdk";
import {
  CHAMPION_EMOJI,
  DEFAULT_CONFIG,
  bjDateKey,
  bjWeekKey,
  normalizeConfig,
  rankMembers,
  remainingAttempts,
  settleIfDue,
  successProbability,
  type CandyConfig,
} from "./logic";
import { PLUGIN_ID } from "./meta";
import { sdk } from "./sdk";
import * as store from "./storage";
import { errorMessage, isAdminRole, isJoined } from "./utils";

/** 点糖 / 保存反馈 */
export interface Feed {
  kind: "success" | "fail" | "error" | "info";
  text: string;
}

/** 榜单控制器（页面组件消费的全部状态与动作） */
export interface CandyRankController {
  me: PluginUserInfo | null;
  members: PluginTeamMember[];
  /** 当前周糖数（userId → 糖数） */
  candies: Map<string, number>;
  config: CandyConfig;
  champions: string[];
  attemptsToday: number;
  remaining: number;
  ranked: PluginTeamMember[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  feed: Feed | null;
  isAdmin: boolean;
  isJoinedTeam: boolean;
  today: string;
  currentWeek: string;
  nameOf: (userId: string) => string;
  reload: () => void;
  clearFeed: () => void;
  candy: (member: PluginTeamMember) => Promise<void>;
  saveConfig: (next: CandyConfig) => Promise<void>;
}

export function useCandyRank(): CandyRankController {
  const { usePluginUserMe, usePluginTeamMembers } = sdk();

  const { user: me, loading: meLoading, refresh: refreshMe } =
    usePluginUserMe(PLUGIN_ID);
  const {
    members,
    loading: membersLoading,
    error: membersError,
    refresh: refreshMembers,
  } = usePluginTeamMembers(PLUGIN_ID);

  const [candies, setCandies] = useState<Map<string, number>>(new Map());
  const [config, setConfig] = useState<CandyConfig>(DEFAULT_CONFIG);
  const [champions, setChampions] = useState<string[]>([]);
  const [attemptsToday, setAttemptsToday] = useState(0);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const meId = me?.id ?? null;
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);
  /** 成员集合的稳定指纹：成员数组每次刷新都是新对象，用它当依赖 */
  const memberIdsKey = memberIds.join(",");

  // ── 打开页面：读参数 → 懒结算 → 拉糖数 / 冠军 / 今日次数 ──

  useEffect(() => {
    if (meLoading) return;
    if (!meId) {
      setBoardLoading(false);
      setBoardError("无法获取当前用户信息，请重新登录后再试");
      return;
    }

    let cancelled = false;
    setBoardLoading(true);
    setBoardError(null);
    setFeed(null);

    void (async () => {
      try {
        const today = bjDateKey();
        const currentWeek = bjWeekKey();

        const nextConfig = await store.readConfig();
        if (cancelled) return;
        setConfig(nextConfig);

        // 懒结算：参与者 = 当前成员 ∪ KV 中仍有糖记录的用户（含已退队者）
        const lastSettled = await store.readLastSettled();
        const storedIds = await store
          .listCandyUserIds()
          .catch(() => [] as string[]);
        const { champions: settledChampions } = await settleIfDue(
          lastSettled,
          currentWeek,
          [...memberIds, ...storedIds],
          store.candyReader,
          store.candyWriter,
        );

        const [nextChampions, candyMap, used] = await Promise.all([
          // 刚结算 → 用本次结果（无人有糖则空，不覆盖历史冠军）；
          // 本周已结算过 → 从存储里读当前展示的冠军
          lastSettled === currentWeek
            ? store.readChampions()
            : Promise.resolve(settledChampions),
          store.readCandiesMap(memberIds),
          store.readAttempts(today, meId),
        ]);
        if (cancelled) return;

        setChampions(nextChampions);
        setCandies(candyMap);
        setAttemptsToday(used);
      } catch (error) {
        if (!cancelled) setBoardError(errorMessage(error));
      } finally {
        if (!cancelled) setBoardLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // memberIds 与 memberIdsKey 同步变化，用后者当依赖避免数组身份抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, meLoading, memberIdsKey, reloadToken]);

  // ── 点糖 ──

  const candy = useCallback(
    async (member: PluginTeamMember) => {
      if (busy) return;
      if (!me || !isJoined(me)) {
        setFeed({
          kind: "error",
          text: "仅团队成员可以参与点糖，请联系管理员申请加入团队。",
        });
        return;
      }
      if (member.user_id === me.id) {
        setFeed({ kind: "error", text: "不能给自己点糖，去给别人点吧" });
        return;
      }
      if (remainingAttempts(attemptsToday, config) <= 0) {
        setFeed({
          kind: "error",
          text: `今日点糖次数已用完（${config.dailyLimit}/${config.dailyLimit}），明天再来吧`,
        });
        return;
      }

      setBusy(true);
      setFeed(null);
      const dateKey = bjDateKey();

      try {
        // 1) 先原子占用一次今日额度：服务端自增，多 Tab / 多设备并发也不会超额
        const { allowed, used } = await store.consumeAttempt(
          dateKey,
          me.id,
          config.dailyLimit,
        );
        setAttemptsToday(used);
        if (!allowed) {
          setFeed({
            kind: "error",
            text: `今日点糖次数已用完（${config.dailyLimit}/${config.dailyLimit}），明天再来吧`,
          });
          return;
        }

        // 2) 现读现算：不复用列表里可能已陈旧的糖数
        const current = await store.readCandies(member.user_id);
        const probability = successProbability(current, config);
        const success = Math.random() < probability;

        // 3) 成功 +1，失败清零
        const next = success ? current + 1 : 0;
        await store.writeCandies(member.user_id, next);
        setCandies((previous) => new Map(previous).set(member.user_id, next));

        setFeed(
          success
            ? {
                kind: "success",
                text: `${CHAMPION_EMOJI} 点糖成功！${member.display_name} 的糖数 +1（共 ${next} 颗）`,
              }
            : {
                kind: "fail",
                text: `💥 点糖失败…${member.display_name} 的糖数被清空了`,
              },
        );
      } catch (error) {
        // 抛错时退还额度，避免白扣次数
        const left = await store.refundAttempt(dateKey, me.id).catch(() => null);
        if (left !== null) setAttemptsToday(left);
        setFeed({ kind: "error", text: `操作失败：${errorMessage(error)}` });
      } finally {
        setBusy(false);
      }
    },
    [busy, me, attemptsToday, config],
  );

  // ── 保存玩法参数（仅管理员）──

  const saveConfig = useCallback(
    async (next: CandyConfig) => {
      if (!isAdminRole(me)) throw new Error("只有管理员可以调整玩法参数");
      const normalized = normalizeConfig(next);
      await store.writeConfig(normalized);
      setConfig(normalized);
      setFeed({ kind: "info", text: "玩法参数已保存，立即生效" });
    },
    [me],
  );

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
    void refreshMe();
    void refreshMembers();
  }, [refreshMe, refreshMembers]);

  const clearFeed = useCallback(() => setFeed(null), []);

  const nameOf = useCallback(
    (userId: string) =>
      members.find((member) => member.user_id === userId)?.display_name ??
      userId,
    [members],
  );

  const ranked = useMemo(
    () => rankMembers(members, candies),
    [members, candies],
  );

  return {
    me,
    members,
    candies,
    config,
    champions,
    attemptsToday,
    remaining: remainingAttempts(attemptsToday, config),
    ranked,
    loading: meLoading || membersLoading || boardLoading,
    error: boardError ?? membersError,
    busy,
    feed,
    isAdmin: isAdminRole(me),
    isJoinedTeam: isJoined(me),
    today: bjDateKey(),
    currentWeek: bjWeekKey(),
    nameOf,
    reload,
    clearFeed,
    candy,
    saveConfig,
  };
}
