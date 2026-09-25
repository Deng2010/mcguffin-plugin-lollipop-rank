/**
 * 插件入口 —— 打包后即 zip 包内的 `index.js`（plugin.json 的 entry）。
 *
 * 入口只做一件事：通过宿主的全局 SDK **自注册**插件（路由 + 页面组件）。
 *
 * 注意：
 *  - 这里刻意不 `import "react"`；React 从 `window.__MCGUFFIN_SDK__` 取用，
 *    保证与宿主是同一份实例（页面组件里则可以正常 `import { useState } from "react"`
 *    与写 JSX —— 宿主 index.html 的 import map 会把它映射回宿主实例）；
 *  - 元信息统一取自 ./meta，`src/manifest.test.ts` 会校验它与 plugin.json 一致。
 */
import { ensureStyles } from "./styles";
import {
  PLUGIN_AUTHOR,
  PLUGIN_DESCRIPTION,
  PLUGIN_ID,
  PLUGIN_NAME,
  PLUGIN_PERMISSIONS,
  PLUGIN_VERSION,
  ROUTE_PATH,
  ROUTE_REQUIRED_PERMISSION,
} from "./meta";

const { definePlugin, React } = window.__MCGUFFIN_SDK__;

// 入口先注入一次样式：即使页面组件还没被 lazy 加载，样式也已就位（幂等）
ensureStyles();

definePlugin({
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  description: PLUGIN_DESCRIPTION,
  author: PLUGIN_AUTHOR,
  // 与 plugin.json 的 permissions_needed 一致：首次安装按声明授予，
  // 之后扩权要由管理员在后台插件页勾选（更新不会自动扩权）。
  permissions_needed: [...PLUGIN_PERMISSIONS],
  routes: [
    {
      path: ROUTE_PATH,
      label: PLUGIN_NAME,
      icon: "🍭",
      nav_placement: "main",
      // 主应用权限：能看团队成员的人才看得到本页
      required_permission: ROUTE_REQUIRED_PERMISSION,
      // 页面按需加载 → 同目录 chunk，打包脚本会一起塞进 zip
      component: React.lazy(() => import("./CandyPage")),
    },
  ],
});

export {};
