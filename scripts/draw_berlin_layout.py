# 第4关《柏林保卫战》开场初始占位图（t=0，过场前）
# 输出：docs/berlin_initial_layout.png（俯视图 x/z 等比 + 玩家编队放大 inset + 侧视图 x/y）
from pathlib import Path
import sys

sys.path.insert(0, str(Path(sys.executable).parent.parent.parent))
from daimon_runtime import setup_plot
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, FancyArrowPatch
import numpy as np

setup_plot()

# ═══════════ 数据（与 js/config/levels/level_04_berlin.js 一致）═══════════
# B-17：4 小队 × V 字三机；槽位相对 route[0]=(38000,5000,0)，僚机后撤 380 / 横距 ±320
VICS = [(0, 0, 0), (700, 150, 900), (1400, -150, -900), (2100, 50, 0)]
WING_LAT, TRAIL = 320, 380
b17 = []
for dx, dalt, lat in VICS:
    b17.append((38000 + dx, 5000 + dalt, lat))                       # 长机
    b17.append((38000 + dx + TRAIL, 5000 + dalt, lat - WING_LAT))    # 左僚
    b17.append((38000 + dx + TRAIL, 5000 + dalt, lat + WING_LAT))    # 右僚
b17 = np.array(b17)
center = b17.mean(axis=0)   # 编队质心 ≈ (39303, 5012, 0)

# P-51：槽位相对质心（fwd 沿航向：负=靠前=更西；lat 侧向；alt 高度差），僚机东偏 120m
P51_SLOTS = {'A1': (-350, -260, +400), 'A2': (-350, +260, +400),
             'B1': (+350, -260, -400), 'B2': (+350, +260, -400)}
p51 = {}                    # id -> [(x,y,z) 长机, 僚机]
for fid, (fwd, lat, alt) in P51_SLOTS.items():
    lead = (center[0] + fwd, center[1] + alt, center[2] + lat)
    p51[fid] = [lead, (lead[0] + 120, lead[1], lead[2] + 30)]

# 玩家 + 3 僚机（朝东；僚机槽位 body [x右→北, y上, z后→西]）
player = (21250, 6300, 0)
# (name, 后撤west_m, dy, 侧向north_m)：#2 左后(南) / #3 右后(北) / #4 右后远
wm262 = [('#2', 45, 0, -91), ('#3', 45, 0, 91), ('#4', 90, 15, 195)]

C_B17, C_P51A, C_P51B, C_PL = '#c0392b', '#2471a3', '#5dade2', '#1e8449'

# ═══════════ 绘图 ═══════════
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 11),
                               gridspec_kw={'height_ratios': [0.72, 1], 'hspace': 0.30})

# ---------- 面板 1：俯视图（x 东西 / z 南北，等比 → 触发圈为正圆）----------
ax1.set_title('俯视图（东 → 右，北 → 上；等比）', fontsize=13, pad=8)
ax1.scatter(b17[:, 0] / 1000, b17[:, 2] / 1000, marker='<', s=95, c=C_B17,
            zorder=5, label='B-17 机群 ×12（50 m/s 向西）')
for fid, pair in p51.items():
    pts = np.array(pair)
    col = C_P51A if fid.startswith('A') else C_P51B
    ax1.scatter(pts[:, 0] / 1000, pts[:, 2] / 1000, marker='<', s=70, c=col, zorder=6)
    # 标签错开：南侧小队（A1/B1）向下偏，北侧（A2/B2）向上偏，避免互叠
    off = (6, -16) if fid in ('A1', 'B1') else (6, 8)
    ax1.annotate(fid, (pair[0][0] / 1000, pair[0][2] / 1000),
                 textcoords='offset points', xytext=off, fontsize=10,
                 color=col, fontweight='bold')
ax1.scatter([], [], marker='<', s=70, c=C_P51A, label='P-51 A 中队（上方 +400 m，靠前）')
ax1.scatter([], [], marker='<', s=70, c=C_P51B, label='P-51 B 中队（下方 −400 m，靠后）')
ax1.scatter([player[0] / 1000], [player[2] / 1000], marker='>', s=150, c=C_PL,
            zorder=7, label='玩家小队（Me 262 ×4，150 m/s 向东；编队见放大图）')
# 质心十字（不标文字，避免与 P-51 标签互叠）
ax1.scatter([center[0] / 1000], [center[2] / 1000], marker='+', s=220, c=C_B17,
            linewidths=2.2, zorder=6)
