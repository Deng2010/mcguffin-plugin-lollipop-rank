// @vitest-environment jsdom
/**
 * 页面集成测试 —— 在进程内模拟宿主，把「数据接口 → storage → useCandyRank → 页面」
 * 整条链路跑通，覆盖单测摸不到的 UI 接线（Hook 顺序、按钮禁用、反馈文案、结算展示）。
 *
 * 模拟方式：把 `window.__MCGUFFIN_SDK__` 换成
 *  - **真实 React Hooks**（useState / useEffect / useMemo / useCallback，来自 node_modules 的 React）；
 *  - 内存版 KV（getPluginData / setPluginData / pluginKeys / pluginAdd / pluginIncr）；
 *  - 两个宿主 Hook（usePluginUserMe / usePluginTeamMembers）按 `server` 里的假数据返回。
 *
 * ⚠️ 这里的 react / react-dom / jsdom / @testing-library 只服务于测试：
 *    产物构建时 react 是 external（由宿主提供），绝不会打进 zip。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CandyPage from "./CandyPage";
import { NS, WEEK_KEY, attemptsKey } from "./storage";
import { bjDateKey, bjWeekKey } from "./logic";

const PLUGIN_ID = "lollipop-rank";

interface Member {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  effective_role: string;
  team_status: string;
  bio: string;
  created_at: string;
  joined_at: string;
}

function member(id: string, name: string, extra: Partial<Member> = {}): Member {
  return {
    id,
    user_id: id,
    username: id,
    display_name: name,
    avatar_url: null,
    role: "member",
    effective_role: "member",
    team_status: "joined",
    bio: "",
    created_at: "2026-01-01T00:00:00Z",
    joined_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

/** 假「服务端」：测试可随时改写，Hook 下次 refresh 时读到 */
const server: { me: Member | null; members: Member[]; teamError: string | null } = {
  me: null,
  members: [],
  teamError: null,
};

/** 假 KV（键为 `namespace/key`） */
const kv = new Map<string, string>();
const kvKey = (namespace: string, key: string) => `${namespace}/${key}`;

function installFakeSdk(): void {
  const dataApi = {
    getPluginData: async (_p: string, namespace: string, key: string) =>
      kv.get(kvKey(namespace, key)) ?? "",
    setPluginData: async (
      _p: string,
      namespace: string,
      key: string,
      value: string,
    ) => {
      kv.set(kvKey(namespace, key), value);
    },
    pluginKeys: async (_p: string, namespace: string, prefix?: string) =>
      [...kv.keys()]
        .filter((entry) => entry.startsWith(`${namespace}/`))
        .map((entry) => entry.slice(namespace.length + 1))
        .filter((entry) => !prefix || entry.startsWith(prefix)),
    pluginAdd: async (
      _p: string,
      namespace: string,
      key: string,
      delta: number,
    ) => {
      const current =
        Number.parseInt(kv.get(kvKey(namespace, key)) ?? "0", 10) || 0;
      const next = current + delta;
      kv.set(kvKey(namespace, key), String(next));
      return next;
    },
    pluginIncr: async (p: string, namespace: string, key: string) =>
      dataApi.pluginAdd(p, namespace, key, 1),
  };

  const usePluginUserMe = () => {
    const [user, setUser] = React.useState<Member | null>(null);
    const [loading, setLoading] = React.useState(true);
    const refresh = React.useCallback(async () => {
      setUser(server.me);
      setLoading(false);
    }, []);
    React.useEffect(() => {
      void refresh();
    }, [refresh]);
    return { user, loading, refresh };
  };

  const usePluginTeamMembers = () => {
    const [members, setMembers] = React.useState<Member[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const refresh = React.useCallback(async () => {
      setLoading(true);
      setError(null);
      if (server.teamError) {
        setError(server.teamError);
        setMembers([]);
      } else {
        setMembers(server.members);
      }
      setLoading(false);
    }, []);
    React.useEffect(() => {
      void refresh();
    }, [refresh]);
    return { members, loading, error, refresh };
  };

  Object.assign(window, {
    __MCGUFFIN_SDK__: {
      React,
      ReactDOM: {},
      definePlugin: (definition: unknown) => definition,
      usePluginId: () => PLUGIN_ID,
      usePluginContext: () => null,
      usePluginUserMe,
      usePluginTeamMembers,
      ...dataApi,
    },
  });
}

/** 取某成员所在的榜单行（只按名字 span 定位，避开头像里的首字） */
function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name, { selector: ".lp-name" }).closest(".lp-row");
  if (!row) throw new Error(`没找到 ${name} 的榜单行`);
  return row as HTMLElement;
}

