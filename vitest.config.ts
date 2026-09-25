import { defineConfig } from "vitest/config";

/**
 * 单测配置（与 vite.config.ts 分开，避免插件构建配置里混入 test 字段）。
 *
 * 默认环境是 node（纯逻辑与存储层不需要浏览器）；页面集成测试用文件顶部的
 * `// @vitest-environment jsdom` 单独切换，并通过给 `globalThis.window` 打桩
 * 注入假的宿主 SDK（见 src/*.test.ts(x)）。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
