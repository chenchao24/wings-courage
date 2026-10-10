/**
 * P-51 护航机群渲染优化（第4关护航编队准备，方案A：离线合并网格，复刻 optimize_b17.mjs 模式）
 *
 * 背景：model/p51.glb 有 32 mesh / 32 材质（每 prim 1 draw call），计划 6-8 架护航同屏
 * → 256 draw call。几何本身很轻（5097 v / 5330 tri），瓶颈在 draw call 与状态切换。
 * 本脚本离线合并到 9 draw call/架（8 架 = 72，-72%），且全部不透明材质转 FrontSide
 * （原 32 材质全 doubleSided=true，光栅化成本减半）。
 *
 * 管线（输入 model/p51.original.glb → 输出 model/p51.glb，可重复运行；首次运行自动备份）：
 *   0. 备份          — model/p51.original.glb 不存在时从 model/p51.glb 复制
 *   1. 分类快照       — dedup 前按 prim 记录分组（材质经 dedup 合并后名字可能变）
 *   2. dedup(材质)   — 合并完全相同材质（VIFS13/14 尾码贴图材质、4 个 0.07 灰件等）
 *   3. 分组合并       — 烘焙世界变换后按组写回：
 *       p51_solid       19 个纯色不透明部件 → 新 COLOR_0 = 原COLOR_0 × baseColorFactor
 *                       （本模型导出器把 factor 在 COLOR_0 里重复存了一份，最终色=factor²，
 *                        逐通道烘焙可逐位保真）；丢弃无用 TEXCOORD_0 → 1 draw call
 *       p51_tex_{i}     6 个贴图不透明部件按纹理分 5 组（机身/机翼/尾码×2/"351"机码/黑白条纹）
 *                       纹理承载涂装细节不可烘焙 → 原样拷贝 COLOR_0/TEXCOORD_0
 *       p51_translucent 4 个半透明小件（红 VIFS11/绿 VIFS12 翼尖航行灯 + VIFS21/27）
 *                       → COLOR_0(vec4) 烘焙 rgb+alpha，单 BLEND 材质 → 1 draw call
 *       p51_canopy      座舱盖 VIFS03 独立成组（近景透明排序安全，材质原样保留）
 *       p51_propdisc    双模糊盘 Cylinder15/16 同轴同位置合并为单节点（材质原样保留 tex0+BLEND）
 *                       未来要转桨：MODEL_CONFIGS p51 条目加 propNodes:['p51_propdisc'] 即可
 *   4. FrontSide     — 不透明材质 doubleSided→false；透明组/座舱盖/模糊盘保持双面
 *   5. prune + 校验  — 重读输出，打印分组/三角面/包围盒（须与原 bbox 一致）
 *
 * 运行时安全性（2026-08-18 已核查）：
 *   - autoOrient：PROP_KEYWORDS 匹配不到 P-51 任何节点名（VIFS 系/Cylinder 系）→ 用配置
 *     yawOffset=134 兜底；合并改名后行为不变
 *   - muzzleOffsets：body frame 数值，不依赖节点树 → 不受影响
 *   - propBranches：无 Prop_Set、无关键词匹配 → 今日即为静态模糊盘，合并后一致
 *   - 当前无关卡生成 P-51（level_04 仅有 p51Kill 记分字段）；model_tuner.html 仅按 URL 列出
 *   - 无代码引用 P-51 内部节点名（VIFS 系/Cylinder15/16 的既有引用均属其他机型）
 *   - 无镜像（负行列式）mesh 节点；绕序翻转逻辑仍保留作防御
 *
 * 回退：把 model/p51.original.glb 复制回 model/p51.glb（或 git checkout）
 *
 * 用法：node scripts/optimize_p51.mjs
 */
import { NodeIO, Logger, Verbosity, PropertyType } from '@gltf-transform/core';
import { dedup, prune } from '@gltf-transform/functions';
import { statSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'model', 'p51.original.glb');
const DST = join(__dirname, '..', 'model', 'p51.glb');

// ── 分组规则（按 dedup 前的原始材质名/属性分类） ──
const PROP_RE = /^Cylinder1[56]-FACES/;   // 机头双模糊盘（同轴同位，tex0，BLEND alpha 0.27）
const CANOPY_NAME = 'VIFS03-FACES';       // 座舱盖（BLEND alpha 0.55）

