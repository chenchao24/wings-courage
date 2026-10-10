# -*- coding: utf-8 -*-
"""柏林关出生态势图（俯视 XZ 平面）：玩家出生点/朝向、B-17 机群出生点与行进方向。
用法：scripts/.venv-ground/Scripts/python.exe tests/python/_berlin_spawn_map.py
输出：tests/screenshots/berlin_spawn_map.png"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1500, 1040
KM = 14.0          # px / km
CX, CY = W / 2, H / 2 + 20

def px(x_km, z_km):
    """世界坐标(km) → 像素。x+东(右)，z+北(上)。"""
    return (CX + x_km * KM, CY - z_km * KM)

img = Image.new("RGB", (W, H), (18, 24, 32))
d = ImageDraw.Draw(img, "RGBA")

F = "C:/Windows/Fonts/msyh.ttc"
def font(sz):
    return ImageFont.truetype(F, sz)
f_title, f_big, f_mid, f_small = font(34), font(24), font(19), font(16)

# ── 标题 ──
d.text((W / 2, 28), "第4关《柏林保卫战》出生态势（俯视）", fill=(230, 230, 230), font=f_title, anchor="mm")
d.text((W / 2, 66), "坐标系：x+ 东 / x- 西，z+ 北 / z- 南（网格间距 10km）", fill=(150, 150, 150), font=f_small, anchor="mm")

# ── 网格（10km）+ 轴刻度 ──
for gx in range(-40, 41, 10):
    x0, _ = px(gx, 0)
    d.line([(x0, px(0, -32)[1]), (x0, px(0, 32)[1])], fill=(255, 255, 255, 22), width=1)
    d.text((x0, CY + 32 * KM + 14), f"{gx:+d}", fill=(120, 120, 120), font=f_small, anchor="mm")
for gz in range(-30, 31, 10):
    _, y0 = px(0, gz)
    d.line([(px(-40, 0)[0], y0), (px(40, 0)[0], y0)], fill=(255, 255, 255, 22), width=1)
    d.text((CX - 40 * KM - 22, y0), f"{gz:+d}", fill=(120, 120, 120), font=f_small, anchor="mm")
d.text((W / 2, H - 24), "x (km) → 东", fill=(150, 150, 150), font=f_small, anchor="mm")
d.text((30, CY), "z (km) → 北", fill=(150, 150, 150), font=f_small, anchor="mm")

# ── 地图边界（卫星地面 80×64km）──
g0, g1 = px(-40, -32), px(40, 32)
d.rectangle([g0[0], g1[1], g1[0], g0[1]], fill=(38, 58, 40), outline=(90, 120, 90), width=2)
d.text((g0[0] + 10, g1[1] + 6), "卫星地面 80×64km（柏林市区在图外东缘 →）", fill=(140, 170, 140), font=f_small, anchor="la")

# ── Flak 交战走廊带 ──
flak = [px(x, z) for x, z in [(-30, -8), (15, -8), (15, 8), (-30, 8)]]
d.polygon(flak, fill=(255, 140, 40, 28), outline=(255, 140, 40, 120))
d.text(px(-7.5, -6.5), "Flak 防空走廊带（3000-6000m）", fill=(255, 170, 90), font=f_small, anchor="mm")

# ── B-17 航线（东→西，38km → -38km）──
r0, r1 = px(38, 0), px(-38, 0)
d.line([r0, r1], fill=(80, 160, 255, 200), width=4)
ax, ay = r1
d.polygon([(ax - 26, ay), (ax - 2, ay - 12), (ax - 2, ay + 12)], fill=(80, 160, 255))
d.text((px(6, 1.4)[0], px(6, 1.4)[1]), "B-17 航线：东缘 x=+38km → 西缘 x=-38km（巡航 5000m，50m/s）",
       fill=(120, 190, 255), font=f_mid, anchor="mm")

# ── B-17 机群位置（主图只给集群标记，细节见放大框）──
c_lead, c_tail = px(38, 0), px(40.5, 0)
d.ellipse([c_lead[0] - 6, c_lead[1] - 22, c_tail[0] + 6, c_tail[1] + 22], outline=(255, 90, 90), width=3)
d.text((c_lead[0] + 4, c_lead[1] - 40), "B-17 机群出生", fill=(255, 150, 150), font=f_mid, anchor="mb")

# ── 玩家出生点 ──
p0 = px(28, 0)
d.ellipse([p0[0] - 10, p0[1] - 10, p0[0] + 10, p0[1] + 10], fill=(120, 255, 120), outline=(220, 255, 220), width=2)
d.text((p0[0] - 6, p0[1] + 28), "玩家出生 x=+28km（4500m，Me 262）", fill=(160, 255, 160), font=f_mid, anchor="mm")

# 修正后朝向：朝东（绿实线箭头）
d.line([p0, (p0[0] + 84, p0[1])], fill=(120, 255, 120), width=5)
d.polygon([(p0[0] + 110, p0[1]), (p0[0] + 84, p0[1] - 11), (p0[0] + 84, p0[1] + 11)], fill=(120, 255, 120))
d.text((p0[0] + 58, p0[1] - 18), "修正后：朝东迎头", fill=(120, 255, 120), font=f_small, anchor="mm")

# 修正前朝向：朝西（红虚线箭头）
for t in range(0, 84, 12):
    d.line([(p0[0] - t, p0[1] + 50), (p0[0] - t - 7, p0[1] + 50)], fill=(255, 110, 110), width=4)
d.polygon([(p0[0] - 110, p0[1] + 50), (p0[0] - 84, p0[1] + 39), (p0[0] - 84, p0[1] + 61)], fill=(255, 110, 110))
d.text((p0[0] - 58, p0[1] + 72), "修正前：朝西 = 背对机群", fill=(255, 130, 130), font=f_small, anchor="mm")

# ── 距离标注 ──
d.line([px(28, 4.6), px(38, 4.6)], fill=(200, 200, 120), width=2)
for xx in (28, 38):
    d.line([px(xx, 4.3), px(xx, 4.9)], fill=(200, 200, 120), width=2)
d.text(px(33, 5.3), "≈10km", fill=(220, 220, 150), font=f_mid, anchor="mm")

# ── 放大框：机群编队细节（左上）──
ix0, iy0, iw, ih = 60, 100, 560, 420
d.rectangle([ix0, iy0, ix0 + iw, iy0 + ih], fill=(24, 32, 42, 240), outline=(120, 160, 200), width=2)
d.text((ix0 + iw / 2, iy0 + 24), "机群编队放大（4 小队 × V 字三机 = 12 架）", fill=(200, 210, 225), font=f_mid, anchor="mm")
# 放大区域：x 37.2..41.2km，z -2.2..+2.2km
ZX0, ZKM = 37.2, 62.0   # 原点 x(km)、px/km
def zx(x_km, z_km):
    return (ix0 + 20 + (x_km - ZX0) * ZKM, iy0 + 50 + (2.2 - z_km) * ZKM)
# 航线
zl0, zl1 = zx(41.2, 0), zx(37.2, 0)
d.line([zl0, zl1], fill=(80, 160, 255, 200), width=3)
d.polygon([(zl1[0] - 16, zl1[1]), (zl1[0] - 2, zl1[1] - 8), (zl1[0] - 2, zl1[1] + 8)], fill=(80, 160, 255))
d.text((zl1[0] + 4, zl1[1] + 22), "向西 →", fill=(120, 190, 255), font=f_small, anchor="la")
# 编队槽位
vics = [(0, 0, 0), (700, 150, 900), (1400, -150, -900), (2100, 50, 0)]
trail, wing = 0.38, 0.32
for i, (vx, valt, vz) in enumerate(vics):
    vx_km, vz_km = vx / 1000, vz / 1000
    slots = [(vx_km, vz_km, "长"), (vx_km + trail, vz_km - wing, "僚"), (vx_km + trail, vz_km + wing, "僚")]
    pts = [zx(38 + sx, sz) for sx, sz, _ in slots]
    d.ellipse([min(p[0] for p in pts) - 16, min(p[1] for p in pts) - 16,
               max(p[0] for p in pts) + 16, max(p[1] for p in pts) + 16], outline=(255, 120, 120, 90), width=2)
    for (sx, sz, role), p in zip(slots, pts):
        d.ellipse([p[0] - 8, p[1] - 8, p[0] + 8, p[1] + 8], fill=(255, 90, 90), outline=(255, 200, 200), width=2)
    lp = pts[0]
    d.text((lp[0], lp[1] - 20), f"{i+1}队", fill=(255, 170, 170), font=f_small, anchor="mb")
d.text((ix0 + iw / 2, iy0 + ih - 40), "小队高度：1队 ±0m / 2队 +150m / 3队 -150m / 4队 +50m",
       fill=(255, 170, 170), font=f_small, anchor="mm")
d.text((ix0 + iw / 2, iy0 + ih - 16), "小队内：长机在前，左右僚机后撤 380m、横距 ±320m、低 15m；小队纵距 700m",
       fill=(150, 160, 175), font=f_small, anchor="mm")
# 主图与放大框联动线
d.line([(c_lead[0], c_lead[1] - 22), (ix0 + iw, iy0 + ih / 2)], fill=(255, 120, 120, 100), width=2)

img.save("tests/screenshots/berlin_spawn_map.png")
print("saved: tests/screenshots/berlin_spawn_map.png")
