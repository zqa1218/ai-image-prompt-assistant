import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_ASSETS, mergeAssets, type AssetMap } from '../workflows/assets.ts'

type AssetState = {
  overrides: AssetMap
  setOverride: (id: string, text: string) => void
  resetAsset: (id: string) => void
  resetAll: () => void
}

export const useAssetStore = create<AssetState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (id, text) =>
        set((state) => ({ overrides: { ...state.overrides, [id]: text } })),
      resetAsset: (id) =>
        set((state) => {
          const next = { ...state.overrides }
          delete next[id]
          return { overrides: next }
        }),
      resetAll: () => set({ overrides: {} }),
    }),
    { name: 'prompt-wizard.assets.v1' },
  ),
)

export function isOverridden(overrides: AssetMap, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, id)
}

export function isDirty(overrides: AssetMap, id: string, draft: string): boolean {
  const current = overrides[id] ?? DEFAULT_ASSETS[id] ?? ''
  return draft !== current
}

export function effectiveAssets(overrides: AssetMap): AssetMap {
  return mergeAssets(overrides)
}
