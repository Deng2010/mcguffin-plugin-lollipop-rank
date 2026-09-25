/**
 * 存储层单测 —— 用内存假 SDK 替换 `window.__MCGUFFIN_SDK__`，
 * 覆盖 KV 读写、原子额度计数与参数读写。
 *
 * 这里特意验证「v1 数据可读」：老版本把次数写成了数字字符串，
 * 新的原子计数器必须能接着往上加。
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./storage";
import { DEFAULT_CONFIG } from "./logic";
import { PLUGIN_ID } from "./meta";

interface FakeSdk {
  getPluginData: (
    pluginId: string,
    namespace: string,
    key: string,
  ) => Promise<string>;
  setPluginData: (
    pluginId: string,
    namespace: string,
    key: string,
    value: string,
  ) => Promise<void>;
  pluginKeys: (
    pluginId: string,
    namespace: string,
    prefix?: string,
  ) => Promise<string[]>;
  pluginAdd: (
    pluginId: string,
    namespace: string,
    key: string,
    delta: number,
  ) => Promise<number>;
  pluginIncr: (
    pluginId: string,
    namespace: string,
    key: string,
  ) => Promise<number>;
}

/** 安装内存版宿主 SDK，返回底层 KV（便于断言落盘内容） */
function installFakeSdk(): Map<string, string> {
  const kv = new Map<string, string>();
  const fullKey = (namespace: string, key: string) => `${namespace}/${key}`;

  const fake: FakeSdk = {
    getPluginData: async (_pluginId, namespace, key) =>
      kv.get(fullKey(namespace, key)) ?? "",
    setPluginData: async (_pluginId, namespace, key, value) => {
      kv.set(fullKey(namespace, key), value);
    },
    pluginKeys: async (_pluginId, namespace, prefix) =>
      [...kv.keys()]
        .filter((k) => k.startsWith(`${namespace}/`))
        .map((k) => k.slice(namespace.length + 1))
        .filter((k) => !prefix || k.startsWith(prefix)),
    pluginAdd: async (_pluginId, namespace, key, delta) => {
      const current = Number.parseInt(kv.get(fullKey(namespace, key)) ?? "0", 10) || 0;
      const next = current + delta;
      kv.set(fullKey(namespace, key), String(next));
      return next;
    },
    pluginIncr: async (pluginId, namespace, key) =>
      fake.pluginAdd(pluginId, namespace, key, 1),
  };

  (globalThis as unknown as { window: unknown }).window = {
    __MCGUFFIN_SDK__: fake,
  };
  return kv;
}

let kv: Map<string, string>;

beforeEach(() => {
  kv = installFakeSdk();
});

describe("糖数读写", () => {
  it("不存在 / 坏数据 / 负数都当 0", async () => {
    expect(await store.readCandies("u1")).toBe(0);
    kv.set(`${store.NS.candies}/u2`, "abc");
    expect(await store.readCandies("u2")).toBe(0);
    kv.set(`${store.NS.candies}/u3`, "-4");
    expect(await store.readCandies("u3")).toBe(0);
  });

  it("能读出 v1 写入的数字字符串", async () => {
    kv.set(`${store.NS.candies}/u1`, "7");
    expect(await store.readCandies("u1")).toBe(7);
  });

  it("写入时取整并夹到非负", async () => {
    await store.writeCandies("u1", 2.7);
    expect(kv.get(`${store.NS.candies}/u1`)).toBe("2");
    await store.writeCandies("u1", -5);
    expect(kv.get(`${store.NS.candies}/u1`)).toBe("0");
    await store.writeCandies("u1", Number.NaN);
    expect(kv.get(`${store.NS.candies}/u1`)).toBe("0");
  });

  it("批量读取去重并映射回每个 id", async () => {
    kv.set(`${store.NS.candies}/a`, "1");
    kv.set(`${store.NS.candies}/b`, "2");
    const map = await store.readCandiesMap(["a", "b", "a", "c"]);
    expect([...map.entries()].sort()).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 0],
    ]);
  });

  it("listCandyUserIds 用 pluginKeys 拿到所有有糖记录的人", async () => {
    kv.set(`${store.NS.candies}/a`, "1");
    kv.set(`${store.NS.candies}/b`, "0");
    kv.set(`${store.NS.week}/last_settled`, "2026-W01");
    expect((await store.listCandyUserIds()).sort()).toEqual(["a", "b"]);
  });
});

