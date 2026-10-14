#!/usr/bin/env python3
"""
fetch_kursk_ground.py — 第三关《鏖战库尔斯克》地面卫星贴图一次性获取管线

数据源：Sentinel-2 L2A（哥白尼开放数据，AWS 公开桶 sentinel-s2-l2a，匿名 HTTP 可取）
输出：img/kursk/ground.jpg（4400x4400，1 texel = 10m，覆盖 44km x 44km）
      img/kursk/ground_preview.jpg（快速检查用，确认后可删）

选址：普罗霍罗卡以南草原（史实 1943.07 普罗霍罗卡坦克战南翼），
      开阔农田+缓丘+小河，避开别尔哥罗德（西）与奥博扬/普罗霍罗卡镇（北缘）的建成区。
裁剪窗口（UTM 37N，单位米）：
  E 320000 ~ 364000（西→东 44km），N 5610000 ~ 5654000（南→北 44km）
  窗口完全位于 Sentinel-2 tile 37UCS 范围内，无需拼图。

依赖：Pillow（官方 wheel 自带 OpenJPEG，可解 JP2）。
用法：python scripts/fetch_kursk_ground.py

教训备忘（继承自 fetch_barbarossa_ground.py 的坑）：
  - 不信 tileInfo 自报的覆盖率/云量（会虚报），用 R60m 快视图实测窗口
  - R60m 与 R10m 内容可能不一致（空 granule 时 R10m 仅 ~30KB），下载后校验文件大小
"""

import io
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'img', 'kursk')
TMP = os.path.join(ROOT, 'scripts', '_ground_cache')

BUCKET = 'https://sentinel-s2-l2a.s3.eu-central-1.amazonaws.com'
TILE = ('37', 'U', 'CS')

# 候选拍摄日期（HEAD content-length 实测满覆盖的优先：2023-06-25 / 07-05 / 2024-08-28 ≈134MB）
CANDIDATES = [
    (2023, 6, 25),
    (2023, 7, 5),
    (2024, 8, 28),
    (2023, 7, 8),
    (2023, 7, 13),
    (2023, 7, 18),
    (2023, 7, 23),
    (2023, 7, 28),
    (2023, 8, 2),
    (2023, 8, 12),
    (2024, 7, 2),
    (2024, 7, 12),
    (2024, 7, 21),
    (2023, 6, 18),
    (2024, 5, 17),
]

# 质量门槛：R60m 快视图实测——窗口有效率 ≥95% 且云斑（高亮低饱和像素）≤0.5%
MIN_WINDOW_VALID_PCT = 95.0
MAX_WINDOW_CLOUD_PCT = 0.5
# R10m 全尺寸 TCI：乡村满覆盖 tile 约 130MB；<80MB 必为大面积空 granule（实测空 sliver 仅 12-30KB）
# 注意 R60m 快视图与 R10m 内容可能不一致（本 tile 实测如此），快视图只做初筛，大小+均匀性兜底
MIN_JP2_BYTES = 80_000_000

# 裁剪窗口（UTM 37N，米）：44km × 44km
E_MIN, E_MAX = 320000, 364000    # 44 km
N_MIN, N_MAX = 5610000, 5654000  # 44 km

UA = {'User-Agent': 'courage-wings-level3-ground-fetch/1.0'}


def http_get(url, dst=None, expect_min=0):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if len(data) < expect_min:
        raise RuntimeError(f'响应过短 ({len(data)}B): {url}')
    if dst:
        with open(dst, 'wb') as f:
            f.write(data)
        return dst
    return data


def window_stats(base, origin_e, origin_n):
    """用 R60m 快视图（~1830px）实测目标窗口：(有效像素比例, 云斑比例)。
    云斑判定：高亮度且低饱和（白/亮灰积云）。白色 no-data 同时计入无效与云斑。"""
    from PIL import Image
    data = http_get(f'{BUCKET}/{base}/R60m/TCI.jp2', expect_min=10_000)
    pv = Image.open(io.BytesIO(data)).convert('RGB')
    tile_px = 10980
    sx, sy = pv.size[0] / tile_px, pv.size[1] / tile_px
    win = pv.crop((int((E_MIN - origin_e) / 10 * sx), int((origin_n - N_MAX) / 10 * sy),
                   int((E_MAX - origin_e) / 10 * sx), int((origin_n - N_MIN) / 10 * sy)))
    px = list(win.getdata())
    valid = cloud = 0
    for p in px:
        white = p[0] > 200 and p[1] > 200 and p[2] > 200
        if not white:
            valid += 1
        mx, mn = max(p), min(p)
        if mx > 190 and (mx - mn) < 45:
            cloud += 1
    n = len(px)
    return valid / n * 100, cloud / n * 100


