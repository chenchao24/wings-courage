/**
 * B-17 机群渲染优化（第4关《柏林保卫战》专用，方案A：离线合并网格）
 *
 * 背景：model/b17.glb 有 116 个 mesh / 28 个材质，12 架编队同屏 → ~1392 个 draw call，
 * 玩家面向机群时掉帧严重。本脚本离线合并，把每架渲染 mesh 压到 ~材质数个。
 *
 * 管线（输入 model/b17.original.glb → 输出 model/b17.glb，可重复运行）：
 *   1. dedup(材质)      — 合并完全相同的材质，减少合并分组数
 *   2. 删除起落架节点    — 复刻运行时 hideGearNodes 行为（enemy.js MODEL_CONFIGS b17 条目），
 *                         注意【不删】helice03_FACES01-FACES（运行时 visible=false 隐藏，
 *                         但 _setupPropPivot 要用它的几何包围盒算桨毂 pivot，删了 pivot 变 NaN）
 *   3. 合并静态网格      — 除 4 个螺旋桨组（helice03_FACES01~04 子树，需独立旋转）外，
 *                         所有 mesh 节点按 (材质 × 属性签名) 分组，烘焙世界变换后合并
 *   4. FrontSide        — 不透明材质 doubleSided→false（光栅化减半）；
 *                         桨叶/玻璃/模糊盘保持双面（桨叶从背面可见、薄玻璃防破洞）
 *
 * 安全性：
 *   - tuner 标定点位（hitSpheres/muzzles/engines）全是 body frame 数值，不依赖节点树 → 不受影响
 *   - 控制面检测正则（/^AileronL|Elevators/）匹配不到 b17 任何节点 → 不受影响
 *   - _hideLandingGear 按名匹配、找不到就跳过 → 已删除的节点名不会报错
 *   - 负行列式（镜像）节点合并时翻转三角形绕序，保证 FrontSide 下不翻面
 *
 * 回退：git checkout model/b17.glb 或 把 model/b17.original.glb 复制回 model/b17.glb
 *
 * 用法：node scripts/optimize_b17.mjs
 */
import { NodeIO, Logger, Verbosity, PropertyType } from '@gltf-transform/core';
import { dedup, prune } from '@gltf-transform/functions';
import { statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'model', 'b17.original.glb');
const DST = join(__dirname, '..', 'model', 'b17.glb');

// ── 删除清单（glTF 节点名；对应 enemy.js hideGearNodes 的运行时名映射） ──
//   'Object13-FACES_1' → 节点 'Object13-FACES'（mesh 定义名==节点名，three GLTFLoader 去重后加 _1）
//   其余不带 _1 的为同名 group 子树
const DELETE_NODES = [
  'Object02', 'Object03', 'Object35', 'rueda01_FACES02',
  'Object13-FACES', 'Object19-FACES', 'Object27-FACES',
  'rueda01_FACES01-FACES', 'ruedaatras_FACES01-FACES',
];
// 螺旋桨组（子树整体保护，不参与合并/删除；运行时按名查找做 pivot 旋转）
const PROP_ROOTS = ['helice03_FACES01', 'helice03_FACES02', 'helice03_FACES03', 'helice03_FACES04'];

// ── 4x4 / 3x3 矩阵小工具（glTF 列主序） ──
function mat3NormalFromMat4(m) {
  // 法线矩阵 = 上 3x3 的逆转置
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = 1 / det;
  // inverse
  const r00 = A * inv, r01 = (c * h - b * i) * inv, r02 = (b * f - c * e) * inv;
  const r10 = B * inv, r11 = (a * i - c * g) * inv, r12 = (c * d - a * f) * inv;
  const r20 = C * inv, r21 = (b * g - a * h) * inv, r22 = (a * e - b * d) * inv;
  // transpose → 法线矩阵
  return [r00, r10, r20, r01, r11, r21, r02, r12, r22];
}
function det3(m) {
  return m[0] * (m[5] * m[10] - m[6] * m[9])
       - m[4] * (m[1] * m[10] - m[2] * m[9])
       + m[8] * (m[1] * m[6] - m[2] * m[5]);
}
function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}
function transformVec(n, x, y, z) {
  return [
    n[0] * x + n[3] * y + n[6] * z,
    n[1] * x + n[4] * y + n[7] * z,
    n[2] * x + n[5] * y + n[8] * z,
  ];
}

