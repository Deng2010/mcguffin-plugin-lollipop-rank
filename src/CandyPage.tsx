/**
 * 榜榜糖 —— 插件页面（v2，按 McGuffin 插件规范重写）。
 *
 * 本文件只负责渲染；状态与数据读写都在 `useCandyRank()` 里。
 * 样式来自 `./style.css`（以 `?inline` 打进产物，模块加载时注入，见 ./styles.ts）。
 *
 * 与原版（v1，主仓库内联插件）的差异见仓库 README「与 v1 的差异」一节：
 *  - 玩法参数可调（管理员在页面内调整）；
 *  - 每日次数改用宿主的原子计数器，多 Tab 不再超额；
 *  - 点糖前现读糖数，不再用列表里的陈旧值；
 *  - 周结算参与者 = 当前成员 ∪ KV 里仍有糖的人（退队成员也能夺冠 / 被清零）。
 */
import { useState } from "react";
import type { PluginTeamMember } from "../types/mcguffin-plugin-sdk";
import {
  CANDY_EMOJI,
  CHAMPION_EMOJI,
  formatNumber,
  formatProbability,
  isDefaultConfig,
  successProbability,
} from "./logic";
import { PLUGIN_NAME, PLUGIN_VERSION } from "./meta";
import SettingsPanel from "./SettingsPanel";
import { ensureStyles } from "./styles";
import { useCandyRank } from "./useCandyRank";

// lazy chunk 加载时注入样式（幂等）
ensureStyles();

export default function CandyPage() {
  const rank = useCandyRank();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const {
    me,
    members,
    candies,
    config,
    champions,
    remaining,
    ranked,
    loading,
    error,
    busy,
    feed,
    isAdmin,
    isJoinedTeam,
    today,
    currentWeek,
    nameOf,
    reload,
    clearFeed,
    candy,
    saveConfig,
  } = rank;

  const meId = me?.id ?? null;

  if (loading) {
    return (
      <div className="lp-page">
        <p className="lp-loading">加载榜榜糖数据…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="lp-page">
        <div className="lp-banner lp-banner--error">
          <strong>加载失败</strong>
          <p>{error}</p>
          <button type="button" className="lp-btn" onClick={reload}>
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lp-page">
      <header className="lp-header">
        <h1 className="lp-title">
          {CHAMPION_EMOJI} {PLUGIN_NAME}
        </h1>
        <span className="lp-badge">插件</span>
        <span className="lp-version">v{PLUGIN_VERSION}</span>
      </header>

      {/* 状态栏 */}
      <div className="lp-status">
        <span className="lp-status-item">
          今日剩余点糖次数：
          <strong className={remaining > 0 ? "lp-accent" : "lp-danger"}>
            {remaining} / {config.dailyLimit}
          </strong>
        </span>
        <span className="lp-status-item">
          本周：<strong>{currentWeek}</strong>
        </span>
        <span className="lp-status-right">
          北京时间 {today} · 每周一 0:00 结算
        </span>
      </div>

      {/* 玩法参数快照 + 管理员设置入口 */}
      <div className="lp-params">
        <span>玩法参数：</span>
        <span>
          基础成功率 <code>{formatProbability(config.successBase)}</code>
        </span>
        <span>
          每颗衰减 <code>×{formatNumber(config.successDecay)}</code>
        </span>
        <span>
          下限 <code>{formatProbability(config.successFloor)}</code>
        </span>
        <span>
          每日 <code>{config.dailyLimit}</code> 次
        </span>
        {isDefaultConfig(config) && (
          <span className="lp-params-tag">（默认值）</span>
        )}
        {isAdmin && (
          <button
            type="button"
            className="lp-btn"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            {settingsOpen ? "收起设置" : "调整参数"}
          </button>
        )}
      </div>

      {settingsOpen && isAdmin && (
        <SettingsPanel
          config={config}
          onSave={saveConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* 上周冠军 */}
      {champions.length > 0 && (
        <div className="lp-banner lp-banner--champion">
          🏆 上周冠军：
          {champions.map((userId, index) => (
            <span key={userId}>
              {index > 0 && "、"}
              <strong>
                {CHAMPION_EMOJI} {nameOf(userId)} {CHAMPION_EMOJI}
              </strong>
            </span>
          ))}
        </div>
      )}

      {/* 点糖反馈 */}
      {feed && (
        <div className={`lp-banner lp-banner--${feed.kind}`}>
          {feed.text}
          <button type="button" className="lp-btn" onClick={clearFeed}>
            知道了
          </button>
        </div>
      )}

      {/* 非成员提示 */}
      {me && !isJoinedTeam && (
        <div className="lp-banner lp-banner--info">
          仅团队成员可以参与点糖，请联系管理员申请加入团队。
        </div>
      )}

      {/* 成员榜 */}
      <div className="lp-list">
        {ranked.length === 0 ? (
          <p className="lp-empty">
            {members.length === 0
              ? "暂无团队成员"
              : "团队里只有你自己，去找更多队友吧"}
          </p>
        ) : (
          ranked.map((member: PluginTeamMember) => {
            const count = candies.get(member.user_id) ?? 0;
            const probability = successProbability(count, config);
            const isChampion = champions.includes(member.user_id);
            const isSelf = member.user_id === meId;
            const disabled = busy || !isJoinedTeam || remaining <= 0 || isSelf;
            const hint = !isJoinedTeam
              ? "仅团队成员可点糖"
              : isSelf
                ? "不能给自己点糖"
                : remaining <= 0
                  ? "今日次数已用完"
                  : `当前成功率 ${formatProbability(probability)}`;

            return (
              <div
                key={member.user_id}
                className={`lp-row${isChampion ? " lp-row--champion" : ""}`}
              >
                <div className="lp-member">
                  {member.avatar_url ? (
                    <img
                      className="lp-avatar"
                      src={member.avatar_url}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.style.visibility = "hidden";
                      }}
                    />
                  ) : (
                    <div className="lp-avatar lp-avatar--fallback">
                      {member.display_name?.charAt(0) || "?"}
                    </div>
                  )}
                  <div className="lp-member-text">
                    <div className="lp-member-name">
                      {isChampion && <span>{CHAMPION_EMOJI}</span>}
                      <span className="lp-name">{member.display_name}</span>
                      {isChampion && <span>{CHAMPION_EMOJI}</span>}
                      {isSelf && <span className="lp-self-tag">（我）</span>}
                    </div>
                    <div className="lp-member-sub">
                      {member.username} · {CANDY_EMOJI} {count} 颗糖
                    </div>
                  </div>
                </div>

                <div className="lp-row-actions">
                  <span className="lp-prob">
                    成功率 {formatProbability(probability)}
                  </span>
                  <button
                    type="button"
                    className="lp-btn lp-btn--primary"
                    disabled={disabled}
                    title={hint}
                    onClick={() => void candy(member)}
                  >
                    {CHAMPION_EMOJI} 点糖
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="lp-footer">
        共 {members.length} 名团队成员 · 糖数越多成功率越低，失败会清空糖数 ·
        每周一 0:00（北京时间）结算冠军并清零
      </p>
    </div>
  );
}