// ── 4x4 / 3x3 矩阵小工具（glTF 列主序，与 optimize_b17.mjs 相同） ──
function mat3NormalFromMat4(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = 1 / det;
  const r00 = A * inv, r01 = (c * h - b * i) * inv, r02 = (b * f - c * e) * inv;
  const r10 = B * inv, r11 = (a * i - c * g) * inv, r12 = (c * d - a * f) * inv;
  const r20 = C * inv, r21 = (b * g - a * h) * inv, r22 = (a * e - b * d) * inv;
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
  // 0. 首次运行：备份原始模型
  if (!existsSync(SRC)) {
    copyFileSync(DST, SRC);
    console.log(`首次运行，已备份: ${DST} → ${SRC}`);
  }

  const io = new NodeIO().setLogger(new Logger(Verbosity.ERROR));
  const doc = await io.read(SRC);
  const root = doc.getRoot();
  const scene = root.getDefaultScene();
  const buffer = root.listBuffers()[0];

  const before = { meshes: root.listMeshes().length, nodes: root.listNodes().length, materials: root.listMaterials().length };

  // 1. dedup 前快照：prim → 分组类别（dedup 合并材质后名字可能归并到任一副本）
  const catOf = new WeakMap();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const name = mat ? mat.getName() : '';
      let cat;
      if (PROP_RE.test(name)) cat = 'prop';
      else if (name === CANOPY_NAME) cat = 'canopy';
      else if (mat && mat.getAlphaMode() === 'BLEND') cat = 'translucent';
      else if (mat && mat.getBaseColorTexture()) cat = 'tex';
      else cat = 'solid';
      catOf.set(prim, cat);
    }
  }

  // 2. 材质去重（VIFS13/14、Cylinder15/16、4 个 0.07 灰件等归并）
  await doc.transform(dedup({ propertyTypes: [PropertyType.MATERIAL] }));

  // 3. 收集全部 mesh 节点，按组归集 prim（连同节点世界矩阵）
  const groups = new Map(); // key → { cat, material, items:[{prim, world, c0factor}] }
  const texturedKeys = new Map(); // texture → groupKey（tex 组按纹理再细分）
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const cat = catOf.get(prim);
      const mat = prim.getMaterial(); // dedup 后的材质
      let key;
      if (cat === 'tex') {
        const tex = mat.getBaseColorTexture();
        if (!texturedKeys.has(tex)) texturedKeys.set(tex, `tex_${texturedKeys.size}`);
        key = texturedKeys.get(tex);
      } else {
        key = cat; // 'solid' | 'translucent' | 'canopy' | 'prop'
      }
      if (!groups.has(key)) groups.set(key, { cat, material: mat, items: [] });
      groups.get(key).items.push({ prim, world });
    }
  }

  // 4. 逐组烘焙世界变换并合并
  const groupStats = [];
  let totalDrawCalls = 0;
  for (const [key, { cat, material, items }] of groups.entries()) {
    let totalVerts = 0, totalIdx = 0;
    for (const { prim } of items) {
      totalVerts += prim.getAttribute('POSITION').getCount();
      totalIdx += prim.getIndices() ? prim.getIndices().getCount() : 0;
    }

    // 属性计划：solid/translucent 丢弃 TEXCOORD_0、重写 COLOR_0；其余原样携带
    const bakeColor = (cat === 'solid' || cat === 'translucent');
    const semWanted = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']);
    if (bakeColor) semWanted.delete('TEXCOORD_0');
    // 以首个 prim 为准确定实际存在的语义
    const avail = items[0].prim.listSemantics();
    const semantics = [...semWanted].filter((s) => avail.includes(s) || s === 'COLOR_0');

    const merged = {};
    for (const sem of semantics) {
      if (sem === 'COLOR_0') {
        // 统一输出 vec4：solid/translucent = 原COLOR_0 × baseColorFactor（逐通道，含 alpha）；
        // tex/canopy/prop = 原样拷贝（factor 白/材质原样保留，shader 结果不变）
        const out = new Float32Array(totalVerts * 4);
        let vOff = 0;
        for (const { prim } of items) {
          const acc = prim.getAttribute('COLOR_0');
          const arr = acc ? acc.getArray() : null;
          const es = acc ? acc.getElementSize() : 0;
          const n = prim.getAttribute('POSITION').getCount();
          const mat = prim.getMaterial();
          const matFactor = bakeColor && mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
          for (let i = 0; i < n; i++) {
            for (let k = 0; k < 4; k++) {
              const c = arr && k < es ? arr[i * es + k] : 1; // 缺失分量（如 vec3 的 alpha）补 1
              out[(vOff + i) * 4 + k] = c * matFactor[k];
            }
          }
          vOff += n;
        }
        merged.COLOR_0 = out;
        continue;
      }
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
        } else {
          // TEXCOORD_0 等不受变换影响，直接拷贝
          out.set(arr.subarray(0, n * elSize), vOff * elSize);
        }
        vOff += n;
      }
      merged[sem] = out;
    }

    // 合并索引（带顶点偏移；负行列式镜像节点翻转绕序——本模型实测无镜像，防御保留）
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

    // 组材质：solid/translucent 新建白底材质（颜色全在 COLOR_0）；tex/canopy/prop 沿用原材质
    let outMat = material;
    if (bakeColor) {
      outMat = doc.createMaterial(`p51_${key}`)
        .setBaseColorFactor([1, 1, 1, 1])
        .setMetallicFactor(0).setRoughnessFactor(0.6)
        .setDoubleSided(cat === 'translucent'); // 小透明件保持双面防破洞；solid 下面统一 FrontSide
      if (cat === 'translucent') outMat.setAlphaMode('BLEND');
    }

    const newPrim = doc.createPrimitive().setMaterial(outMat);
    for (const sem of semantics) {
      const type = sem === 'COLOR_0' ? 'VEC4' : items[0].prim.getAttribute(sem).getType();
      const acc = doc.createAccessor().setType(type).setArray(merged[sem]).setBuffer(buffer);
      newPrim.setAttribute(sem, acc);
    }
    if (indices) {
      const idxAcc = doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer);
      newPrim.setIndices(idxAcc);
    }
    const nodeName = `p51_${key === 'prop' ? 'propdisc' : key === 'canopy' ? 'canopy' : key}`;
    const mesh = doc.createMesh(nodeName);
    mesh.addPrimitive(newPrim);
    const node = doc.createNode(nodeName).setMesh(mesh);
    scene.addChild(node);
    totalDrawCalls++;
    groupStats.push(`    ${nodeName.padEnd(18)} [${cat}] ${items.length} 部件 → 1 draw call（${Math.round((totalIdx > 0 ? totalIdx : totalVerts) / 3)} tri）`);
  }

  // 5. 删除被合并的原始 mesh 节点
  for (const node of root.listNodes()) {
    if (node.getMesh() && !/^p51_/.test(node.getName())) disposeSubtree(node);
  }

  // 6. 不透明材质 doubleSided→false（透明组/座舱盖/模糊盘保持双面）
  let frontCount = 0;
  for (const mat of root.listMaterials()) {
    if (mat.getAlphaMode() !== 'BLEND' && mat.getDoubleSided()) {
      mat.setDoubleSided(false);
      frontCount++;
    }
  }

  // 7. 清理孤儿 mesh/accessor/材质/空节点
  await doc.transform(prune());

  await io.write(DST, doc);

  // 8. 校验：重读输出，核对计数与包围盒
  const doc2 = await io.read(DST);
  const root2 = doc2.getRoot();
  const { getBounds } = await import('@gltf-transform/core');
  const b = getBounds(root2.listScenes()[0]);
  const after = { meshes: root2.listMeshes().length, nodes: root2.listNodes().length, materials: root2.listMaterials().length, textures: root2.listTextures().length };

  console.log('=== P-51 护航机群网格合并 ===');
  console.log(`输入: ${SRC}`);
  console.log(`输出: ${DST}`);
  console.log(`mesh: ${before.meshes} → ${after.meshes}`);
  console.log(`节点: ${before.nodes} → ${after.nodes}`);
  console.log(`材质: ${before.materials} → ${after.materials}（纹理剩 ${after.textures} 张）`);
  console.log(`每架 draw call: 32 → ${totalDrawCalls}（8 架: 256 → ${totalDrawCalls * 8}）`);
  console.log(`FrontSide 材质: ${frontCount} 个（透明件保持双面）`);
  console.log(`包围盒: min [${b.min.map((v) => v.toFixed(2))}] max [${b.max.map((v) => v.toFixed(2))}]（原 [-2.73,-1.07,-3.52] [3.17,0.82,2.46]）`);
  console.log('合并分组:');
  console.log(groupStats.join('\n'));
  const srcKB = (statSync(SRC).size / 1024).toFixed(0);
  const dstKB = (statSync(DST).size / 1024).toFixed(0);
  console.log(`文件: ${srcKB}KB → ${dstKB}KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