function disposeSubtree(node) {
  for (const child of [...node.listChildren()]) disposeSubtree(child);
  node.dispose();
}

async function main() {
  const io = new NodeIO().setLogger(new Logger(Verbosity.ERROR));
  const doc = await io.read(SRC);
  const root = doc.getRoot();
  const scene = root.getDefaultScene();
  const buffer = root.listBuffers()[0];

  const before = { meshes: root.listMeshes().length, nodes: root.listNodes().length };

  // 1. 材质去重（完全相同的材质合并 → 后续合并分组更少）
  await doc.transform(dedup({ propertyTypes: [PropertyType.MATERIAL] }));

  // 2. 删除起落架节点（复刻 hideGearNodes；螺旋桨 helice03_FACES01-FACES 保留）
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  let deleted = 0;
  for (const name of DELETE_NODES) {
    const node = byName.get(name);
    if (!node) { console.warn(`  ! 节点不存在，跳过删除: ${name}`); continue; }
    disposeSubtree(node);
    deleted++;
  }

  // 3. 收集合并候选：有 mesh 且不在螺旋桨子树内
  const propSet = new Set(PROP_ROOTS);
  const inPropSubtree = (node) => {
    for (const p of node.listParents()) {
      if (p.propertyType !== 'Node') continue;
      if (propSet.has(p.getName())) return true;
      // 父级的父级递归检查
      if (inPropSubtree(p)) return true;
    }
    return false;
  };
  const candidates = root.listNodes().filter((n) => n.getMesh() && !inPropSubtree(n));

  // 按 (材质 × 属性签名) 分组
  const groups = new Map();
  for (const node of candidates) {
    const mesh = node.getMesh();
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const matKey = mat ? root.listMaterials().indexOf(mat) : -1;
      const sig = prim.listSemantics().sort().join(',') + '|idx:' + (prim.getIndices() ? 1 : 0);
      const key = matKey + '|' + sig;
      if (!groups.has(key)) groups.set(key, { material: mat, semantics: prim.listSemantics(), items: [] });
      groups.get(key).items.push({ prim, world: node.getWorldMatrix() });
    }
  }

  // 4. 逐组烘焙世界变换并合并
  let mergedTris = 0;
  let groupIdx = 0;
  const groupStats = [];
  for (const { material, semantics, items } of groups.values()) {
    // 统计总顶点/总索引
    let totalVerts = 0, totalIdx = 0;
    for (const { prim } of items) {
      totalVerts += prim.getAttribute('POSITION').getCount();
      totalIdx += prim.getIndices() ? prim.getIndices().getCount() : 0;
    }

    // 合并各属性
    const merged = {};
    for (const sem of semantics) {
      const sample = items[0].prim.getAttribute(sem);
      const elSize = sample.getElementSize();
      const out = new Float32Array(totalVerts * elSize);
      let vOff = 0;
      for (const { prim, world } of items) {
        const acc = prim.getAttribute(sem);
        const arr = acc.getArray();
        const n = acc.getCount();
        if (sem === 'POSITION') {
          for (let i = 0; i < n; i++) {
            const [x, y, z] = transformPoint(world, arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
            out[(vOff + i) * 3] = x; out[(vOff + i) * 3 + 1] = y; out[(vOff + i) * 3 + 2] = z;
          }
        } else if (sem === 'NORMAL') {
          const nMat = mat3NormalFromMat4(world);
          for (let i = 0; i < n; i++) {
            let [x, y, z] = transformVec(nMat, arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
            const len = Math.hypot(x, y, z) || 1;
            out[(vOff + i) * 3] = x / len; out[(vOff + i) * 3 + 1] = y / len; out[(vOff + i) * 3 + 2] = z / len;
          }
        } else if (sem === 'TANGENT') {
          const nMat = mat3NormalFromMat4(world);
          for (let i = 0; i < n; i++) {
            let [x, y, z] = transformVec(nMat, arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2]);
            const len = Math.hypot(x, y, z) || 1;
            out[(vOff + i) * 4] = x / len; out[(vOff + i) * 4 + 1] = y / len; out[(vOff + i) * 4 + 2] = z / len;
            out[(vOff + i) * 4 + 3] = arr[i * 4 + 3]; // w 分量原样保留
          }
        } else {
          // TEXCOORD/COLOR 等不受变换影响，直接拷贝
          out.set(arr.subarray(0, n * elSize), vOff * elSize);
        }
        vOff += n;
      }
      merged[sem] = out;
    }

    // 合并索引（带顶点偏移；负行列式镜像节点翻转绕序）
    let indices = null;
    if (totalIdx > 0) {
      const IdxArray = totalVerts > 65535 ? Uint32Array : Uint16Array;
      indices = new IdxArray(totalIdx);
      let iOff = 0, vOff = 0;
      for (const { prim, world } of items) {
        const idx = prim.getIndices().getArray();
        const nVerts = prim.getAttribute('POSITION').getCount();
        const flip = det3(world) < 0;
        if (flip) {
          for (let t = 0; t < idx.length; t += 3) {
            indices[iOff + t] = idx[t] + vOff;
            indices[iOff + t + 1] = idx[t + 2] + vOff;
            indices[iOff + t + 2] = idx[t + 1] + vOff;
          }
        } else {
          for (let t = 0; t < idx.length; t++) indices[iOff + t] = idx[t] + vOff;
        }
        iOff += idx.length;
        vOff += nVerts;
      }
    }

    // 写回 Document
    const newPrim = doc.createPrimitive().setMaterial(material);
    for (const sem of semantics) {
      const type = items[0].prim.getAttribute(sem).getType();
      const acc = doc.createAccessor().setType(type).setArray(merged[sem]).setBuffer(buffer);
      newPrim.setAttribute(sem, acc);
    }
    if (indices) {
      const idxAcc = doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer);
      newPrim.setIndices(idxAcc);
    }
    const mesh = doc.createMesh(`b17_merged_${groupIdx}`);
    mesh.addPrimitive(newPrim);
    const node = doc.createNode(`b17_merged_${groupIdx}`).setMesh(mesh);
    scene.addChild(node);
    mergedTris += (totalIdx > 0 ? totalIdx : totalVerts) / 3;
    groupStats.push(`    [${String(groupIdx).padStart(2)}] ${material ? material.getName() : '(无材质)'}: ${items.length} 部件 → 1 draw call`);
    groupIdx++;
  }

  // 5. 删除被合并的原始节点
  for (const node of candidates) disposeSubtree(node);

  // 6. 不透明材质 doubleSided→false（桨叶/玻璃/模糊盘保持双面防破洞）
  let frontCount = 0;
  for (const mat of root.listMaterials()) {
    const name = mat.getName() || '';
    const isBlend = mat.getAlphaMode() === 'BLEND';
    const isProp = /^helice/i.test(name);
    if (!isBlend && !isProp && mat.getDoubleSided()) {
      mat.setDoubleSided(false);
      frontCount++;
    }
  }

  // 7. 清理孤儿 mesh/accessor/纹理
  await doc.transform(prune());

  await io.write(DST, doc);

  const after = { meshes: root.listMeshes().length, nodes: root.listNodes().length };
  console.log('=== B-17 机群网格合并 ===');
  console.log(`输入: ${SRC}`);
  console.log(`输出: ${DST}`);
  console.log(`删除起落架节点: ${deleted}/${DELETE_NODES.length}`);
  console.log(`mesh: ${before.meshes} → ${after.meshes}（合并组 ${groupIdx} + 螺旋桨保留 4）`);
  console.log(`节点: ${before.nodes} → ${after.nodes}`);
  console.log(`合并三角面: ${Math.round(mergedTris)}`);
  console.log(`FrontSide 材质: ${frontCount} 个（桨叶/玻璃/模糊盘保持双面）`);
  console.log('合并分组:');
  console.log(groupStats.join('\n'));
  const srcKB = (statSync(SRC).size / 1024).toFixed(0);
  const dstKB = (statSync(DST).size / 1024).toFixed(0);
  console.log(`文件: ${srcKB}KB → ${dstKB}KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
