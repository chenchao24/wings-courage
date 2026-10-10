# 优化清单（2026-08-20 重新审计，截至 CHANGELOG #78）

按收益排序的性能优化项。状态栏：⬜ 未做 / 🔧 进行中 / ✅ 已完成。

---

## 已完成 ✅

### 1. glTF 缓存 + 克隆复用 ✅（#32，2026-08-06）
- `aircraft.js` 模块级 `_gltfCache` Map（url → gltf 模板），首加载后 `SkeletonUtils.clone()` 克隆复用
- 消除同模型重复加载（4 架敌机：4 次网络 → 1 次网络 + 3 次克隆）
- 详见 `docs/glTF缓存克隆与战斗对话系统文档.md` 第一章

### 2. 材质深拷贝修复透明 Bug ✅（#33，2026-08-06）
- `SkeletonUtils.clone()` 共享材质引用，`_setupPropPivot()` 改桨叶 opacity 传播到所有克隆体
- 修复：`cloneGltfScene()` 后逐 mesh `material.clone()` 断开引用
- 详见 `docs/glTF缓存克隆与战斗对话系统文档.md` 第二章

### 3. B-17 网格合并 ✅（#63，2026-08-14）
- 管线 `scripts/optimize_b17.mjs`：`model/b17.original.glb` → `model/b17.glb`
- 116 → 26 mesh/架，近距 draw call 2398 → 768
- ⚠️ `helice03_FACES01-FACES` 不能删（`_setupPropPivot` 算 pivot 包围盒）；4 个桨叶组节点名是 pivot 旋转查找键
- ⚠️ 重跑管线前不要删 `b17.original.glb` 备份

### 4. P-51 网格合并 ✅（#74，2026-08-18）
- 管线 `scripts/optimize_p51.mjs`：`model/p51.original.glb` → `model/p51.glb`
- 32 → 9 draw call/架（8 架 256 → 72，-72%）；节点 128 → 9；材质 32 → 9；文件 530KB → 435KB
- 19 纯色件顶点色烘焙合并 / 6 贴图件按纹理分组 / 4 半透明件 vec4 顶点色合并 / 座舱盖独立成组
- 全部不透明材质 doubleSided → FrontSide（光栅化成本减半）
- ⚠️ 回退：`model/p51.original.glb` 复制回 `model/p51.glb`

### 5. 僚机尾迹去带状改粒子 ✅（#73，2026-08-18）
- 弃用 VaporTrail 带状，新建 `js/game/WingmanJetTrail.js`（玩家 JetExhaust 简化版）
- 一架飞机左右喷口共 1 个 `THREE.Points`（自定义 shader 软圆斑）= **每架仅 1 次 draw call**
- 比 sprite 球链省几百 draw call

---

## 待优化 ⬜

### 6. InstancedMesh 方案（同屏架次 30+ 评估）⬜
**问题**：柏林关同屏 B-17×N + P-51×8 + 僚机 262×3 + 玩家已接近上限，更多架次时 draw call 与状态切换成瓶颈

**方案**：对同模型同材质的飞机用 `THREE.InstancedMesh`，每实例 per-instance matrix + color

**注意**：
- 飞机有动画（螺旋桨旋转 / 控制面偏转 / 起落架），InstancedMesh 不支持骨骼动画，需把动态部分拆出单独 mesh
- 炮塔/桨叶等独立旋转部件不能 InstancedMesh
- 优先评估 B-17（数量最多、网格已合并静态部分占比高）

**触发条件**：试玩确认同屏架次稳定 30+ 且帧率掉

### 7. 库尔斯克地面物件 InstancedMesh 池化 ⬜
**来源**：`docs/库尔斯克/交接文档_库尔斯克关卡.md` P2

**问题**：同型号坦克多实例（T-34 / Pz III 等）逐个 mesh，draw call 线性增长

**方案**：同型号坦克用 InstancedMesh，涂装纹理共享（german/soviet/wreck 各一张 CanvasTexture）

**前置**：`js/kurskGroundObjects.js` 模块尚未实现（交接文档 P1 待实现）

### 8. 残骸模型合批 ⬜
**来源**：`docs/库尔斯克/交接文档_库尔斯克关卡.md` P2

**问题**：主战场分散残骸数量大，逐个 draw call

**方案**：静态残骸几何合并为少量大 mesh（按涂装分组）

### 9. 弹坑用纹理代替几何体 ⬜
**来源**：`docs/库尔斯克/交接文档_库尔斯克关卡.md` P2

**问题**：被炮击区域密集弹坑，若用几何体每个弹坑多顶点

**方案**：弹坑烘焙到地面纹理 decal，或用单 quad + 弹坑纹理 sprite

---

## 历史审计参考
- 2026-08-06 首次审计（本文件原版，仅列 glTF 缓存一项，现已完成）