def find_tile():
    """按候选日期探测 tile：R60m 快视图实测窗口有效率与云斑（不信 tileInfo 自报值）。
    下载后发现覆盖不足的日期记入 _ground_cache/_skip_dates.txt，本轮及后续运行跳过。"""
    skip_file = os.path.join(TMP, '_skip_dates.txt')
    skip = set()
    if os.path.exists(skip_file):
        skip = set(x.strip() for x in open(skip_file) if x.strip())
    for (y, m, d) in CANDIDATES:
        if f'{y}-{m:02d}-{d:02d}' in skip:
            continue
        for seq in (0, 1):
            base = f'tiles/{TILE[0]}/{TILE[1]}/{TILE[2]}/{y}/{m}/{d}/{seq}'
            try:
                info = json.loads(http_get(f'{BUCKET}/{base}/tileInfo.json'))
            except Exception:
                continue
            coords = info['tileGeometry']['coordinates'][0]
            origin_e = min(c[0] for c in coords)
            origin_n = max(c[1] for c in coords)
            try:
                wpct, cpct = window_stats(base, origin_e, origin_n)
            except Exception:
                continue
            print(f'[probe] {y}-{m:02d}-{d:02d} seq={seq}: 窗口有效 {wpct:.0f}% 云斑 {cpct:.2f}%')
            if wpct >= MIN_WINDOW_VALID_PCT and cpct <= MAX_WINDOW_CLOUD_PCT:
                print(f'[ok] 采用 tile: {y}-{m:02d}-{d:02d} seq={seq}')
                return (y, m, d, seq, base, info, origin_e, origin_n)
    raise RuntimeError('所有候选日期均不满足窗口有效率/云斑门槛')


def mark_skip(y, m, d):
    """下载后判定覆盖不足的日期记入跳过名单"""
    skip_file = os.path.join(TMP, '_skip_dates.txt')
    with open(skip_file, 'a') as f:
        f.write(f'{y}-{m:02d}-{d:02d}\n')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)

    y, m, d, seq, base, info, origin_e, origin_n = find_tile()
    print(f'[info] tile 原点 E={origin_e} N={origin_n}')

    jp2_path = os.path.join(TMP, f'TCI_37UCS_{y}{m:02d}{d:02d}.jp2')
    if not os.path.exists(jp2_path) or os.path.getsize(jp2_path) < MIN_JP2_BYTES:
        url = f'{BUCKET}/{base}/R10m/TCI.jp2'
        print(f'[dl] 下载 TCI.jp2 (~130MB): {url}')
        try:
            http_get(url, dst=jp2_path, expect_min=MIN_JP2_BYTES)
        except Exception as e:
            # 响应过短=granule 部分覆盖：记跳过名单 + 删残文件，外层循环换日期
            if os.path.exists(jp2_path):
                os.remove(jp2_path)
            mark_skip(y, m, d)
            raise RuntimeError(f'granule 覆盖不足（{os.path.basename(url)}），换日期: {e}')
        sz = os.path.getsize(jp2_path) / 1e6
        print(f'[dl] 完成: {sz:.1f}MB')
    else:
        print(f'[cache] 复用 {jp2_path}')

    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    print('[dec] 解码 JP2（约 30-60s）...')
    img = Image.open(jp2_path)
    img.load()
    print(f'[dec] 尺寸 {img.size}')
    assert img.size[0] >= 10980 and img.size[1] >= 10980, '非预期 tile 尺寸'

    px = 10  # m/px（整型，保证像素坐标为 int）
    left = int(round((E_MIN - origin_e) / px))
    upper = int(round((origin_n - N_MAX) / px))
    right = left + (E_MAX - E_MIN) // px
    lower = upper + (N_MAX - N_MIN) // px
    print(f'[crop] 像素窗口 left={left} upper={upper} right={right} lower={lower}')
    assert left >= 0 and upper >= 0 and right <= img.size[0] and lower <= img.size[1], \
        '裁剪窗口超出 tile 范围，需要调整窗口或拼图'

    crop = img.crop((left, upper, right, lower)).convert('RGB')
    # 均匀性兜底：窗口全黑/全白（granule 没盖到窗口）直接判失败换日期
    import numpy as np
    arr = np.asarray(crop.resize((110, 110)), dtype=np.uint8)
    if arr.std() < 5:
        mark_skip(y, m, d)
        raise RuntimeError('裁剪窗口内容均匀（granule 未覆盖窗口），换日期')
    out = os.path.join(OUT_DIR, 'ground.jpg')
    crop.save(out, quality=84, optimize=True)
    print(f'[ok] 写出 {out} ({os.path.getsize(out) / 1e6:.1f}MB, {crop.size})')

    preview = crop.resize((1000, 1000), Image.LANCZOS)
    prev_path = os.path.join(OUT_DIR, 'ground_preview.jpg')
    preview.save(prev_path, quality=85)
    print(f'[ok] 预览 {prev_path}')


if __name__ == '__main__':
    sys.exit(main())
