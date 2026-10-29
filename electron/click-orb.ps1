param([Parameter(Mandatory=$true)][string]$Handle)
# 双击指定窗口的中心。耀 AI 的悬浮小球是「双击展开主面板」，单击只是选中。
# 单独成文件：window-link.ps1 里混了三种模式，反复改容易互相影响。
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PWClick {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Pt { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Pt p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flag, uint dx, uint dy, uint data, IntPtr extra);
  public static string DoubleClickCenter(IntPtr h) {
    if (!IsWindow(h)) return "no-window";
    Rect r; if (!GetWindowRect(h, out r)) return "no-rect";
    int cx = (r.Left + r.Right) / 2, cy = (r.Top + r.Bottom) / 2;
    Pt old; GetCursorPos(out old);
    SetCursorPos(cx, cy);
    System.Threading.Thread.Sleep(60);
    for (int i = 0; i < 2; i++) {
      mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
      mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
      System.Threading.Thread.Sleep(80);
    }
    System.Threading.Thread.Sleep(120);
    SetCursorPos(old.X, old.Y);
    return "clicked@" + cx + "," + cy;
  }
}
'@
$hwnd = [IntPtr]([long]::Parse($Handle))
$result = [PWClick]::DoubleClickCenter($hwnd)
@{ clicked = ($result -like 'clicked*'); detail = $result } | ConvertTo-Json -Compress
