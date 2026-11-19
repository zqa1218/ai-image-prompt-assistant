import { useEffect, useState } from 'react'
import AssetsPage from './pages/AssetsPage.tsx'
import SettingsPage from './pages/SettingsPage.tsx'
import WizardPage from './pages/WizardPage.tsx'
import PosePage from './pages/PosePage.tsx'
import { applyProviderMode, useProviderMode } from './lib/providerMode.ts'
import TransportSwitch from './components/TransportSwitch.tsx'
import ConfirmDialog from './components/ConfirmDialog.tsx'

type Tab = 'wizard' | 'pose' | 'assets' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('wizard')
  const demo = useProviderMode((s) => s.demo)

  useEffect(() => {
    applyProviderMode(demo)
  }, [demo])

  return (
    <div className="min-h-full bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <h1 className="text-sm font-semibold tracking-tight text-neutral-100">提示词助手</h1>
          <nav className="flex flex-wrap gap-0.5 text-sm" aria-label="页面">
            <TabButton active={tab === 'wizard'} onClick={() => setTab('wizard')}>
              向导
            </TabButton>
            <TabButton active={tab === 'pose'} onClick={() => setTab('pose')}>
              姿态库
            </TabButton>
            <TabButton active={tab === 'assets'} onClick={() => setTab('assets')}>
              资产
            </TabButton>
            <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
              设置
            </TabButton>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <TransportSwitch openSettings={() => setTab('settings')} />
            {window.pwShell && (
              <button
                type="button"
                onClick={() => void window.pwShell?.openWorkbench()}
                className="min-h-9 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 hover:border-neutral-500"
              >
                工作台
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {tab === 'settings' && <SettingsPage />}
        {tab === 'assets' && <AssetsPage />}
        {tab === 'pose' && <PosePage openWizard={() => setTab('wizard')} />}
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
      aria-current={props.active ? 'page' : undefined}
      className={
        'min-h-9 rounded-md px-3 transition-colors ' +
        (props.active
          ? 'bg-neutral-800 font-medium text-neutral-50'
          : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200')
      }
    >
      {props.children}
    </button>
  )
}
