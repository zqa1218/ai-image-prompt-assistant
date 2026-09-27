/**
 * 资产加载：默认值来自 assets/ 目录下的 Markdown，构建时以原始文本内联。
 * 用户改动存在 localStorage（见 lib/assetStore.ts），恢复默认即删掉覆盖项。
 */
const modules = import.meta.glob('./assets/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export type AssetMap = Record<string, string>

function idFromPath(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/\.md$/, '')
}

export const DEFAULT_ASSETS: AssetMap = Object.fromEntries(
  Object.entries(modules).map(([path, text]) => [idFromPath(path), text]),
)

export const ASSET_IDS: string[] = Object.keys(DEFAULT_ASSETS).sort()

/** 每份资产的出处，用于在资产页标注来源 skill。 */
export const ASSET_SOURCES: Record<string, string> = {
  'analysis-framework': '自有资产（提炼自两条工作流的共享阶段 1）',
  'refine-four-section': 'gpt-image-2',
  'figure-base-rules': 'figure-base-environment-props',
  'recompose-decompose': 'nuyoah-xiezhen-prompt + prompt-extractor',
  'mj-params': 'midjourney-image',
}

export function mergeAssets(overrides: AssetMap): AssetMap {
  const merged: AssetMap = { ...DEFAULT_ASSETS }
  for (const [id, text] of Object.entries(overrides)) {
    if (id in merged) merged[id] = text
  }
  return merged
}