function buttonOf(name: string): HTMLButtonElement {
  return within(rowOf(name)).getByRole("button") as HTMLButtonElement;
}

beforeEach(() => {
  kv.clear();
  server.me = member("me", "我");
  server.members = [server.me, member("u1", "小明"), member("u2", "小红")];
  server.teamError = null;
  // 默认「本周已结算」，避免每个用例都被懒结算抹平预置的糖数；
  // 需要验证结算的用例自行把 last_settled 改成上一周。
  kv.set(kvKey(NS.week, WEEK_KEY.lastSettled), bjWeekKey());
  installFakeSdk();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CandyPage", () => {
  it("渲染成员榜：剩余次数、成功率与自己的按钮禁用", async () => {
    render(<CandyPage />);
    expect(screen.getByText(/加载榜榜糖数据/)).toBeTruthy();

    await screen.findByText("小明");
    expect(screen.getByText("小红")).toBeTruthy();
    expect(screen.getByText(/10 \/ 10/)).toBeTruthy();

    // 自己那行：按钮禁用 + 标记
    expect(buttonOf("我").disabled).toBe(true);
    expect(screen.getByText("（我）")).toBeTruthy();
    // 别人的行：可点
    expect(buttonOf("小明").disabled).toBe(false);
  });

  it("点糖成功：目标糖数 +1、今日次数 -1、给出成功反馈", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 0 < p，必定成功
    render(<CandyPage />);
    await screen.findByText("小明");

    fireEvent.click(buttonOf("小明"));

    await waitFor(() => expect(within(rowOf("小明")).getByText(/1 颗糖/)).toBeTruthy());
    expect(screen.getByText(/点糖成功/)).toBeTruthy();
    expect(screen.getByText(/9 \/ 10/)).toBeTruthy();
    expect(kv.get(kvKey(NS.candies, "u1"))).toBe("1");
    expect(kv.get(kvKey(NS.attempts, attemptsKey(bjDateKey(), "me")))).toBe("1");
  });

  it("点糖失败：目标糖数清零并提示", async () => {
    kv.set(kvKey(NS.candies, "u2"), "5");
    vi.spyOn(Math, "random").mockReturnValue(0.999); // 远大于 5 颗时的 ~20%
    render(<CandyPage />);

    await waitFor(() => expect(within(rowOf("小红")).getByText(/5 颗糖/)).toBeTruthy());
    fireEvent.click(buttonOf("小红"));

    await waitFor(() => expect(within(rowOf("小红")).getByText(/0 颗糖/)).toBeTruthy());
    expect(screen.getByText(/点糖失败/)).toBeTruthy();
    expect(kv.get(kvKey(NS.candies, "u2"))).toBe("0");
  });

  it("今日次数用完时禁用点糖按钮", async () => {
    kv.set(kvKey(NS.attempts, attemptsKey(bjDateKey(), "me")), "10");
    render(<CandyPage />);

    await screen.findByText("小明");
    await waitFor(() => expect(screen.getByText(/0 \/ 10/)).toBeTruthy());
    expect(buttonOf("小明").disabled).toBe(true);
    expect(buttonOf("小红").disabled).toBe(true);
  });

  it("跨周打开页面触发懒结算：并列冠军展示且糖数清零", async () => {
    const previousWeek = bjWeekKey(new Date(Date.now() - 14 * 86400000));
    expect(previousWeek).not.toBe(bjWeekKey());
    kv.set(kvKey(NS.candies, "me"), "1");
    kv.set(kvKey(NS.candies, "u1"), "3");
    kv.set(kvKey(NS.candies, "u2"), "3");
    kv.set(kvKey(NS.week, WEEK_KEY.lastSettled), previousWeek);

    render(<CandyPage />);

    const banner = await screen.findByText(/上周冠军/);
    expect(banner.textContent).toContain("小明");
    expect(banner.textContent).toContain("小红");
    expect(kv.get(kvKey(NS.week, WEEK_KEY.lastSettled))).toBe(bjWeekKey());
    expect(JSON.parse(kv.get(kvKey(NS.week, WEEK_KEY.champions)) ?? "[]")).toEqual([
      "u1",
      "u2",
    ]);
    for (const id of ["me", "u1", "u2"]) {
      expect(kv.get(kvKey(NS.candies, id))).toBe("0");
    }
  });

  it("本周已结算过时不再重复结算（幂等）", async () => {
    kv.set(kvKey(NS.week, WEEK_KEY.lastSettled), bjWeekKey());
    kv.set(kvKey(NS.week, WEEK_KEY.champions), JSON.stringify(["u1"]));
    kv.set(kvKey(NS.candies, "u1"), "4");

    render(<CandyPage />);

    const banner = await screen.findByText(/上周冠军/);
    expect(banner.textContent).toContain("小明");
    expect(kv.get(kvKey(NS.candies, "u1"))).toBe("4");
  });

  it("普通成员看不到参数设置入口", async () => {
    render(<CandyPage />);
    await screen.findByText("小明");
    expect(screen.queryByRole("button", { name: /调整参数/ })).toBeNull();
  });

  it("非团队成员只能看榜，且给出申请提示", async () => {
    server.me = member("me", "我", { team_status: "pending" });
    server.members = [server.me, member("u1", "小明")];
    render(<CandyPage />);

    await screen.findByText("小明");
    expect(screen.getByText(/仅团队成员可以参与点糖/)).toBeTruthy();
    expect(buttonOf("小明").disabled).toBe(true);
  });

  it("管理员可调整玩法参数，保存后立即生效并落盘", async () => {
    server.me = member("me", "我", { role: "admin", effective_role: "admin" });
    server.members = [server.me, member("u1", "小明")];
    render(<CandyPage />);

    await screen.findByText("小明");
    fireEvent.click(screen.getByRole("button", { name: /调整参数/ }));

    const limitInput = screen.getByLabelText("每日点糖次数") as HTMLInputElement;
    fireEvent.change(limitInput, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /保存参数/ }));

    await waitFor(() =>
      expect(kv.get(kvKey(NS.config, "params"))).toContain('"dailyLimit":2'),
    );
    expect(screen.getByText(/参数已保存/)).toBeTruthy();
    expect(screen.getByText(/2 \/ 2/)).toBeTruthy();
  });

  it("参数越界时给出校验提示且不落盘", async () => {
    server.me = member("me", "我", { role: "admin", effective_role: "admin" });
    server.members = [server.me, member("u1", "小明")];
    render(<CandyPage />);

    await screen.findByText("小明");
    fireEvent.click(screen.getByRole("button", { name: /调整参数/ }));

    const limitInput = screen.getByLabelText("每日点糖次数") as HTMLInputElement;
    fireEvent.change(limitInput, { target: { value: "99999" } });
    fireEvent.click(screen.getByRole("button", { name: /保存参数/ }));

    expect(await screen.findByText(/每日次数需在 0 ~ 1000 之间/)).toBeTruthy();
    expect(kv.get(kvKey(NS.config, "params"))).toBeUndefined();
  });

  it("团队成员加载失败时展示错误与重试", async () => {
    server.teamError = "插件权限不足（403）";
    render(<CandyPage />);

    expect(await screen.findByText(/加载失败/)).toBeTruthy();
    expect(screen.getByText(/插件权限不足/)).toBeTruthy();

    // 修好后重试可恢复
    server.teamError = null;
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(await screen.findByText("小明")).toBeTruthy();
  });
});
