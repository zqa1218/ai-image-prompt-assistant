"""Repack an extracted directory back into app.asar (with electron-builder style integrity)."""

import hashlib
import json
import struct
import sys
from pathlib import Path

BLOCK_SIZE = 4194304


def integrity_of(path: Path):
    data = path.read_bytes()
    whole = hashlib.sha256(data).hexdigest()
    blocks = [
        hashlib.sha256(data[start:start + BLOCK_SIZE]).hexdigest()
        for start in range(0, max(len(data), 1), BLOCK_SIZE)
    ]
    return data, {"algorithm": "SHA256", "hash": whole, "blockSize": BLOCK_SIZE, "blocks": blocks}


def build_tree(root: Path, unpacked: dict):
    tree = {"files": {}}
    payloads = {}

    def walk(base: Path, node: dict):
        for entry in sorted(base.iterdir(), key=lambda p: p.name):
            if entry.name == "_manifest.txt":
                continue
            rel = entry.relative_to(root).as_posix()
            if entry.is_dir():
                child = {"files": {}}
                node["files"][entry.name] = child
                walk(entry, child)
            elif rel in unpacked:
                node["files"][entry.name] = {"size": unpacked[rel], "unpacked": True}
            else:
                data, integ = integrity_of(entry)
                payloads[rel] = data
                node["files"][entry.name] = {
                    "size": len(data),
                    "integrity": integ,
                }

    walk(root, tree)
    return tree, payloads


def assign_offsets(node: dict, prefix: str, payloads: dict, blobs: list):
    for name, meta in (node.get("files") or {}).items():
        rel = prefix + name
        if "files" in meta:
            assign_offsets(meta, rel + "/", payloads, blobs)
        elif not meta.get("unpacked"):
            offset = sum(len(d) for d in blobs)
            meta["offset"] = str(offset)
            blobs.append(payloads[rel])


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2])

    unpacked = {}
    manifest = src / "_manifest.txt"
    if manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            parts = line.split("\t")
            if len(parts) == 3 and parts[0] == "u":
                unpacked[parts[1]] = int(parts[2])

    tree, payloads = build_tree(src, unpacked)
    blobs = []
    assign_offsets(tree, "", payloads, blobs)

    payload = json.dumps(tree, separators=(",", ":")).encode("utf-8")
    inner_len = (4 + len(payload) + 3) // 4 * 4
    outer_len = 4 + inner_len
    pad = b"\x00" * (inner_len - 4 - len(payload))

    with out.open("wb") as f:
        f.write(struct.pack("<I", 4))
        f.write(struct.pack("<I", outer_len))
        f.write(struct.pack("<I", inner_len))
        f.write(struct.pack("<I", len(payload)))
        f.write(payload)
        f.write(pad)
        for data in blobs:
            f.write(data)

    total = 8 + outer_len + sum(len(d) for d in blobs)
    print("packed %d files, unpacked=%d, bytes=%d -> %s" % (len(blobs), len(unpacked), total, out))


if __name__ == "__main__":
    main()