# 触发圈（以最西 B-17 长机为参照；等比下为正圆）
trig = Circle((38.0, 0), 2.0, fill=False, ls='--', lw=1.6, ec='#8e44ad', zorder=4)
ax1.add_patch(trig)
ax1.annotate('首次拦截触发圈 R = 2 km\n（任一 B-17 ↔ 任一 262 最近距离）',
             (38.0, 2.2), ha='center', fontsize=9.5, color='#8e44ad')
# 距离标注：玩家 → 机群前缘
ax1.add_patch(FancyArrowPatch((21.25, -1.95), (38.0, -1.95), arrowstyle='<->',
                              mutation_scale=14, color='#555555', lw=1.2))
ax1.annotate('16.75 km（过场推进 2.25 km 后 ~14.5 km；接近率 200 m/s，约 59 s 后进入触发圈）',
             (29.6, -2.25), ha='center', fontsize=9.5, color='#444444')
ax1.set_xlim(19, 43)
ax1.set_ylim(-2.5, 2.7)
ax1.set_xlabel('x [km]')
ax1.set_ylabel('z [km]')
ax1.legend(loc='upper left', fontsize=9.5, framealpha=0.92)
ax1.grid(alpha=0.3)
ax1.set_aspect('equal', adjustable='box')

# ---------- inset：玩家小队指尖编队放大（m，玩家为原点；右=北，上=后/西）----------
axin = ax1.inset_axes([0.415, 0.22, 0.23, 0.52])
axin.set_title('玩家小队编队放大（m）', fontsize=9.5, pad=3)
axin.scatter([0], [0], marker='>', s=110, c=C_PL, zorder=6)
axin.annotate('玩家', (0, 0), textcoords='offset points', xytext=(8, 4),
              fontsize=9, color=C_PL, fontweight='bold')
for name, dxw, dy, dzn in wm262:
    axin.scatter([dzn], [dxw], marker='>', s=70, c=C_PL, alpha=0.65, zorder=6)
    axin.annotate(name, (dzn, dxw), textcoords='offset points', xytext=(8, -12),
                  fontsize=9, color=C_PL)
axin.set_xlabel('← 南      z [m]      北 →', fontsize=8)
axin.set_ylabel('后撤（西）[m]', fontsize=8)
axin.tick_params(labelsize=8)
axin.grid(alpha=0.3)
axin.set_aspect('equal', adjustable='box')

# ---------- 面板 2：侧视图（x / 高度 y）----------
ax2.set_title('侧视图（沿 x 轴看高度分布）', fontsize=13, pad=8)
ax2.scatter(b17[:, 0] / 1000, b17[:, 1], marker='<', s=95, c=C_B17, zorder=5,
            label='B-17 ×12（4850–5150 m 四层）')
for fid, pair in p51.items():
    pts = np.array(pair)
    col = C_P51A if fid.startswith('A') else C_P51B
    ax2.scatter(pts[:, 0] / 1000, pts[:, 1], marker='<', s=70, c=col, zorder=6)
    off = (6, -16) if fid in ('A1', 'B1') else (6, 8)
    ax2.annotate(fid, (pair[0][0] / 1000, pair[0][1]), textcoords='offset points',
                 xytext=off, fontsize=10, fontweight='bold', color=col)
ax2.scatter([], [], marker='<', s=70, c=C_P51A, label='P-51 A 中队 ≈ 5400 m')
ax2.scatter([], [], marker='<', s=70, c=C_P51B, label='P-51 B 中队 ≈ 4600 m')
ax2.scatter([player[0] / 1000], [player[1]], marker='>', s=150, c=C_PL, zorder=7,
            label='玩家小队 6300 m')
ax2.axhline(6500, ls='--', lw=1.4, color='#8e44ad')
ax2.annotate('拦截爬升目标 6500 m', (41.8, 6560), ha='right', fontsize=9.5,
             color='#8e44ad')
ax2.axhspan(3000, 7000, color='#f0c419', alpha=0.06)
ax2.annotate('交战高度带 [3000, 7000] m', (19.3, 3080), fontsize=9, color='#9a7d0a')
ax2.set_xlim(19, 43)
ax2.set_ylim(2900, 7300)
ax2.set_xlabel('x [km]')
ax2.set_ylabel('高度 [m]')
ax2.legend(loc='lower right', fontsize=9.5, framealpha=0.92)
ax2.grid(alpha=0.3)

fig.suptitle('第4关《柏林保卫战》双方初始占位（t = 0，开场过场前；玩家出生点已西移 3000 m）',
             fontsize=15, y=0.975)

out = Path(__file__).resolve().parent.parent / 'docs' / 'berlin_initial_layout.png'
fig.savefig(out, dpi=160, bbox_inches='tight')
print('saved:', out)
