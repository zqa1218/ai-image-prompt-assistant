import { it, expect } from "vitest";
import {
  beginConversationRun,
  imageConversationId,
} from "./imageConversation.ts";

const image = {
  name: "a.png",
  dataUrl: "data:image/png;base64,AA==",
  width: 1,
  height: 1,
  bytes: 1,
};

it("按底图内容绑定，而非文件名；无图阶段的标识保持稳定", async () => {
  expect(await imageConversationId(image)).toBe(
    await imageConversationId({ ...image, name: "renamed.png" }),
  );
  expect(await imageConversationId(image)).not.toBe(
    await imageConversationId({
      ...image,
      dataUrl: "data:image/png;base64,BB==",
    }),
  );
  expect(await imageConversationId(null)).toBe(
    await imageConversationId(undefined),
  );
});

it("同一张底图，换一次运行就换一个对话，避免复用旧对话而跳过上传", async () => {
  const before = await imageConversationId(image);
  beginConversationRun();
  const after = await imageConversationId(image);
  expect(after).not.toBe(before);
  expect(after.startsWith("image-")).toBe(true);
  // 同一运行内保持稳定：一次运行的所有阶段共用一个对话
  expect(await imageConversationId(image)).toBe(after);
});

it("无图阶段的标识不随运行变化，保持稳定", async () => {
  const before = await imageConversationId(null);
  beginConversationRun();
  expect(await imageConversationId(null)).toBe(before);
});
