/**
 * 纯逻辑单测 —— 覆盖概率、北京时间换算、参数规整与周结算。
 *
 * 这些用例是 v1 行为的「防回归网」：默认参数下的关键数值（60% 基础成功率、
 * 周一 0:00 北京时间切周、并列冠军、失败清零、幂等结算）必须与旧版一致。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  bjDateKey,
  bjWeekKey,
  formatNumber,
  formatProbability,
  isDefaultConfig,
  isoWeekKey,
  normalizeConfig,
  parseConfig,
  rankMembers,
  remainingAttempts,
  settleIfDue,
  successProbability,
  type CandyReader,
  type CandyWriter,
} from "./logic";

// ── 概率 ──

describe("successProbability", () => {
  it("默认参数与 v1 一致：0 颗 60%，每多一颗乘 0.8", () => {
    expect(successProbability(0)).toBeCloseTo(0.6, 10);
    expect(successProbability(1)).toBeCloseTo(0.48, 10);
    expect(successProbability(10)).toBeCloseTo(0.6 * 0.8 ** 10, 10);
  });

  it("糖数越多成功率单调不增", () => {
    const values = [0, 1, 2, 3, 5, 8, 13].map((n) => successProbability(n));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  });

  it("再多的糖也不会低于下限", () => {
    expect(successProbability(200)).toBe(DEFAULT_CONFIG.successFloor);
  });

  it("非法糖数按 0 处理（负数 / NaN）", () => {
    expect(successProbability(-5)).toBeCloseTo(0.6, 10);
    expect(successProbability(Number.NaN)).toBeCloseTo(0.6, 10);
  });

  it("参数可调：基础 100% + 不衰减 → 必定成功", () => {
    const config = { ...DEFAULT_CONFIG, successBase: 1, successDecay: 1, successFloor: 0 };
    expect(successProbability(50, config)).toBe(1);
  });

  it("下限高于基础成功率时以下限为准", () => {
    const config = { ...DEFAULT_CONFIG, successBase: 0.1, successFloor: 0.2 };
    expect(successProbability(0, config)).toBeCloseTo(0.2, 10);
    expect(successProbability(30, config)).toBeCloseTo(0.2, 10);
  });
});

describe("formatProbability / formatNumber", () => {
  it("概率按四舍五入取整成百分比", () => {
    expect(formatProbability(0.6)).toBe("60%");
    expect(formatProbability(0.0644)).toBe("6%");
    expect(formatProbability(0)).toBe("0%");
  });

  it("数字去掉浮点尾巴", () => {
    expect(formatNumber(0.6 * 100)).toBe("60");
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(0.8)).toBe("0.8");
  });
});

// ── 北京时间 ──

describe("北京时间换算", () => {
  it("日期 key 按 UTC+8 平移", () => {
    expect(bjDateKey(new Date("2026-01-04T15:59:59Z"))).toBe("2026-01-04");
    expect(bjDateKey(new Date("2026-01-04T16:00:00Z"))).toBe("2026-01-05");
  });

  it("周 key 用 ISO 周（周一为一周开始）", () => {
    expect(isoWeekKey(new Date(Date.UTC(2026, 0, 4)))).toBe("2026-W01");
    expect(isoWeekKey(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-W02");
  });

  it("跨年周归属按 ISO 规则", () => {
    // 2025-12-29（周一）属于 2026 年第 1 周
    expect(isoWeekKey(new Date(Date.UTC(2025, 11, 29)))).toBe("2026-W01");
    expect(isoWeekKey(new Date(Date.UTC(2025, 11, 28)))).toBe("2025-W52");
  });

  it("北京时间周一 0:00 整切到新的一周（结算时刻）", () => {
    expect(bjWeekKey(new Date("2026-01-04T15:59:59Z"))).toBe("2026-W01");
    expect(bjWeekKey(new Date("2026-01-04T16:00:00Z"))).toBe("2026-W02");
  });
});

// ── 玩法参数规整 ──

describe("normalizeConfig", () => {
  it("缺失 / 非法输入回退默认值", () => {
    for (const input of [undefined, null, 42, "x", {}, { successBase: "abc" }]) {
      expect(normalizeConfig(input)).toEqual(DEFAULT_CONFIG);
    }
  });

  it("越界数值夹紧到允许区间", () => {
    expect(normalizeConfig({ successBase: 5 }).successBase).toBe(1);
    expect(normalizeConfig({ successBase: 0 }).successBase).toBe(0.01);
    expect(normalizeConfig({ successDecay: 0 }).successDecay).toBe(0.01);
    expect(normalizeConfig({ successFloor: -1 }).successFloor).toBe(0);
    expect(normalizeConfig({ dailyLimit: 99999 }).dailyLimit).toBe(1000);
    expect(normalizeConfig({ dailyLimit: -3 }).dailyLimit).toBe(0);
  });

  it("支持字符串数字，dailyLimit 向下取整", () => {
    expect(normalizeConfig({ dailyLimit: "7" }).dailyLimit).toBe(7);
    expect(normalizeConfig({ dailyLimit: 3.9 }).dailyLimit).toBe(3);
  });

  it("只保留已知字段（脏字段不会写回）", () => {
    expect(Object.keys(normalizeConfig({ dailyLimit: 1, evil: "x" })).sort()).toEqual(
      Object.keys(DEFAULT_CONFIG).sort(),
    );
  });

  it("有效值原样保留", () => {
    const config = {
      successBase: 0.5,
      successDecay: 0.5,
      successFloor: 0.1,
      dailyLimit: 3,
    };
    expect(normalizeConfig(config)).toEqual(config);
  });
});

describe("parseConfig", () => {
  it("空 / 坏 JSON 回退默认", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig("")).toEqual(DEFAULT_CONFIG);
    expect(parseConfig("not json")).toEqual(DEFAULT_CONFIG);
  });

  it("合法 JSON 与默认值合并", () => {
    expect(parseConfig('{"dailyLimit":3}')).toEqual({ ...DEFAULT_CONFIG, dailyLimit: 3 });
  });
});

describe("isDefaultConfig", () => {
  it("区分默认与自定义", () => {
    expect(isDefaultConfig({ ...DEFAULT_CONFIG })).toBe(true);
    expect(isDefaultConfig({ ...DEFAULT_CONFIG, dailyLimit: 3 })).toBe(false);
  });
});

describe("remainingAttempts", () => {
  it("剩余次数不会为负", () => {
    expect(remainingAttempts(0, DEFAULT_CONFIG)).toBe(10);
    expect(remainingAttempts(4, DEFAULT_CONFIG)).toBe(6);
    expect(remainingAttempts(10, DEFAULT_CONFIG)).toBe(0);
    expect(remainingAttempts(99, DEFAULT_CONFIG)).toBe(0);
    expect(remainingAttempts(Number.NaN, DEFAULT_CONFIG)).toBe(10);
  });

  it("每日 0 次时没有剩余", () => {
    expect(remainingAttempts(0, { ...DEFAULT_CONFIG, dailyLimit: 0 })).toBe(0);
  });
});

// ── 排名 ──

describe("rankMembers", () => {
  const members = [
    { user_id: "a", display_name: "Alice" },
    { user_id: "b", display_name: "Bob" },
    { user_id: "c", display_name: "Cara" },
  ];

  it("按糖数降序，糖数相同按显示名", () => {
    const ranked = rankMembers(members, new Map([["a", 2], ["b", 5]]));
    expect(ranked.map((m) => m.user_id)).toEqual(["b", "a", "c"]);
  });

  it("不修改传入数组（v1 原地 sort 的副作用 bug）", () => {
    const input = [...members];
    const snapshot = input.map((m) => m.user_id);
    rankMembers(input, new Map([["c", 9]]));
    expect(input.map((m) => m.user_id)).toEqual(snapshot);
  });

  it("没有糖记录的人按 0 计", () => {
    const ranked = rankMembers(members, new Map());
    expect(ranked.map((m) => m.user_id)).toEqual(["a", "b", "c"]);
  });
});

// ── 周结算 ──

interface Harness {
  values: Map<string, number>;
  calls: string[];
  champions: string[];
  lastSettledLog: string[];
  reader: CandyReader;
  writer: CandyWriter;
}

function createHarness(initial: Record<string, number> = {}): Harness {
  const values = new Map(Object.entries(initial));
  const calls: string[] = [];
  const harness: Harness = {
    values,
    calls,
    champions: [],
    lastSettledLog: [],
    reader: {
      getCandies: async (userId) => {
        calls.push(`get:${userId}`);
        return values.get(userId) ?? 0;
      },
    },
    writer: {
      setCandies: async (userId, n) => {
        calls.push(`set:${userId}=${n}`);
        values.set(userId, n);
      },
      setChampions: async (userIds) => {
        calls.push(`champions:${userIds.join("|")}`);
        harness.champions = [...userIds];
      },
      setLastSettled: async (weekKey) => {
        calls.push(`lastSettled:${weekKey}`);
        harness.lastSettledLog.push(weekKey);
      },
    },
  };
  return harness;
}

describe("settleIfDue", () => {
  it("本周已结算 → 幂等跳过，不读不写", async () => {
    const harness = createHarness({ a: 5 });
    const result = await settleIfDue("2026-W02", "2026-W02", ["a"], harness.reader, harness.writer);
    expect(result).toEqual({ settled: false, champions: [] });
    expect(harness.calls).toEqual([]);
  });

  it("无人参与 → 跳过", async () => {
    const harness = createHarness();
    const result = await settleIfDue(null, "2026-W02", [], harness.reader, harness.writer);
    expect(result).toEqual({ settled: false, champions: [] });
    expect(harness.calls).toEqual([]);
  });

  it("并列最高者全部成为冠军，有糖者清零、无糖者不写", async () => {
    const harness = createHarness({ a: 3, b: 3, c: 1, d: 0 });
    const result = await settleIfDue(
      "2026-W01",
      "2026-W02",
      ["a", "b", "c", "d"],
      harness.reader,
      harness.writer,
    );

    expect(result).toEqual({ settled: true, champions: ["a", "b"] });
    expect(harness.champions).toEqual(["a", "b"]);
    expect([...harness.values.values()]).toEqual([0, 0, 0, 0]);
    expect(harness.calls).not.toContain("set:d=0");
  });

  it("先写占位锁再读糖数（缩小并发重复结算窗口）", async () => {
    const harness = createHarness({ a: 1 });
    await settleIfDue(null, "2026-W02", ["a"], harness.reader, harness.writer);
    expect(harness.calls[0]).toBe("lastSettled:2026-W02");
    expect(harness.calls[1]).toBe("get:a");
  });

  it("整周无人有糖 → 不覆盖历史冠军，但记录已结算", async () => {
    const harness = createHarness({ a: 0, b: 0 });
    const result = await settleIfDue(null, "2026-W02", ["a", "b"], harness.reader, harness.writer);
    expect(result).toEqual({ settled: true, champions: [] });
    expect(harness.lastSettledLog).toEqual(["2026-W02"]);
    expect(harness.calls.some((call) => call.startsWith("champions:"))).toBe(false);
  });

  it("参与者去重（同一 id 只读一次）", async () => {
    const harness = createHarness({ a: 1 });
    await settleIfDue(null, "2026-W02", ["a", "a", "a"], harness.reader, harness.writer);
    expect(harness.calls.filter((call) => call === "get:a")).toHaveLength(1);
  });

  it("结算失败时回滚占位锁并抛出，便于下次重试", async () => {
    const harness = createHarness({ a: 5 });
    harness.reader.getCandies = async () => {
      throw new Error("网络抖动");
    };

    await expect(
      settleIfDue("2026-W01", "2026-W02", ["a"], harness.reader, harness.writer),
    ).rejects.toThrow("网络抖动");
    expect(harness.lastSettledLog).toEqual(["2026-W02", "2026-W01"]);
  });
});
