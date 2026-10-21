function parseResearchPayload(t){let s=String(t||``),a=s.indexOf(`{`),b=s.lastIndexOf(`}`);if(a<0||b<=a)return null;try{let j=JSON.parse(s.slice(a,b+1));if(!j||typeof j!==`object`)return null;let fill=j.fill&&typeof j.fill===`object`?j.fill:{},confirm=Array.isArray(j.confirm)?j.confirm.map(function(c){let opts=Array.isArray(c&&c.options)?c.options.map(String).filter(Boolean):[];return{q:String((c&&c.q)||``).trim(),options:opts,recommended:Number.isInteger(c&&c.recommended)?c.recommended:0}}).filter(function(c){return c.q&&c.options.length>=2}).slice(0,3):[],insp=Array.isArray(j.inspiration)?j.inspiration.map(function(i){return{title:String((i&&i.title)||``).trim(),why:String((i&&i.why)||``).trim(),how:String((i&&i.how)||``).trim(),params:Array.isArray(i&&i.params)?i.params.map(String).filter(Boolean):[]}}).filter(function(i){return i.title&&i.how}).slice(0,3):[],kw=Array.isArray(j.searchKeywords)?j.searchKeywords.map(String).filter(Boolean).slice(0,6):[],ch=j.character&&typeof j.character===`object`?{name:String(j.character.name||``).trim(),work:String(j.character.work||``).trim(),canon:Array.isArray(j.character.canon)?j.character.canon.map(String).filter(Boolean).slice(0,4):[]}:null;return{character:ch,inspiration:insp,fill:fill,confirm:confirm,searchKeywords:kw}}catch(e){return null}}
function parseConfirmPoints(t){let s=String(t||``),i=s.indexOf(`需要用户确认的点`),out=[];if(i<0)return out;let tail=s.slice(i+8),nl=tail.indexOf(`\n`);if(nl>=0)tail=tail.slice(nl+1);for(let raw of tail.split(/\n+/)){let v=raw.trim();if(!v)continue;if(/^[#【]/.test(v))continue;v=v.replace(/^(?:\d+[.、)]\s*|[（(]\d+[)）]\s*|[-·•*]\s*)/,``).replace(/\s+/g,` `).trim();if(v.length>=10)out.push(v);if(out.length>=4)break}return out}
function ResearchPanel({research:e,busy:t,onLoad:n,onApply:r,onAnswer:i,intake:k}){
let st=(0,_.useState)({}),pick=st[0],setPick=st[1];
let c=e&&e.character||null;
let comp=String((k&&k.compositeMode)||``).trim();
let scope=String((k&&k.renderScope)||``).trim();
let missing=[];
if(!comp)missing.push(`合成模式`);
if(!scope)missing.push(`生成内容`);
let ready=missing.length===0;
let ins=e&&Array.isArray(e.inspiration)?e.inspiration:[];
let cf=e&&Array.isArray(e.confirm)?e.confirm:[];
let kw=e&&Array.isArray(e.searchKeywords)?e.searchKeywords:[];
let pairs=cf.map(function(q,ix){return Number.isInteger(pick[ix])?q.q+` → `+q.options[pick[ix]]:null}).filter(Boolean);
let summary=pairs.length?`资料确认：`+pairs.join(`；`):``;
let onPick=function(ix,oi){let nx=Object.assign({},pick);nx[ix]=oi;setPick(nx)};
let onUse=function(item){if(summary)i(summary);r({fill:e.fill});};
return (0,B.jsxs)(`div`,{className:`space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800`,children:[
  (0,B.jsxs)(`div`,{className:`flex items-center justify-between gap-2`,children:[
    (0,B.jsx)(`span`,{className:`text-xs font-medium`,children:`资料收集（角色名 / 出处作品）`}),
    (0,B.jsx)(`button`,{type:`button`,disabled:t||!ready,onClick:function(){n()},className:`rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800`,children:e?`重新收集`:`让 AI 收集资料并给方案`})
  ]}),
  ready?(0,B.jsx)(`p`,{className:`text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400`,children:`合成模式：`+comp+`　｜　生成内容：`+scope}):(0,B.jsx)(`p`,{className:`text-[11px] leading-relaxed text-amber-700 dark:text-amber-300`,children:`先在下面「需求」里选好：`+missing.join(`、`)+`，再点上面的按钮（会连同原图一起提交）`}),
  e?(0,B.jsxs)(`div`,{className:`space-y-2`,children:[
    c?(0,B.jsx)(`p`,{className:`text-xs text-neutral-600 dark:text-neutral-300`,children:`角色：`+(c.name||`未知`)+`　出处：`+(c.work||`未知`)}):null,
    ins.map(function(item,ix){
      return (0,B.jsxs)(`div`,{className:`rounded-lg border border-neutral-200 p-2 dark:border-neutral-800`,children:[
        (0,B.jsxs)(`div`,{className:`flex items-baseline justify-between gap-2`,children:[
          (0,B.jsx)(`span`,{className:`text-xs font-medium`,children:item.title}),
          (0,B.jsx)(`button`,{type:`button`,onClick:function(){onUse(item)},className:`shrink-0 text-[11px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100`,children:`用这个方案`})
        ]}),
        (0,B.jsx)(`p`,{className:`mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300`,children:item.how}),
        item.why?(0,B.jsx)(`p`,{className:`mt-1 text-[11px] text-neutral-500 dark:text-neutral-400`,children:item.why}):null,
        item.params.length?(0,B.jsx)(`p`,{className:`mt-1 text-[11px] text-neutral-500 dark:text-neutral-400`,children:item.params.join(` `)}):null
      ]},`ins-`+ix)
    }),
    cf.length?(0,B.jsxs)(`div`,{className:`space-y-2 rounded-lg bg-neutral-50 p-2 dark:bg-neutral-900`,children:[
      (0,B.jsx)(`p`,{className:`text-[11px] font-medium text-neutral-500 dark:text-neutral-400`,children:`载入前先确认`}),
      cf.map(function(q,ix){
        return (0,B.jsxs)(`div`,{className:`space-y-1`,children:[
          (0,B.jsx)(`p`,{className:`text-xs`,children:q.q}),
          (0,B.jsx)(`div`,{className:`flex flex-wrap gap-1.5`,children:q.options.map(function(op,oi){
            return (0,B.jsxs)(`button`,{type:`button`,onClick:function(){onPick(ix,oi)},className:`rounded-md border px-2 py-1 text-[11px] `+(pick[ix]===oi?`border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900`:`border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800`),children:[op,oi===q.recommended?(0,B.jsx)(`span`,{className:`ml-1 opacity-60`,children:`推荐`}):null]},`c-`+ix+`-`+oi)
          })})
        ]},`cf-`+ix)
      })
    ]}):null,
    kw.length?(0,B.jsx)(`p`,{className:`text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400`,children:`找参考图可搜：`+kw.join(` / `)}):null,
    (0,B.jsxs)(`div`,{className:`flex flex-wrap items-center gap-2`,children:[
      (0,B.jsx)(`button`,{type:`button`,onClick:function(){if(summary)i(summary);r({fill:e.fill})},className:`rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300`,children:`载入并跳到方向建议`}),
      (0,B.jsx)(`span`,{className:`text-[11px] text-neutral-400`,children:`会把下方字段一并填好；已选的确认项写进补充要求`})
    ]})
  ]}):(0,B.jsx)(`p`,{className:`text-xs text-neutral-500 dark:text-neutral-400`,children:`填好角色名与出处后再点上面的按钮。`})
]})}
function ConfirmPanel({questions:e,busy:t,onLoad:n,onAnswer:r,onNext:i}){
let items=Array.isArray(e)?e:[];
let st=(0,_.useState)({}),pick=st[0],setPick=st[1];
let ex=(0,_.useState)(``),extra=ex[0],setExtra=ex[1];
let pairs=items.map(function(q,ix){return Number.isInteger(pick[ix])?q.q+` → `+q.options[pick[ix]].label:null}).filter(Boolean);
let summary=pairs.length?`反向拆解确认：`+pairs.join(`；`):``;
let onPick=function(ix,oi){let nx=Object.assign({},pick);nx[ix]=oi;setPick(nx)};
let onAll=function(){let all={};items.forEach(function(q,ix){all[ix]=q.recommended});setPick(all)};
if(!items.length)return (0,B.jsxs)(`div`,{className:`flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800`,children:[
  (0,B.jsx)(`span`,{className:`text-xs text-neutral-600 dark:text-neutral-300`,children:`把这次分析里「需要你确认的点」转成可以点选的选项`}),
  (0,B.jsx)(`button`,{type:`button`,disabled:t,onClick:function(){n()},className:`rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800`,children:`抓取确认项（带选项）`})
]});
return (0,B.jsxs)(`div`,{className:`space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40`,children:[
  (0,B.jsxs)(`div`,{className:`flex items-center justify-between gap-2`,children:[
    (0,B.jsx)(`span`,{className:`text-xs font-medium text-amber-900 dark:text-amber-200`,children:`需要你确认的点（选完写进补充要求，再进方向建议）`}),
    (0,B.jsx)(`button`,{type:`button`,disabled:t,onClick:function(){n()},className:`shrink-0 text-[11px] text-amber-700 hover:text-amber-900 disabled:opacity-40 dark:text-amber-300`,children:`重新抓取`})
  ]}),
  items.map(function(q,ix){
    return (0,B.jsxs)(`div`,{className:`space-y-1`,children:[
      (0,B.jsxs)(`p`,{className:`text-xs leading-relaxed text-amber-900 dark:text-amber-200`,children:[q.q,q.why?(0,B.jsx)(`span`,{className:`ml-1 opacity-70`,children:`· `+q.why}):null]}),
      (0,B.jsx)(`div`,{className:`flex flex-wrap gap-1.5`,children:q.options.map(function(op,oi){
        return (0,B.jsxs)(`button`,{type:`button`,title:op.note||``,onClick:function(){onPick(ix,oi)},className:`rounded-md border px-2 py-1 text-[11px] leading-snug `+(pick[ix]===oi?`border-amber-600 bg-amber-600 text-white`:`border-amber-300 bg-white hover:bg-amber-100 dark:border-amber-900 dark:bg-neutral-900 dark:hover:bg-neutral-800`),children:[op.label,oi===q.recommended?(0,B.jsx)(`span`,{className:`ml-1 opacity-60`,children:`推荐`}):null]},`a-`+ix+`-`+oi)
      })})
    ]},`aq-`+ix)
  }),
  (0,B.jsx)(`input`,{value:extra,onChange:function(ev){setExtra(ev.target.value)},placeholder:`补充一句你的确认（可留空）`,className:`w-full rounded-md border border-amber-300 bg-white px-2 py-1 text-xs outline-none dark:border-amber-900 dark:bg-neutral-900`}),
  (0,B.jsxs)(`div`,{className:`flex flex-wrap items-center gap-2`,children:[
    (0,B.jsx)(`button`,{type:`button`,onClick:onAll,className:`rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-amber-100 dark:border-amber-900 dark:bg-neutral-900 dark:hover:bg-neutral-800`,children:`全部用推荐项`}),
    (0,B.jsx)(`button`,{type:`button`,disabled:t||!(pairs.length||extra.trim()),onClick:function(){r(extra.trim()?summary+`；`+extra.trim():summary);i()},className:`rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40`,children:`确认并进入方向建议`}),
    (0,B.jsx)(`span`,{className:`text-[11px] text-amber-700 dark:text-amber-300`,children:`不选也可以直接点下方「下一步」`})
  ]})
]})}
