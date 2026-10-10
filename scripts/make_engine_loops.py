#!/usr/bin/env python3
"""
make_engine_loops.py — 引擎实录音频无缝循环烘焙

问题：原始 mp3 头部有 ~0.3s 静音，且尾部与头部波形相位/振幅不连续，
直接 loop 会在循环点产生明显截断咔哒声。

处理（每文件）：
  1. ffmpeg 解码为单声道 44.1kHz WAV
  2. 裁掉头部静音（RMS 阈值检测）
  3. 自相关找主周期（引擎低频嗡鸣），循环段长度取主周期整数倍（相位相干）
  4. 尾部与头部交叉淡化 ~80ms（消除残余振幅差），产出无缝循环体
  5. 输出 WAV（不用 mp3：mp3 编码有 delay/padding 会再次破坏循环）

产出：sound/eg/<name>-loop.wav
用法：scripts/.venv-ground/Scripts/python scripts/make_engine_loops.py
"""

import os
import subprocess
import sys

import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = 'ffmpeg'
SR = 44100
FILES = ['bf109-eg', 'fw190-eg', 'me262-eg']
TMP = os.path.join(ROOT, 'scripts', '_eg_cache')

TARGET_LOOP_SEC = 3.0      # 目标循环段时长
XFADE_MS = 80              # 尾头交叉淡化时长
HEAD_RMS_RATIO = 0.08      # 头部静音判定阈值（相对稳态 RMS）


def decode(name):
    """mp3 → 单声道 float32 PCM"""
    src = os.path.join(ROOT, 'sound', 'eg', name + '.mp3')
    dst = os.path.join(TMP, name + '.wav')
    if not os.path.exists(dst):
        subprocess.run([FFMPEG, '-y', '-i', src, '-ac', '1', '-ar', str(SR), dst],
                       check=True, capture_output=True)
    data, sr = sf.read(dst, dtype='float32')
    return data, sr


def analyze_and_loop(name, data, sr):
    n = len(data)
    # ── 1. 头部静音检测：10ms 窗 RMS，首个超过阈值的位置 ──
    win = int(sr * 0.01)
    rms = np.sqrt(np.convolve(data ** 2, np.ones(win) / win, mode='same'))
    steady = float(np.percentile(rms[int(n * 0.3):int(n * 0.9)], 80))  # 稳态 RMS 参考
    thr = steady * HEAD_RMS_RATIO
    head_end = int(np.argmax(rms > thr))
    # 头部 0-0.6s 的 RMS 剖面（判断静音真实长度）
    prof = ' '.join(f'{t/1000:.2f}s:{rms[int(t/1000*sr)]/steady:.2f}'
                    for t in range(0, 600, 100))
    print(f'  时长 {n/sr:.2f}s | 稳态 RMS {steady:.4f} | 头部静音 {head_end/sr:.3f}s')
    print(f'  头部剖面: {prof}')

    body = data[head_end:]
    if len(body) < sr * 1.5:
        raise RuntimeError('裁头后剩余过短')

    # ── 2. 主周期（自相关，取 0.5s 稳态窗口，周期范围 3~60ms ≈ 17~330Hz） ──
    w0 = body[:int(sr * 0.5)] - np.mean(body[:int(sr * 0.5)])
    ac = np.correlate(w0, w0, mode='full')[len(w0) - 1:]
    ac /= ac[0] + 1e-12
    lo, hi = int(sr * 0.003), int(sr * 0.06)
    period = None
    for i in range(lo, hi):
        if ac[i] > 0.3 and ac[i] >= ac[i - 1] and ac[i] >= ac[i + 1]:
            period = i
            break
    if period is None:
        period = int(lo + np.argmax(ac[lo:hi]))
    print(f'  主周期 {period} samples = {period/sr*1000:.1f}ms ≈ {sr/period:.0f}Hz')

    # ── 3. 循环段：主周期整数倍，长度 ≈ TARGET_LOOP_SEC，材料多留 xf 供交叉淡化 ──
    xf = int(XFADE_MS / 1000 * sr)
    avail = len(body)
    target = min(int(TARGET_LOOP_SEC * sr), avail - xf - 1)
    cycles = max(1, round(target / period))
    L = cycles * period
    while L + xf > avail:
        cycles -= 1
        L = cycles * period
    material = body[:L + xf]
    print(f'  循环段 {L/sr:.2f}s = {cycles} 个周期 + {xf} samples 淡化料')

    # ── 4. 尾→头交叉淡化（等功率曲线；缝合点落在原始材料的相邻样本之间 → 严格连续）──
    out = np.empty(L, dtype=np.float32)
    out[:L - xf] = material[xf:L]                        # 主体（从头部 xf 后开始）
    t = (np.arange(xf) + 1) / xf
    out[L - xf:] = material[L:L + xf] * np.sqrt(1 - t) + material[:xf] * np.sqrt(t)
    # 缝合验证：out[L-1] ≈ material[xf-1]（淡化末端=纯头部材料），out[0] = material[xf]，
    # 两者是原始材料的相邻样本，循环严格连续
    seam = abs(float(out[-1]) - float(out[0]))
    print(f'  交叉淡化 {xf} samples ({XFADE_MS}ms)，缝合端点差 {seam:.5f}')

    # 归一化防爆音（保留原始响度比例，只做硬限幅）
    peak = float(np.max(np.abs(out)))
    if peak > 0.98:
        out *= 0.98 / peak

    out_path = os.path.join(ROOT, 'sound', 'eg', name + '-loop.wav')
    sf.write(out_path, out, sr, subtype='PCM_16')
    print(f'  [ok] {out_path} ({os.path.getsize(out_path)/1024:.0f}KB, {L/sr:.2f}s)')


def main():
    os.makedirs(TMP, exist_ok=True)
    for name in FILES:
        print(f'== {name} ==')
        data, sr = decode(name)
        analyze_and_loop(name, data, sr)


if __name__ == '__main__':
    sys.exit(main())
