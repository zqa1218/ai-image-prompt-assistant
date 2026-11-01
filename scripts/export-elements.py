#!/usr/bin/env python3
"""从 intelligent-prompt-generator 的元素库导出前端可读的 JSON。

源库：~/.codex/skills/intelligent-prompt-generator/engine/extracted_results/elements.db
产物：public/data/elements.json（静态资源，运行时按需拉取，不打进 JS bundle）

用法：
    python scripts/export-elements.py
    python scripts/export-elements.py --check     # 只校验条数一致性，不写文件
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

SOURCE_SKILL = "intelligent-prompt-generator"
SOURCE_VERSION = "v2.0"

DEFAULT_DB = (
    Path.home()
    / ".codex"
    / "skills"
    / "intelligent-prompt-generator"
    / "engine"
    / "extracted_results"
    / "elements.db"
)
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "elements.json"


def parse_keywords(raw):
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return [part.strip() for part in str(raw).split(",") if part.strip()]
    if isinstance(value, list):
        return [str(item) for item in value]
    return []


def parse_number(raw):
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def collect(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        domains = [
            {
                "id": row["domain_id"],
                "name": row["name"],
                "description": row["description"],
                "elementCount": row["total_elements"],
            }
            for row in con.execute(
                "SELECT domain_id, name, description, total_elements "
                "FROM domains ORDER BY domain_id"
            ).fetchall()
        ]

        categories = [
            {
                "id": row["category_id"],
                "domainId": row["domain_id"],
                "name": row["name"],
                "description": row["description"],
            }
            for row in con.execute(
                "SELECT category_id, domain_id, name, description FROM categories "
                "ORDER BY domain_id, category_id"
            ).fetchall()
        ]

        tags_by_element = {}
        for row in con.execute(
            "SELECT et.element_id AS element_id, t.tag_name AS tag_name "
            "FROM element_tags et JOIN tags t ON t.tag_id = et.tag_id "
            "ORDER BY t.usage_count DESC, t.tag_name"
        ).fetchall():
            tags_by_element.setdefault(row["element_id"], []).append(row["tag_name"])

        elements = []
        for row in con.execute(
            "SELECT element_id, domain_id, category_id, name, chinese_name, "
            "ai_prompt_template, keywords, reusability_score, confidence_score "
            "FROM elements ORDER BY domain_id, category_id, element_id"
        ).fetchall():
            elements.append(
                {
                    "id": row["element_id"],
                    "domain": row["domain_id"],
                    "category": row["category_id"],
                    "name": row["name"],
                    "chineseName": row["chinese_name"],
                    "prompt": row["ai_prompt_template"],
                    "keywords": parse_keywords(row["keywords"]),
                    "reusability": parse_number(row["reusability_score"]),
                    "confidence": parse_number(row["confidence_score"]),
                    "tags": tags_by_element.get(row["element_id"], []),
                }
            )

        design_variables = [
            {
                "styleName": row["style_name"],
                "type": row["variable_type"],
                "name": row["variable_name"],
                "priority": row["priority"],
                "description": row["description"],
            }
            for row in con.execute(
                "SELECT style_name, variable_type, variable_name, priority, description "
                "FROM design_variables ORDER BY style_name, variable_type"
            ).fetchall()
        ]

        element_count = con.execute("SELECT COUNT(*) FROM elements").fetchone()[0]
    finally:
        con.close()

    return {
        "source": {
            "skill": SOURCE_SKILL,
            "skillVersion": SOURCE_VERSION,
            "dbPath": str(db_path),
            "exportedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "elementCount": element_count,
        },
        "domains": domains,
        "categories": categories,
        "designVariables": design_variables,
        "elements": elements,
    }


def main():
    parser = argparse.ArgumentParser(description="导出元素库为 JSON")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--check", action="store_true", help="只校验条数一致性，不写文件")
    args = parser.parse_args()

    if not args.db.is_file():
        print(f"[ERROR] 找不到元素库：{args.db}", file=sys.stderr)
        print("        该文件随 intelligent-prompt-generator 技能安装。", file=sys.stderr)
        return 1

    if args.check:
        if not args.out.is_file():
            print(f"[FAIL] 尚未导出：{args.out}")
            return 1
        existing = json.loads(args.out.read_text(encoding="utf-8"))
        total = existing["source"]["elementCount"]
        ok = len(existing["elements"]) == total
        print(f"{'PASS' if ok else 'FAIL'} 元数据 {total} 条 / 实际导出 {len(existing['elements'])} 条")
        return 0 if ok else 1

    data = collect(args.db)
    total = data["source"]["elementCount"]
    exported = len(data["elements"])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    size_mb = args.out.stat().st_size / 1024 / 1024
    print(f"[OK] 已导出 {exported} 条元素 -> {args.out}（{size_mb:.2f} MB）")
    print(
        f"     领域 {len(data['domains'])} 个 / 类别 {len(data['categories'])} 个 / "
        f"设计变量 {len(data['designVariables'])} 条"
    )
    for domain in data["domains"]:
        print(f"       - {domain['id']:16} {domain['elementCount']:>4} 条  {domain['name']}")

    if exported != total:
        print(f"[ERROR] 导出条数 {exported} 与库内 {total} 不一致", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
