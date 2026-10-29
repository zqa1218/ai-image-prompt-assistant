import { useState } from "react";
import { downloadText, safeFilename } from "../lib/download.ts";
import { parseSections, toMarkdown } from "../lib/promptSections.ts";
import type { Artifact } from "../lib/wizardTypes.ts";

function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
    } catch {
      setCopiedKey("__fail");
    }
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return { copiedKey, copy };
}

/** 交接给耀 AI：先复制，再请主进程把耀 AI 窗口带到前台。 */
function useHandoff(copy: (text: string, key: string) => Promise<void>) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(text: string) {
    const bridge = (
      window as unknown as {
        pwShell?: { handoff?: () => Promise<{ message?: string }> };
      }
    ).pwShell;
    if (!bridge?.handoff) {
      await copy(text, "handoff");
      setMessage("已复制。当前环境不支持自动切换窗口，请手动切到耀 AI 粘贴。");
      return;
    }
    setBusy(true);
    try {
      // 先复制成功再切窗口：切窗口失败也不该丢掉已经复制的内容
      await copy(text, "handoff");
      const result = await bridge.handoff();
      setMessage(result?.message ?? "已复制。");
    } catch (error) {
      setMessage(
        `已复制；切换窗口失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return { message, busy, run };
}

export default function PromptOutput({
  artifact,
  exportName = "提示词",
}: {
  artifact: Artifact;
  exportName?: string;
}) {
  const { copiedKey, copy } = useCopy();
  const handoff = useHandoff(copy);
  const sections = parseSections(artifact.prompt);

  function exportMarkdown() {
    const lines = [
      `# ${exportName}`,
      "",
      sections ? toMarkdown(sections) : artifact.prompt,
      "",
      "## 交付方式",
      "",
      artifact.channel,
    ];
    if (artifact.params?.length) {
      lines.push(
        "",
        "## 参数",
        "",
        ...artifact.params.map((p) => `- \`${p}\``),
      );
    }
    if (artifact.checklist?.length) {
      lines.push(
        "",
        "## 提交前检查",
        "",
        ...artifact.checklist.map((c) => `- [ ] ${c}`),
      );
    }
    downloadText(safeFilename(exportName, ".md"), lines.join("\n"));
  }

  function exportJson() {
    downloadText(
      safeFilename(exportName, ".json"),
      JSON.stringify({ ...artifact, sections: sections ?? undefined }, null, 2),
      "application/json",
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg-muted text-fg-muted">
          最终提示词
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={handoff.busy}
            onClick={() => void handoff.run(artifact.prompt)}
            className="rounded-md border border-accent/50 bg-accent-soft px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed"
          >
            {handoff.busy ? "交接中…" : "复制并切到耀 AI"}
          </button>
          <button
            type="button"
            onClick={() => void copy(artifact.prompt, "all")}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-ink-750 border-line-strong dark:hover:bg-ink-700"
          >
            {copiedKey === "all"
              ? "已复制"
              : copiedKey === "__fail"
                ? "复制失败"
                : "复制全文"}
          </button>
          <button type="button" onClick={exportMarkdown} className={ghostBtn}>
            导出 .md
          </button>
          <button type="button" onClick={exportJson} className={ghostBtn}>
            导出 .json
          </button>
        </div>
      </div>

      {sections ? (
        <div className="space-y-2">
          {sections.map((section, index) => (
            <div
              key={`${section.key}-${index}`}
              className="rounded-xl border border-line border-line"
            >
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5 border-line">
                <span className="text-xs font-semibold">{section.key}</span>
                <button
                  type="button"
                  onClick={() => void copy(section.body, section.key)}
                  className="text-xs text-fg-muted hover:text-fg"
                >
                  {copiedKey === section.key ? "已复制" : "复制这段"}
                </button>
              </div>
              <pre className="overflow-x-auto px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap">
                {section.body}
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-line p-3 border-line">
          <pre className="overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">
            {artifact.prompt}
          </pre>
        </div>
      )}

      <p className="rounded-lg bg-ink-750 px-3 py-2 text-xs text-fg-muted text-fg">
        {artifact.channel}
      </p>

      {artifact.params && artifact.params.length > 0 && (
        <Section title="参数">
          <ul className="space-y-1">
            {artifact.params.map((p) => (
              <li key={p} className="text-xs">
                <code className="font-mono">{p}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {artifact.checklist && artifact.checklist.length > 0 && (
        <Section title="提交前 QA 清单">
          <ul className="space-y-1 text-xs">
            {artifact.checklist.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="text-fg-dim">□</span>
                {c}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

const ghostBtn =
  "rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-ink-750 " +
  "border-line-strong dark:hover:bg-ink-700";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line p-3 border-line">
      <h3 className="mb-2 text-xs font-medium text-fg-muted text-fg-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}
