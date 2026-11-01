import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const pristine = "W:/dsh/pw-analyze/app-pristine";
const repo = "W:/dsh/pw-repo";
const hash = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

console.log("=== server/ 逐文件对比（出厂包 vs 仓库 main）===");
const serverFiles = walk(path.join(pristine, "server"));
let same = 0;
const diffs = [];
const onlyInPristine = [];
for (const rel of serverFiles) {
  const a = path.join(pristine, "server", rel);
  const b = path.join(repo, "server", rel);
  if (!existsSync(b)) {
    onlyInPristine.push(rel);
    continue;
  }
  const ha = hash(readFileSync(a, "utf8"));
  const hb = hash(readFileSync(b, "utf8"));
  if (ha === hb) same += 1;
  else diffs.push({ rel, pristine: ha, repo: hb });
}
console.log(`一致: ${same} / 共 ${serverFiles.length}`);
if (diffs.length) {
  console.log("不一致：");
  for (const d of diffs)
    console.log(`  ${d.rel}  出厂=${d.pristine} 仓库=${d.repo}`);
}
if (onlyInPristine.length)
  console.log("只在出厂包里有：", onlyInPristine.join(", "));

const repoServer = walk(path.join(repo, "server"));
const onlyInRepo = repoServer.filter(
  (rel) => !existsSync(path.join(pristine, "server", rel)),
);
if (onlyInRepo.length) console.log("只在仓库里有：", onlyInRepo.join(", "));

console.log("\n=== 版本 ===");
const pkgPristine = JSON.parse(
  readFileSync(path.join(pristine, "package.json"), "utf8"),
);
const pkgRepo = JSON.parse(
  readFileSync(path.join(repo, "package.json"), "utf8"),
);
console.log(`出厂 ${pkgPristine.version} / 仓库 ${pkgRepo.version}`);
