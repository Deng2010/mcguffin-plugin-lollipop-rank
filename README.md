# 🍭 榜榜糖（lollipop-rank）

McGuffin 团队成员「点糖」小游戏 —— 独立插件仓库，按
[McGuffin 插件规范](https://github.com/Deng2010/mcguffin/blob/main/docs/guide/plugin-development.md)
打包成 zip 安装，**不依赖主仓库源码**。

给队友点一颗糖 🍭：糖越多越难成功，失败会把他的糖清零；每周一 0:00（北京时间）
结算一次，糖数最高者成为本周冠军，名字两侧会挂上 🍭，随后全员清零进入新一周。

> 本仓库是主仓库里 v1 内联插件 `web/src/plugins/lollipop-rank/` 的重写版：
> 玩法、数据布局、插件 id 与路由路径全部保持不变，升级不丢数据。
> 差异清单见[下文](#与-v1-的差异)。

---

## 玩法

| 规则 | 说明 |
|------|------|
| 谁能玩 | 团队成员（`team_status = joined`），且拥有 `view_team` 权限 |
| 能点谁 | 除自己以外的团队成员 |
| 成功率 | `p = clamp(基础成功率 × 衰减系数^当前糖数, 下限, 1)`，默认 `60% × 0.8^糖数`，下限 `5%` |
| 成功 | 目标糖数 +1 |
| 失败 | 目标糖数清零（风险自负） |
| 每日次数 | 每人每天最多点出 **10** 次，按北京时间自然日计数 |
| 结算 | 每周一 0:00（北京时间）**懒结算**：糖数最高者（并列全取）成为冠军，全员糖数清零 |
| 冠军展示 | 冠军在榜单里名字两侧显示 🍭；若整周无人有糖，则保留上一次冠军直到产生新冠军 |

默认成功率：`0 颗 60% → 1 颗 48% → 3 颗 31% → 5 颗 20% → 8 颗 10% → 10 颗 6%`。

玩法参数由**管理员**在插件页面里现场调整（页面顶部「调整参数」），保存后对所有成员
立即生效；参数存在插件私有 KV 里，升级插件不会丢。

## 安装

管理后台 → 插件管理：

| 方式 | 操作 |
|------|------|
| 上传 zip | 「上传 .zip 文件」→ 选 `dist/lollipop-rank.zip` |
| 从 URL 安装（推荐） | 「从 URL 安装」→ 填 `https://github.com/<owner>/<repo>/releases/latest/download/lollipop-rank.zip`，之后可一键「从原 URL 更新」 |

装完**立即生效**（前端动态 `import()` 入口 ESM，无需刷新或重启），主导航出现
「🍭 榜榜糖」，路径 `/plugins/lollipop`。

### 权限

`plugin.json` 只申请两个已知权限：

| 权限 | 用途 |
|------|------|
| `storage` | 插件私有 KV（糖数 / 每日次数 / 周结算状态 / 玩法参数） |
| `read:team` | 读取团队成员列表 |

⚠️ 插件更新**不会自动扩权**：若某个版本新增了 `permissions_needed`，需要在后台插件页
手动勾选后才生效。本版本没有新增权限，从 v1 升级无需任何手工操作。

## 开发

环境要求：Node.js **>= 24**（`package.json` 的 `engines`），包管理器 npm / bun / pnpm 均可。

```bash
npm install

npm run dev        # vite build --watch：改代码即增量构建到 dist/
npm run build      # tsc --noEmit + vite build
npm test           # vitest 单测（纯逻辑 / 存储层 / 清单一致性）
npm run zip        # build + 打包 dist/lollipop-rank.zip + 产物冒烟测试
npm run smoke      # 只跑产物冒烟测试（需先有 dist/<id>.zip）
```

开发调试循环：`npm run dev` 常驻 → 需要看效果时 `npm run zip` → 后台上传新 zip
（同 id 按「更新」处理，插件数据 / 启用状态 / 已授权权限都会保留）。

### 测试

```bash
npm test        # 67 个测试：纯逻辑 / 存储层 / 清单一致性 / 页面集成
npm run zip     # 构建 + 打包 + 产物冒烟测试
```

| 文件 | 覆盖 |
|------|------|
| `src/logic.test.ts` | 成功率、北京时间换算、参数规整、并列冠军 / 失败清零 / 幂等结算等玩法规则（32） |
| `src/storage.test.ts` | KV 读写、原子额度计数、参数读写、**v1 数据可读**（旧格式次数能接着加）（17） |
| `src/CandyPage.test.tsx` | jsdom + React 渲染整页：成员榜 / 点糖成功与失败 / 次数用尽禁用 / 跨周懒结算 / 管理员调参 / 权限不足重试（11） |
| `src/manifest.test.ts` | `plugin.json` / `package.json` / `src/meta.ts` 三处元信息一致（7） |
| `scripts/smoke-entry.mjs` | 解压 zip → 校验包结构 / 体积 / 裸模块名 → 打桩宿主 SDK 真正 `import()` 入口，断言自注册内容与清单一致 |

几点说明：

- 逻辑与存储层测试跑在 node 环境，不需要浏览器（存储层用内存假 SDK 注入
  `window.__MCGUFFIN_SDK__`）；页面集成测试用文件顶部的 `// @vitest-environment jsdom`
  单独切到 jsdom，并把宿主 SDK 换成真实 React Hooks + 内存 KV。
- 冒烟测试能在 Node 里跑，是因为入口链路没有裸模块 import —— React 由宿主 import map
  解析（只在按需加载的页面 chunk 里出现），CSS 是以 `?inline` 打进 JS 的字符串。
- `react` / `react-dom` / `jsdom` / `@testing-library/react` 都是**开发依赖，只服务于测试**；
  构建时 `react` 是 `external`（由宿主提供），绝不会打进 zip。

### UI 约定

插件的 Tailwind 工具类**不会生效**（宿主构建扫描不到插件源码）：样式自带在 `src/style.css`，
以 `?inline` 打进产物后在运行时注入 `<style id="lollipop-rank-styles">`。
改 UI 前请先读 `AGENTS.md` 的「UI 风格规范」，要点：

- 选择器一律 `.lp-` 前缀；颜色只走 `--lp-*` CSS 变量（禁止写死 hex、禁止 Tailwind 类、禁止全局选择器）
- 深色模式跟随宿主 `<html class="dark">`，浅/深两套变量都要给
- 尺寸用 `rem`，跟随宿主 `html[data-font-size]` 的 small / default / large 三档
- 卡片沿用宿主配方：`白/gray-900 底 + gray-300/gray-700 边框 + shadow`
- 主题色（pink）只用于本插件专属动作（点糖 / 冠军 / 参数主按钮），通用动作走中性 `.lp-btn`
- 新组件优先复用 `.lp-row` / `.lp-btn` / `.lp-banner--*` / `.lp-panel` / `.lp-status` / `.lp-field`
- 改完按「UI 风格规范」第 6 节的人工核对清单过一遍（浅/深色、三档字号、窄屏、hover/disabled、各提示条）

## 目录结构

```
.
├── plugin.json                  # 插件清单（id / name / version / permissions_needed / entry）
├── package.json                 # 构建脚本与开发依赖（与主仓库依赖互不影响）
├── tsconfig.json                # strict + jsx: react-jsx
├── vite.config.ts               # lib 模式；产物 dist/index.js；React 不打包
├── vitest.config.ts             # 单测配置（node 环境）
├── src/
│   ├── index.tsx                # 入口（zip 内的 index.js）：definePlugin() 自注册
│   ├── meta.ts                  # 插件元信息唯一事实来源（与 plugin.json 一致）
│   ├── CandyPage.tsx            # 榜单页面（只负责渲染）
│   ├── SettingsPanel.tsx        # 玩法参数设置面板（仅管理员可见）
│   ├── useCandyRank.ts          # 状态机：拉数据 / 懒结算 / 点糖 / 存参数
│   ├── logic.ts                 # 纯逻辑：概率、时间、排名、周结算（零依赖，可测）
│   ├── storage.ts               # KV 存储层（namespace / key 布局集中在此）
│   ├── sdk.ts                   # window.__MCGUFFIN_SDK__ 访问器
│   ├── styles.ts                # 样式注入（?inline，幂等）
│   ├── style.css                # 自带样式（.lp-* 前缀，深色模式跟随宿主）
│   ├── utils.ts                 # 小工具（错误文案 / isJoined / isAdminRole）
│   └── *.test.ts(x)             # 单测：logic / storage / manifest / CandyPage 页面集成
├── types/
│   ├── mcguffin-plugin-sdk.d.ts # SDK 类型（主仓库的逐字节副本，勿手改）
│   ├── global.d.ts              # window.__MCGUFFIN_SDK__ 全局声明
│   └── vite-env.d.ts            # vite/client 类型（*.css?inline 等）
├── scripts/
│   ├── build-zip.mjs            # 构建 + 打包 zip
│   └── smoke-entry.mjs          # 产物契约冒烟测试
└── .github/
    ├── dependabot.yml           # 依赖 / action 自动更新（action 以 SHA 固定，靠它升级）
    └── workflows/
        ├── ci.yml               # PR / main：类型检查 + 单测 + 打包 + 冒烟
        └── release.yml          # tag：版本校验 → 构建 → 上传 release 资产
```

## 数据布局

数据全部走宿主的插件私有 KV（`storage` 权限），按 `pluginId + namespace` 隔离，
与主应用数据互不影响。**布局与 v1 完全一致**，因此从旧版升级是无损的：

| namespace | key | 值 |
|-----------|-----|-----|
| `candies` | `{userId}` | 当前周糖数（数字字符串） |
| `attempts` | `{北京时间日期}:{userId}`，如 `2026-02-02:admin` | 当天已用点糖次数（原子计数器，按天自然过期） |
| `week` | `last_settled` | 已结算的周标识（如 `2026-W06`，幂等 + 并发占位锁） |
| `week` | `champion_ids` | 上周冠军 userId 列表（JSON 数组） |
| `config` | `params` | 玩法参数 JSON（v2 新增；缺失时用默认值） |

- 单值 ≤ 64 KiB、单插件 KV 条目 ≤ 2000（由宿主限制）。
- `candies` 里保留糖数记录，所以周结算的参与者取「当前成员 ∪ KV 里仍有记录的人」——
  中途退队的成员也能夺冠，糖数也一定会被清零。
- 卸载插件会删除这些数据（后台「卸载」不可恢复），更新不会。

## 与 v1 的差异

v1 = 主仓库内联插件（提交 `66471b0` 之前位于 `web/src/plugins/lollipop-rank/`）。
玩法、KV 布局、插件 id、路由路径均未变化；下面是工程实现上的差异：

| # | 项目 | v1 | 本版本 |
|---|------|----|--------|
| 1 | 分发方式 | 主仓库源码内联，前端 `import.meta.glob` 代码注册（机制已移除） | 独立仓库 + Vite lib 打包 zip，入口经 `window.__MCGUFFIN_SDK__` 自注册 |
| 2 | 宿主依赖 | `import { isJoined } from "../../utils/user"` | 零主应用依赖，`isJoined` 等判定在 `src/utils.ts` 本地实现 |
| 3 | 样式 | 复用宿主 Tailwind 工具类 | 宿主 Tailwind 扫不到插件源码 → 自带 `style.css`（`.lp-*` 前缀，`?inline` 注入，深色模式跟随 `html.dark`） |
| 4 | 玩法参数 | 硬编码常量 | 管理员可在页面内调整（基础成功率 / 衰减 / 下限 / 每日次数），越界校验 + 成功率预览 |
| 5 | 每日次数 | KV「读-改-写」，多 Tab / 多设备并发会互相覆盖导致超额 | 宿主原子计数器（`pluginIncr` / `pluginAdd`），超额即回滚拒绝 |
| 6 | 点糖判定 | 用 React state 里的糖数（可能已陈旧） | 掷骰前现读一次糖数 |
| 7 | 结算参与者 | 仅当前成员：退队者拿不到冠军、糖数也清不掉 | 当前成员 ∪ KV 中仍有糖记录者 |
| 8 | 榜单排序 | `members.sort()` 原地改了 React state | 返回新数组（`rankMembers`），不再有隐藏副作用 |
| 9 | 结算读糖 | 串行逐个读 | `Promise.all` 并行读，只清零确实有糖的人 |
| 10 | 测试 | 无 | 67 个测试（纯逻辑 / 存储层 / 清单 / jsdom 页面集成）+ 产物冒烟测试 + CI |

## 发布

```bash
# 1) 递增版本（三处必须一致，manifest.test.ts 会拦）
#    plugin.json / package.json / src/meta.ts
# 2) 提交后打 tag
git tag v2.0.0
git push origin v2.0.0
```

`.github/workflows/release.yml` 会校验 tag 与版本号一致，跑类型检查、单测、
`npm run zip`（含冒烟测试），再把 `dist/lollipop-rank.zip` 作为 release 资产上传。
之后在后台点「从原 URL 更新」即可升级线上插件。

## SDK 类型同步

`types/mcguffin-plugin-sdk.d.ts` 是主仓库 `web/src/plugins/sdk/plugin-sdk.d.ts` 的
**逐字节副本**（主仓库有测试强制校验两份一致）。宿主 SDK 升级后同步一次即可：

```bash
cp <mcguffin>/web/src/plugins/sdk/plugin-sdk.d.ts types/mcguffin-plugin-sdk.d.ts
npm run build     # tsc 报错处即为不兼容点
```

不要手改这个文件。

## 排错

| 现象 | 排查方向 |
|------|----------|
| 后台显示「加载失败」 | 悬停看原因；控制台按 `[plugin]` 过滤。多为入口 ESM 报错 |
| `Failed to resolve module specifier "xxx"` | 该裸模块名不在宿主 import map（只有 react 系列 4 个）；第三方库保持默认打包 |
| 数据接口 403 | 插件被禁用 / 全局禁用 / `storage`·`read:team` 权限未授予（后台插件页勾选） |
| 导航里没有「榜榜糖」 | 当前用户是否有 `view_team` 权限；插件是否启用 |
| 点糖按钮全灰 | 不是团队成员（`team_status`）、今日次数用完，或正在请求中 |
| 页面没有样式 | 样式由入口注入 <style id="lollipop-rank-styles">；若被宿主 CSP 拦下需放行内联样式 |
| 后台版本与 zip 不一致 | `plugin.json` 与 `src/meta.ts` 不同步，跑 `npm test` 会直接失败 |

## 相关文档

- [插件开发指南](https://github.com/Deng2010/mcguffin/blob/main/docs/guide/plugin-development.md)（独立仓库开发 / 构建 / 发布）
- [插件管理](https://github.com/Deng2010/mcguffin/blob/main/docs/admin/plugins.md)（安装 / 更新语义 / 打包契约 / 权限清单）
- [主仓库模板骨架](https://github.com/Deng2010/mcguffin/tree/main/templates/plugin)（本仓库由它派生）

## License

[Apache-2.0](./LICENSE)
