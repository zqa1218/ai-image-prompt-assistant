import { useEffect, useState } from 'react'
import AssetsPage from './pages/AssetsPage.tsx'
import SettingsPage from './pages/SettingsPage.tsx'
import WizardPage from './pages/WizardPage.tsx'
import { applyProviderMode, useProviderMode } from './lib/providerMode.ts'
import TransportSwitch from './components/TransportSwitch.tsx'
import ConfirmDialog from './components/ConfirmDialog.tsx'
import { IterationPanel, PromptLibrary } from './features/prompt-tools/index.ts'

type Tab = 'wizard' | 'assets' | 'settings' | 'library'

export default function App() {
  const [tab, setTab] = useState<Tab>('wizard')
  const demo = useProviderMode((s) => s.demo)

  useEffect(() => {
    applyProviderMode(demo)
  }, [demo])

  return (
    <div className="min-h-full bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-3xl items-center gap-6 px-6 py-4">
          <h1 className="text-base font-semibold tracking-tight">提示词向导</h1>
          <nav className="flex gap-1 text-sm">
            <TabButton active={tab === 'library'} onClick={() => setTab('library')}>档案库</TabButton>
            <TabButton active={tab === 'wizard'} onClick={() => setTab('wizard')}>
              向导
            </TabButton>
            <TabButton active={tab === 'assets'} onClick={() => setTab('assets')}>
              资产
            </TabButton>
            <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
              设置
            </TabButton>
          </nav>
        </div>
        <TransportSwitch openSettings={() => setTab('settings')} />
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <PromptLibrary.Banner />
        {tab === 'library' && <PromptLibrary.LibraryPage />}
        {tab === 'settings' && <IterationPanel.Settings />}
        {tab === 'settings' && <SettingsPage />}
        {tab === 'assets' && <AssetsPage />}
        {tab === 'wizard' && <WizardPage />}
      </main>

      <ConfirmDialog />
    </div>
  )
}

function TabButton(props: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={
        'rounded-md px-3 py-1.5 transition-colors ' +
        (props.active
          ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
          : 'text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800')
      }
    >
      {props.children}
    </button>
  )
}
