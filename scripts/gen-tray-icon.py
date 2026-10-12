#!/usr/bin/env python3
"""生成托盘图标素材（raw RGBA），供 Windows / Linux 托盘使用。

为什么需要预生成：
    Windows / Linux 没有 macOS 的「模板图标」语义，托盘必须自带配色素材；
    而 Tauri 侧为不引入 PNG 解码依赖（`image-png` feature），改为直接嵌入 raw RGBA，
    因此需要把源图标预解码并下采样成固定尺寸的 `.rgba` 文件随仓库提交。

用法：
    python scripts/gen-tray-icon.py                      # 彩色素材（默认 32×32）
    python scripts/gen-tray-icon.py --size 64            # 指定尺寸
    python scripts/gen-tray-icon.py --mono black         # 单色黑猫（浅色任务栏用）
    python scripts/gen-tray-icon.py --mono white         # 单色白猫（深色任务栏用）

要点：
    * 彩色源图必须**含透明通道**（透明底）。满幅不透明方图会在深色任务栏下显示为白底方块。
    * 下采样使用**预乘 alpha 的面积平均**，避免出现白边 / 黑边。
    * 单色素材取自 `icons/tray-icon-template.png`（与 macOS 模板同一份猫形），
      只对 alpha 做面积平均、RGB 固定为黑白，不携带任何彩色边缘。
"""
import argparse
import struct
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# 单色素材的墨色：黑猫用在浅色任务栏，白猫用在深色任务栏。
MONO_RGB = {"black": (17, 17, 19), "white": (255, 255, 255)}
MONO_TEMPLATE = "src-tauri/icons/tray-icon-template.png"
COLOR_SRC = "public/icon-transparent.png"
COLOR_OUT = "src-tauri/icons/tray-icon-color.rgba"


def decode_png(path: Path):
    """极简 PNG 解码（8bit / 非隔行；支持灰度、RGB、RGBA、灰度+alpha）。"""
    d = path.read_bytes()
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} 不是 PNG")
    pos, idat, ihdr = 8, b"", None
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        data = d[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", data)
        elif typ == b"IDAT":
            idat += data
        elif typ == b"IEND":
            break
        pos += 12 + ln
    w, h, depth, ctype, _, _, interlace = ihdr
    if depth != 8 or interlace != 0:
        raise SystemExit(f"仅支持 8bit 非隔行 PNG（实际 depth={depth} interlace={interlace}）")
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    raw = zlib.decompress(idat)
    stride = w * ch
    px = bytearray()
    prev = bytearray(stride)
    i = 0
    for _ in range(h):
        f = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            v = line[x]
            if f == 1:
                v += a
            elif f == 2:
                v += b
            elif f == 3:
                v += (a + b) // 2
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                v += a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            line[x] = v & 0xFF
        prev = line
        if ch == 4:
            px += line
        elif ch == 3:
            for x in range(0, stride, 3):
                px += bytes((line[x], line[x + 1], line[x + 2], 255))
        elif ch == 2:
            for x in range(0, stride, 2):
                v = line[x]
                px += bytes((v, v, v, line[x + 1]))
        else:
            for x in range(0, stride, ch):
                v = line[x]
                px += bytes((v, v, v, 255))
    return w, h, px


def downscale_premultiplied(w, h, px, size):
    """预乘 alpha 的面积平均下采样（避免白边 / 黑边）。"""
    out = bytearray(size * size * 4)
    bx, by = w / size, h / size
    for ty in range(size):
        for tx in range(size):
            x0, x1 = int(tx * bx), max(int(tx * bx) + 1, int((tx + 1) * bx))
            y0, y1 = int(ty * by), max(int(ty * by) + 1, int((ty + 1) * by))
            sr = sg = sb = sa = 0.0
            cnt = 0
            for y in range(y0, min(y1, h)):
                for x in range(x0, min(x1, w)):
                    i = (y * w + x) * 4
                    a = px[i + 3] / 255.0
                    sr += px[i] * a
                    sg += px[i + 1] * a
                    sb += px[i + 2] * a
                    sa += a
                    cnt += 1
            j = (ty * size + tx) * 4
            if cnt and sa > 0:
                out[j] = int(sr / sa)
                out[j + 1] = int(sg / sa)
                out[j + 2] = int(sb / sa)
                out[j + 3] = int(sa / cnt * 255)
    return bytes(out)


def downscale_mono(w, h, px, size, rgb):
    """单色素材：只对 alpha 做面积平均，RGB 固定为给定墨色。"""
    out = bytearray(size * size * 4)
    bx, by = w / size, h / size
    for ty in range(size):
        for tx in range(size):
            x0, x1 = int(tx * bx), max(int(tx * bx) + 1, int((tx + 1) * bx))
            y0, y1 = int(ty * by), max(int(ty * by) + 1, int((ty + 1) * by))
            sa = 0.0
            cnt = 0
            for y in range(y0, min(y1, h)):
                for x in range(x0, min(x1, w)):
                    sa += px[(y * w + x) * 4 + 3] / 255.0
                    cnt += 1
            j = (ty * size + tx) * 4
            out[j], out[j + 1], out[j + 2] = rgb
            out[j + 3] = int(sa / cnt * 255) if cnt else 0
    return bytes(out)


def main():
    ap = argparse.ArgumentParser(description="生成托盘 raw RGBA 素材")
    ap.add_argument("--mono", choices=sorted(MONO_RGB), help="生成单色素材（源图默认取 tray-icon-template.png）")
    ap.add_argument("--src", default=None, help="源图标（彩色必须含透明通道）")
    ap.add_argument("--out", default=None, help="输出 .rgba")
    ap.add_argument("--size", type=int, default=32, help="输出边长（默认 32；Windows 托盘实际最大 32，过大的源会被系统二次缩放而发虚）")
    args = ap.parse_args()

    src_name = args.src or (MONO_TEMPLATE if args.mono else COLOR_SRC)
    out_name = args.out or (
        f"src-tauri/icons/tray-icon-mono-{args.mono}.rgba" if args.mono else COLOR_OUT
    )
    src, out = REPO / src_name, REPO / out_name
    w, h, px = decode_png(src)
    if args.mono:
        rgba = downscale_mono(w, h, px, args.size, MONO_RGB[args.mono])
    else:
        rgba = downscale_premultiplied(w, h, px, args.size)
    n = len(rgba) // 4
    transparent = sum(1 for i in range(n) if rgba[i * 4 + 3] == 0)
    opaque = sum(1 for i in range(n) if rgba[i * 4 + 3] == 255)
    if transparent == 0:
        raise SystemExit("源图不含透明像素：托盘素材必须是透明底，否则深色任务栏会出现白底方块")
    if opaque == 0:
        raise SystemExit("源图没有不透明像素：图标会完全不可见")
    out.write_bytes(rgba)
    try:
        shown = out.relative_to(REPO)
    except ValueError:  # --out 指向仓库外
        shown = out
    print(f"已生成 {shown}：{args.size}×{args.size}，{len(rgba):,} B"
          f"（透明 {transparent} / 不透明 {opaque} 像素）")


if __name__ == "__main__":
    main()
