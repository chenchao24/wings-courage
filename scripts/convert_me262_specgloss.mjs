/**
 * 一次性转换：me_262.glb 的 KHR_materials_pbrSpecularGlossiness（旧 spec-gloss 工作流）
 * 转换为标准 metallic-roughness（three.js GLTFLoader 新版已不再内置支持 spec-gloss，
 * 导致材质/贴图整体失效）。
 *
 * 原文件备份为 model/me_262_specgloss_backup.glb。
 *
 * 用法：node scripts/convert_me262_specgloss.mjs
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { metalRough } from '@gltf-transform/functions';
import { copyFileSync } from 'fs';

const SRC = 'model/me_262.glb';
const BAK = 'model/me_262_specgloss_backup.glb';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

console.log('读取', SRC);
const doc = await io.read(SRC);

const specGlossMats = doc.getRoot().listMaterials().length;
console.log(`材质数: ${specGlossMats}，执行 metalRough 转换...`);

await doc.transform(metalRough());

copyFileSync(SRC, BAK);
await io.write(SRC, doc);
console.log('完成。备份:', BAK);
