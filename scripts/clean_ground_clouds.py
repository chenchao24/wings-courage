#!/usr/bin/env python3
"""
clean_ground_clouds.py — 卫星地面图云斑修复（一次性工具）

检测卫星图上的积云白斑（高亮度 + 低饱和 + 块状），用 OpenCV inpaint 从周围纹理重建。
云影（云旁的暗斑）不单独处理：小块暗斑视觉上近似水塘/林地，高空不可辨。

用法：python scripts/clean_ground_clouds.py [img/barbarossa/ground.jpg]
输出：原地覆盖（先备份到 _archive/precompress/），并写 *_cloudmask.png 供人工核对。
"""
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 云斑判定（局部对比法）：比 101×101 邻域均值亮 LOCAL_DV 以上且发白
# （实测云芯 S 13-25/V 200-225；亮田整体亮、局部对比≈0 不误伤）
V_MIN = 150      # 绝对亮度下限（兜底，防止暗区噪点）
S_MAX = 95       # 发白上限（局部对比已做主过滤，这里放宽收云边缘）
LOCAL_K = 201    # 局部均值核（≈2km，大于卷云条带宽度，防止宽条纹自我稀释对比度）
LOCAL_DV = 20    # 亮度超出局部均值的阈值（收薄雾状云边缘）
BLOB_MIN_AREA = 60      # px²（10m/px → 6000m²，约 77m 见方起步，滤掉白色屋顶/小路）
BLOB_MAX_AREA = 800000  # 成片积云簇也修（闭运算合并后面积大）
DILATE = 25      # 掩膜外扩像素，覆盖云边缘过渡带


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'img', 'barbarossa', 'ground.jpg')
    img = cv2.imread(path)
    assert img is not None, f'读不到 {path}'
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1].astype(np.int16), hsv[..., 2].astype(np.int16)

    # 局部对比检测：云 = 比周围亮得多且发白的像素。
    # 亮田整体都亮（局部对比≈0）不会被误伤；森林上的白云对比强烈被抓住。
    local_v = cv2.blur(v, (LOCAL_K, LOCAL_K))
    local_s = cv2.blur(s, (LOCAL_K, LOCAL_K))
    mask = (((v - local_v) > LOCAL_DV) & (v >= V_MIN) & (s <= S_MAX) & (s <= local_s + 30)).astype(np.uint8) * 255
    # 形态学闭运算连块、开运算去碎点
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)

    # 连通域过滤：只保留云斑大小的块
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    keep = np.zeros_like(mask)
    kept = 0
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if BLOB_MIN_AREA <= area <= BLOB_MAX_AREA:
            keep[labels == i] = 255
            kept += 1
    if kept:
        keep = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (DILATE, DILATE)))

    cloud_pct = np.count_nonzero(keep) / keep.size * 100
    print(f'云斑块 {kept} 个，掩膜覆盖 {cloud_pct:.2f}%')

    backup = os.path.join(ROOT, '_archive', 'precompress', 'img', 'barbarossa')
    os.makedirs(backup, exist_ok=True)
    base = os.path.basename(path)
    cv2.imwrite(os.path.join(backup, base + '.before_decloud.jpg'), img)
    cv2.imwrite(path.replace('.jpg', '_cloudmask.png'), keep)

    if kept == 0:
        print('无需修复')
        return
    out = transplant_fill(img, keep)
    cv2.imwrite(path, out, [cv2.IMWRITE_JPEG_QUALITY, 84])
    print(f'已修复并覆盖 {path}')


def transplant_fill(img, mask):
    """纹理移植填充：每个云斑用邻近同类地表（左/右/上/下平移取样）替换，
    边缘羽化混合；找不到干净源才回退 inpaint。比 Telea 大斑块涂抹更真实。"""
    out = img.copy()
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    H, W = mask.shape
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area == 0:
            continue
        blob = (labels[y:y+h, x:x+w] == i).astype(np.uint8)
        # 羽化 alpha：距离变换归一化
        alpha = cv2.distanceTransform(blob, cv2.DIST_L2, 5)
        if alpha.max() > 0:
            alpha = alpha / alpha.max()
        alpha = cv2.GaussianBlur(alpha, (0, 0), 3)[..., None]

        placed = False
        for dx, dy in [(-(w + 40), 0), (w + 40, 0), (0, -(h + 40)), (0, h + 40)]:
            sx, sy = x + dx, y + dy
            if sx < 0 or sy < 0 or sx + w > W or sy + h > H:
                continue
            src_region_mask = mask[sy:sy+h, sx:sx+w]
            if src_region_mask.any():
                continue   # 源区域本身有云，换方向
            src = img[sy:sy+h, sx:sx+w]
            dst = out[y:y+h, x:x+w]
            out[y:y+h, x:x+w] = (src.astype(np.float32) * alpha + dst.astype(np.float32) * (1 - alpha)).astype(np.uint8)
            placed = True
            break
        if not placed:
            # 四周都不干净：Telea 兜底
            out = cv2.inpaint(out, (blob * 255).astype(np.uint8), 5, cv2.INPAINT_TELEA) if False else \
                cv2.inpaint(out, np.pad(blob, ((y, H-y-h), (x, W-x-w))) .astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)
    return out


if __name__ == '__main__':
    main()
