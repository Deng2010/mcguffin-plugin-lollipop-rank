/**
 * 玩法参数设置面板（仅管理员可见，由 CandyPage 控制显隐）。
 *
 * 设计要点：
 *  - 百分比字段按「%」输入（60 而不是 0.6），避免管理员数错小数位；
 *  - 先本地校验再提交，越界给明确报错而不是静默夹紧 —— 参数是给人调的，
 *    悄悄改掉用户输入的值比报错更让人困惑；
 *  - 保存前过一遍 normalizeConfig，双保险；
 *  - 带一行「不同糖数下的成功率」预览，方便现场调参。
 */
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  CONFIG_BOUNDS,
  DEFAULT_CONFIG,
  formatNumber,
  formatProbability,
  isDefaultConfig,
  normalizeConfig,
  successProbability,
  type CandyConfig,
} from "./logic";
import { errorMessage } from "./utils";

interface SettingsPanelProps {
  config: CandyConfig;
  /** 保存回调（会先经过 normalizeConfig；抛错表示保存失败） */
  onSave: (next: CandyConfig) => Promise<void>;
  onClose: () => void;
}

type FieldKey =
  | "successBasePercent"
  | "successDecay"
  | "successFloorPercent"
  | "dailyLimit";

type Draft = Record<FieldKey, string>;
type Errors = Partial<Record<FieldKey, string>>;

const FIELDS: Array<{ key: FieldKey; label: string; hint: string }> = [
  {
    key: "successBasePercent",
    label: "基础成功率（%）",
    hint: "糖数为 0 时的成功率，1 ~ 100",
  },
  {
    key: "successDecay",
    label: "衰减系数（每颗糖）",
    hint: "每多 1 颗糖，成功率乘以此系数，0.01 ~ 1（越小衰减越快）",
  },
  {
    key: "successFloorPercent",
    label: "成功率下限（%）",
    hint: "糖再多也不会低于该成功率，0 ~ 100",
  },
  {
    key: "dailyLimit",
    label: "每日点糖次数",
    hint: "每人每天最多点出多少颗糖，0 ~ 1000（0 = 禁止点糖）",
  },
];

/** 配置 → 输入框草稿（百分比字段乘 100） */
function toDraft(config: CandyConfig): Draft {
  return {
    successBasePercent: formatNumber(config.successBase * 100),
    successDecay: formatNumber(config.successDecay),
    successFloorPercent: formatNumber(config.successFloor * 100),
    dailyLimit: String(config.dailyLimit),
  };
}

/**
 * 校验草稿：
 *  - 每个字段必须是有限数字且落在区间内；
 *  - 每日次数必须是整数；
 *  - 成功率下限不得高于基础成功率（否则下限直接盖掉基础值，参数失去意义）。
 */
function validate(draft: Draft): { config: CandyConfig | null; errors: Errors } {
  const errors: Errors = {};

  const parse = (
    key: FieldKey,
    min: number,
    max: number,
    label: string,
  ): number | null => {
    const raw = draft[key].trim();
    const value = Number(raw);
    if (raw === "" || !Number.isFinite(value)) {
      errors[key] = "请填数字";
      return null;
    }
    if (value < min || value > max) {
      errors[key] = `${label}需在 ${min} ~ ${max} 之间`;
      return null;
    }
    return value;
  };

  const basePercent = parse(
    "successBasePercent",
    CONFIG_BOUNDS.successBase.min * 100,
    CONFIG_BOUNDS.successBase.max * 100,
    "基础成功率",
  );
  const decay = parse(
    "successDecay",
    CONFIG_BOUNDS.successDecay.min,
    CONFIG_BOUNDS.successDecay.max,
    "衰减系数",
  );
  const floorPercent = parse(
    "successFloorPercent",
    CONFIG_BOUNDS.successFloor.min * 100,
    CONFIG_BOUNDS.successFloor.max * 100,
    "成功率下限",
  );
  const dailyLimit = parse(
    "dailyLimit",
    CONFIG_BOUNDS.dailyLimit.min,
    CONFIG_BOUNDS.dailyLimit.max,
    "每日次数",
  );

  if (dailyLimit !== null && !Number.isInteger(dailyLimit)) {
    errors.dailyLimit = "每日次数需为整数";
  }
  if (basePercent !== null && floorPercent !== null && floorPercent > basePercent) {
    errors.successFloorPercent = "下限不能高于基础成功率";
  }

  if (
    basePercent === null ||
    decay === null ||
    floorPercent === null ||
    dailyLimit === null ||
    Object.keys(errors).length > 0
  ) {
    return { config: null, errors };
  }

  return {
    config: normalizeConfig({
      successBase: basePercent / 100,
      successDecay: decay,
      successFloor: floorPercent / 100,
      dailyLimit,
    }),
    errors,
  };
}

export default function SettingsPanel({
  config,
  onSave,
  onClose,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(config));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 外部参数变化（保存成功回写 / 重新加载）时同步草稿
  useEffect(() => {
    setDraft(toDraft(config));
    setErrors({});
  }, [config]);

  const preview = useMemo(() => {
    const { config: candidate } = validate(draft);
    if (!candidate) return null;
    return [0, 1, 3, 5, 8]
      .map(
        (candies) =>
          `${candies} 颗 → ${formatProbability(
            successProbability(candies, candidate),
          )}`,
      )
      .join(" · ");
  }, [draft]);

  const setField =
    (key: FieldKey) => (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setDraft((previous) => ({ ...previous, [key]: value }));
    };

  const submit = async () => {
    const { config: next, errors: validationErrors } = validate(draft);
    setErrors(validationErrors);
    setSaveError(null);
    if (!next) return;

    setSaving(true);
    try {
      await onSave(next);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    setDraft(toDraft(DEFAULT_CONFIG));
    setErrors({});
    setSaveError(null);
  };

  return (
    <section className="lp-panel" aria-label="玩法参数设置">
      <h2 className="lp-panel-title">玩法参数</h2>
      <p className="lp-panel-hint">
        保存后对所有成员立即生效，数据存在插件私有 KV（升级插件不会丢）。
        当前{isDefaultConfig(config) ? "为默认值" : "已自定义"}。
      </p>

      <div className="lp-fields">
        {FIELDS.map((field) => (
          <div className="lp-field" key={field.key}>
            <label htmlFor={`lp-setting-${field.key}`}>{field.label}</label>
            <input
              id={`lp-setting-${field.key}`}
              value={draft[field.key]}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              onChange={setField(field.key)}
            />
            {errors[field.key] ? (
              <span className="lp-field-error">{errors[field.key]}</span>
            ) : (
              <span className="lp-field-hint">{field.hint}</span>
            )}
          </div>
        ))}
      </div>

      {preview && <p className="lp-preview">成功率预览：{preview}</p>}
      {saveError && <p className="lp-save-error">保存失败：{saveError}</p>}

      <div className="lp-panel-actions">
        <button
          type="button"
          className="lp-btn lp-btn--primary"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? "保存中…" : "保存参数"}
        </button>
        <button
          type="button"
          className="lp-btn"
          disabled={saving}
          onClick={resetToDefault}
        >
          恢复默认
        </button>
        <button
          type="button"
          className="lp-btn lp-spacer"
          disabled={saving}
          onClick={onClose}
        >
          收起
        </button>
      </div>
    </section>
  );
}
