import { BrowserWindow, nativeImage, session } from 'electron';
import { setTimeout as sleep } from 'node:timers/promises';
import { downloadShots, matchNewJob } from '../../packages/adapters/mj-relay.mjs';

const home = 'https://www.midjourney.com/imagine';
const partition = 'persist:mj-workbench';

// Runs in an isolated renderer world and checks the current document again after every navigation.
function inspectPage(input) {
  if (location.origin !== 'https://www.midjourney.com' || !/^\/imagine\/?$/.test(location.pathname)) return null;
  const editor = [...document.querySelectorAll('textarea')].find(node => node.offsetWidth && /imagine/i.test(node.placeholder));
  if (!editor) return null;
  if (input !== null) {
    if (editor.value.trim() && editor.value.trim() !== input) throw Error('官网输入框已有其他内容，请先保存或清空');
    editor.focus();
    editor.select();
    document.execCommand('insertText', false, input);
    if (editor.value.trim() !== input) throw Error('提示词未完整写入官网输入框');
  }
  const links = [...document.querySelectorAll('a[href*="/jobs/"]')];
  const jobs = new Map();
  for (const link of links) {
    const url = new URL(link.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/jobs/')) continue;
    let box = link;
    while (box.parentElement && box.parentElement.tagName !== 'BODY') {
      const neighbors = box.parentElement.querySelectorAll('a[href*="/jobs/"]');
      if (box.parentElement.querySelector('textarea')) break;
      if ([...neighbors].some(item => new URL(item.href).pathname !== url.pathname)) break;
      box = box.parentElement;
    }
    const key = url.origin + url.pathname;
    const text = (box.innerText || '').slice(0, 48000);
    if (text.length > (jobs.get(key)?.text.length ?? -1)) jobs.set(key, { url: key, text });
  }
  return { value: editor.value, jobs: [...jobs.values()] };
}

export function makeMjBrowser() {
  const profile = session.fromPartition(partition);
  // Electron includes the localized product name in the UA. HTTP header values must be ASCII.
  profile.setUserAgent(profile.getUserAgent().replace(/[^\x20-\x7e]+/g, 'PromptWizard'));
  let window;
  const getWindow = async () => {
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ width: 1200, height: 860, title: 'Midjourney', webPreferences: {
        partition, sandbox: true, contextIsolation: true, nodeIntegration: false,
      } });
      window.removeMenu();
      window.webContents.setWindowOpenHandler(({ url }) => {
        const allowed = /^https:\/\/(?:accounts\.google\.com|discord\.com|(?:www\.)?midjourney\.com)\//i.test(url);
        return { action: allowed ? 'allow' : 'deny', overrideBrowserWindowOptions: { webPreferences: { partition, sandbox: true, nodeIntegration: false, contextIsolation: true } } };
      });
      try { await window.loadURL(home); }
      catch (error) { window.destroy(); throw error; }
    }
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
    return window;
  };
  return {
    open: async () => { await getWindow(); },
    close: () => { if (window && !window.isDestroyed()) window.destroy(); },
    // autoSubmit=false (the default) only fills the Create box; the user reviews and presses Enter on the site.
    async submit(prompt, snapshot, markAttempt, { autoSubmit = false } = {}) {
      const win = await getWindow();
      const inspect = arg => win.webContents.executeJavaScriptInIsolatedWorld(581, [{ code: '(' + inspectPage.toString() + ')(' + JSON.stringify(arg) + ')' }]);
      const before = await inspect(null);
      if (!before) throw Error('请在独立 MJ 窗口完成登录或页面验证，进入 Create 后再点生成');
      const known = new Set(before.jobs.map(job => job.url));
      await sleep(1000);
      const settled = await inspect(null);
      if (!settled) throw Error('官网 Create 页已变化，请重新准备任务');
      for (const job of settled.jobs) known.add(job.url);
      const needsReview = !autoSubmit || snapshot.operation === 'edit' || snapshot.references.some(ref => !ref.analysisOnly);
      await inspect(prompt);
      if (needsReview) {
        markAttempt(); // User uploads the reviewed references and sends the prepared prompt on the site.
      } else {
        const contents = win.webContents;
        // Check focus, value and origin right before the key press. Nothing has been sent if this fails.
        const ready = '(() => {const e=document.activeElement;return location.origin==="https://www.midjourney.com"&&location.pathname.replace(/\\/$/,"")==="/imagine"&&e?.tagName==="TEXTAREA"&&e.value.trim()===' + JSON.stringify(prompt) + '})()';
        if (!await contents.executeJavaScriptInIsolatedWorld(581, [{ code: ready }])) throw Error('官网输入状态变化，未发送。请核对后重试');
        markAttempt();
        // sendInputEvent produces a trusted key press. Script-dispatched KeyboardEvents are isTrusted=false and may be ignored by the site.
        win.focus(); contents.focus();
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      }
      const deadline = Date.now() + (needsReview ? 30 * 60000 : 90000);
      while (Date.now() < deadline && !win.isDestroyed()) {
        await sleep(1500);
        if (win.isDestroyed()) break;
        const state = await inspect(null);
        const job = state && matchNewJob(known, state.jobs, prompt);
        if (job) return job;
      }
      throw Error('未确认唯一对应的官网任务。请核对官网并手动记录 jobs 链接，避免重复生成');
    },
    download(url) {
      return downloadShots(url, (address, options) => profile.fetch(address, options), (bytes, width, height) => {
        const image = nativeImage.createFromBuffer(bytes);
        if (image.isEmpty() || image.getSize().width !== width * 2 || image.getSize().height !== height * 2) throw Error('四宫格解码失败');
        return [0, 1, 2, 3].map(i => image.crop({ x: (i % 2) * width, y: Math.floor(i / 2) * height, width, height }).toPNG());
      });
    },
  };
}
