// 0.4.1 前端（压缩包 index-workbench.js）里切换 API 服务商的逻辑补丁，由 prepare 脚本应用。
// 原版：顶栏切到另一家服务商时，先弹确认，再带着空 Key 保存（已有 Key 时服务端拒绝），然后不管成败都跳到设置；
// 在设置里只填 Key 不换地址，回到顶栏再切又是同一套 → 死循环，而且永远切不过去。
// 现在：服务端按地址分别保存 Key（见 config-patch.mjs）。顶栏切换时，目标服务商已经存过 Key 就直接切、自动换上；
// 没存过才确认并在保存成功后打开设置。设置页的提示文字同步改掉。
const apply = (file, source, edits) => {
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error(`补丁定位不唯一：${file}: ${before.slice(0, 80)}`);
    source = source.split(before).join(after);
  }
  return source;
};

const edits = [
  [
    "async function b(n){if(n===`custom`){e();return}let r=Z.find(e=>e.id===n);if(r){if(f(``),(t?.baseUrl??``)===r.baseUrl){await a({mode:`api`,baseUrl:r.baseUrl,model:r.model});return}await Yd({title:`切换到 ${r.label}？`,message:`地址会改成 ${r.baseUrl}，模型改成 ${r.model}。不同服务商的 Key 不通用，切换后需要在设置里重新填一次 Key。`,confirmLabel:`切换`})&&(await a({mode:`api`,baseUrl:r.baseUrl,model:r.model,apiKey:``}),f(`已切到 ${r.label}，请到设置里填 Key。`),e())}}",
    "async function b(n){if(n===`custom`){e();return}let r=Z.find(e=>e.id===n);if(r){f(``);if((t?.baseUrl??``)===r.baseUrl){await a({mode:`api`,baseUrl:r.baseUrl,model:r.model});return}let w=(t?.keyOrigins??[]).includes(new URL(r.baseUrl).origin);if(!w&&!await Yd({title:`切换到 ${r.label}？`,message:`还没有保存 ${r.label} 的 Key。切换后会打开设置，填一次就会记住；以后在各家服务商之间切换会自动换上对应的 Key。`,confirmLabel:`切换并去填 Key`}))return;if(!await a({mode:`api`,baseUrl:r.baseUrl,model:r.model}))return;Ff.getState().settings?.hasKey?f(`已切到 ${r.label}，已换上之前保存的 Key。`):(f(`已切到 ${r.label}，请在设置里填 ${r.label} 的 Key。`),e())}}"
  ],
  [
    "已填入 ${e.label} 的地址与模型。保存前请确认 Key 是 ${e.label} 的；更换地址时服务端要求同时填新 Key。",
    "已填入 ${e.label} 的地址与模型。之前保存过 ${e.label} 的 Key 会自动换上；还没有的话在下面填一次再保存。"
  ],
  [
    "快速切换供应商（只填地址与模型，Key 各家不通用，必须自己填）",
    "快速切换供应商（每家的 Key 分开记住，切回来不用重填）"
  ],
  [
    "Key 使用本机系统加密保存，不回显。更换服务地址时请同时更换对应 Key；自定义模型须支持图片及当前请求格式。",
    "Key 使用本机系统加密保存，不回显。每个服务地址的 Key 分开保存，换地址会自动换上对应的 Key；自定义模型须支持图片及当前请求格式。"
  ]
];

export const patchBundleApiSwitch = source => apply('dist/assets/index-workbench.js', source, edits);
