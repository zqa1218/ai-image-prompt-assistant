import type { ImageRef } from "./wizardTypes.ts";

const textSession = `text-${crypto.randomUUID()}`;

/**
 * 当前运行的命名空间。
 * 对话 id 只由底图内容决定时，同一张图会永远命中同一个网页对话：
 * 附件指纹记录还在，第二次运行会跳过上传，模型其实没收到图。
 * 加一个运行标记，让每次「开始一条线 / 载入存档」都开新对话。
 */
let runTag = String(Date.now());

/** 开始一次新的运行：同一批阶段共用一个对话，不同运行之间互不串线。 */
export function beginConversationRun(): void {
  runTag = String(Date.now());
}

/** 内容而非文件名标识底图：改名不换会话，换图不会串线。 */
export async function imageConversationId(
  image: ImageRef | null | undefined,
): Promise<string> {
  if (!image) return textSession;
  const bytes = new TextEncoder().encode(image.dataUrl);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `image-${hex}-${runTag}`;
}
