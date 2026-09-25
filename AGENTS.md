# AGENTS.md — 榜榜糖（lollipop-rank）AI Agent 指南

> 面向 AI 编程助手（Claude Code、OpenCode、Copilot、Cline 等）。这是 **McGuffin 的独立插件仓库**，
> 动手前请先读完本文；其中「UI 风格规范」与「数据兼容」两节最容易踩坑。

---

## 项目概览

**榜榜糖**是 McGuffin（算法竞赛出题团队协作工具）的前端插件：团队成员互相点糖 🍭，
糖越多成功率越低、失败清零；每周一 0:00（北京时间）结算冠军并清零。

- **仓库定位**：独立插件仓库，只产出 zip 插件包，**不含宿主代码**。宿主主仓库是 `mcguffin`
  （本机通常与本仓库同级 checkout）。
- **技术栈**：TypeScript + Vite 6（lib 模式，产物单入口 ESM）+ Vitest 4。
  **React 由宿主提供、绝不打包**（见 `vite.config.ts` 的 `external`）。
- **插件标识**：id `lollipop-rank`（改了等于换插件，KV 数据全丢）、路由 `/plugins/lollipop`、
  导航位 `main`、需主应用权限 `view_team`。
- **插件权限**：`storage` + `read:team`（`plugin.json`）。
- **当前版本**：`2.0.0`（`plugin.json` / `package.json` / `src/meta.ts` 三处必须一致）。
- **运行时依赖**：只有 `window.__MCGUFFIN_SDK__`；**不 import 任何主应用源码**。

---

## ⚠️ 首要约定：保持 AGENTS.md 与代码同步

**如果本文件与实际代码/约定不再一致，必须随手更新本文件**，以代码为唯一事实来源。

以下任一改动完成后都要同步本文档：

- 新增/删除/重命名源码模块、脚本、workflow，或改变构建/测试命令
- **UI 规范变化**：新增/调整 CSS 变量、色板、圆角、间距、断点、样式注入方式
- **元信息变化**：插件 id / 名称 / 路由 / 版本 / `permissions_needed` / `entry`
- **数据布局变化**：KV 的 namespace / key、值的格式（务必同时评估 v1 兼容性）
- SDK 类型同步（`types/mcguffin-plugin-sdk.d.ts` 重新 `cp`）或改用新的 SDK 成员
- 宿主插件契约变化（打包限制、更新语义、权限模型、import map）

---

## 构建与运行

```bash
npm install          # 环境要求 Node.js >= 24（见 package.json 的 engines）
npm run dev          # vite build --watch，改代码即增量构建到 dist/（本地调试用）
npm run build        # tsc --noEmit + vite build
npm test             # vitest run（67 个测试）
npm run test:watch   # vitest 监听
npm run zip          # build + 打包 dist/lollipop-rank.zip + 产物冒烟测试 ★发版前必跑
npm run smoke        # 只跑产物冒烟测试（需先有 dist/<id>.zip）
```

包管理器 npm / bun / pnpm 均可；`package-lock.json` 已提交，CI 用 `npm ci`。

> **已知环境问题（本机，非代码缺陷）**：部分 macOS 机器的 `~/.npm` 存在 root 属主文件，
> 直接 `npm install` 会 `EPERM .../_cacache`。绕过方式：`npm install --cache <可写目录>`，
> 或先 `sudo chown -R $(id -u):$(id -g) ~/.npm`。

产物约束（宿主后端安装时会校验，`npm run zip` 提前拦）：单文件 ≤ 8 MiB、文件数 ≤ 512、
解压总量 ≤ 64 MiB、`plugin.json` 必须在 zip **根目录**、entry 文件必须存在。

---

## 项目结构

