/**
 * 样式注入。
 *
 * 插件不能依赖宿主的 Tailwind（宿主构建扫描不到插件源码），因此自带
 * `style.css`；用 Vite 的 `?inline` 把 CSS 作为字符串打进 JS 产物，
 * 运行时插入一个 <style> 标签 —— 好处：
 *  - 不会多出一个 CSS 资产文件，也就不需要在运行时推导 assets URL；
 *  - 页面组件（lazy chunk）加载时立即生效，没有额外的网络往返与闪烁。
 *
 * 注入是幂等的：宿主重复加载插件（HMR / 重新启用）不会堆叠多个 style 标签。
 */
import css from "./style.css?inline";

const STYLE_ELEMENT_ID = "lollipop-rank-styles";

export function ensureStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = css;
  document.head.appendChild(style);
}
