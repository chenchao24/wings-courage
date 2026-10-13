#!/usr/bin/env python3
"""
fetch_barbarossa_ground.py — 第二关《巴巴罗萨之鹰》地面卫星贴图一次性获取管线

数据源：Sentinel-2 L2A（哥白尼开放数据，AWS 公开桶 sentinel-s2-l2a，匿名 HTTP 可取）
输出：img/barbarossa/ground.jpg（4000x3200，1 texel = 10m，覆盖 40km x 32km）
      img/barbarossa/ground_preview.jpg（快速检查用，确认后可删）

选址：白俄罗斯明斯克以西平原（史实：1941.06 中央集团军群主攻方向），
      大平原农田 + 零散村庄树林，平坦适合纯平贴图。
裁剪窗口（UTM 35N，单位米）：
  E 420000 ~ 460000（西→东 40km），N 5920000 ~ 5952000（南→北 32km）
  窗口完全位于 Sentinel-2 tile 35UMV 范围内，无需拼图。

依赖：Pillow（官方 wheel 自带 OpenJPEG，可解 JP2）。
用法：python scripts/fetch_barbarossa_ground.py
"""

import io
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'img', 'barbarossa')
TMP = os.path.join(ROOT, 'scripts', '_ground_cache')

BUCKET = 'https://sentinel-s2-l2a.s3.eu-central-1.amazonaws.com'
TILE = ('35', 'U', 'MV')

# 候选拍摄日期（5-8 月夏季植被；2023-06-18 优先——6.22 前初夏且窗口实测 0.00% 云斑）。
# 注意：本 tile 的 tileInfo dataCoveragePercentage/cloudyPixelPercentage 不可靠
# （2024-06-09 声称 100%/0% 实际仅 ~4% 有效；2023-06-05 标称 0% 云但窗口内有 0.61% 积云斑），
# 因此 find_tile() 在下载大文件前用 R60m/TCI.jp2（1830px 快视图）实测窗口有效像素与云斑比例。
CANDIDATES = [
    (2023, 7, 23),
    (2023, 7, 8),
    (2023, 8, 2),
    (2024, 7, 2),
    (2023, 6, 18),
    (2023, 6, 25),
    (2023, 7, 5),
    (2024, 5, 2),
    (2024, 5, 17),
]

# 质量门槛：R60m 快视图实测——窗口有效率 ≥95% 且云斑（高亮低饱和像素）≤0.5%
MIN_WINDOW_VALID_PCT = 95.0
MAX_WINDOW_CLOUD_PCT = 0.5

# 裁剪窗口（UTM 35N，米）：40km × 32km（宽高比 1.25，与柏林一致）
E_MIN, E_MAX = 420000, 460000    # 40 km
N_MIN, N_MAX = 5920000, 5952000  # 32 km

UA = {'User-Agent': 'courage-wings-level2-ground-fetch/1.0'}


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


def window_stats(base):
    """用 R60m 快视图（~1830px）实测目标窗口：(有效像素比例, 云斑比例)。
    云斑判定：高亮度且低饱和（白/亮灰积云）。白色 no-data 同时计入无效与云斑。"""
    import io
    from PIL import Image
    data = http_get(f'{BUCKET}/{base}/R60m/TCI.jp2', expect_min=10_000)
    pv = Image.open(io.BytesIO(data)).convert('RGB')
    sx, sy = pv.size[0] / 10980, pv.size[1] / 10980
    win = pv.crop((int((E_MIN - 399960) / 10 * sx), int((6000000 - N_MAX) / 10 * sy),
                   int((E_MAX - 399960) / 10 * sx), int((6000000 - N_MIN) / 10 * sy)))
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
    """按候选日期探测 tile：R60m 快视图实测窗口有效率与云斑（不信 tileInfo 自报值）。"""
    for (y, m, d) in CANDIDATES:
        for seq in (0, 1):
            base = f'tiles/{TILE[0]}/{TILE[1]}/{TILE[2]}/{y}/{m}/{d}/{seq}'
            try:
                info = json.loads(http_get(f'{BUCKET}/{base}/tileInfo.json'))
            except Exception:
                continue
            try:
                wpct, cpct = window_stats(base)
            except Exception:
                continue
            print(f'[probe] {y}-{m:02d}-{d:02d} seq={seq}: 窗口有效 {wpct:.0f}% 云斑 {cpct:.2f}%')
            if wpct >= MIN_WINDOW_VALID_PCT and cpct <= MAX_WINDOW_CLOUD_PCT:
                print(f'[ok] 采用 tile: {y}-{m:02d}-{d:02d} seq={seq}')
                return (y, m, d, seq, base, info)
    raise RuntimeError('所有候选日期均不满足窗口有效率/云斑门槛')


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

    jp2_path = os.path.join(TMP, f'TCI_35UMV_{y}{m:02d}{d:02d}.jp2')
    if not os.path.exists(jp2_path):
        url = f'{BUCKET}/{base}/R10m/TCI.jp2'
        print(f'[dl] 下载 TCI.jp2 (~150MB): {url}')
        # 乡村地区 JP2 压缩率高（柏林城市 TCI ~150MB，白俄罗斯乡村 ~10MB），下限放宽到 1MB，
        # 完整性由 PIL 解码 + tile 尺寸断言兜底
        http_get(url, dst=jp2_path, expect_min=1_000_000)
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
    crop.save(out, quality=84, optimize=True)
    print(f'[ok] 写出 {out} ({os.path.getsize(out) / 1e6:.1f}MB, {crop.size})')

    preview = crop.resize((1000, 800), Image.LANCZOS)
    prev_path = os.path.join(OUT_DIR, 'ground_preview.jpg')
    preview.save(prev_path, quality=85)
    print(f'[ok] 预览 {prev_path}')


if __name__ == '__main__':
    sys.exit(main())
