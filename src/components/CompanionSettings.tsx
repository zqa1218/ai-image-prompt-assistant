/**
 * 窗口菜单。
 *
 * 曾经这里有「窗口伴随（跟随耀 AI）」：自动隐藏/停靠。
 * 实测它需要常驻窗口监听进程，且会把助手自己藏起来，已整体移除，
 * 只保留「始终置顶」这一条确定可用的设置。
 */
import { useLayout } from "../lib/layoutStore.ts";

export default function CompanionSettings() {
  const layout = useLayout();
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={layout.alwaysOnTop}
          disabled={layout.syncing}
          onChange={(event) => layout.setAlwaysOnTop(event.target.checked)}
        />
        始终置顶
      </label>
      <p className="text-xs text-fg-muted">窗口位置与尺寸自动记忆</p>
    </div>
  );
}
