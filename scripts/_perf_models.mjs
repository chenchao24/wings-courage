// 临时：对比多架机模型的渲染开销指标（mesh/材质/三角面/纹理/文件大小）
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { promises as fs } from 'fs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  let tris = 0, prims = 0;
  for (const mesh of root.listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      prims++;
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      tris += Math.round((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
    }
  }
  const texBytes = root.listTextures().reduce((s, t) => s + (t.getImage()?.byteLength || 0), 0);
  const stat = await fs.stat(file);
  console.log(`${file}`);
  console.log(`  文件 ${(stat.size / 1048576).toFixed(2)}MB | mesh ${root.listMeshes().length} | prim ${prims} | 材质 ${root.listMaterials().length} | 纹理 ${root.listTextures().length}（内嵌 ${(texBytes / 1048576).toFixed(2)}MB）| 三角面 ${(tris / 1000).toFixed(1)}k`);
  console.log(`  估算 draw call/架 ≈ prim 数 ${prims}（双面材质另算）`);
}
