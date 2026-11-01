/**
 * 彻底掐死原生对话框。
 *
 * Windows 上 Electron 的原生 alert/confirm 是把属主窗口置为禁用的模态循环，
 * 关闭后偶发不恢复，表现就是「点不动、打不了字」。应用内已有 ConfirmDialog
 * 承担确认，这里再兜一层：将来任何漏网调用都不会再弹原生框破坏焦点。
 */
export function installNativeDialogGuard(): void {
  if (typeof window === "undefined") return;

  const warn = (kind: string, message: string) => {
    console.warn(
      `[prompt-wizard] 拦截了原生 ${kind}（会破坏窗口焦点），请改用 confirmAction()。内容：${message}`,
    );
  };

  window.alert = (message?: unknown) => {
    warn("alert", String(message ?? ""));
  };
  window.confirm = (message?: string) => {
    warn("confirm", String(message ?? ""));
    return false;
  };
  window.prompt = (message?: string) => {
    warn("prompt", String(message ?? ""));
    return null;
  };
}
