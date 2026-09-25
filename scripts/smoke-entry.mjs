#!/usr/bin/env node
/**
 * 产物契约冒烟测试：`npm run smoke`（`npm run zip` 末尾会自动执行）
 *
 * 打包成功 ≠ 装得上。这个脚本模拟宿主（McGuffin）加载 zip 插件的方式，
 * 把「装完不生效」这类问题挡在发布之前：
 *
 *  1. 解压 `dist/<id>.zip` 到临时目录，校验包结构（plugin.json 在根目录、entry 存在）；
 *  2. 校验体积 / 文件数 / 裸模块名限制（与宿主后端安装校验一致）；
 *  3. 校验产物里所有相对 `import()` 都能在包内找到对应文件；
 *  4. 打桩 `window.__MCGUFFIN_SDK__`，真正 `import()` 入口 ESM；
 *  5. 断言入口调用了 `definePlugin()`，且 id / name / version / 权限 / 路由与
 *     plugin.json 完全一致（不一致会让后台显示的版本与 zip 对不上）。
 *
 * 之所以能在 Node 里跑：入口链路上没有裸模块 import（React 由宿主的 import map
 * 解析，只在按需加载的页面 chunk 里出现），CSS 是以 `?inline` 打进 JS 的字符串。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import AdmZip from "adm-zip";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");

/** 宿主 web/index.html 的 import map 覆盖的裸模块名（其余浏览器解析不了） */
const MAPPED_SPECIFIERS = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom",
]);

/** 与宿主后端 `install_plugin_zip` 的校验保持一致 */
const LIMITS = {
  files: 512,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
};

function fail(message) {
  console.error(`\n✗ 冒烟测试失败：${message}\n`);
  process.exit(1);
}

