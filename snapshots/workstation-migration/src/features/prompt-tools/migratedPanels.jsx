import * as _ from 'react'
import * as B from 'react/jsx-runtime'
import Ud from '../../components/FreeInput.tsx'
function parseResearchPayload(t){let s=String(t||``),a=s.indexOf(`{`),b=s.lastIndexOf(`}`);if(a<0||b<=a)return null;try{let j=JSON.parse(s.slice(a,b+1));if(!j||typeof j!==`object`)return null;let fill=j.fill&&typeof j.fill===`object`?j.fill:{},confirm=Array.isArray(j.confirm)?j.confirm.map(function(c){let opts=Array.isArray(c&&c.options)?c.options.map(String).filter(Boolean):[];return{q:String((c&&c.q)||``).trim(),options:opts,recommended:Number.isInteger(c&&c.recommended)?c.recommended:0}}).filter(function(c){return c.q&&c.options.length>=2}).slice(0,3):[],insp=Array.isArray(j.inspiration)?j.inspiration.map(function(i){return{title:String((i&&i.title)||``).trim(),why:String((i&&i.why)||``).trim(),how:String((i&&i.how)||``).trim(),params:Array.isArray(i&&i.params)?i.params.map(String).filter(Boolean):[]}}).filter(function(i){return i.title&&i.how}).slice(0,3):[],kw=Array.isArray(j.searchKeywords)?j.searchKeywords.map(String).filter(Boolean).slice(0,6):[],ch=j.character&&typeof j.character===`object`?{name:String(j.character.name||``).trim(),work:String(j.character.work||``).trim(),canon:Array.isArray(j.character.canon)?j.character.canon.map(String).filter(Boolean).slice(0,4):[]}:null;return{character:ch,inspiration:insp,fill:fill,confirm:confirm,searchKeywords:kw}}catch(e){return null}}
function parseConfirmPoints(t){let s=String(t||``),i=s.indexOf(`需要用户确认的点`),out=[];if(i<0)return out;let tail=s.slice(i+8),nl=tail.indexOf(`\n`);if(nl>=0)tail=tail.slice(nl+1);for(let raw of tail.split(/\n+/)){let v=raw.trim();if(!v)continue;if(/^[#【]/.test(v))continue;v=v.replace(/^(?:\d+[.、)]\s*|[（(]\d+[)）]\s*|[-·•*]\s*)/,``).replace(/\s+/g,` `).trim();if(v.length>=10)out.push(v);if(out.length>=4)break}return out}
function parsePersonaPayload(t){let s=String(t||``),a=s.indexOf(`{`),b=s.lastIndexOf(`}`);if(a<0||b<=a)return null;try{let j=JSON.parse(s.slice(a,b+1));if(!j||typeof j!==`object`)return null;let ap=j.appearance&&typeof j.appearance===`object`?j.appearance:{},tr=j.turnaround&&typeof j.turnaround===`object`?j.turnaround:{},ch=j.character&&typeof j.character===`object`?j.character:{};return{character:{name:String(ch.name||``).trim(),work:String(ch.work||``).trim(),confidence:String(ch.confidence||``).trim(),missing:Array.isArray(ch.missing)?ch.missing.map(String).filter(Boolean):[]},appearance:{hair:ap.hair&&typeof ap.hair===`object`?{color:String(ap.hair.color||``),style:String(ap.hair.style||``),details:Array.isArray(ap.hair.details)?ap.hair.details.map(String).filter(Boolean):[]}:null,eyes:ap.eyes&&typeof ap.eyes===`object`?{color:String(ap.eyes.color||``),shape:String(ap.eyes.shape||``)}:null,costume:Array.isArray(ap.costume)?ap.costume.map(function(c){return{layer:String((c&&c.layer)||``),material:String((c&&c.material)||``),color:String((c&&c.color)||``),pattern:String((c&&c.pattern)||``),notes:String((c&&c.notes)||``)}}).filter(function(c){return c.layer||c.color}):[],weapon:ap.weapon&&typeof ap.weapon===`object`?{type:String(ap.weapon.type||``),length:String(ap.weapon.length||``),details:String(ap.weapon.details||``)}:null,palette:Array.isArray(ap.palette)?ap.palette.map(String).filter(Boolean):[],signature:Array.isArray(ap.signature)?ap.signature.map(String).filter(Boolean):[]},turnaround:{mj:String(tr.mj||``).trim(),mjParams:Array.isArray(tr.mjParams)?tr.mjParams.map(String).filter(Boolean):[],edit:String(tr.edit||``).trim()},notes:Array.isArray(j.notes)?j.notes.map(String).filter(Boolean):[]}}catch(e){return null}}
function ResearchPanel({research:e,busy:t,onLoad:n,onApply:r,onAnswer:i,intake:k,persona:pp,onPersona:op}){
let st=(0,_.useState)({}),pick=st[0],setPick=st[1];
let copied=(0,_.useState)(``),copiedKey=copied[0],setCopied=copied[1];
let copy=function(text,key){try{navigator.clipboard.writeText(text)}catch(err){}setCopied(key);setTimeout(function(){setCopied(``)},1800)};
let ap=pp&&pp.appearance?pp.appearance:null;
let tr=pp&&pp.turnaround?pp.turnaround:null;
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
  (0,B.jsxs)(`div`,{className:`space-y-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800`,children:[
    (0,B.jsxs)(`div`,{className:`flex items-center justify-between gap-2`,children:[
      (0,B.jsx)(`span`,{className:`text-xs font-medium`,children:`人设卡（先贴官方图，再解析）`}),
      (0,B.jsx)(`button`,{type:`button`,disabled:t,onClick:function(){op()},className:`rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800`,children:pp?`重新解析`:`解析人设卡 + 三视图`})
    ]}),
    pp?(0,B.jsxs)(`div`,{className:`space-y-1`,children:[
      (0,B.jsx)(`p`,{className:`text-[11px] text-neutral-500 dark:text-neutral-400`,children:`角色：`+((pp.character&&pp.character.name)||`未知`)+`　出处：`+((pp.character&&pp.character.work)||`未知`)+`　置信度：`+((pp.character&&pp.character.confidence)||`-`)}),
      ap&&ap.hair?(0,B.jsx)(`p`,{className:`text-xs`,children:`发型：`+[ap.hair.color,ap.hair.style].filter(Boolean).join(` / `)+(ap.hair.details.length?`（`+ap.hair.details.join(`、`)+`）`:``)}):null,
      ap&&ap.eyes?(0,B.jsx)(`p`,{className:`text-xs`,children:`瞳色/眼型：`+[ap.eyes.color,ap.eyes.shape].filter(Boolean).join(` / `)}):null,
      ap&&ap.costume.length?(0,B.jsx)(`ul`,{className:`space-y-0.5`,children:ap.costume.map(function(x,ix){return(0,B.jsxs)(`li`,{className:`text-xs`,children:[`· `,[x.layer,x.color,x.material,x.pattern,x.notes].filter(Boolean).join(`｜`)]},`ct-`+ix)})}):null,
      ap&&ap.weapon&&(ap.weapon.type||ap.weapon.details)?(0,B.jsx)(`p`,{className:`text-xs`,children:`武器：`+[ap.weapon.type,ap.weapon.length,ap.weapon.details].filter(Boolean).join(`｜`)}):null,
      ap&&ap.palette.length?(0,B.jsx)(`p`,{className:`text-xs`,children:`配色：`+ap.palette.join(`  `)}):null,
      ap&&ap.signature.length?(0,B.jsx)(`p`,{className:`text-xs`,children:`标志特征：`+ap.signature.join(`、`)}):null,
      pp.character&&pp.character.missing&&pp.character.missing.length?(0,B.jsx)(`p`,{className:`text-[11px] text-amber-700 dark:text-amber-300`,children:`缺资料：`+pp.character.missing.join(`、`)}):null,
      tr&&tr.mj?(0,B.jsxs)(`div`,{className:`space-y-1 rounded-md bg-neutral-50 p-2 dark:bg-neutral-900`,children:[
        (0,B.jsxs)(`div`,{className:`flex items-center justify-between`,children:[
          (0,B.jsx)(`span`,{className:`text-[11px] font-medium text-neutral-500`,children:`三视图 · Midjourney`}),
          (0,B.jsx)(`button`,{type:`button`,onClick:function(){copy([tr.mj].concat(tr.mjParams).join(` `),`mj`)},className:`text-[11px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100`,children:copiedKey===`mj`?`已复制`:`复制整行`})
        ]}),
        (0,B.jsx)(`p`,{className:`text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-300`,children:[tr.mj].concat(tr.mjParams).join(` `)})
      ]}):null,
      tr&&tr.edit?(0,B.jsxs)(`div`,{className:`space-y-1 rounded-md bg-neutral-50 p-2 dark:bg-neutral-900`,children:[
        (0,B.jsxs)(`div`,{className:`flex items-center justify-between`,children:[
          (0,B.jsx)(`span`,{className:`text-[11px] font-medium text-neutral-500`,children:`三视图 · 图像编辑指令`}),
          (0,B.jsx)(`button`,{type:`button`,onClick:function(){copy(tr.edit,`edit`)},className:`text-[11px] text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100`,children:copiedKey===`edit`?`已复制`:`复制`})
        ]}),
        (0,B.jsx)(`p`,{className:`text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-300`,children:tr.edit})
      ]}):null,
      pp.notes&&pp.notes.length?(0,B.jsx)(`ul`,{className:`space-y-0.5`,children:pp.notes.map(function(x,ix){return(0,B.jsx)(`li`,{className:`text-[11px] text-neutral-500 dark:text-neutral-400`,children:`※ `+x},`nt-`+ix)})}):null
    ]}):null
  ]}),
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
function parseChecklistItems(t){let s=String(t||``),a=s.indexOf(`{`),b=s.lastIndexOf(`}`);if(a<0||b<=a)return[];let out=[];try{let j=JSON.parse(s.slice(a,b+1)),arr=Array.isArray(j&&j.items)?j.items:[];for(let it of arr){let q=String((it&&it.q)||``).trim();if(!q)continue;let opts=(Array.isArray(it&&it.options)?it.options:[]).map(function(o){return typeof o===`string`?{label:o.trim(),note:``}:{label:String((o&&o.label)||``).trim(),note:String((o&&o.note)||``).trim()}}).filter(function(o){return o.label});if(opts.length<2)continue;let rec=Number.isInteger(it&&it.recommended)?it.recommended:0;out.push({q:q,why:String((it&&it.why)||``).trim(),options:opts,recommended:rec>=0&&rec<opts.length?rec:0})}}catch(e){return[]}return out.slice(0,6)}
function Wd({selected:e,notes:t,messages:n,busy:r,onAsk:i,questions:a,onLoad:o,onAnswer:s,placement:c}){let st=(0,_.useState)({}),picked=st[0],setPicked=st[1];return(0,B.jsxs)(`div`,{className:`space-y-4`,children:[e?(0,B.jsxs)(`div`,{className:`rounded-xl border border-neutral-200 p-4 text-xs leading-relaxed dark:border-neutral-800`,children:[(0,B.jsx)(`p`,{className:`text-sm font-medium`,children:e.title}),(0,B.jsx)(`p`,{className:`mt-2 text-neutral-600 dark:text-neutral-300`,children:e.change}),(0,B.jsxs)(`p`,{className:`mt-1 text-amber-700 dark:text-amber-400`,children:[`风险：`,e.risk]})]}):(0,B.jsx)(`p`,{className:`rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300`,children:`尚未选择方向，将按推荐项继续。`}),c?(0,B.jsx)(qdPanel,{items:Array.isArray(a)?a:[],picked:picked,setPicked:setPicked,busy:r,onLoad:o,onAnswer:s}):null,n.length>0&&(0,B.jsx)(`ul`,{className:`space-y-2`,children:n.map(function(m){return(0,B.jsx)(`li`,{className:`rounded-lg px-3 py-2 text-xs leading-relaxed `+(m.role===`user`?`bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900`:`bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300`),children:m.text},m.id)})}),(0,B.jsxs)(`div`,{className:`space-y-2`,children:[(0,B.jsx)(`p`,{className:`text-xs text-neutral-500 dark:text-neutral-400`,children:`补充要求，或问一个关于写法的具体问题。这些内容会进入生成阶段。`}),(0,B.jsx)(Ud,{rows:2,disabled:r,placeholder:`例：必须保留桌面木纹，不要动杯子的形状`,submitLabel:`补充`,onSubmit:i})]}),t.length>0&&(0,B.jsxs)(`p`,{className:`text-xs text-neutral-500 dark:text-neutral-400`,children:[`已记录 `,t.length,` 条补充要求。`]})]})}
function qdPanel({items:e,picked:t,setPicked:n,busy:r,onLoad:i,onAnswer:a}){let chosen=e.map(function(q,ix){let op=q.options[t[ix]];return Number.isInteger(t[ix])&&op?{q:q,op:op}:null}).filter(Boolean),strip=function(v){return String(v||``).replace(/\[cite:[^\]]*\]/giu,``).replace(/\s{2,}/gu,` `).trim()},summary=`待定项确认：`+chosen.map(function(x){return strip(x.q.q)+` → `+strip(x.op.label)+(strip(x.op.note)?`（`+strip(x.op.note)+`）`:``)}).join(`；`);return(0,B.jsxs)(`div`,{className:`space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800`,children:[(0,B.jsxs)(`div`,{className:`flex items-center justify-between gap-2`,children:[(0,B.jsx)(`span`,{className:`text-xs font-medium`,children:`置入物体 · 待定项`}),(0,B.jsx)(`button`,{type:`button`,disabled:r,onClick:function(){i()},className:`rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800`,children:e.length>0?`重新抓取`:`让 Gemini 列出待定项`})]}),e.length===0?(0,B.jsx)(`p`,{className:`text-xs leading-relaxed text-neutral-500 dark:text-neutral-400`,children:`把「还没定、但会影响成片」的参数列成选项：点一下选中，再写进补充要求。原图精修线与分步生成线都会出现。`}):(0,B.jsxs)(`div`,{className:`space-y-3`,children:[(0,B.jsx)(`div`,{className:`space-y-3`,children:e.map(function(q,ix){return(0,B.jsxs)(`div`,{className:`space-y-1.5`,children:[(0,B.jsxs)(`div`,{className:`text-xs font-medium leading-relaxed`,children:[q.q,q.why?(0,B.jsxs)(`span`,{className:`ml-1 font-normal text-neutral-500 dark:text-neutral-400`,children:[`· `,q.why]}):null]}),(0,B.jsx)(`div`,{className:`flex flex-wrap gap-1.5`,children:q.options.map(function(op,oi){return(0,B.jsxs)(`button`,{type:`button`,title:op.note||``,onClick:function(){let next=Object.assign({},t);next[ix]=oi,n(next)},'aria-pressed':t[ix]===oi,className:`rounded-md border px-2 py-1 text-[11px] leading-snug `+(t[ix]===oi?`border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900`:`border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800`),children:[op.label,oi===q.recommended?(0,B.jsx)(`span`,{className:`ml-1 opacity-60`,children:`推荐`}):null]},`opt-`+ix+`-`+oi)})})]},`q-`+ix)})}),(0,B.jsxs)(`div`,{className:`flex flex-wrap items-center gap-2 pt-1`,children:[(0,B.jsx)(`button`,{type:`button`,onClick:function(){let all={};e.forEach(function(q,ix){all[ix]=q.recommended}),n(all)},className:`rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800`,children:`全部用推荐项`}),(0,B.jsxs)(`button`,{type:`button`,disabled:chosen.length===0,onClick:function(){a(summary),n({})},className:`rounded-md bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300`,children:[`写入补充要求（`,chosen.length,` 条）`]})]})]})]})}
function RefPlanPanel({references:e,busy:t,onChange:n}){
let list=Array.isArray(e)?e.map(function(x,ix){return{ref:x,ix:ix}}).filter(function(o){return o.ref&&o.ref.role===`reference`}):[];
if(!list.length)return null;
let chips=[`人物/人设`,`发型/结构`,`服装/道具`,`置入物体`,`特效形态与运动`,`材质/质感`,`背景空间`,`光线/色调`,`选区/画笔`];
let append=function(ix,label){let cur=String((e[ix]&&e[ix].note)||``),parts=cur.split(/[、,，]/u).map(function(s){return s.trim()}).filter(Boolean);if(parts.indexOf(label)>=0)return;parts.push(label);n(ix,parts.join(`、`))};
return(0,B.jsxs)(`div`,{className:`space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800`,children:[
(0,B.jsx)(`p`,{className:`text-xs font-medium`,children:`参考图分工（每张单独写，会写进提示词的 REFERENCE_N）`}),
list.map(function(o){
let note=String((o.ref&&o.ref.note)||``);
return(0,B.jsxs)(`div`,{className:`space-y-1.5 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800`,children:[
(0,B.jsxs)(`div`,{className:`flex items-center gap-2`,children:[
(0,B.jsx)(`span`,{className:`shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400`,children:(()=>{let k=0;for(let j=0;j<=o.ix;j++){if(e[j]&&e[j].role===`reference`)k++}return `REFERENCE_`+k})()}),
(0,B.jsx)(`span`,{className:`min-w-0 flex-1 truncate text-[11px] text-neutral-400`,children:String((o.ref&&o.ref.name)||``)})
]}),
(0,B.jsx)(`input`,{value:note,disabled:t,onChange:function(ev){n(o.ix,ev.target.value)},placeholder:`例：只借它的特效形态与运动`,className:`w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-xs outline-none dark:border-neutral-700`}),
(0,B.jsx)(`div`,{className:`flex flex-wrap gap-1`,children:chips.map(function(c){return(0,B.jsx)(`button`,{type:`button`,disabled:t,onClick:function(){append(o.ix,c)},className:`rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800`,children:c},`chip-`+o.ix+`-`+c)})})
]},`rp-`+o.ix)
})
]})}
export { ResearchPanel, ConfirmPanel, RefPlanPanel, Wd as DetailPanel, parseChecklistItems, parseResearchPayload, parsePersonaPayload }
