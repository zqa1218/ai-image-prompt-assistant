// 分析来源标签与中途换来源确认用到的纯函数（不碰 DOM，便于在 Node 里测试）。

/** 当前任务是否已经有模型给出的结论。 */
export function analyzedOnce(state) {
  return Object.values(state?.records ?? {}).some(record => record?.status === 'ready');
}

/**
 * 把顶栏几个下拉框当前选中的文字拼成一行标签。
 * API 预设的文字形如「MiniMax · MiniMax-M3.1-Flash」，标签只留服务商名；思考等级“跟随账号”时不显示。
 */
export function sourceSummary({ mode = '', plan = '', api = '', thinking = '', thinkingValue = '' } = {}) {
  const parts = [mode];
  if (plan) parts.push(plan);
  if (api) parts.push(api.split(' · ')[0]);
  if (thinkingValue) parts.push(thinking.replace('思考：', '思考'));
  return parts.filter(Boolean).join(' · ');
}
