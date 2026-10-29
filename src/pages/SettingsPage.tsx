import { API_PRESETS, matchPreset } from "../lib/apiPresets.ts";
import ApiStatus from "../components/ApiStatus.tsx";
import { useCallback, useEffect, useState } from "react";
import {
  getWebStatus,
  openWebLogin,
  type WebChannel,
  type WebStatus,
} from "../lib/api.ts";
import { useProviderMode } from "../lib/providerMode.ts";
import { useTransport } from "../lib/transportStore.ts";
import { useWizard } from "../lib/wizardStore.ts";

/** 两个网页渠道的连接卡片长得一样，只有标题和文案不同。 */
function WebChannelCard({
  active,
  channel,
  title,
  description,
  footer,
}: {
  active: boolean;
  channel: WebChannel;
  title: string;
  description: string;
  footer: string;
}) {
  const [status, setStatus] = useState<WebStatus>({
    connected: false,
    detail: "正在检查…",
  });
  const [busy, setBusy] = useState(false);
  const generating = useWizard((state) => state.busy);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getWebStatus(channel));
    } catch (error) {
      setStatus({
        connected: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [channel]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh, active]);

  const login = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await openWebLogin(channel));
    } catch (error) {
      setStatus({
        connected: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [channel]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-fg-muted text-fg-muted">
          {description}
        </p>
      </div>

      <div className="rounded-lg border border-line p-4 border-line">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">
              {status.account || "已登录的账号"}
            </p>
            <p
              className={`mt-1 text-xs ${status.connected ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
            >
              {status.connected
                ? `已登录并可用${status.model ? ` · 当前 ${status.model}` : ""}`
                : status.detail || "尚未登录"}
            </p>
            {status.connected && status.engine === "embedded" && (
              <p className="mt-1 text-xs text-fg-muted">
                当前跑在助手内置窗口里；装好 Chrome 或 Edge
                后可换用真实浏览器承载。
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={busy || generating}
            onClick={() => void login()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium hover:bg-ink-700 disabled:opacity-50 text-ink-900"
          >
            {busy
              ? "正在打开…"
              : status.connected
                ? `打开 ${title.replace(" 网页连接", "")} 网页`
                : "登录账号"}
          </button>
        </div>
      </div>

      <p className="text-xs leading-5 text-fg-muted text-fg-muted">{footer}</p>
    </section>
  );
}

export default function SettingsPage({ active = true }: { active?: boolean }) {
  const demo = useProviderMode((state) => state.demo);
  const setDemo = useProviderMode((state) => state.setDemo);
  const { settings, saving, save } = useTransport();
  const generating = useWizard((state) => state.busy);
  const [baseUrl, setBaseUrl] = useState(
    settings?.baseUrl || "https://api.deepseek.com",
  );
  const [model, setModel] = useState(settings?.model || "deepseek-flash");
  const [apiKey, setApiKey] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (settings) {
      setBaseUrl(settings.baseUrl);
      setModel(settings.model);
    }
  }, [settings?.baseUrl, settings?.model]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">运行模式</h2>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 border-line">
          <input
            type="checkbox"
            checked={demo}
            onChange={(event) => setDemo(event.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            演示模式（使用假数据）
            <span className="mt-1 block text-xs text-fg-muted text-fg-muted">
              开启后不访问任何模型；关闭后使用顶部选中的渠道，提交
              Skill、需求、底图和参考图。
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">API 设置</h2>
        <ApiStatus
          hasKey={Boolean(settings?.hasKey)}
          baseUrl={baseUrl}
          model={model}
        />
        <p className="text-sm text-fg-muted text-fg-muted">
          默认 DeepSeek V4.1 Flash（deepseek-flash），支持图片。API
          与网页模式使用相同的置景合成、真人 Cosplay 后期 Skill。API
          单独计费，不使用网页会员额度。
        </p>
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await save({
              baseUrl,
              model,
              ...(apiKey.trim() ? { apiKey } : {}),
            });
            if (ok) {
              setApiKey("");
              setNotice("API 设置已保存；可在顶部一键切换。");
            }
          }}
        >
          <fieldset
            disabled={!settings || saving || generating}
            className="space-y-3 disabled:opacity-50"
          >
            <div className="space-y-1.5">
              <p className="text-xs text-fg-muted text-fg-muted">
                快速切换供应商（只填地址与模型，Key 各家不通用，必须自己填）
              </p>
              <div className="flex flex-wrap gap-2">
                {API_PRESETS.map((preset) => {
                  const active = matchPreset(baseUrl, model)?.id === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.hint}
                      aria-pressed={active}
                      onClick={() => {
                        setBaseUrl(preset.baseUrl);
                        setModel(preset.model);
                        setNotice(
                          `已填入 ${preset.label} 的地址与模型。保存前请确认 Key 是 ${preset.label} 的；更换地址时服务端要求同时填新 Key。`,
                        );
                      }}
                      className={
                        "min-h-9 rounded-lg border px-2.5 py-1 text-xs font-medium " +
                        (active
                          ? "border-accent bg-accent-soft text-fg"
                          : "border-line hover:bg-ink-750 hover:border-line-strong")
                      }
                    >
                      {preset.label}
                      {!preset.vision && (
                        <span className="ml-1 text-xs opacity-60">
                          无图
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block text-sm">
              API 地址
              <input
                type="url"
                required
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-transparent px-3 border-line-strong"
              />
            </label>
            <label className="block text-sm">
              模型 ID
              <input
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-transparent px-3 border-line-strong"
              />
            </label>
            <label className="block text-sm">
              API Key（{settings?.hasKey ? "已配置，留空保留" : "尚未配置"}）
              <input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-transparent px-3 border-line-strong"
              />
            </label>
            <p className="text-xs text-fg-muted text-fg-muted">
              Key 使用本机系统加密保存，不回显。更换服务地址时请同时更换对应
              Key；自定义模型须支持图片及当前请求格式。
            </p>
            <button
              type="submit"
              className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm text-ink-900"
            >
              {saving ? "正在保存…" : "保存 API 设置"}
            </button>
          </fieldset>
        </form>
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
      </section>

      <WebChannelCard
        active={active}
        channel="gemini-web"
        title="Gemini 网页连接"
        description="不使用 Gemini API 或 API Key。助手会打开独立的 Chrome 窗口，使用顶部所选方案，上传图片、提交需求并抓取提示词。失败时保留原因，不自动更换方案。"
        footer="登录态保存在助手自己的浏览器配置里，不动你平时用的 Chrome 资料。第一次使用请在弹出的窗口完成 Google 登录（邮箱已自动填好），密码、验证码与安全确认都在那个窗口里完成——助手既不读取也不保存密码，登录一次后长期有效。"
      />

      <WebChannelCard
        active={active}
        channel="chatgpt-web"
        title="ChatGPT 网页连接"
        description="与 Gemini 网页完全相同的用法：打开独立的 Chrome 窗口登录 ChatGPT，按顶部所选方案（默认沿用网页当前模型）提交 Skill、需求、底图和参考图，只抓回文字提示词，不生成图片。"
        footer="ChatGPT 使用独立于 Gemini 的浏览器配置与对话存档，两个账号互不影响；同样不读取、不保存密码。默认方案是「沿用网页当前模型」，如果想固定档位（Instant / Thinking / Pro），可在顶部切换。"
      />
    </div>
  );
}
