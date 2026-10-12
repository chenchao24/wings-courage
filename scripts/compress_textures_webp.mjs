/**
 * GLB 内嵌纹理压缩：等比缩到 ≤1024（不放大）+ 转 webp(quality 82, EXT_texture_webp)。
 * 等价于 `gltf-transform resize --width 1024 --height 1024` + `gltf-transform webp`
 * （fitWithin 语义：保持宽高比、小图不放大），绕开 CLI textureCompress 在本机 sharp/libvips 的崩溃。
 * 用法: node scripts/compress_textures_webp.mjs <in.glb> <out.glb> [--keep-format]
 *   --keep-format: 只 resize，不重编码为 webp（webp 步骤失败时的降级）
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [file, out] = process.argv.slice(2);
const keepFormat = process.argv.includes('--keep-format');

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(file);
const root = doc.getRoot();
let converted = 0, skipped = 0;
for (const texture of root.listTextures()) {
  const src = texture.getImage();
  const mime = texture.getMimeType();
  if (mime === 'image/webp') { skipped++; continue; }
  const toWebp = !keepFormat;
  try {
    let pipe = sharp(Buffer.from(src), { limitInputPixels: 1e9 })
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true });
    pipe = toWebp ? pipe.webp({ quality: 82 }) : pipe.toFormat(mime === 'image/png' ? 'png' : 'jpeg', { quality: 82 });
    const dst = await pipe.toBuffer();
    texture.setImage(new Uint8Array(dst));
    if (toWebp) {
      texture.setMimeType('image/webp');
      const uri = texture.getURI();
      if (uri) texture.setURI(uri.replace(/\.(png|jpe?g)$/i, '.webp'));
    }
    converted++;
    console.log(`  tex: ${mime} ${src.byteLength}B -> ${toWebp ? 'webp' : 're-enc'} ${dst.byteLength}B`);
  } catch (e) {
    skipped++;
    console.log(`  tex SKIP (${mime}): ${e.message.slice(0, 100)}`);
  }
}
if (!keepFormat) {
  const ext = doc.createExtension(EXTTextureWebP);
  if (root.listTextures().some((t) => t.getMimeType() === 'image/webp')) ext.setRequired(true);
  else ext.dispose();
}
await io.write(out, doc);
console.log(`WRITE OK: ${out} (converted=${converted} skipped=${skipped})`);
