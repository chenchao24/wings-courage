// 静态服务器（5173 端口）：node _serve5173.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname;
const mime = {
  '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
};
http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  let p = path.join(root, u);
  fs.readFile(p, (e, d) => {
    if (e) { s.writeHead(404); s.end('404 ' + u); console.log('404', u); return; }
    const ext = path.extname(p).toLowerCase();
    s.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    s.end(d);
  });
}).listen(5173, '0.0.0.0', () => console.log('serving http://localhost:5173'));