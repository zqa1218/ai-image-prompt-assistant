import { useEffect, useMemo, useState } from "react";
import {
  ASSET_IDS,
  ASSET_SOURCES,
  DEFAULT_ASSETS,
} from "../workflows/assets.ts";
import { WORKFLOWS } from "../workflows/index.ts";
import { useUiDraft } from "../lib/uiDraftStore.ts";
import {
  effectiveAssets,
  isOverridden,
  useAssetStore,
} from "../lib/assetStore.ts";
import { buildPrefix, hashPrefix, orderedAssetIds } from "../lib/prefix.ts";

export default function AssetsPage() {
  const overrides = useAssetStore((s) => s.overrides);
  const setOverride = useAssetStore((s) => s.setOverride);
  const resetAsset = useAssetStore((s) => s.resetAsset);
  const resetAll = useAssetStore((s) => s.resetAll);

  const [selectedId, setSelectedId] = useState(ASSET_IDS[0] ?? "");
  // 未保存的编辑同样不能随组件卸载丢掉
  const drafts = useUiDraft((state) => state.assetDrafts);
  const setAssetDraft = useUiDraft((state) => state.setAssetDraft);
  const clearAssetDraft = useUiDraft((state) => state.clearAssetDraft);

  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const assets = useMemo(() => effectiveAssets(overrides), [overrides]);
  const current = assets[selectedId] ?? "";
  const draft = drafts[selectedId] ?? current;
  const setDraft = (value: string) => setAssetDraft(selectedId, value);
  const dirty = draft !== current;
  const overridden = isOverridden(overrides, selectedId);

  useEffect(() => {
    setSaved(false);
  }, [assets, selectedId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const workflow of WORKFLOWS) {
        next[workflow.id] = await hashPrefix(buildPrefix(workflow, assets));
      }
      if (!cancelled) setHashes(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [assets]);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold">工作流资产</h2>
        <p className="mt-1 text-sm text-fg-muted text-fg-muted">
          这些资产会被拼进请求的固定前缀。前缀跨阶段逐字不变才能命中缓存，
          所以改动会让该工作流的历史缓存失效。
        </p>
      </section>


      <section className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {ASSET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setSelectedId(id)}
              className={
                "rounded-md px-3 py-1.5 text-xs transition-colors " +
                (id === selectedId
                  ? "bg-accent text-ink-900"
                  : "border border-line hover:bg-ink-750 border-line-strong dark:hover:bg-ink-700")
              }
            >
              {id}
              {isOverridden(overrides, id) && (
                <span className="ml-1 text-amber-500">●</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-baseline justify-between gap-4">
          <div className="text-xs text-fg-muted text-fg-muted">
            来源：{ASSET_SOURCES[selectedId] ?? "未知"}
            {overridden && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                已覆盖默认值
              </span>
            )}
          </div>
          <div className="text-xs text-fg-muted text-fg-muted">
            {draft.length} 字符（默认 {DEFAULT_ASSETS[selectedId]?.length ?? 0}
            ）
            {dirty && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                未保存
              </span>
            )}
            {saved && !dirty && (
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                已保存
              </span>
            )}
          </div>
        </div>

        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
          spellCheck={false}
          className="h-96 w-full resize-y rounded-lg border border-line bg-ink-800 p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent border-line-strong"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!dirty}
            onClick={() => {
              setOverride(selectedId, draft);
              setSaved(true);
            }}
            className={primaryBtn + (dirty ? "" : " opacity-40")}
          >
            保存修改
          </button>
          <button
            type="button"
            disabled={!overridden && !dirty}
            onClick={() => {
              resetAsset(selectedId);
              setDraft(DEFAULT_ASSETS[selectedId] ?? "");
              setSaved(false);
            }}
            className={
              secondaryBtn + (overridden || dirty ? "" : " opacity-40")
            }
          >
            恢复本份默认值
          </button>
          <button type="button" onClick={() => { resetAll(); Object.keys(drafts).forEach(clearAssetDraft); }} className={secondaryBtn}>
            全部恢复默认
          </button>
        </div>
      </section>
      <details className="space-y-2 disclosure"><summary>诊断与缓存信息</summary>
        <h3 className="text-xs font-medium tracking-wide text-fg-muted uppercase text-fg-muted">
          缓存前缀哈希
        </h3>
        <div className="overflow-hidden rounded-lg border border-line text-sm border-line">
          {WORKFLOWS.map((workflow) => (
            <div
              key={workflow.id}
              className="flex items-baseline gap-3 border-b border-line px-3 py-2 last:border-b-0 border-line"
            >
              <span className="w-32 shrink-0 font-medium">{workflow.name}</span>
              <code className="truncate font-mono text-xs text-fg-muted text-fg-muted">
                {hashes[workflow.id] ?? "计算中…"}
              </code>
            </div>
          ))}
        </div>
        <p className="text-xs text-fg-muted text-fg-muted">
          顺序：全局指令 → 共享资产 →
          专属资产。两条线共享前两段，所以能在共享段命中同一份缓存。
          {WORKFLOWS.map((w) => (
            <span key={w.id}>
              {" "}
              {w.id}: {orderedAssetIds(w).join(" → ")}
            </span>
          ))}
        </p>
      </details>

    </div>
  );
}

const primaryBtn =
  "rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-900 hover:brightness-110 " +
  "disabled:cursor-not-allowed bg-accent text-ink-900 dark:hover:bg-ink-800";

const secondaryBtn =
  "rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-ink-750 " +
  "disabled:cursor-not-allowed disabled:opacity-40 border-line-strong dark:hover:bg-ink-700";
