/**
 * 插件元信息 —— 插件侧的**唯一事实来源**。
 *
 * ⚠️ 必须与仓库根目录的 `plugin.json` 保持一致（id / name / version / author /
 *    permissions_needed），否则管理后台显示的版本会与 zip 里的版本对不上。
 *    `src/manifest.test.ts` 会强制校验两者一致，改一处忘了另一处会被测试拦下。
 *
 * ⚠️ `PLUGIN_ID` 一旦发布就不要再改：插件数据（KV）按 id 隔离，改 id 等于换了一个
 *    新插件；同时 id 决定 zip 文件名 `dist/<id>.zip`。
 */

/** 插件 id（与 plugin.json 的 id 一致；决定 KV 数据归属与 zip 文件名） */
export const PLUGIN_ID = "lollipop-rank";

/** 显示名称 */
export const PLUGIN_NAME = "榜榜糖";

/** 语义化版本（与 plugin.json / package.json 同步递增） */
export const PLUGIN_VERSION = "2.0.0";

/** 一句话描述 */
export const PLUGIN_DESCRIPTION =
  "给团队成员点糖，每周结算冠军；糖越多成功率越低，失败清零（玩法参数可在插件内调整）";

/** 作者 */
export const PLUGIN_AUTHOR = "mcguffin";

/**
 * 申请的插件权限：
 *  - `storage`    —— KV（糖数 / 每日次数 / 周结算状态 / 玩法参数）
 *  - `read:team`  —— 读取团队成员列表
 *
 * 已知权限之外的名字会被服务端静默忽略；更新插件时**不会**自动扩权，
 * 新版权限需要管理员在后台插件页勾选后才生效。
 */
export const PLUGIN_PERMISSIONS: string[] = ["storage", "read:team"];

/** 插件页面路由（沿用 v1 路径，老书签仍然有效） */
export const ROUTE_PATH = "/plugins/lollipop";

/** 查看该页面所需的主应用权限（团队可见性） */
export const ROUTE_REQUIRED_PERMISSION = "view_team";