```
.
├── plugin.json                  # 插件清单（id / name / version / permissions_needed / entry）
├── package.json                 # 脚本与开发依赖（devDependencies 只服务构建与测试）
├── tsconfig.json                # strict + noUnusedLocals/Parameters + jsx: react-jsx
├── vite.config.ts               # lib 模式：产物 dist/index.js；React external；?inline CSS
├── vitest.config.ts             # 单测：默认 node 环境，include src/**/*.test.{ts,tsx}
├── src/
│   ├── index.tsx                # 入口（zip 内 index.js）：注入样式 + definePlugin() 自注册
│   ├── meta.ts                  # 插件元信息唯一事实来源（与 plugin.json 一致）
│   ├── logic.ts                 # 纯逻辑：概率 / 北京时间 / 排名 / 周结算 / 参数规整（零依赖）
│   ├── storage.ts               # KV 存储层：唯一调用宿主数据 API 的地方
│   ├── useCandyRank.ts          # 状态机：拉数据 / 懒结算 / 点糖 / 存参数
│   ├── CandyPage.tsx            # 页面：只负责渲染（消费 useCandyRank）
│   ├── SettingsPanel.tsx        # 玩法参数面板（仅管理员可见）
│   ├── styles.ts                # 样式注入（?inline → <style id="lollipop-rank-styles">）
│   ├── style.css                # 自带样式：.lp-* 类 + --lp-* CSS 变量（浅/深两套）
│   ├── sdk.ts                   # window.__MCGUFFIN_SDK__ 访问器（缺失时给明确报错）
│   ├── utils.ts                 # errorMessage / isJoined / isAdminRole
│   └── *.test.ts(x)             # 单测与页面集成测试
├── types/
│   ├── mcguffin-plugin-sdk.d.ts # SDK 规范类型（主仓库的逐字节副本，勿手改）
│   ├── global.d.ts              # window.__MCGUFFIN_SDK__ 全局声明
│   └── vite-env.d.ts            # vite/client 类型（*.css?inline 等）
├── scripts/
│   ├── build-zip.mjs            # tsc + vite build + 打包 zip（含裸模块名兜底检查）
│   └── smoke-entry.mjs          # 产物冒烟：解压 zip → 打桩宿主 SDK → 真正 import 入口
└── .github/
    ├── dependabot.yml           # npm + actions 自动更新（action 以 SHA 固定）
    └── workflows/
        ├── ci.yml               # PR/main：tsc + 单测 + 打包 + 冒烟
        └── release.yml          # tag：校验版本 → 构建 → 上传 release 资产
```

---

## 运行时契约（宿主 ↔ 插件）

### 入口

入口 ESM（`dist/index.js`）只做两件事：`ensureStyles()` 注入样式、`definePlugin()` 自注册。
页面组件用 `React.lazy(() => import("./CandyPage"))` 按需加载，产物是同目录 chunk。
宿主从 `/api/plugins/{id}/assets/index.js` **按 URL** `import()` 入口，因此相对导入与动态
import 都按该 URL 解析——**不要在产物里用绝对路径或 blob**。

### 用到的宿主 SDK 成员（`window.__MCGUFFIN_SDK__`）

| 成员 | 需要的插件权限 | 用途 |
|------|----------------|------|
| `definePlugin` / `React` | — | 入口自注册；`React.lazy` 页面组件 |
| `usePluginUserMe` | — | 当前用户：`id` / `effective_role` / `team_status` |
| `usePluginTeamMembers` | `read:team` | 成员榜 |
| `getPluginData` / `setPluginData` / `pluginKeys` | `storage` | KV 读写、列出有糖记录的用户 |
| `pluginIncr` / `pluginAdd` | `storage` | 每日额度原子自增；`pluginAdd(-1)` 回滚 |

SDK 还有 `notify` / 文件存储 / 集合 / 计数器 Hooks 等能力，本插件暂未使用；要用新能力必须
先在 `plugin.json` 声明对应权限，并提醒管理员在后台插件页勾选（**更新不会自动扩权**）。

### 鉴权真相 ⚠️

- 插件数据接口（`/api/plugins/{id}/data/*`）只校验**插件级** `storage` 权限 + 插件启用 +
  未全局禁用 + 已登录，**不校验用户角色**。宿主 `plugin_perms` 里也没有「仅管理员」这种粒度。
