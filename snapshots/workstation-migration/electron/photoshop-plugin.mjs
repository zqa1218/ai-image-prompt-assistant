import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'

const PLUGIN_ID = 'com.promptwizard.photoshop-link'

/**
 * 把随桌面端发布的薄插件同步到用户级 UXP 目录。
 *
 * 注意：Photoshop 不会自动扫描这个目录（实测 `%APPDATA%\Adobe\UXP\PluginsInfo\v1\PS.json`
 * 为空时一个插件都不会加载），它只作暂存副本用：
 * - 根目录的「安装 Photoshop 面板（管理员一次）.cmd」会从这里取源文件
 * - 也可以在 UXP Developer Tools 里直接用这个目录做临时加载
 * 真正让面板随 Photoshop 启动自动生效的是把它放进 Photoshop 的 Plug-ins 目录。
 */
export async function installPhotoshopPlugin({ app, projectRoot }) {
  const source = app.isPackaged
    ? path.join(process.resourcesPath, 'photoshop-plugin')
    : path.join(projectRoot, 'photoshop-plugin')
  const externalRoot = path.join(app.getPath('appData'), 'Adobe', 'UXP', 'Plugins', 'External')
  const target = path.join(externalRoot, PLUGIN_ID)
  await mkdir(externalRoot, { recursive: true })
  await cp(source, target, { recursive: true, force: true })
  return target
}
