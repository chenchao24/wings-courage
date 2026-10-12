/**
 * 校验 GLB 可解析 + 结构完整（支持 EXT_meshopt_compression / EXT_texture_webp）。
 * 用法:
 *   node scripts/verify_glb.mjs <file.glb>                 # 仅验证可解析，打印统计
 *   node scripts/verify_glb.mjs <file.glb> --compare <ref.glb>  # 额外校验 ref 中所有节点名在 file 中仍存在
 * 退出码非 0 即失败。
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const file = args[0];
const cmpIdx = args.indexOf('--compare');
const ref = cmpIdx >= 0 ? args[cmpIdx + 1] : null;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

function collectNodeNames(doc) {
  const names = new Set();
  for (const node of doc.getRoot().listNodes()) names.add(node.getName());
  return names;
}

async function stat(f) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  return { doc, nodes: collectNodeNames(doc), meshes: root.listMeshes().length, materials: root.listMaterials().length, textures: root.listTextures().length, anims: root.listAnimations().length, skins: root.listSkins().length, nodeCount: root.listNodes().length };
}

try {
  const s = await stat(file);
  console.log(`PARSE OK: ${file}`);
  console.log(`  nodes=${s.nodeCount} meshes=${s.meshes} materials=${s.materials} textures=${s.textures} anims=${s.anims} skins=${s.skins}`);
  if (ref) {
    const r = await stat(ref);
    const missing = [...r.nodes].filter((n) => !s.nodes.has(n));
    if (missing.length > 0) {
      console.error(`NODE MISSING (${missing.length}/${r.nodes.size}): ${missing.slice(0, 20).join(', ')}`);
      process.exit(2);
    }
    console.log(`NODE CHECK OK: all ${r.nodes.size} node names from reference preserved`);
  }
} catch (err) {
  console.error(`PARSE FAIL: ${file}: ${err.message}`);
  process.exit(1);
}