- 因此 `isAdminRole()` 决定的是**要不要显示参数入口**，属于 UI 级限制，**不是安全边界**：
  任何成员在控制台直接调接口都能写 KV。不要把它当作权限漏洞去"修"，也不要在文档/注释里
  宣称参数受保护；要真管控得改宿主权限模型（主仓库改动）或把参数移出插件。

### 更新语义（宿主保证）

| 项目 | 更新 zip 时 |
|------|-------------|
| KV 数据 / 文件存储 | **保留** |
| `enabled` 状态 | **保留** |
| 已授权权限 | **保留（冻结）**，新版本声明不会自动扩权 |
| `assets/` | 整体替换 |

**卸载**会删掉插件全部持久化数据（含玩法参数），不可恢复。

---

## UI 风格规范（必须与宿主统一）★

插件页面渲染在宿主布局内部，**视觉上必须像宿主自己的一页**，不能像嵌进来的第三方组件。
由于宿主的 Tailwind 构建扫描不到插件源码，样式只能自带 —— 所以"统一"这件事完全靠本节的
约定来保证，改 UI 前先读这一节。

### 1. 硬性约束

| 项目 | 规则 |
|------|------|
| 样式来源 | 只用 `src/style.css`，选择器一律 `.lp-` 前缀；**禁止** Tailwind 工具类、全局选择器（`body`/`*`）、`!important`、引入任何 UI/图标库 |
| 颜色 | 只用 `--lp-*` CSS 变量；**禁止**在 TSX 或 CSS 里写死 hex/rgb（变量定义处除外） |
| 深色模式 | 跟随宿主 `<html class="dark">`（宿主 `themeStore` 控制），用 `.dark .lp-page { ... }` 覆盖变量；**禁止** `prefers-color-scheme` |
| 尺寸 | 一律 `rem`/`em`，跟随宿主 `html[data-font-size]`（small 14px / default 16px / large 18px）；**禁止**用 px 写字号 |
| 卡片配方 | 沿用宿主卡片：`白/gray-900 底 + gray-300/gray-700 边框 + shadow` → `.lp-row` / `.lp-panel` |
| 圆角 | 输入框/按钮 `0.375rem`、卡片/提示条 `0.5rem`、头像与徽章 `999px`；宿主整体偏方角，**不要**加大到 `1rem+` |
| 页宽 | `.lp-page`：`max-width: 64rem` 居中 + `1.5rem` 内边距（窄屏 `1rem`） |
| 反馈 | 统一走 `.lp-banner--{champion,success,fail,error,info}`；**禁止** `alert`/`confirm`/`console` 提示用户 |
| 图标 | 用 emoji（🍭 🍬 🏆 💥）+ 文字；不引图标库 |
| 文案 | 中文、第二人称、口语化（如「明天再来吧」），与宿主一致 |
| 无障碍 | 交互元素用 `<button type="button">`；表单 `label htmlFor`；禁用态 `disabled` + `title` 说明原因 |
| 响应式 | 新增布局必须在 `≤40rem` 下检查（`.lp-row` 会折行） |

### 2. 色板（`src/style.css` 的 `--lp-*` 变量）

| 用途 | 变量 | 浅色 | 深色 |
|------|------|------|------|
| 正文 / 强调文字 | `--lp-text` / `--lp-text-strong` | gray-800 / gray-900 | gray-100 / white |
| 次级 / 弱化文字 | `--lp-muted` / `--lp-faint` | gray-500 / gray-400 | gray-400 / gray-500 |
| 边框 / 弱边框 | `--lp-border` / `--lp-border-soft` | gray-300 / gray-200 | gray-700 / gray-800 |
| 卡片底 / 次级底 | `--lp-surface` / `--lp-surface-alt` | white / gray-50 | gray-900 / gray-800+50% |
| 主题色（品牌） | `--lp-accent` / `--lp-accent-strong` | pink-500 / pink-600 | 同左 |
| 主题浅底 / 边框 / 文字 | `--lp-accent-soft` / `--lp-accent-border` / `--lp-accent-text` | pink-50 / pink-300 / pink-700 | pink-900+30% / pink-800 / pink-300 |
| 语义四态 | `--lp-success-*` `--lp-warn-*` `--lp-error-*` `--lp-info-*` | green/amber/red/blue 的 50/300/700 | 900+30% / 800 / 300 |
| 卡片阴影 | `--lp-shadow` | Tailwind `shadow` | 同左（宿主卡片在深色下也是 plain `shadow`） |

