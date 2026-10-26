import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installNativeDialogGuard } from './lib/nativeDialogGuard.ts'

// 必须在渲染前装好：原生 alert/confirm 会破坏 Electron 窗口焦点。
installNativeDialogGuard()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found')

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
