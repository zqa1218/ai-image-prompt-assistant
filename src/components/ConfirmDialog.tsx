import { useEffect, useRef } from "react";
import { useConfirmDialog } from "../lib/confirmDialog.ts";

/**
 * 应用内确认框。挂在 App 根节点，任何位置都能用 confirmAction() 调起来。
 * Esc = 取消，按钮可键盘操作，不会阻塞渲染进程。
 */
export default function ConfirmDialog() {
  const request = useConfirmDialog((state) => state.request);
  const resolve = useConfirmDialog((state) => state.resolve);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    confirmRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      resolve(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [request, resolve]);

  if (!request) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={() => resolve(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title}
        className="w-full max-w-sm rounded-xl border border-line bg-ink-800 p-5 shadow-xl border-line-strong"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">{request.title}</h2>
        {request.message && (
          <p className="mt-2 text-xs leading-relaxed text-fg-muted text-fg-muted">
            {request.message}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => resolve(false)}
            className={cancelBtn}
          >
            {request.cancelLabel ?? "取消"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => resolve(true)}
            className={request.tone === "danger" ? dangerBtn : confirmBtn}
          >
            {request.confirmLabel ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

const cancelBtn =
  "rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-ink-750 " +
  "border-line-strong dark:hover:bg-ink-700";

const confirmBtn =
  "rounded-lg bg-accent px-3 py-2 text-sm font-medium text-ink-900 hover:brightness-110 " +
  "bg-accent text-ink-900 dark:hover:bg-ink-800";

const dangerBtn =
  "rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700";
