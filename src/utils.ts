/** 通用小工具（无 React / 无 SDK 依赖，可直接单测） */

/** 把任意抛出的异常转成可展示的文案 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * 是否已加入团队。
 *
 * 对应主应用 `team_status === "joined"` 的判定：待审核（pending）/ 未加入的用户
 * 可以看榜但不能点糖。插件不能 import 宿主 utils，故在此本地实现。
 */
export function isJoined(
  user: { team_status?: string } | null | undefined,
): boolean {
  return user?.team_status === "joined";
}

/** 管理员（含超级管理员）——决定是否展示玩法参数设置面板 */
export function isAdminRole(
  user: { effective_role?: string } | null | undefined,
): boolean {
  return (
    user?.effective_role === "admin" || user?.effective_role === "superadmin"
  );
}
