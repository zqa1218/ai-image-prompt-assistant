; 安装时把内置的 UXP 面板写进 Photoshop 自己的 Plug-ins 目录。
; 该目录由 Photoshop 启动时扫描，和耀 Link 一样，不需要 UXP Developer Tools。

!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
Var /GLOBAL pwPluginSource
Var /GLOBAL pwPluginCount
!endif

!macro customInstall
  Call pwInstallPhotoshopPlugin
!macroend

!macro customUnInstall
  Call un.pwRemovePhotoshopPlugin
!macroend

!ifndef BUILD_UNINSTALLER
Function pwInstallPhotoshopPlugin
  StrCpy $pwPluginCount 0
  StrCpy $pwPluginSource "$INSTDIR\resources\photoshop-plugin"
  ${IfNot} ${FileExists} "$pwPluginSource\manifest.json"
    DetailPrint "安装包内没有找到 Photoshop 面板插件，跳过面板安装。"
    Return
  ${EndIf}

  ; 1) 优先按注册表定位，能覆盖装在非默认盘的 Photoshop
  StrCpy $0 0
  pw_reg_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Adobe\Photoshop" $0
    StrCmp $1 "" pw_reg_done
    ReadRegStr $2 HKLM "SOFTWARE\Adobe\Photoshop\$1" "ApplicationPath"
    ${If} $2 != ""
      StrCpy $R0 $2
      StrCpy $3 $2 1 -1
      ${If} $3 == "\"
        StrCpy $R0 $2 -1
      ${EndIf}
      Call pwCopyPluginToPhotoshop
    ${EndIf}
    IntOp $0 $0 + 1
    Goto pw_reg_loop
  pw_reg_done:

  ; 2) 注册表没找到时，兜底扫描默认安装位置
  ${If} $pwPluginCount == 0
    StrCpy $R3 "$PROGRAMFILES64"
    FindFirst $4 $5 "$R3\Adobe\Adobe Photoshop*"
    pw_scan64_loop:
      StrCmp $5 "" pw_scan64_done
      StrCpy $R0 "$R3\Adobe\$5"
      Call pwCopyPluginToPhotoshop
      FindNext $4 $5
      Goto pw_scan64_loop
    pw_scan64_done:
    FindClose $4

    ${If} "$PROGRAMFILES" != "$PROGRAMFILES64"
      StrCpy $R3 "$PROGRAMFILES"
      FindFirst $4 $5 "$R3\Adobe\Adobe Photoshop*"
      pw_scan32_loop:
        StrCmp $5 "" pw_scan32_done
        StrCpy $R0 "$R3\Adobe\$5"
        Call pwCopyPluginToPhotoshop
        FindNext $4 $5
        Goto pw_scan32_loop
      pw_scan32_done:
      FindClose $4
    ${EndIf}
  ${EndIf}

  ${If} $pwPluginCount == 0
    DetailPrint "没有找到 Photoshop 的 Plug-ins 目录，面板未安装；助手仍可通过直连通道读取画布。"
  ${Else}
    DetailPrint "已为 $pwPluginCount 个 Photoshop 安装 AI修图提示词 Link 面板。"
  ${EndIf}
FunctionEnd

!endif

; $R0 = Photoshop 安装目录
!ifndef BUILD_UNINSTALLER
Function pwCopyPluginToPhotoshop
  ${IfNot} ${FileExists} "$R0\Plug-ins"
    Return
  ${EndIf}
  StrCpy $R1 "$R0\Plug-ins\com.promptwizard.photoshop-link"
  RMDir /r "$R1"
  nsExec::ExecToLog '"$SYSDIR\xcopy.exe" /E /I /Y /Q "$pwPluginSource" "$R1\"'
  Pop $2
  ${If} ${FileExists} "$R1\manifest.json"
    IntOp $pwPluginCount $pwPluginCount + 1
    DetailPrint "Photoshop 面板已安装：$R1"
  ${Else}
    DetailPrint "Photoshop 面板写入失败（$R0），助手仍可通过直连通道读取画布。"
  ${EndIf}
FunctionEnd

!endif

!ifdef BUILD_UNINSTALLER
Function un.pwRemovePhotoshopPlugin
  StrCpy $0 0
  pw_un_reg_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Adobe\Photoshop" $0
    StrCmp $1 "" pw_un_reg_done
    ReadRegStr $2 HKLM "SOFTWARE\Adobe\Photoshop\$1" "ApplicationPath"
    ${If} $2 != ""
      StrCpy $R0 $2
      StrCpy $3 $2 1 -1
      ${If} $3 == "\"
        StrCpy $R0 $2 -1
      ${EndIf}
      RMDir /r "$R0\Plug-ins\com.promptwizard.photoshop-link"
    ${EndIf}
    IntOp $0 $0 + 1
    Goto pw_un_reg_loop
  pw_un_reg_done:
FunctionEnd
!endif
