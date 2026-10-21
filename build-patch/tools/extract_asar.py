import json
import os
import struct
import sys
from pathlib import Path


def read_header(f):
    f.seek(0)
    head = f.read(8)
    if len(head) < 8:
        raise SystemExit("file too small")
    size = struct.unpack("<I", head[4:8])[0]
    raw = f.read(size)
    jstart = raw.find(b"{")
    if jstart < 0:
        raise SystemExit("no JSON header found")
    header, _ = json.JSONDecoder().raw_decode(raw[jstart:].decode("utf-8", "replace"))
    return header, 8 + size


def walk(node, prefix, out, data, base):
    files = node.get("files") or {}
    for name, meta in files.items():
        path = prefix + name
        if "files" in meta:
            out.append(("d", path, None))
            walk(meta, path + "/", out, data, base)
            continue
        if meta.get("unpacked"):
            out.append(("u", path, meta.get("size", 0)))
            continue
        off = int(meta.get("offset", 0))
        size = int(meta.get("size", 0))
        out.append(("f", path, size))
        data.append((path, base + off, size))


def main():
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    with src.open("rb") as f:
        header, base = read_header(f)
        entries = []
        blobs = []
        walk(header, "", entries, blobs, base)
        for path, off, size in blobs:
            target = dst / path
            target.parent.mkdir(parents=True, exist_ok=True)
            f.seek(off)
            target.write_bytes(f.read(size))

    (dst / "_manifest.txt").write_text(
        "\n".join(
            f"{kind}\t{path}\t{size if size is not None else ''}"
            for kind, path, size in entries
        ),
        encoding="utf-8",
    )
    print(f"header_base={base} entries={len(entries)} files={len(blobs)} -> {dst}")


if __name__ == "__main__":
    main()
