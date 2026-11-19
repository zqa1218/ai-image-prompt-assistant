// 0.4.1 server/config.mjs 的工作台版改动（由 scripts/prepare-installed-workbench.mjs 应用）：
// 1. 默认来源改为 API（只影响还没保存过来源的新配置；已有选择不变）。
// 2. 保存的 Key 解不开时（例如由别的程序或旧系统账户加密），原版每次读设置都抛错：来源下拉框全部锁住，
//    分析请求和保存设置一起失败。现在当作未配置（keyUnreadable），用户在设置里重新填 Key 即可覆盖。
// 3. 每个服务地址的 Key 分开保存（encryptedKeys，按 origin）。顶栏在 DeepSeek / MiniMax 之间切换时自动换上
//    该服务之前保存的 Key，不再“跳到设置重填 → 又被要求同时填 Key → 切不过去”的死循环。旧 Key 仍然不会发给别家服务。
// 锚点必须在原文件里恰好出现一次，否则构建直接失败。
const apply = (file, source, edits) => {
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error(`补丁定位不唯一：${file}: ${before.slice(0, 80)}`);
    source = source.split(before).join(after);
  }
  return source;
};

const configEdits = [
  [
    "  mode: 'gemini-web',\n",
    "  mode: 'api',\n"
  ],
  [
    "  let apiKey = process.env.DEEPSEEK_API_KEY || ''\n  if (stored.encryptedKey) {\n    const storage = globalThis.promptWizardSafeStorage\n    if (!storage?.isEncryptionAvailable()) throw new Error('无法解密本机 API Key，请使用桌面端重新保存设置')\n    apiKey = storage.decryptString(Buffer.from(stored.encryptedKey, 'base64'))\n  }\n  const settings = { ...defaults, ...stored, apiKey }",
    "  let apiKey = process.env.DEEPSEEK_API_KEY || ''\n  let keyUnreadable = false\n  if (stored.encryptedKey) {\n    const storage = globalThis.promptWizardSafeStorage\n    try {\n      if (!storage?.isEncryptionAvailable()) throw new Error('无法解密本机 API Key')\n      apiKey = storage.decryptString(Buffer.from(stored.encryptedKey, 'base64'))\n    } catch {\n      keyUnreadable = true\n    }\n  } else if (apiKey && stored.baseUrl) {\n    // 环境变量里的 Key 只属于环境变量指定的服务地址；换到别家服务时不带过去。\n    try { if (new URL(stored.baseUrl).origin !== new URL(defaults.baseUrl).origin) apiKey = '' } catch { apiKey = '' }\n  }\n  const settings = { ...defaults, ...stored, apiKey, keyUnreadable }"
  ],
  [
    "    hasKey: Boolean(settings.apiKey), keySource: settings.encryptedKey ? 'local' : settings.apiKey ? 'env' : 'none' }",
    "    hasKey: Boolean(settings.apiKey), keyUnreadable: Boolean(settings.keyUnreadable),\n    keySource: settings.keyUnreadable ? 'unreadable' : settings.encryptedKey ? 'local' : settings.apiKey ? 'env' : 'none',\n    keyOrigins: savedKeyOrigins(settings) }\n\n/** 已保存过 Key 的服务地址（只是地址，不含 Key），前端据此决定切换服务商时要不要让用户去填 Key。 */\nfunction savedKeyOrigins(settings) {\n  const origins = new Set(Object.keys(settings.encryptedKeys ?? {}))\n  try { if (settings.encryptedKey && !settings.keyUnreadable) origins.add(new URL(settings.baseUrl).origin) } catch { /* 地址无效时忽略 */ }\n  return [...origins]\n}"
  ],
  [
    "  const next = readSettings()\n",
    "  const next = readSettings()\n  let originChanged = false\n"
  ],
  [
    "    if (new URL(next.baseUrl).origin !== url.origin && next.apiKey && !patch.apiKey?.trim()) throw new Error('更换 API 服务地址时必须同时填写新服务的 Key，避免把旧 Key 发给其他服务')\n",
    "    const fromOrigin = new URL(next.baseUrl).origin\n    if (fromOrigin !== url.origin) {\n      // 环境变量里的 Key 不能带去别家服务，仍要求同时填新 Key。\n      if (next.apiKey && !next.encryptedKey && !patch.apiKey?.trim()) throw new Error('更换 API 服务地址时必须同时填写新服务的 Key，避免把旧 Key 发给其他服务')\n      // 工作台版：每个服务地址的 Key 分开保存。旧 Key 收起来，换上新地址之前保存过的 Key；没有就留空，等用户在设置里填。\n      next.encryptedKeys = { ...(next.encryptedKeys ?? {}) }\n      if (next.encryptedKey && !next.keyUnreadable) next.encryptedKeys[fromOrigin] = next.encryptedKey\n      if (next.encryptedKeys[url.origin]) next.encryptedKey = next.encryptedKeys[url.origin]\n      else delete next.encryptedKey\n      originChanged = true\n    }\n"
  ],
  [
    "      next.encryptedKey = storage.encryptString(key).toString('base64')\n    } else delete next.encryptedKey\n",
    "      next.encryptedKey = storage.encryptString(key).toString('base64')\n      next.encryptedKeys = { ...(next.encryptedKeys ?? {}), [new URL(next.baseUrl).origin]: next.encryptedKey }\n    } else if (!originChanged) {\n      // 明确清空 Key：当前服务地址保存的 Key 一起删掉。换地址时传来的空 Key 只表示“不沿用旧 Key”。\n      delete next.encryptedKey\n      if (next.encryptedKeys) delete next.encryptedKeys[new URL(next.baseUrl).origin]\n    }\n"
  ],
  [
    "  delete next.apiKey\n",
    "  delete next.apiKey\n  delete next.keyUnreadable\n"
  ]
];

const configTestEdits = [
  [
    "    expect(() => updateSettings({ baseUrl: 'https://evil.example' })).toThrow(/Key/)\n",
    "    // 工作台版：换服务地址不再报错，但旧 Key 不会带去新地址；切回原地址时换回原 Key。\n    expect(updateSettings({ baseUrl: 'https://evil.example' })).toMatchObject({ hasKey: false, keyOrigins: ['https://api.deepseek.com'] })\n    expect(readSettings().apiKey).toBe('')\n    expect(updateSettings({ baseUrl: 'https://api.deepseek.com' }).hasKey).toBe(true)\n"
  ]
];

export const patchConfigSource = source => apply('server/config.mjs', source, configEdits);

/** 原版 config.test.mjs 断言“换地址必须报错”；按新行为改成“换地址不带旧 Key、切回来换回原 Key”。 */
export const patchConfigTestSource = source => apply('server/config.test.mjs', source, configTestEdits);