describe("周结算状态", () => {
  it("未结算过返回 null，写后可读回", async () => {
    expect(await store.readLastSettled()).toBeNull();
    await store.writeLastSettled("2026-W06");
    expect(await store.readLastSettled()).toBe("2026-W06");
  });

  it("冠军列表 JSON 往返，坏数据回退空数组", async () => {
    await store.writeChampions(["a", "b"]);
    expect(kv.get(`${store.NS.week}/champion_ids`)).toBe('["a","b"]');
    expect(await store.readChampions()).toEqual(["a", "b"]);

    kv.set(`${store.NS.week}/champion_ids`, "{坏 JSON");
    expect(await store.readChampions()).toEqual([]);
    kv.set(`${store.NS.week}/champion_ids`, '["a",1,null]');
    expect(await store.readChampions()).toEqual(["a"]);
  });
});

describe("每日额度（原子计数器）", () => {
  const dateKey = "2026-02-02";

  it("额度内放行并返回已用次数", async () => {
    const first = await store.consumeAttempt(dateKey, "u1", 2);
    expect(first).toEqual({ allowed: true, used: 1 });
    const second = await store.consumeAttempt(dateKey, "u1", 2);
    expect(second).toEqual({ allowed: true, used: 2 });
  });

  it("超出额度拒绝，且计数停在上限而不是继续增长", async () => {
    await store.consumeAttempt(dateKey, "u1", 1);
    const overflow = await store.consumeAttempt(dateKey, "u1", 1);
    expect(overflow).toEqual({ allowed: false, used: 1 });
    expect(await store.readAttempts(dateKey, "u1")).toBe(1);

    // 再点多次也不会把计数推高
    await store.consumeAttempt(dateKey, "u1", 1);
    expect(await store.readAttempts(dateKey, "u1")).toBe(1);
  });

  it("每日 0 次时直接拒绝", async () => {
    expect(await store.consumeAttempt(dateKey, "u1", 0)).toEqual({
      allowed: false,
      used: 0,
    });
    expect(await store.readAttempts(dateKey, "u1")).toBe(0);
  });

  it("能接着 v1 写的次数继续计数", async () => {
    kv.set(`${store.NS.attempts}/${dateKey}:u1`, "4");
    expect(await store.consumeAttempt(dateKey, "u1", 10)).toEqual({
      allowed: true,
      used: 5,
    });
  });

  it("按天隔离（不同日期互不影响）", async () => {
    await store.consumeAttempt(dateKey, "u1", 10);
    expect(await store.readAttempts("2026-02-03", "u1")).toBe(0);
  });

  it("退还次数不会退成负数", async () => {
    await store.consumeAttempt(dateKey, "u1", 10);
    expect(await store.refundAttempt(dateKey, "u1")).toBe(0);
    expect(await store.refundAttempt(dateKey, "u1")).toBe(0);
  });
});

describe("玩法参数", () => {
  it("未设置时返回默认参数", async () => {
    expect(await store.readConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("写入后可读回，且只落盘已知字段", async () => {
    await store.writeConfig({ ...DEFAULT_CONFIG, dailyLimit: 3 });
    expect(await store.readConfig()).toEqual({ ...DEFAULT_CONFIG, dailyLimit: 3 });
    expect(kv.get(`${store.NS.config}/params`)).toBe(
      JSON.stringify({ ...DEFAULT_CONFIG, dailyLimit: 3 }),
    );
  });

  it("KV 里是脏数据时回退默认", async () => {
    kv.set(`${store.NS.config}/params`, "{坏 JSON");
    expect(await store.readConfig()).toEqual(DEFAULT_CONFIG);
  });
});

describe("数据命名空间", () => {
  it("与 v1 完全一致（升级不丢数据）", () => {
    expect(store.NS).toEqual({
      candies: "candies",
      attempts: "attempts",
      week: "week",
      config: "config",
    });
    expect(store.WEEK_KEY).toEqual({
      lastSettled: "last_settled",
      champions: "champion_ids",
    });
    expect(store.attemptsKey("2026-02-02", "u1")).toBe("2026-02-02:u1");
    expect(PLUGIN_ID).toBe("lollipop-rank");
  });
});
