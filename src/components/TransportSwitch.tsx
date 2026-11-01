import { useEffect, useState } from "react";
import { useTransport } from "../lib/transportStore.ts";
import { useWizard } from "../lib/wizardStore.ts";
import { useProviderMode } from "../lib/providerMode.ts";
import { imageConversationId } from "../lib/imageConversation.ts";
import { resetWebConversation, type WebChannel } from "../lib/api.ts";
import { confirmAction } from "../lib/confirmDialog.ts";
import { focusIntakeRequirement } from "../lib/intakeFocus.ts";
import { API_PRESETS, matchPreset } from "../lib/apiPresets.ts";

const MODES = ["gemini-web", "chatgpt-web", "api"] as const;
const MODE_LABELS: Record<(typeof MODES)[number], string> = {
  "gemini-web": "Gemini 网页",
  "chatgpt-web": "ChatGPT 网页",
  api: "API",
};
const CHANNEL_NAMES: Record<WebChannel, string> = {
  "gemini-web": "Gemini",
  "chatgpt-web": "ChatGPT",
};

export default function TransportSwitch({
  openSettings,
}: {
  openSettings: () => void;
}) {
  const { settings, saving, error, refresh, save } = useTransport();
  const busy = useWizard((state) => state.busy);
  const original = useWizard((state) => state.original);
  const demo = useProviderMode((state) => state.demo);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 两个网页渠道共用一套界面，只有方案列表和重置接口按渠道区分。
  const channel: WebChannel | null =
    settings?.mode === "gemini-web" || settings?.mode === "chatgpt-web"
      ? settings.mode
      : null;
  const planList =
    channel === "chatgpt-web" ? settings?.chatgptPlans : settings?.plans;
  const planId =
    channel === "chatgpt-web" ? settings?.chatgptPlan : settings?.geminiPlan;
  const planNote = planList?.find((plan) => plan.id === planId)?.note ?? "";
  const locked = busy || saving || resetting;

  // 当前配置对上哪个预设：对不上说明是自定义地址
  const currentPreset =
    settings && settings.mode === 'api'
      ? matchPreset(settings.baseUrl ?? '', settings.model ?? '')
      : null;

  async function switchPreset(presetId: string) {
    if (presetId === 'custom') { openSettings(); return }
    const preset = API_PRESETS.find(item => item.id === presetId);
    if (!preset) return;
    setNotice('');
    if ((settings?.baseUrl ?? '') === preset.baseUrl) {
      // 同一服务商只是换模型，Key 不用动
      await save({ mode: 'api', baseUrl: preset.baseUrl, model: preset.model });
      return;
    }
    // 换服务商：Key 不能复用（各家不通用），切过去后请用户重填
    const ok = await confirmAction({
      title: `切换到 ${preset.label}？`,
      message: `地址会改成 ${preset.baseUrl}，模型改成 ${preset.model}。不同服务商的 Key 不通用，切换后需要在设置里重新填一次 Key。`,
      confirmLabel: '切换',
    });
    if (!ok) return;
    await save({ mode: 'api', baseUrl: preset.baseUrl, model: preset.model, apiKey: '' });
    setNotice(`已切到 ${preset.label}，请到设置里填 Key。`);
    openSettings();
  }

  async function reset() {
    if (!channel) return;
    const ok = await confirmAction({
      title: `为这张底图重开 ${CHANNEL_NAMES[channel]} 对话？`,
      message:
        "旧对话不会删除。保留图片、需求与用户补充，清除模型旧分析和提示词，回到接收步骤重新分析。",
      confirmLabel: "重开对话",
    });
    if (!ok) return;
    setResetting(true);
    try {
      await resetWebConversation(channel, await imageConversationId(original));
      useWizard.getState().restartModelContext();
      setNotice("已清除模型旧结论，下一次分析会新建对话。");
      focusIntakeRequirement();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setResetting(false);
    }
  }

  return <section aria-label="模型快捷切换" className="transport-bar">
    <div className="transport-primary">
      <select aria-label="生成通道" value={settings?.mode ?? 'gemini-web'} disabled={!settings || locked}
        onChange={e => { setNotice(''); void save({ mode: e.target.value as typeof MODES[number] }); }}>
        {MODES.map(mode => <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>)}
      </select>
      {channel ? <select aria-label="网页方案" value={planId ?? ''} disabled={!settings || locked}
        onChange={e => { void save(channel === 'chatgpt-web' ? {chatgptPlan:e.target.value} : {geminiPlan:e.target.value}); }}>
        {planList?.map(plan => <option key={plan.id} value={plan.id}>{plan.label}</option>)}
      </select> : (
        <select
          aria-label="API 预设"
          value={currentPreset?.id ?? 'custom'}
          disabled={!settings || locked}
          onChange={e => void switchPreset(e.target.value)}
        >
          {API_PRESETS.map(preset => (
            <option key={preset.id} value={preset.id}>{preset.label}{preset.model ? ` · ${preset.model}` : ''}</option>
          ))}
          {!currentPreset && <option value="custom">{settings?.model || '自定义配置'}</option>}
        </select>
      )}
      {/* 思考等级放进工具条：每次分析都要看，不该藏在二级弹层里 */}
      {channel === 'gemini-web' && (
        <select aria-label="Gemini 思考等级" disabled={locked} value={settings?.geminiThinking ?? ''}
          onChange={e => void save({ geminiThinking: e.target.value })}>
          <option value="">思考：跟随账号</option><option value="低点">思考：低点</option><option value="中等">思考：中等</option><option value="高点">思考：高点</option>
        </select>
      )}
      <details className="transport-more">
        <summary aria-label="通道更多选项">更多</summary>
        <div className="surface-row p-3 space-y-3">
          {channel && <button type="button" disabled={locked || !original} onClick={() => void reset()}>对话跑偏，重开</button>}
          <p className="text-xs text-fg-muted">{planNote || '发送期间不能切换配置。'}</p>
        </div>
      </details>
    </div>
    {demo && <p className="text-xs text-warn">演示模式 · 不调用模型</p>}
    {(error || notice || saving) && <p role="status" className="text-xs text-warn">{error || notice || '正在保存…'}</p>}
  </section>;
}
