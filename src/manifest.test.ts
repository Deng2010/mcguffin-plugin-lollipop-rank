/**
 * 清单一致性守卫。
 *
 * 宿主的插件后台是按 `plugin.json` 展示版本与来源的，而运行期路由是入口
 * `definePlugin()` 注册的 —— 两处一旦不一致，后台显示的版本就会与 zip 对不上
 * （主仓库文档明确要求保持一致）。这里把 `plugin.json` / `package.json` 与
 * `src/meta.ts` 对齐，避免人工同步漏改。
 */
import { describe, expect, it } from "vitest";
import manifest from "../plugin.json";
import pkg from "../package.json";
import {
  PLUGIN_AUTHOR,
  PLUGIN_DESCRIPTION,
  PLUGIN_ID,
  PLUGIN_NAME,
  PLUGIN_PERMISSIONS,
  PLUGIN_VERSION,
} from "./meta";

describe("plugin.json", () => {
  it("id / name / version / description / author 与 src/meta 一致", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
    expect(manifest.name).toBe(PLUGIN_NAME);
    expect(manifest.version).toBe(PLUGIN_VERSION);
    expect(manifest.description).toBe(PLUGIN_DESCRIPTION);
    expect(manifest.author).toBe(PLUGIN_AUTHOR);
  });

  it("permissions_needed 与 src/meta 一致（含顺序，便于人工比对）", () => {
    expect(manifest.permissions_needed).toEqual(PLUGIN_PERMISSIONS);
  });

  it("id 符合宿主校验规则（字母数字开头，仅含字母数字 / - / _，长度 ≤ 64）", () => {
    expect(manifest.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
  });

  it("entry 指向 vite lib 产物 index.js（默认值也接受）", () => {
    expect(manifest.entry ?? "index.js").toBe("index.js");
  });

  it("只申请宿主已知的插件权限", () => {
    const known = new Set([
      "storage",
      "notify",
      "read:team",
      "write:team",
      "write:team_roles",
      "read:problems",
      "read:contests",
      "read:posts",
      "read:users",
      "read:users:email",
    ]);
    for (const permission of manifest.permissions_needed) {
      expect(known.has(permission)).toBe(true);
    }
  });
});

describe("package.json", () => {
  it("version 与插件版本同步（发布时一起递增）", () => {
    expect(pkg.version).toBe(PLUGIN_VERSION);
    expect(pkg.name).toBe(`mcguffin-plugin-${PLUGIN_ID}`);
  });

  it("构建脚本齐全（dev / build / zip / test）", () => {
    for (const script of ["dev", "build", "zip", "test"]) {
      expect(pkg.scripts[script as keyof typeof pkg.scripts]).toBeTruthy();
    }
  });
});
