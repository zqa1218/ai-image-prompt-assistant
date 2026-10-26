import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { LIVE_PROVIDER, MOCK_PROVIDER, setProvider } from './wizardStore.ts'

type ProviderModeState = {
  /** true = 用假数据演示流程，不调用模型 */
  demo: boolean
  setDemo: (demo: boolean) => void
}

export const useProviderMode = create<ProviderModeState>()(
  persist(
    (set) => ({
      demo: false,
      setDemo: (demo) => set({ demo }),
    }),
    { name: 'prompt-wizard.provider-mode.v1' },
  ),
)

/** 把开关落到状态机上。放在副作用里调用，避免模块加载顺序问题。 */
export function applyProviderMode(demo: boolean) {
  setProvider(demo ? MOCK_PROVIDER : LIVE_PROVIDER)
}
