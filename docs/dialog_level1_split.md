# 第1关《风云不列颠》分兵后对白脚本（v3 定稿）

> **状态**：已接入。splitChat 三段 + interceptChat 接敌序列 + victoryChat 胜利序列均已写入 `level_01_britain.js`。
>
> **时间窗口**：分兵演出 t=96s 开始，farewell 告别约 t=116s 播完，接敌（triggerZ 物理触发）约 t=244s。空白约 128 秒，splitChat 脚本填充约 110s，段间留静默。
>
> **风格**：二战德国空军职业军人无线电通话，简洁、战术化，不加情感戏份。仅聚焦在场三人：玩家长机、僚机、轰炸机一队长。哈通/Adler 分兵后已驶离，不再参与。
>
> **播放机制**：splitChat 由 CinematicSystem 时间轴 phase 节点驱动（逐句定时播放）；interceptChat / victoryChat 由 GameRuntime 对话队列 `_updateDialogQueue` 逐句按时长播放（非时间轴，事件触发）。

---

## 角色表

| speaker | role（职位标注） | avatar | 身份 |
|---|---|---|---|
| Falke-1 | 长机·你 | player | 玩家，Falke 小队长机 |
| Falke-2 | 僚机 | radio | 玩家僚机 |
| 多林 | 轰炸机一队长 | commander | 多林组3架Ju-88长机，主攻机场 |

---

## 对白内容（分3段，段间静默）

### 第1段 · t≈120s（态势确认 + 护航分工）
> 场景：分兵完成，编队重组，确认双机掩护三机轰炸机的分工。

| # | speaker | role | text | duration(ms) |
|---|---|---|---|---|
| 1 | Falke-2 | 僚机 | 长机，哈通组已脱离。现在双机掩护多林编队。 | 4500 |
| 2 | Falke-1 | 长机·你 | 收到。注意高度，英国佬经常自从高处来。 | 4500 |
| 3 | Falke-2 | 僚机 | 明白，六点钟归我。 | 3000 |
| 4 | 多林 | 轰炸机一队长 | Falke 小队，多林。编队保持 2100，三分钟后进入目标上空。 | 5000 |
| 5 | Falke-1 | 长机·你 | Falke-1 收到。在你左右。 | 3500 |

**本段时长**：约 20.5s。**段后静默**：约 18s。

---

### 第2段 · t≈159s（轰炸机-战斗机打配合）
> 场景：轰炸机队长与战斗机沟通突袭应对预案。轰炸机保持队形用交叉火力自卫，Ju88 自卫火力不俗；战斗机自由猎杀。

| # | speaker | role | text | duration(ms) |
|---|---|---|---|---|
| 6 | 多林 | 轰炸机一队长 | Falke，说一下预案。如果有英国佬出现，轰炸机保持队形不动，靠交叉火力自卫。Ju 88 的炮塔不是摆设。 | 6500 |
| 7 | Falke-1 | 长机·你 | 收到，Falke 自由猎杀！ | 3500 |
| 8 | 多林 | 轰炸机一队长 | 注意炮塔火力射界。 | 3000 |
| 9 | Falke-2 | 僚机 | 收到，伙计。 | 3000 |

**本段时长**：约 16s。**段后静默**：约 18s。

---

### 第3段 · t≈193s（能量俯冲战术 + 英国雷达）
> 场景：长机向僚机交代战法（B&Z 能量俯冲战术），僚机引出英国雷达与反应速度提升话题，长机补充情报部门简报，最后提醒油量速战速决。

| # | speaker | role | text | duration(ms) |
|---|---|---|---|---|
| 10 | Falke-1 | 长机·你 | Falke-2，接敌后用能量战术。保持高度优势，俯冲打一轮就拉起来，不要和喷火缠斗盘旋。 | 6500 |
| 11 | Falke-2 | 僚机 | 明白，俯冲一击脱离，不跟它转圈。 | 4000 |
| 12 | Falke-2 | 僚机 | 长官，最近英国人反应快了不少，从发现到起飞拦截间隔越来越短。 | 5500 |
| 13 | Falke-1 | 长机·你 | 情报部门简报是他们沿海的新雷达，探测距离比我们预想的，远。 | 5500 |
| 14 | Falke-1 | 长机·你 | Falke-2，注意你的油表，我们不能久留，速战速决，打完就汇合返航，别恋战。 | 6000 |
| 15 | Falke-2 | 僚机 | 收到 长官。 | 2500 |

**本段时长**：约 30s。**段后静默**：约 21s，随后触发接敌（triggerZ），CinematicSystem 播 intercept 告警。

---

## 时间轴汇总

| 时间轴节点 t(s) | 阶段 | 内容 |
|---|---|---|
| 116 | farewell 播完 | （已有，不改动） |
| **120** | **splitChat 段1** | 态势确认+护航分工（5句，~20.5s） |
| 120+20.5+18 = **158.5** | **splitChat 段2** | 轰炸机-战斗机打配合（4句，~16s） |
| 158.5+16+18 = **192.5** | **splitChat 段3** | 能量俯冲战术+英国雷达（6句，~30s） |
| 192.5+30+21 = **243.5** | 接敌（triggerZ 物理触发） | intercept 告警 |

