import { useEffect, useRef, useState } from 'react';
import PresetPanel from "./components/PresetPanel.tsx";
import AssetsPage from './pages/AssetsPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import WizardPage from './pages/WizardPage.tsx';
import ArchivePanel from './components/ArchivePanel.tsx';
import { useLayout } from './lib/layoutStore.ts';
import { clearSession, saveSession } from './lib/sessionSnapshot.ts';
import { useWizard } from './lib/wizardStore.ts';
import { applyProviderMode, useProviderMode } from './lib/providerMode.ts';
import TransportSwitch from './components/TransportSwitch.tsx';
import ConfirmDialog from './components/ConfirmDialog.tsx';
import CompanionSettings from './components/CompanionSettings.tsx';

type Tab = 'wizard' | 'archives' | 'assets' | 'settings';
export default function App() {
  const [tab, setTab] = useState<Tab>('wizard');
  const [visited, setVisited] = useState<Set<Tab>>(new Set(['wizard']));
  const scroll = useRef<Partial<Record<Tab, number>>>({});
  const demo = useProviderMode(s => s.demo);
  const layout = useLayout();
  const narrow = layout.mode === 'narrow';
  function navigate(next: Tab) {
    scroll.current[tab] = window.scrollY;
    setVisited(previous => new Set([...previous, next]));
    setTab(next);
  }
  useEffect(() => { window.scrollTo(0, scroll.current[tab] ?? 0); }, [tab]);
  useEffect(() => { applyProviderMode(demo); }, [demo]);
  useEffect(() => {
    useWizard.getState().hydrateSession();
    void useLayout.getState().syncHost();
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      const s = useWizard.getState();
      if (s.workflowId) saveSession({ taskId: s.taskId, workflowId: s.workflowId, stageIndex: s.stageIndex, intake: s.intake });
      else clearSession();
    };
    const unsubscribe = useWizard.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(flush, 500);
    });
    window.addEventListener('pagehide', flush);
    return () => { clearTimeout(timer); unsubscribe(); window.removeEventListener('pagehide', flush); };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.shell = layout.mode;
    document.documentElement.classList.add('dark');
  }, [layout.mode]);
  return <div className="app-shell">
    <header className="shell-header glass-panel">
      <div className="shell-nav">
        <h1 className="shell-title">提示词向导</h1>
        <nav aria-label="主导航" className="primary-nav">
          {(['wizard', 'archives', 'assets', 'settings'] as Tab[]).map(key =>
            <button key={key} type="button" aria-current={tab === key ? 'page' : undefined}
              onClick={() => navigate(key)}>{({wizard:'向导', archives:narrow ? '存档' : '存档和预设', assets:'资产', settings:'设置'})[key]}</button>)}
        </nav>
        <details className="window-menu">
          <summary>窗口</summary>
          <div className="window-popover">
            <CompanionSettings />
          </div>
        </details>
        <button type="button" className="shell-toggle" disabled={layout.syncing} onClick={layout.toggleMode}>{narrow ? '展开' : '收窄'}</button>
      </div>
      {tab === 'wizard' && <TransportSwitch openSettings={() => navigate('settings')} />}
      {layout.error && <p role="alert" className="px-4 pb-2 text-xs text-warn">{layout.error}</p>}
    </header>
    <main className="shell-main">
      {/* 已访问页保留挂载，避免切页丢草稿；隐藏设置页停止状态轮询。 */}
      <div hidden={tab !== 'wizard'}><WizardPage onArchives={() => navigate('archives')} /></div>
      {visited.has('archives') && <div hidden={tab !== 'archives'}>
        <h2 className="mb-4 text-lg font-semibold">存档和预设</h2>
        <ArchivePanel onLoaded={() => navigate('wizard')} />
        <div className="mt-6"><PresetPanel /></div>
      </div>}
      {visited.has('assets') && <div hidden={tab !== 'assets'}><AssetsPage /></div>}
      {visited.has('settings') && <div hidden={tab !== 'settings'}><SettingsPage active={tab === 'settings'} /></div>}
    </main>
    <ConfirmDialog />
  </div>;
}
