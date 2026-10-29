import { useEffect, useState } from "react";
import { usePresets, type Preset } from "../lib/presetStore.ts";
import { useWizard } from "../lib/wizardStore.ts";

/**
 * 预设库：存 / 搜 / 套用。
 *
 * 与存档的区别写在界面上，避免用户分不清：
 * 存档 = 整套输入（含图），预设 = 一段可复用的产出文本。
 */
export default function PresetPanel() {
  const presets = usePresets((state) => state.presets);
  const lastApplied = usePresets((state) => state.lastApplied);
  const load = usePresets((state) => state.load);
  const save = usePresets((state) => state.save);
  const remove = usePresets((state) => state.remove);
  const search = usePresets((state) => state.search);
  const markApplied = usePresets((state) => state.markApplied);
  const clearApplied = usePresets((state) => state.clearApplied);

  const artifact = useWizard((state) => state.artifact);
  const workflowId = useWizard((state) => state.workflowId);
  const taskId = useWizard((state) => state.taskId);
  const applyPresetPrompt = useWizard((state) => state.applyPresetPrompt);
  const restorePrompt = useWizard((state) => state.restorePrompt);

  const [keyword, setKeyword] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  const visible = search(keyword);
  const canSave = Boolean(artifact?.prompt.trim());

  const doSave = () => {
    if (!artifact) return;
    const finalName = name.trim() || artifact.prompt.trim().slice(0, 16);
    const preset = save({
      name: finalName,
      workflowId: workflowId ?? "",
      step: "prompt",
      text: artifact.prompt,
      sourceTaskId: taskId,
    });
    if (preset) setName("");
  };

  const doApply = (preset: Preset) => {
    const previous = applyPresetPrompt(preset.text);
    if (previous === null) return;
    markApplied(preset.id, previous);
  };

  return (
    <section className="surface-row space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">提示词预设</h2>
          <p className="text-xs text-fg-muted">
            一段可复用的产出文本，套到别的任务上。与存档不同，预设不带图片。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="预设名称"
            className="w-40 px-2.5 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={!canSave}
            onClick={doSave}
            className="focus-ring rounded-[10px] border border-line-strong bg-ink-700 px-2.5 py-1 text-xs disabled:cursor-not-allowed"
          >
            存为预设
          </button>
        </div>
      </header>

      {!canSave && (
        <p className="text-xs text-fg-dim">
          先生成一次提示词，就能把当前结果存成预设。
        </p>
      )}

      {lastApplied && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs">
          <span>已套用预设。</span>
          <button
            type="button"
            className="focus-ring rounded-md border border-line-strong px-2 py-1"
            onClick={() => {
              restorePrompt(lastApplied.previousPrompt);
              clearApplied();
            }}
          >
            撤回
          </button>
          <button
            type="button"
            className="focus-ring rounded-md px-2 py-1 text-fg-muted"
            onClick={clearApplied}
          >
            知道了
          </button>
        </div>
      )}

      <input
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="搜索名称 / 内容 / 线路"
        className="w-full px-3 py-2 text-xs"
      />

      {visible.length === 0 ? (
        <p className="text-xs text-fg-dim">
          {presets.length === 0 ? "还没有预设。生成提示词后点「存为预设」。" : "没有匹配的预设。"}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((preset) => (
            <li key={preset.id} className="rounded-lg border border-line bg-ink-850 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{preset.name}</p>
                  <p className="text-xs text-fg-dim">
                    {preset.workflowId || "未标线路"} · {new Date(preset.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="focus-ring rounded-md border border-line px-2 py-1 text-xs hover:border-line-strong"
                    onClick={() => setOpen(open === preset.id ? null : preset.id)}
                  >
                    {open === preset.id ? "收起" : "预览"}
                  </button>
                  <button
                    type="button"
                    disabled={!artifact}
                    className="focus-ring rounded-md border border-accent/50 bg-accent-soft px-2 py-1 text-xs disabled:cursor-not-allowed"
                    onClick={() => doApply(preset)}
                  >
                    套用
                  </button>
                  <button
                    type="button"
                    className="focus-ring rounded-md px-2 py-1 text-xs text-fg-dim hover:text-fg"
                    onClick={() => remove(preset.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
              {open === preset.id && (
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-900 p-2 text-xs leading-relaxed text-fg-muted">
                  {preset.text}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
