/**
 * 临时：检查 GLB 模型结构（节点树/材质/纹理/尺寸），用于 Me 262 校准调试。
 * 用法：node scripts/inspect_glb.mjs model/me_262.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/core';
const bounds = getBounds;

const file = process.argv[2];
const io = new NodeIO();
const doc = await io.read(file);
const root = doc.getRoot();

console.log('=== 文件:', file);
console.log('meshes:', root.listMeshes().length, ' materials:', root.listMaterials().length, ' textures:', root.listTextures().length);

console.log('\n=== 纹理 ===');
for (const t of root.listTextures()) {
  console.log(` - ${t.getName() || t.getURI() || '(embedded)'} ${t.getMimeType()} ${t.getImage() ? t.getImage().byteLength + 'B' : 'NO DATA'}`);
}

console.log('\n=== 材质 ===');
for (const m of root.listMaterials()) {
  const bc = m.getBaseColorTexture();
  console.log(` - ${m.getName()} baseColorTex=${bc ? 'YES' : 'no'} baseColorFactor=${JSON.stringify(m.getBaseColorFactor().map(v => +v.toFixed(2)))} metallic=${m.getMetallicFactor().toFixed(2)} rough=${m.getRoughnessFactor().toFixed(2)} doubleSided=${m.getDoubleSided()} alphaMode=${m.getAlphaMode()}`);
}

console.log('\n=== 节点树（含 mesh 尺寸） ===');
const scene = root.listScenes()[0];
function walk(node, depth) {
  const mesh = node.getMesh();
  let info = '';
  if (mesh) {
    const b = bounds(node);
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map(v => +v.toFixed(2));
    const prims = mesh.listPrimitives();
    const mats = prims.map(p => p.getMaterial() ? p.getMaterial().getName() : 'null').join(',');
    info = ` | mesh size=[${size}] mats=[${mats}] prims=${prims.length}`;
  }
  const t = node.getTranslation().map(v => +v.toFixed(2));
  console.log(`${'  '.repeat(depth)}${node.getName()} t=${JSON.stringify(t)}${info}`);
  for (const c of node.listChildren()) walk(c, depth + 1);
}
for (const n of scene.listChildren()) walk(n, 0);

console.log('\n=== 整体包围盒 ===');
const b = bounds(scene);
console.log('min', b.min.map(v => +v.toFixed(2)), 'max', b.max.map(v => +v.toFixed(2)));

console.log('\n=== 动画 ===');
for (const a of root.listAnimations()) {
  console.log(` - ${a.getName()} channels=${a.listChannels().length}`);
}
console.log('\n=== 蒙皮 ===', root.listSkins().length);
