/**
 * 地面模型批量压缩优化脚本
 *
 * 优化步骤（管道式处理，无需中间文件）：
 *   1. dedup  — 去重网格/材质/纹理
 *   2. weld   — 合并共享顶点的重复顶点
 *   3. simplify — 网格简化（保留 60% 三角形，空中视角足够）
 *   4. quantize — 顶点量化（16-bit，文件体积减小）
 *   5. textureCompress — 纹理转 WebP（质量 0.75，大幅减小纹理体积）
 *
 * 用法：node scripts/optimize_models.mjs
 * 输出：model/ground_optimized/（保留目录结构）
 */
import { NodeIO, Logger, Verbosity } from '@gltf-transform/core';
import { dedup, weld, simplify, quantize, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, '..', 'model', 'ground');
const DST_ROOT = join(__dirname, '..', 'model', 'ground_optimized');

const WEBP_QUALITY = 0.75;
const SIMPLIFY_RATIO = 0.6;  // 保留60%三角形

const io = new NodeIO().setLogger(new Logger(Verbosity.ERROR));

async function optimizeFile(srcPath, dstPath) {
  const document = await io.read(srcPath);
  const srcSize = statSync(srcPath).size;

  await document.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, simplifierRatio: SIMPLIFY_RATIO }),
    quantize(),
    textureCompress({ targetFormat: 'webp', quality: WEBP_QUALITY }),
  );

  await io.write(dstPath, document);
  const dstSize = statSync(dstPath).size;
  const ratio = ((1 - dstSize / srcSize) * 100).toFixed(1);
  return { srcSize, dstSize, ratio };
}

function listGlbs(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listGlbs(full));
    } else if (entry.name.toLowerCase().endsWith('.glb')) {
      results.push(full);
    }
  }
  return results;
}

async function main() {
  console.log('=== 地面模型批量压缩优化 ===\n');
  console.log(`源目录: ${SRC_ROOT}`);
  console.log(`输出目录: ${DST_ROOT}`);
  console.log(`优化参数: simplify=${SIMPLIFY_RATIO} webp=${WEBP_QUALITY}\n`);

  const files = listGlbs(SRC_ROOT);
  console.log(`找到 ${files.length} 个 GLB 文件\n`);

  let totalSrc = 0, totalDst = 0;
  const results = [];

  for (let i = 0; i < files.length; i++) {
    const src = files[i];
    const rel = relative(SRC_ROOT, src);
    const dst = join(DST_ROOT, rel);
    const dstDir = dirname(dst);
    if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

    const srcKB = (statSync(src).size / 1024).toFixed(1);
    process.stdout.write(`[${i + 1}/${files.length}] ${rel} (${srcKB}KB) ... `);

    try {
      const { srcSize, dstSize, ratio } = await optimizeFile(src, dst);
      const dstKB = (dstSize / 1024).toFixed(1);
      totalSrc += srcSize;
      totalDst += dstSize;
      results.push({ rel, srcSize, dstSize, ratio });
      console.log(`${srcKB}KB → ${dstKB}KB (-${ratio}%)`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      results.push({ rel, srcSize: statSync(src).size, dstSize: 0, ratio: 'ERR', error: e.message });
    }
  }

  const totalRatio = ((1 - totalDst / totalSrc) * 100).toFixed(1);
  console.log(`\n=== 完成 ===`);
  console.log(`总计: ${(totalSrc / 1024 / 1024).toFixed(2)}MB → ${(totalDst / 1024 / 1024).toFixed(2)}MB (-${totalRatio}%)`);
  console.log(`输出: ${DST_ROOT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
