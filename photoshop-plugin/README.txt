AI修图提示词 Link
==================

这个面板插件是「可选增强」，不是必需品：
桌面端默认走 Photoshop 自带的 COM 自动化直连，不装插件也能导入底图和参考图。

要让面板像耀 Link 一样每次开机自动出现，做一次安装即可：

1. 在项目根目录双击「安装 Photoshop 面板（管理员一次）.cmd」，点一次「是」。
   它会把本目录复制到 Photoshop 自己的 Plug-ins 目录里。
2. 完全重启 Photoshop。之后每次启动 Photoshop 都会自动加载本插件，
   不需要 UXP Developer Tools，也不需要保持面板打开。
3. 启动桌面端「AI修图提示词助手」，插件会在后台自动连上；
   在桌面端点击「从 Photoshop 导入底图/参考图」即可读取画布。

只有开发调试才需要 Adobe UXP Developer Tools：用它的 Add Plugin 选择本目录的 manifest.json。

插件只读取当前文档的合成像素，不修改 PSD，也不读取图层名称。
