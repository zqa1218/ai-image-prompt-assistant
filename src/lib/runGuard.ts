/**
 * 迟到回复保护。
 *
 * 场景：用户在「方向建议」阶段点了重跑，第一次请求比第二次晚回来，
 * 旧结果覆盖新结果——界面上看到的是上一轮的答案，而且没有任何提示。
 *
 * 做法：每次发起请求领一个序号，回来时只认「该阶段最新的序号」。
 * 不依赖时间戳比较，避免同毫秒并发时判错。
 */
export type RunGuard = {
  /** 为某个阶段发起一次请求，返回这一轮的序号 */
  begin: (key: string) => number;
  /** 这一轮的回复是否仍是最新的（晚回来的旧请求返回 false） */
  isCurrent: (key: string, token: number) => boolean;
  /** 主动作废某阶段在途请求（例如切线路、载入存档） */
  cancel: (key: string) => void;
  /** 作废所有在途请求 */
  reset: () => void;
};

export function createRunGuard(): RunGuard {
  let seq = 0;
  const latest = new Map<string, number>();

  return {
    begin(key) {
      seq += 1;
      latest.set(key, seq);
      return seq;
    },
    isCurrent(key, token) {
      return latest.get(key) === token;
    },
    cancel(key) {
      latest.delete(key);
    },
    reset() {
      latest.clear();
    },
  };
}
