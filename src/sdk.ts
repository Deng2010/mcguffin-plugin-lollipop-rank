/**
 * 宿主注入的全局 SDK 访问器。
 *
 * 插件**只能**通过 `window.__MCGUFFIN_SDK__` 使用宿主能力，不能 import 主应用代码。
 * 这里刻意把读取动作放在函数内部（而不是模块顶层解构），好处是：
 *  - 单测里可以先打桩 `globalThis.window.__MCGUFFIN_SDK__` 再调用存储层；
 *  - SDK 缺失时给出明确报错，而不是 `undefined is not a function`。
 */
export type McGuffinSdk = Window["__MCGUFFIN_SDK__"];

export function sdk(): McGuffinSdk {
  const instance =
    typeof window === "undefined" ? undefined : window.__MCGUFFIN_SDK__;
  if (!instance) {
    throw new Error(
      "McGuffin 插件 SDK 不可用：插件页面必须运行在 McGuffin 站内",
    );
  }
  return instance;
}
