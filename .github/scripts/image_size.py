#!/usr/bin/env python3
"""Measure a built image the way the DanubeData registry will count it (ops-1, AC-3/AC-7).

    docker save <image> | python3 .github/scripts/image_size.py --base node:24-slim

Reads a `docker save` archive on stdin and prints, per layer, the uncompressed
tar size and the gzip size `docker push` would upload, marks which layers come
from the base image, and totals them. Exits 1 when the total is over budget.

WHY THIS NUMBER: the registry quota counts every tag at the sum of its
COMPRESSED layer blobs, with no dedup across tags (story ops-1 Context §2,
confirmed per run by the push job's tag table: `bytes_size`). Neither
`docker image inspect .Size` (uncompressed) nor the zstd export in build-image
is that number. `docker push` gzips each layer (Go's compress/gzip, default
level); gzip -6 here is the same algorithm at the same level, so the total
agrees to within a few per cent — calibrate against the push job's
`bytes_size` for the same SHA, and keep the budget margin wider than the gap.
A layer that is already compressed in the archive (containerd image store
keeps pulled base layers as their registry blobs) is counted as-is.

BUDGET: the 500 MB plan must hold, at steady state, K rollback tags + the live
tag + P pinned tags, with a 50 MB margin:

    (K + P + 1) x S <= 450 MB,  K = REGISTRY_KEEP_TAGS (default 2),
                                P = 1 (the migrator's container pins an old tag)
    =>  4 x S <= 450  =>  S <= 112 MB

"MB" is taken as 10^6 bytes, the stricter reading: if the registry means MiB,
the real headroom is ~5 % larger. WARN at 90 % of the budget, FAIL above it.
"""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import tarfile
import zlib

REGISTRY_PLAN_MB = 500
MARGIN_MB = 50
KEEP_TAGS = 2  # REGISTRY_KEEP_TAGS default (deploy.yml "Prune old image tags")
PINNED_TAGS = 1  # the migrator container's tag, outside the keep window
# (500 - 50) // (2 + 1 + 1) = 112 whole MB (112.5 rounded down).
BUDGET_BYTES = (REGISTRY_PLAN_MB - MARGIN_MB) // (KEEP_TAGS + PINNED_TAGS + 1) * 1_000_000
WARN_FRACTION = 0.90

GZIP_MAGIC = b"\x1f\x8b"
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"


def gzip_size(stream: io.BufferedIOBase) -> int:
    """Bytes of `gzip -6` output for the stream, without holding it in memory."""
    compressor = zlib.compressobj(6, zlib.DEFLATED, 31)  # 31 = gzip container
    total = 0
    while True:
        chunk = stream.read(1 << 20)
        if not chunk:
            break
        total += len(compressor.compress(chunk))
    return total + len(compressor.flush())


def base_diff_ids(base: str) -> list[str]:
    if not base:
        return []
    out = subprocess.run(
        ["docker", "image", "inspect", base, "--format", "{{json .RootFS.Layers}}"],
        check=False, capture_output=True, text=True,
    )
    if out.returncode != 0:
        print(f"::warning::could not inspect base image {base}; base/app split unavailable", file=sys.stderr)
        return []
    return json.loads(out.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="", help="base image ref, to split base vs app layers")
    parser.add_argument("--budget-bytes", type=int, default=BUDGET_BYTES)
    parser.add_argument("--report-only", action="store_true", help="never fail on the budget")
    args = parser.parse_args()

    archive = tarfile.open(fileobj=sys.stdin.buffer, mode="r|")
    # Stream mode: members arrive in archive order and cannot be revisited, so
    # measure every regular file and decide afterwards which ones are layers.
    sizes: dict[str, tuple[int, int, str]] = {}
    manifest = None
    config_blobs: dict[str, bytes] = {}
    for member in archive:
        if not member.isfile():
            continue
        handle = archive.extractfile(member)
        if handle is None:
            continue
        if member.name == "manifest.json":
            manifest = json.load(handle)
            continue
        if member.size < 64 * 1024 and (member.name.endswith(".json") or "/sha256/" in member.name):
            data = handle.read()
            config_blobs[member.name] = data
            head = data[:4]
            stream: io.BufferedIOBase = io.BytesIO(data)  # type: ignore[assignment]
        else:
            peek = handle.read(4)
            head = peek
            stream = io.BufferedReader(_Prefixed(peek, handle))  # type: ignore[arg-type]
        if head[:2] == GZIP_MAGIC:
            sizes[member.name] = (member.size, member.size, "gzip (as stored)")
        elif head[:4] == ZSTD_MAGIC:
            sizes[member.name] = (member.size, member.size, "zstd (as stored)")
        else:
            sizes[member.name] = (member.size, gzip_size(stream), "gzip -6")

    if not manifest:
        print("::error::no manifest.json in the docker save archive", file=sys.stderr)
        return 1
    entry = manifest[0]
    layers = entry["Layers"]
    config = json.loads(config_blobs.get(entry["Config"], b"{}") or b"{}")
    diff_ids = config.get("rootfs", {}).get("diff_ids", [])
    base = set(base_diff_ids(args.base))

    total = base_total = 0
    print(f"{'#':>2}  {'origin':6}  {'tar bytes':>12}  {'push bytes':>12}  method")
    for i, path in enumerate(layers):
        raw, pushed, method = sizes.get(path, (0, 0, "MISSING"))
        origin = "base" if i < len(diff_ids) and diff_ids[i] in base else "app"
        total += pushed
        if origin == "base":
            base_total += pushed
        print(f"{i:>2}  {origin:6}  {raw:>12,}  {pushed:>12,}  {method}")
    app_total = total - base_total
    budget = args.budget_bytes
    print(f"base layers: {base_total:,} B ({base_total / 1e6:.1f} MB)")
    print(f"app layers:  {app_total:,} B ({app_total / 1e6:.1f} MB)")
    print(f"TOTAL (registry estimate S): {total:,} B = {total / 1e6:.1f} MB = {total / 2**20:.1f} MiB")
    print(f"budget: {budget:,} B ({budget / 1e6:.0f} MB); used {100 * total / budget:.1f} %")

    if total > budget:
        msg = (f"image is {total / 1e6:.1f} MB compressed, over the {budget / 1e6:.0f} MB budget "
               "(4 tags x S <= 450 MB on the 500 MB registry plan; see apps/web/Dockerfile header)")
        if args.report_only:
            print(f"::warning::{msg}")
            return 0
        print(f"::error::{msg}")
        return 1
    if total >= WARN_FRACTION * budget:
        print(f"::warning::image is {total / 1e6:.1f} MB compressed, >= {int(WARN_FRACTION * 100)} % "
              f"of the {budget / 1e6:.0f} MB budget")
    return 0


class _Prefixed(io.RawIOBase):
    """A raw stream that replays a few already-read bytes, then the rest."""

    def __init__(self, prefix: bytes, rest: io.BufferedIOBase) -> None:
        self._prefix = prefix
        self._rest = rest

    def readable(self) -> bool:
        return True

    def readinto(self, buffer) -> int:  # type: ignore[override]
        if self._prefix:
            n = min(len(buffer), len(self._prefix))
            buffer[:n] = self._prefix[:n]
            self._prefix = self._prefix[n:]
            return n
        data = self._rest.read(len(buffer))
        buffer[: len(data)] = data
        return len(data)


if __name__ == "__main__":
    sys.exit(main())
