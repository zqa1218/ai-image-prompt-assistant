import { it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

it('配置持久化且密钥只以密文保存，不回显；校验地址与模型', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-settings-test-'))
  vi.stubEnv('PROMPT_WIZARD_DATA_DIR', dir)
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  vi.stubEnv('DEEPSEEK_BASE_URL', '')
  vi.stubEnv('DEEPSEEK_MODEL', '')
  vi.stubGlobal('promptWizardSafeStorage', {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  })
  try {
    const { readSettings, publicSettings, updateSettings } = await import('./config.mjs')
    expect(publicSettings().model).toBe('deepseek-flash')
    expect(publicSettings()).toMatchObject({ geminiPlan: 'flash', geminiThinking: '', chatgptPlan: 'current' })
    writeFileSync(path.join(dir, 'model-settings.json'), JSON.stringify({ chatgptPlan: 'thinking' }))
    expect(readSettings().chatgptPlan).toBe('current')
    expect(publicSettings().plans.map((plan) => plan.id)).toContain('argon-task')
    expect(publicSettings().chatgptPlans.map((plan) => plan.id)).toContain('gpt-6.1-sol')
    expect(() => updateSettings({ chatgptPlan: 'nope' })).toThrow()
    updateSettings({ chatgptPlan: 'gpt-6.1-sol' })
    expect(publicSettings().chatgptPlan).toBe('gpt-6.1-sol')
    updateSettings({ chatgptPlan: 'current' })
    expect(() => updateSettings({ mode: 'chatgpt-web' })).not.toThrow()
    expect(publicSettings().mode).toBe('chatgpt-web')
    updateSettings({ mode: 'gemini-web' })
    updateSettings({ geminiPlan: 'argon-task' })
    expect(publicSettings().geminiPlan).toBe('argon-task')
    expect(() => updateSettings({ geminiPlan: 'nope' })).toThrow()
    expect(() => updateSettings({ geminiThinking: '超高' })).toThrow()
    updateSettings({ geminiPlan: 'argon', geminiThinking: '中等' })
    expect(publicSettings()).toMatchObject({ geminiPlan: 'argon', geminiThinking: '中等' })
    updateSettings({ geminiPlan: 'flash', geminiThinking: '' })
    updateSettings({ apiKey: 'test-key-only', mode: 'api' })
    expect(readSettings().apiKey).toBe('test-key-only')
    expect(publicSettings()).toMatchObject({ mode: 'api', hasKey: true, keySource: 'local' })
    expect(JSON.stringify(publicSettings())).not.toContain('test-key-only')
    expect(readFileSync(path.join(dir, 'model-settings.json'), 'utf8')).not.toContain('test-key-only')
    expect(() => updateSettings({ baseUrl: 'http://evil.example' })).toThrow()
    expect(() => updateSettings({ baseUrl: 'https://evil.example' })).toThrow(/Key/)
    expect(() => updateSettings({ mode: 'unknown' })).toThrow()
    expect(() => updateSettings({ model: ' ' })).toThrow()
    updateSettings({ mode: 'gemini-web' })
    expect(readSettings().apiKey).toBe('test-key-only')
    updateSettings({ apiKey: '' })
    expect(publicSettings().hasKey).toBe(false)
  } finally {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    rmSync(dir, { recursive: true, force: true })
  }
})
