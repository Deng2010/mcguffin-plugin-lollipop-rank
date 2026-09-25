# 更新日志

本仓库只维护 McGuffin 插件 `lollipop-rank`（榜榜糖）。

## v2.0.0

按 McGuffin 插件规范重写，并从主仓库（`web/src/plugins/lollipop-rank/`）迁出为独立仓库。

**兼容性**

- 插件 id 仍为 `lollipop-rank`，路由仍为 `/plugins/lollipop`，玩法与 KV 数据布局不变
  → 旧数据（糖数 / 每日次数 / 周冠军）全部沿用，升级无需手工操作；
- 权限仍为 `storage` + `read:team`，未新增权限，因此升级后不需要在后台补勾。

**新增**

- 玩法参数可调：管理员可在插件页面调整基础成功率、衰减系数、成功率下限与每日次数，
  带区间校验与「不同糖数下的成功率」预览；参数存于 KV `config/params`，缺失时回退默认值。
- 单测 67 个（玩法纯逻辑 / 存储层 / 清单一致性 / jsdom 页面集成）与产物冒烟测试
  （解压 zip → 打桩宿主 SDK 真正 `import()` 入口，校验自注册内容与清单一致）。
- CI（类型检查 + 单测 + 打包 + 冒烟）与 Release 流程（校验 tag 与版本、上传 zip 资产）。

**修复**

- 每日次数改用宿主原子计数器，修掉 v1 的 KV「读-改-写」在多 Tab / 多设备下互相覆盖、
  可能超额点糖的问题；超出上限时回滚计数，计数不再被推高。
- 点糖前现读目标糖数，不再用列表里可能已陈旧的 React state 值判定概率。
- 周结算参与者改为「当前成员 ∪ KV 中仍有糖记录者」：中途退队的成员此前拿不到冠军、
  其糖数也永远清不掉（重新入队会带着旧糖数回来）。
- 榜单排序不再原地 `sort()` React state，改为返回新数组。
- 结算读糖改并行，且只清零确实有糖的人，减少无谓请求。

**工程**

- 零主应用依赖：`isJoined` / 权限判定等在主仓库 `web/src/utils/user.ts` 里的小工具改为
  本地实现；不再 import 任何主应用源码。
- 样式自带：宿主 Tailwind 扫描不到插件源码，改用 `.lp-*` 前缀的 `style.css`
  （Vite `?inline` 打进 JS 后注入 `<style>`），深色模式跟随宿主 `html.dark`，尺寸用 rem
  跟随宿主字号设置。
- 模块拆分：`logic`（纯逻辑）/ `storage`（KV）/ `useCandyRank`（状态机）/ `CandyPage`
  （渲染）/ `SettingsPanel`（设置）/ `meta`（元信息）。

## v1.0.0

主仓库内联版本（`web/src/plugins/lollipop-rank/`，基于已移除的 `definePlugin()` +
`import.meta.glob` 前端代码注册机制）：点糖玩法初版，玩法参数硬编码（60% 基础成功率、
0.8 衰减、5% 下限、每日 10 次）。该版本于主仓库提交 `66471b0`
（`refactor(plugins): 将内联插件移出版本库，主仓库只保留插件系统`）从源码树移除。
