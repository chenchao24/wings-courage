#!/usr/bin/env python3
"""
fetch_berlin_ground.py — 第四关《柏林保卫战》地面卫星贴图一次性获取管线

数据源：Sentinel-2 L2A（哥白尼开放数据，AWS 公开桶 sentinel-s2-l2a，匿名 HTTP 可取）
输出：img/berlin/ground.jpg（8000x6400，1 texel = 10m，覆盖 80km x 64km）
      img/berlin/ground_preview.jpg（快速检查用）

裁剪窗口（UTM 33N，单位米）：
  E 300000 ~ 380000（西→东 80km），N 5792020 ~ 5856020（南→北 64km）
  窗口东缘切入柏林城西半（E~370000 起为市区），城市贴图落在地图东缘。
  窗口完全位于 Sentinel-2 tile 33UUU 范围内，无需拼图。

依赖：Pillow（官方 wheel 自带 OpenJPEG，可解 JP2）。
用法：python scripts/fetch_berlin_ground.py
"""

import io
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'img', 'berlin')
TMP = os.path.join(ROOT, 'scripts', '_ground_cache')

BUCKET = 'https://sentinel-s2-l2a.s3.eu-central-1.amazonaws.com'
TILE = ('33', 'U', 'UU')

# 候选拍摄日期（哥白尼 catalogue 查询，云量 <=10%，5-8 月）。
# 注意：catalogue 云量按"有数据区域"计算，过境条带只擦过 tile 一角的产品也会显示低云量，
# 因此 find_tile() 必须再按 tileInfo.json 的 dataCoveragePercentage 过滤。
CANDIDATES = [
    (2023, 7, 8),
    (2023, 6, 5),
    (2023, 6, 13),
    (2023, 6, 18),
    (2023, 6, 3),
    (2023, 5, 8),
    (2023, 5, 9),
    (2023, 5, 26),
    (2023, 5, 28),
    (2024, 7, 21),
    (2024, 6, 9),
    (2024, 6, 26),
    (2024, 8, 6),
    (2024, 8, 13),
    (2024, 8, 20),
    (2024, 8, 28),
    (2024, 5, 2),
    (2024, 5, 15),
    (2024, 5, 17),
]

# 质量门槛：数据覆盖率（防过境条带只擦边）+ 云量
MIN_DATA_COVERAGE = 99.0
MAX_CLOUDY_PCT = 8.0

# 裁剪窗口（UTM 33N，米）
# 80km × 64km（宽高比 1.25，较方形避免"长边突出"观感）；东缘切入柏林城西半
E_MIN, E_MAX = 300000, 380000    # 80 km
N_MIN, N_MAX = 5792020, 5856020  # 64 km

UA = {'User-Agent': 'courage-wings-level4-ground-fetch/1.0'}


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


def find_tile():
    """按候选日期探测 tile，用 tileInfo.json 过滤覆盖率/云量，返回 (date, seq, base, tileInfo)。"""
    for (y, m, d) in CANDIDATES:
        for seq in (0, 1):
            base = f'tiles/{TILE[0]}/{TILE[1]}/{TILE[2]}/{y}/{m}/{d}/{seq}'
            try:
                info = json.loads(http_get(f'{BUCKET}/{base}/tileInfo.json'))
            except Exception:
                continue
            cov = info.get('dataCoveragePercentage', 0)
            cld = info.get('cloudyPixelPercentage', 100)
            print(f'[probe] {y}-{m:02d}-{d:02d} seq={seq}: 覆盖 {cov:.1f}% 云 {cld:.2f}%')
            if cov >= MIN_DATA_COVERAGE and cld <= MAX_CLOUDY_PCT:
                print(f'[ok] 采用 tile: {y}-{m:02d}-{d:02d} seq={seq}')
                return (y, m, d, seq, base, info)
    raise RuntimeError('所有候选日期均不满足覆盖率/云量门槛')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(TMP, exist_ok=True)

    y, m, d, seq, base, info = find_tile()

    # 像素原点：tileGeometry 多边形外包（北向上，10m/px）
    coords = info['tileGeometry']['coordinates'][0]
    es = [c[0] for c in coords]
    ns = [c[1] for c in coords]
    origin_e, origin_n = min(es), max(ns)
    print(f'[info] tile 原点 E={origin_e} N={origin_n}')

    jp2_path = os.path.join(TMP, f'TCI_{y}{m:02d}{d:02d}.jp2')
    if not os.path.exists(jp2_path):
        url = f'{BUCKET}/{base}/R10m/TCI.jp2'
        print(f'[dl] 下载 TCI.jp2 (~150MB): {url}')
        http_get(url, dst=jp2_path, expect_min=10_000_000)
        print(f'[dl] 完成: {os.path.getsize(jp2_path) / 1e6:.1f}MB')
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
    out = os.path.join(OUT_DIR, 'ground.jpg')
    crop.save(out, quality=87, optimize=True)
    print(f'[ok] 写出 {out} ({os.path.getsize(out) / 1e6:.1f}MB, {crop.size})')

    preview = crop.resize((1000, 600), Image.LANCZOS)
    prev_path = os.path.join(OUT_DIR, 'ground_preview.jpg')
    preview.save(prev_path, quality=85)
    print(f'[ok] 预览 {prev_path}')


if __name__ == '__main__':
    sys.exit(main())