灰阶与语义色都取自宿主用的同一套 Tailwind 调色板；文字层级只有 `text / strong / muted / faint`
四档，**不要**自造第五档灰。

### 3. 主题色决策

- **pink 是本插件的品牌色**（糖果主题，v1 就这样），只用于本插件专属动作：点糖按钮、
  冠军横幅、参数面板主按钮。
- 宿主自身 UI 的强调色偏 **blue-600 / blue-700**（`bg-blue-600` / `bg-blue-700`）。
  若将来要求与宿主强调色完全一致，**只改 `--lp-accent*` 那 5 个变量**（换成 blue 阶）即可，
  不要散改各处颜色。
- 通用动作（重试 / 收起 / 取消 / 知道了）一律用中性 `.lp-btn`（描边灰），不要用主题色。

### 4. 复用优先

新增 UI 前先在 `style.css` 里找现成类：`.lp-row`（列表卡片）、`.lp-btn` / `.lp-btn--primary`、
`.lp-banner--*`（提示条）、`.lp-panel`（设置卡片）、`.lp-status`（状态条）、`.lp-field`（表单）、
`.lp-empty`（空态）。只有确实无法复用时才新增 `.lp-` 类，并保持同一命名风格
（`block__element` 用连字符、变体用 `--`）。

### 5. 样式注入机制（不要另起一套）

`styles.ts` 用 Vite 的 `?inline` 把 CSS 作为字符串打进 JS，运行时插入
`<style id="lollipop-rank-styles">`，幂等（重复加载不会堆叠）。入口与页面各调一次
`ensureStyles()`。**不要**改成 `<link>` 注入、不要新增第二套注入机制、不要依赖 CSS 资产文件名。
副作用：宿主若配置了严格 CSP 且不放行内联样式，样式会失效（此时才考虑改 `<link>` 方案）。

### 6. 改样式后的人工核对清单（没有视觉回归测试）

1. 浅色 + 深色（宿主右上角主题切换）两套都看
2. 宿主「字号」三档（small / default / large）下不溢出、不错位
3. 窄屏（≤40rem，例如 375px 宽）下 `.lp-row` 折行正常、按钮不挤爆
4. 按钮 `hover` / `disabled` 态，禁用时 `title` 有原因说明
5. 各提示条（冠军 / 成功 / 失败 / 错误 / 信息 / 加载 / 空态）至少各看一次

---

## 关键设计模式

- **分层与依赖方向**：`logic`（纯函数，不 import React/SDK/DOM）← `storage`（唯一碰数据 API 的地方）
  ← `useCandyRank`（状态机）← `CandyPage` / `SettingsPanel`（渲染）。**玩法规则只能写在 `logic.ts`**，
  页面里不要内联概率/时间计算。
- **元信息单一事实来源**：`src/meta.ts` ↔ `plugin.json` ↔ `package.json`，由 `src/manifest.test.ts` 守卫。
- **时间**：全部以北京时间（UTC+8）计算，只用 `bjDateKey` / `bjWeekKey` / `isoWeekKey`。
  **禁止**用 `new Date().getDate()`、`getDay()`、`toLocaleDateString()` 直接算天/周。
- **玩法参数**：`CandyConfig` + `CONFIG_BOUNDS` + `DEFAULT_CONFIG`。默认值必须与 v1 硬编码一致
  （60% / 0.8 / 5% / 10 次）；`normalizeConfig` 负责夹紧、面板负责报错；新增一个参数要同时改
  `CandyConfig`、`DEFAULT_CONFIG`、`CONFIG_BOUNDS`、`SettingsPanel` 的 `FIELDS`、以及测试。
