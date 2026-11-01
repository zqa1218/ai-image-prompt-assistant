param([ValidateSet('list','activate','watch','click')][string]$Mode='list', [string]$Handle='0', [int]$TargetPid=0)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class PWWindowLink {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  public delegate void EventProc(IntPtr hook,uint ev,IntPtr h,int obj,int child,uint thread,uint time);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc fn,IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder text,int max);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect rect);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int cmd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [StructLayout(LayoutKind.Sequential)] public struct Pt { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Pt p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flag,uint dx,uint dy,uint data,IntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,EventProc proc,uint pid,uint thread,uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  public static IntPtr[] Windows() { var list=new List<IntPtr>(); EnumWindows((h,p)=>{if(IsWindow(h))list.Add(h);return true;},IntPtr.Zero);return list.ToArray(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h,out p);return p; }
  public static string Title(IntPtr h) { var b=new StringBuilder(512);GetWindowText(h,b,512);return b.ToString(); }
  public static bool Valid(IntPtr h,int pid) { return IsWindow(h)&&Pid(h)==pid; }
  public static void Watch(IntPtr h,int pid) {
    bool dirty=true; string last=""; int ticks=0;
    EventProc callback=(hook,ev,hw,obj,child,thread,time)=>{ if(ev==3 || hw==h) dirty=true; };
    var handle=SetWinEventHook(3,0x800B,IntPtr.Zero,callback,0,0,0);
    if(handle==IntPtr.Zero) throw new Exception("无法监听窗口事件");
    var timer=new Timer(); timer.Interval=120;
    timer.Tick+=(s,e)=>{
      ticks++; if(!dirty && ticks%8!=0)return; dirty=false;
      bool alive=Valid(h,pid); Rect r; GetWindowRect(h,out r);
      string json=String.Format("{{\"alive\":{0},\"visible\":{1},\"minimized\":{2},\"targetPid\":{3},\"foregroundPid\":{4},\"rect\":{{\"x\":{5},\"y\":{6},\"width\":{7},\"height\":{8}}}}",alive.ToString().ToLower(),IsWindowVisible(h).ToString().ToLower(),IsIconic(h).ToString().ToLower(),pid,Pid(GetForegroundWindow()),r.Left,r.Top,r.Right-r.Left,r.Bottom-r.Top);
      if(json!=last){Console.WriteLine(json);Console.Out.Flush();last=json;}
      if(!alive)Application.ExitThread();
    };
    try{timer.Start();Application.Run();}finally{timer.Stop();timer.Dispose();UnhookWinEvent(handle);GC.KeepAlive(callback);}
  }
}
'@
if ($Mode -eq 'list') {
  $rows = @()
  foreach ($hwnd in [PWWindowLink]::Windows()) {
    $windowPid = [PWWindowLink]::Pid($hwnd)
    $proc = Get-Process -Id $windowPid -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -in @('yaoai_desktop','Photoshop')) {
      $title=[PWWindowLink]::Title($hwnd)
      if ($title -and $proc.Path) { $r = New-Object 'PWWindowLink+Rect'; [void][PWWindowLink]::GetWindowRect($hwnd, [ref]$r); $rows += @{ handle=$hwnd.ToInt64().ToString(); pid=[int]$windowPid; title=$title; path=$proc.Path; w=($r.Right-$r.Left); h=($r.Bottom-$r.Top); visible=[PWWindowLink]::IsWindowVisible($hwnd); kind=$(if($proc.ProcessName -eq 'Photoshop'){'photoshop'}else{'yao'}) } }
    }
  }
  ConvertTo-Json -InputObject $rows -Compress
} else {
  $hwnd=[IntPtr]([long]::Parse($Handle))
  if (-not [PWWindowLink]::Valid($hwnd,$TargetPid)) { throw '目标窗口已关闭，请重新选择' }
  $proc=Get-Process -Id $TargetPid
  if ($proc.ProcessName -notin @('yaoai_desktop','Photoshop')) { throw '不支持的目标程序' }
  if ($Mode -eq 'click') {
    # 耀 AI 的主面板和小球互斥：主面板被它自己隐藏时，ShowWindow 叫不醒，
    # 只能按它自己的交互来——点小球中心，让它自己展开主面板。
    $r = New-Object 'PWWindowLink+Rect'
    [void][PWWindowLink]::GetWindowRect($hwnd, [ref]$r)
    $cx = [int](($r.Left + $r.Right) / 2)
    $cy = [int](($r.Top + $r.Bottom) / 2)
    $old = New-Object 'PWWindowLink+Pt'
    [void][PWWindowLink]::GetCursorPos([ref]$old)
    [void][PWWindowLink]::SetCursorPos($cx, $cy)
    Start-Sleep -Milliseconds 60
    # 耀 AI 的小球是「双击展开主面板」，单击只是选中
    for ($i = 0; $i -lt 2; $i++) {
      [PWWindowLink]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
      [PWWindowLink]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 80
    }
    Start-Sleep -Milliseconds 120
    [void][PWWindowLink]::SetCursorPos($old.X, $old.Y)
    @{clicked=$true} | ConvertTo-Json -Compress
    return
  }
  if ($Mode -eq 'watch') {
    # 原先走 [PWWindowLink]::Watch（WinEventHook + Application.Run），
    # 本机实测一个字节都不输出，跟随因此永远不动作。
    # 改成纯轮询：不依赖消息循环，行为可预期，也能单独跑起来验证。
    $last = ''
    while ($true) {
      $alive = [PWWindowLink]::Valid($hwnd, $TargetPid)
      $rect = New-Object 'PWWindowLink+Rect'
      [void][PWWindowLink]::GetWindowRect($hwnd, [ref]$rect)
      $visible = [PWWindowLink]::IsWindowVisible($hwnd).ToString().ToLower()
      $minimized = [PWWindowLink]::IsIconic($hwnd).ToString().ToLower()
      $foreground = [PWWindowLink]::Pid([PWWindowLink]::GetForegroundWindow())
      $width = $rect.Right - $rect.Left
      $height = $rect.Bottom - $rect.Top
      $json = '{"alive":' + $alive.ToString().ToLower() + ',"visible":' + $visible +
        ',"minimized":' + $minimized + ',"targetPid":' + $TargetPid +
        ',"foregroundPid":' + $foreground + ',"rect":{"x":' + $rect.Left +
        ',"y":' + $rect.Top + ',"width":' + $width + ',"height":' + $height + '}}'
      if ($json -ne $last) { [Console]::Out.WriteLine($json); [Console]::Out.Flush(); $last = $json }
      if (-not $alive) { break }
      Start-Sleep -Milliseconds 200
    }
  }
  else {
    # 主功能区可能整个处于隐藏状态：先 ShowWindow 再切前台，否则切到了也看不见
    if (-not [PWWindowLink]::IsWindowVisible($hwnd) -or [PWWindowLink]::IsIconic($hwnd)) { [void][PWWindowLink]::ShowWindowAsync($hwnd,9); Start-Sleep -Milliseconds 120 }
    @{activated=[PWWindowLink]::SetForegroundWindow($hwnd)} | ConvertTo-Json -Compress
  }
}
