#!/usr/bin/env python3
"""Merge per-platform updater JSON files into latest.json.

Also:
- copies latest-macos-*.json to latest-darwin-*.json (Tauri {{target}}=darwin)
- injects windows-* platform entries into latest-macos-x86_64.json so already
  installed Windows apps (which still request the macOS Intel manifest) can
  find windows-x86_64-nsis / windows-x86_64.
- when REQUIRED_PLATFORMS is set (comma separated), fails after merging if any
  of those platform keys is missing from latest.json.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def load_manifests(directory: Path) -> list[tuple[Path, dict]]:
    items: list[tuple[Path, dict]] = []
    for path in sorted(directory.glob("latest-*.json")):
        if path.name == "latest.json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        items.append((path, data))
    return items


def merge_manifests(items: list[tuple[Path, dict]]) -> dict | None:
    if not items:
        return None
    merged: dict = {
        "version": "",
        "notes": "",
        "pub_date": "",
        "platforms": {},
    }
    for _, data in items:
        version = str(data.get("version") or "").strip()
        if version:
            merged["version"] = version
        notes = data.get("notes")
        if isinstance(notes, str) and notes:
            merged["notes"] = notes
        pub_date = str(data.get("pub_date") or "")
        if pub_date > str(merged.get("pub_date") or ""):
            merged["pub_date"] = pub_date
        platforms = data.get("platforms")
        if isinstance(platforms, dict):
            merged["platforms"].update(platforms)
    if not merged["version"] or not merged["platforms"]:
        return None
    return merged


def inject_windows_into_macos_intel(directory: Path, merged: dict) -> None:
    macos_intel = directory / "latest-macos-x86_64.json"
    if not macos_intel.is_file():
        return
    try:
        data = json.loads(macos_intel.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(data, dict):
        return
    platforms = data.setdefault("platforms", {})
    if not isinstance(platforms, dict):
        return
    changed = False
    for key, value in merged.get("platforms", {}).items():
        if str(key).startswith("windows-") and platforms.get(key) != value:
            platforms[key] = value
            changed = True
    if changed:
        macos_intel.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def copy_macos_to_darwin(directory: Path) -> None:
    for macos_path in directory.glob("latest-macos-*.json"):
        suffix = macos_path.name[len("latest-macos-") :]
        darwin_path = directory / f"latest-darwin-{suffix}"
        darwin_path.write_bytes(macos_path.read_bytes())


def merge_directory(directory: Path) -> Path | None:
    items = load_manifests(directory)
    merged = merge_manifests(items)
    if merged is None:
        return None
    latest = directory / "latest.json"
    latest.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    inject_windows_into_macos_intel(directory, merged)
    copy_macos_to_darwin(directory)
    return latest


def required_platforms() -> list[str]:
    raw = os.environ.get("REQUIRED_PLATFORMS", "")
    return [key.strip() for key in raw.split(",") if key.strip()]


def missing_platforms(merged: dict, required: list[str]) -> list[str]:
    platforms = merged.get("platforms")
    if not isinstance(platforms, dict):
        platforms = {}
    return [key for key in required if key not in platforms]


def _self_test() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        (root / "latest-macos-aarch64.json").write_text(
            json.dumps(
                {
                    "version": "0.1.19",
                    "notes": "",
                    "pub_date": "2026-08-21T00:00:00Z",
                    "platforms": {
                        "darwin-aarch64": {
                            "signature": "mac-arm",
                            "url": "https://example/mac-arm.app.tar.gz",
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        (root / "latest-macos-x86_64.json").write_text(
            json.dumps(
                {
                    "version": "0.1.19",
                    "notes": "",
                    "pub_date": "2026-08-21T00:00:01Z",
                    "platforms": {
                        "darwin-x86_64": {
                            "signature": "mac-intel",
                            "url": "https://example/mac-intel.app.tar.gz",
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        (root / "latest-windows-x86_64.json").write_text(
            json.dumps(
                {
                    "version": "0.1.19",
                    "notes": "",
                    "pub_date": "2026-08-21T00:00:02Z",
                    "platforms": {
                        "windows-x86_64-nsis": {
                            "signature": "win",
                            "url": "https://example/win-setup.exe",
                        },
                        "windows-x86_64": {
                            "signature": "win",
                            "url": "https://example/win-setup.exe",
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        (root / "latest-linux-x86_64.json").write_text(
            json.dumps(
                {
                    "version": "0.1.19",
                    "notes": "",
                    "pub_date": "2026-08-21T00:00:03Z",
                    "platforms": {
                        "linux-x86_64-appimage": {
                            "signature": "linux-appimage",
                            "url": "https://example/workbuddy-switch-linux-x86_64.AppImage",
                        },
                        "linux-x86_64": {
                            "signature": "linux-appimage",
                            "url": "https://example/workbuddy-switch-linux-x86_64.AppImage",
                        },
                    },
                }
            ),
            encoding="utf-8",
        )
        (root / "latest-linux-deb-x86_64.json").write_text(
            json.dumps(
                {
                    "version": "0.1.19",
                    "notes": "",
                    "pub_date": "2026-08-21T00:00:04Z",
                    "platforms": {
                        "linux-x86_64-deb": {
                            "signature": "linux-deb",
                            "url": "https://example/workbuddy-switch-linux-x86_64.deb",
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        latest = merge_directory(root)
        assert latest is not None
        merged = json.loads(latest.read_text(encoding="utf-8"))
        assert merged["version"] == "0.1.19"
        assert set(merged["platforms"]) == {
            "darwin-aarch64",
            "darwin-x86_64",
            "windows-x86_64-nsis",
            "windows-x86_64",
            "linux-x86_64",
            "linux-x86_64-deb",
            "linux-x86_64-appimage",
        }
        assert merged["platforms"]["linux-x86_64"]["url"].endswith(".AppImage")
        assert merged["platforms"]["linux-x86_64-deb"]["url"].endswith(".deb")
        macos_intel = json.loads((root / "latest-macos-x86_64.json").read_text(encoding="utf-8"))
        assert "windows-x86_64-nsis" in macos_intel["platforms"]
        assert "windows-x86_64" in macos_intel["platforms"]
        assert "darwin-x86_64" in macos_intel["platforms"]
        assert "linux-x86_64-deb" not in macos_intel["platforms"]
        darwin = json.loads((root / "latest-darwin-x86_64.json").read_text(encoding="utf-8"))
        assert darwin == macos_intel
        # REQUIRED_PLATFORMS 门禁：齐全通过、缺一即报告
        expected = [
            "darwin-aarch64",
            "darwin-x86_64",
            "windows-x86_64-nsis",
            "windows-x86_64",
            "linux-x86_64",
            "linux-x86_64-deb",
            "linux-x86_64-appimage",
        ]
        assert missing_platforms(merged, expected) == []
        assert missing_platforms(merged, [*expected, "linux-aarch64"]) == ["linux-aarch64"]
        assert missing_platforms(merged, ["linux-x86_64-deb"]) == []
        print("merge-update-manifests: self-test ok")


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        _self_test()
        return 0
    directory = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    latest = merge_directory(directory)
    if latest is None:
        print("merge-update-manifests: 未找到可合并的 latest-*.json", file=sys.stderr)
        return 1
    print(f"merge-update-manifests: 已生成 {latest}")
    required = required_platforms()
    if required:
        merged = json.loads(latest.read_text(encoding="utf-8"))
        missing = missing_platforms(merged, required)
        if missing:
            print(
                "merge-update-manifests: latest.json 缺少必需平台键：" + ", ".join(missing),
                file=sys.stderr,
            )
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