const manifestPath = join(root, "plugin.json");
if (!existsSync(manifestPath)) fail("缺少 plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const id = String(manifest.id ?? "");
const entry = String(manifest.entry ?? "index.js");
const zipPath = join(distDir, `${id}.zip`);

if (!existsSync(zipPath)) {
  fail(`找不到 ${zipPath}；请先执行 \`npm run build\` + \`node scripts/build-zip.mjs\``);
}

// ── 1. 解压 ──

const extractDir = join(distDir, ".smoke");
rmSync(extractDir, { recursive: true, force: true });
mkdirSync(extractDir, { recursive: true });
new AdmZip(zipPath).extractAllTo(extractDir, true);

const zip = new AdmZip(zipPath);
const entries = zip
  .getEntries()
  .filter((e) => !e.isDirectory)
  .map((e) => ({ name: e.entryName, size: e.header.size }));

// ── 2. 包结构与限额 ──

if (!entries.some((e) => e.name === "plugin.json")) {
  fail("zip 根目录缺少 plugin.json（后端按名精确读取）");
}
if (!existsSync(join(extractDir, entry))) {
  fail(`plugin.json 的 entry（${entry}）在包内不存在`);
}
if (entries.length > LIMITS.files) {
  fail(`文件数 ${entries.length} 超过上限 ${LIMITS.files}`);
}
const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
if (totalBytes > LIMITS.totalBytes) {
  fail(`解压总量 ${totalBytes} 字节超过上限 ${LIMITS.totalBytes}`);
}
for (const item of entries) {
  if (item.size > LIMITS.fileBytes) {
    fail(`文件 ${item.name} 超过单文件上限 ${LIMITS.fileBytes} 字节`);
  }
}

const packaged = new Set(entries.map((e) => e.name));
const jsFiles = entries.map((e) => e.name).filter((name) => name.endsWith(".js"));

// ── 3. 裸模块名与相对动态 import 检查 ──

const bareImports = new Set();
for (const name of jsFiles) {
  const source = readFileSync(join(extractDir, name), "utf8");

  for (const match of source.matchAll(
    /(?:from|import)\s*["']([^"'./][^"']*)["']/g,
  )) {
    if (!MAPPED_SPECIFIERS.has(match[1])) bareImports.add(match[1]);
  }

  for (const match of source.matchAll(/import\(\s*["'](\.[^"']*)["']\s*\)/g)) {
    const target = resolve(dirname(join(extractDir, name)), match[1]);
    const relative = target.slice(extractDir.length + 1);
    if (!packaged.has(relative)) {
      fail(`${name} 里 import("${match[1]}") 指向的文件不在包内：${relative}`);
    }
  }
}
if (bareImports.size > 0) {
  fail(
    `产物里出现宿主 import map 未映射的裸模块名：${[...bareImports].join(", ")}` +
      "（第三方库请保持默认打包，不要加进 external）",
  );
}
if (jsFiles.filter((name) => name !== entry).length === 0) {
  fail("包内除了入口没有任何 chunk —— 页面组件用的是动态 import，应产出独立 chunk");
}

// ── 4. 打桩宿主 SDK 并真正加载入口 ──

const registrations = [];
const lazyFactories = [];

globalThis.window = {
  __MCGUFFIN_SDK__: {
    React: {
      lazy: (factory) => {
        lazyFactories.push(factory);
        return { $$typeof: Symbol.for("react.lazy"), _factory: factory };
      },
    },
    ReactDOM: {},
    definePlugin: (definition, component) => {
      registrations.push({ definition, component });
      return definition;
    },
  },
};

try {
  await import(pathToFileURL(join(extractDir, entry)).href);
} catch (error) {
  fail(`入口 ESM 加载失败：${error?.stack ?? error}`);
}

// ── 5. 断言自注册内容 ──

if (registrations.length !== 1) {
  fail(`入口应恰好调用一次 definePlugin()，实际 ${registrations.length} 次`);
}
const { definition } = registrations[0];

const expectations = [
  ["id", manifest.id, definition.id],
  ["name", manifest.name, definition.name],
  ["version", manifest.version, definition.version],
  ["description", manifest.description, definition.description],
  ["author", manifest.author, definition.author],
];
for (const [field, expected, actual] of expectations) {
  if (expected !== undefined && actual !== expected) {
    fail(`definePlugin() 的 ${field} 与 plugin.json 不一致：${actual} ≠ ${expected}`);
  }
}

const declaredPerms = [...(manifest.permissions_needed ?? [])].sort();
const actualPerms = [...(definition.permissions_needed ?? [])].sort();
if (declaredPerms.join(",") !== actualPerms.join(",")) {
  fail(
    `definePlugin() 的 permissions_needed 与 plugin.json 不一致：` +
      `[${actualPerms}] ≠ [${declaredPerms}]`,
  );
}

const routes = definition.routes ?? [];
if (routes.length === 0) fail("入口没有注册任何路由");
for (const route of routes) {
  if (typeof route.path !== "string" || !route.path.startsWith("/")) {
    fail(`路由 path 不合法：${JSON.stringify(route.path)}`);
  }
  if (!route.label) fail(`路由 ${route.path} 缺少 label（导航项要显示它）`);
  if (!["main", "admin", "hidden"].includes(route.nav_placement)) {
    fail(`路由 ${route.path} 的 nav_placement 不合法：${route.nav_placement}`);
  }
  if (!route.component) {
    fail(`路由 ${route.path} 既没有 route.component，也没有插件级组件`);
  }
}
if (lazyFactories.length === 0) {
  fail("没有检测到 React.lazy 页面组件（页面应按需加载）");
}

rmSync(extractDir, { recursive: true, force: true });

const sizeKb = (statSync(zipPath).size / 1024).toFixed(1);
console.log(
  `✓ 冒烟测试通过：${id} v${manifest.version} —— ` +
    `${routes.length} 条路由、${jsFiles.length} 个 JS 文件、${sizeKb} KiB`,
);
console.log(`  入口可被宿主 import()，并已用一致的元信息完成自注册。`);
