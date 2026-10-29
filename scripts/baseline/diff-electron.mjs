import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const pristine = "W:/dsh/pw-analyze/app-pristine/electron";
const repo = "W:/dsh/pw-repo/electron";
const hash = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

console.log("=== electron/ 对比（出厂 vs 仓库）===");
let same = 0;
const diffs = [];
const onlyPristine = [];
for (const name of readdirSync(pristine)) {
  const a = path.join(pristine, name);
  const b = path.join(repo, name);
  if (!existsSync(b)) {
    onlyPristine.push(name);
    continue;
  }
  const ha = hash(readFileSync(a, "utf8"));
  const hb = hash(readFileSync(b, "utf8"));
  if (ha === hb) same += 1;
  else diffs.push({ name, pristine: ha, repo: hb });
}
console.log(`一致: ${same}`);
console.log("不一致:", diffs.map((d) => d.name).join(", ") || "无");
console.log("只在出厂:", onlyPristine.join(", ") || "无");
const onlyRepo = readdirSync(repo).filter(
  (n) => !existsSync(path.join(pristine, n)),
);
console.log("只在仓库:", onlyRepo.join(", ") || "无");