**总填充时长**：约 66.5s 对白 + 57s 静默 = 约 123.5s，填满 t=116~244 空白窗口。

---

## 设计说明

1. **风格**：职业军人无线电通话，短句、术语化、无冗余情感。"收到""明白""长官"等确认语，方位与预案直接说清。
2. **第2段**：严格聚焦打配合--轰炸机保持队形靠交叉火力自卫（强调 Ju88 自卫能力），战斗机自由猎杀，并交代"注意炮塔火力射界"的实操细节。无加戏内容。
3. **第3段**：长机交代 B&Z 能量俯冲战术（保持高度、俯冲一击脱离、不缠斗盘旋），僚机引出英国反应速度提升话题，长机补充情报部门雷达简报，最后以油量提醒收尾"速战速决，别恋战"。
4. **角色精简**：仅 Falke-1/Falke-2/多林三人，哈通/Adler 分兵后不再出场，符合"少加戏"原则。
5. **职位标注**：三人都标 role，玩家一眼分清"长机·你/僚机/轰炸机一队长"。

---

## 待你确认

你审核确认这版定稿后，我接入 `level_01_britain.js`：
- `cinematic.dialogs` 加 `splitChat` 键（3段对白合并为一个数组，或分3个 phase 节点）
- `cinematic.timeline` 加 3 个 phase 节点（t=120/158.5/192.5）
- 现有 farewell/intercept/dialogs 角色补 role 字段

---

## 接敌对话序列 · interceptChat（v1 已接入 2026-08-06）

> **触发**：玩家飞到 `triggerZ`（CinematicSystem `_triggerIntercept`）或跳过剧情（`_finishSkip`）。
> **播放**：`_endCinematic()` 解锁操纵后，由 `GameRuntime._queueDialogs()` 入队，`_updateDialogQueue` 逐句按时长播放。玩家可飞行操作，对话不阻塞。
> **位置**：`cinematic.dialogs.interceptChat`（替代原 `intercept` 单句告警）。

| # | speaker | role | text | duration(ms) | avatar |
|---|---|---|---|---|---|
| 1 | Falke-2 | 僚机 | Falke-1！陌生编队高速逼近！ | 4000 | radio |
| 2 | Falke-1 | 长机·你 | Falke队，前出！自由猎时间！ | 4000 | player |
| 3 | Falke-2 | 僚机 | 收到，长官！ | 3000 | radio |
| 4 | Falke-1 | 长机·你 | 迎面威慑射击，驱散他们的队形！ | 4500 | player |
| 5 | Falke-2 | 僚机 | 跟着你。 | 2500 | radio |
| 6 | 多林 | 轰炸机一队长 | 各机紧密队形，机枪手准备射击！ | 5000 | wingman |

**本段时长**：约 23s。第 1 句为原有告警保留，第 2-6 句为玩家接手控制后的战术指令与回应。

---

## 胜利对话序列 · victoryChat（v1 已接入 2026-08-06）

> **触发**：`WaveDirector` 全灭回调 `onAllClear`（击落全部 4 架敌机 + 坠毁倒计时 + delayAfterWave 1.5s 后）。
> **播放**：`onAllClear` 回调入队 victoryChat + 设 `_victoryPending=true`，`_updateDialogQueue` 逐句播放，队列播空后才触发 `callbacks.onAllClear()`（任务胜利界面）。
> **前置**：击落最后一架（4/4）时 `onEnemyKilled` 设 `_chatterDisabled=true` 关闭随机喊话，跳过随机击落台词。
> **位置**：`dialogs.victoryChat`（顶层 dialogs，非 cinematic.dialogs）。

| # | speaker | role | text | duration(ms) | avatar |
|---|---|---|---|---|---|
| 1 | Falke-1 | 长机·你 | 击落全部敌机，Falke队重组，返航，祝你好运 去干活吧多林 | 6500 | player |
| 2 | 多林 | 轰炸机一队长 | 干的好伙计，下面是我们的活了，汇合点见！ | 5500 | wingman |

**本段时长**：约 12s。播完后任务胜利界面显示。

---

## 对话队列机制说明

`splitChat` 三段由 `CinematicSystem` 时间轴 `_advanceDialogs` 驱动（剧情阶段 phase 节点切换时逐句播放），而 `interceptChat` / `victoryChat` 发生在剧情结束后（CinematicSystem 已 inactive），因此由 `GameRuntime` 的对话队列 `_updateDialogQueue` 驱动：

- **入队**：`_queueDialogs(arr)` 将对话数组逐条 push 到 `_dialogQueue`
- **推进**：`_update(dt)` 每帧调 `_updateDialogQueue`，当前句 `_dialogQueueTimer` 到期后取下一句 `dialogSystem.show()`
- **胜利延迟**：`_victoryPending=true` 时，队列播空才触发 `callbacks.onAllClear()`
- **关闭喊话**：`_chatterDisabled=true` 时 `_updateCombatChatter` 直接 return

详见根目录 [glTF缓存克隆与战斗对话系统文档.md](../glTF缓存克隆与战斗对话系统文档.md) 第三章。