- **周结算（懒结算）**：插件没有后台任务上下文，改为「打开页面时结算」：`last_settled !== 当前周 key`
  才结算，先写 `last_settled` 占位锁再读糖数（缩小并发重复结算窗口），失败回滚锁。
  参与者 = 当前成员 ∪ KV 中仍有糖记录的用户；只清零 `> 0` 的人；整周无人有糖时不覆盖历史冠军。
- **并发**：每日额度用宿主**原子计数器**（`pluginIncr`，超限即 `pluginAdd(-1)` 回滚拒绝），
  不要退回 KV「读-改-写」；点糖判定前**现读**一次目标糖数，不要用列表里的 state。
- **数据兼容**：插件 id、KV namespace/key、值的格式都属于**对外契约**，默认不可改。
  确需变更时：读旧 key 写新 key 做一次性迁移 + 在 `CHANGELOG.md` 写清影响 + 更新本文档。
- **错误处理**：统一用 `errorMessage()` 转文案；页面区分「加载失败（带重试）」与「操作失败（提示条）」；
  点糖流程抛错要 `refundAttempt` 退还额度。

---

## 修改代码注意事项（速查）

| 想改什么 | 改哪里 | 还要动什么 |
|----------|--------|------------|
| 玩法规则（概率/次数/结算） | `src/logic.ts` | `src/logic.test.ts`（必须补用例）；涉及默认值的同步 `CHANGELOG.md` |
| KV 读写 / 新 namespace | `src/storage.ts` | `src/storage.test.ts`（含 v1 兼容用例）；本文档「数据布局」相关描述 |
| 页面 UI / 交互 | `src/CandyPage.tsx` + `src/style.css` | 过一遍「UI 风格规范」的人工核对清单；交互变化补 `src/CandyPage.test.tsx` |
| 玩法参数项 | `src/logic.ts` + `src/SettingsPanel.tsx` | 参数面板 `FIELDS`、`CONFIG_BOUNDS`、测试、README 参数表 |
| 插件名 / 描述 / 版本 | `src/meta.ts` | `plugin.json`、`package.json`、`CHANGELOG.md`（三处版本必须一致，测试会拦） |
| 路由 / 导航 / 需要的权限 | `src/meta.ts` | `plugin.json` 的 `permissions_needed`；新增权限要提醒管理员后台勾选 |
| 宿主 SDK 升级 | `types/mcguffin-plugin-sdk.d.ts` | 重新 `cp`（见「测试与发布」）后 `npm run build`，按报错修 |
| 打包/入口行为 | `vite.config.ts`、`src/index.tsx` | `scripts/smoke-entry.mjs` 的断言；`npm run zip` 验证 |

---

## 测试与发布

### 测试（`npm test`，67 个）

| 文件 | 覆盖 | 环境 |
|------|------|------|
| `src/logic.test.ts` | 概率、北京时间换算（含周一 0:00 切周、跨年 ISO 周）、参数规整、排名、结算（并列冠军 / 无人有糖 / 幂等 / 回滚） | node |
| `src/storage.test.ts` | KV 读写、原子额度（超限停在上限）、参数往返、**v1 旧格式数据可读** | node（内存假 SDK） |
| `src/CandyPage.test.tsx` | jsdom + 真实 React 渲染整页：榜单 / 点糖成功失败 / 次数用尽 / 跨周结算 / 管理员调参 / 越界校验 / 权限不足重试 | jsdom |
| `src/manifest.test.ts` | `plugin.json` / `package.json` / `src/meta.ts` 一致性、id 合法性、权限是否宿主已知 | node |

配套约束：

- 新增玩法规则 → 必须补 `logic.test.ts`；改 KV → 必须补 `storage.test.ts`（含兼容性）；
  改页面交互 → 补 `CandyPage.test.tsx`。
