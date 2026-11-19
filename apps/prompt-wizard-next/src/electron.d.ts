export {}

declare global {
  interface Window {
    pwShell?: {
      setMode(mode: 'wide' | 'narrow'): Promise<unknown>
      setAlwaysOnTop(value: boolean): Promise<boolean>
      getState(): Promise<unknown>
      openWorkbench(): Promise<{ url: string }>
    }
  }
}