- `scripts/smoke-entry.mjs`（`npm run zip` 末尾自动跑）会解压 zip、校验包结构/体积/裸模块名/
  相对动态 import，然后**打桩宿主 SDK 真正 `import()` 入口 ESM**，断言自注册的 id / name /
  version / 描述 / 作者 / 权限 / 路由与清单一致。它能跑在 Node 里的前提是**入口链路没有裸模块
  import**（React 只出现在按需加载的页面 chunk 里）——破坏这个前提冒烟测试会直接失败。
- `react` / `react-dom` / `jsdom` / `@testing-library/react` 都是**开发依赖，只服务测试**；
  构建时 `react` 是 `external`，不会打进 zip。

### SDK 类型同步

```bash
cp <mcguffin>/web/src/plugins/sdk/plugin-sdk.d.ts types/mcguffin-plugin-sdk.d.ts
npm run build     # tsc 报错处即为不兼容点
```

该文件是主仓库的**逐字节副本**（主仓库有测试强制校验两份一致），**不要手改**。

### 发布

```bash
# 1) 三处版本一起递增：plugin.json / package.json / src/meta.ts（+ CHANGELOG.md）
# 2) 提交后打 tag 并推送
git tag v2.0.0 && git push origin v2.0.0
```

`release.yml` 会校验 tag 与版本一致 → `tsc` + `npm test` → `npm run zip`（含冒烟）→
把 `dist/lollipop-rank.zip` 作为 release 资产上传。之后在宿主后台用
`https://github.com/<owner>/<repo>/releases/latest/download/lollipop-rank.zip` 一键「从原 URL 更新」。

---

## 常见坑

| 现象 | 原因 / 处理 |
|------|-------------|
| Tailwind 类没效果 | 宿主构建扫描不到插件源码；样式必须写在 `style.css` 并用 `.lp-` 类 |
| `Failed to resolve module specifier "xxx"` | 裸模块名不在宿主 import map（只有 react / react-dom / jsx-runtime 4 个）；第三方库保持默认打包 |
| 数据接口 403 | 插件被禁用 / 全局禁用 / 未授予 `storage`·`read:team` 权限（后台插件页勾选） |
| 改了参数别人没变 | config 只在页面加载时读一次；其他人需刷新页面（保存者本人立即生效） |
| 首次打开就把糖清零了 | 正常行为：`last_settled` 为空视为跨周，首次打开会结算一次 |
| 参数/糖数全没了 | 插件被**卸载**（卸载会删 KV），更新不会 |
| 控制台能改参数 | 已知边界：后端只校验插件级 `storage`，管理员判定是 UI 级（见「鉴权真相」） |
| 样式整体失效 | 宿主 CSP 不放行内联样式；或 `ensureStyles()` 没被调用 |
| 后台版本与 zip 不一致 | `plugin.json` 与 `src/meta.ts` 漂移；`npm test` 会直接失败 |

---

## 提交与版本规范

- Conventional Commits：`feat:` / `fix:` / `refactor:` / `docs:` / `test:` / `chore:`（中文描述可，
  与主仓库一致）。
- 版本号三处同步（`plugin.json` / `package.json` / `src/meta.ts`），并在 `CHANGELOG.md` 记录
  兼容性影响（尤其是 KV 布局、权限、玩法默认值的变化）。
- **绝不要改** `PLUGIN_ID`、KV namespace/key、`DEFAULT_CONFIG` 的既有默认值 —— 除非本次发布
  明确接受数据迁移，并在 CHANGELOG + 本文档写清。
- CI：`ci.yml`（PR/main：tsc + 单测 + 打包 + 冒烟）、`release.yml`（tag 发布）、
  `dependabot.yml`（npm 与 actions 自动更新，actions 以 commit SHA 固定）。
- 与主仓库的联动：UI 规范或宿主视觉调整时，对齐主仓库的设计；SDK 成员变化时同步类型副本；
  插件契约（打包/权限/更新语义）变化时同步主仓库 `docs/guide/plugin-development.md`。
