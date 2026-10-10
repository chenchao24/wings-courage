/**
 * 《勇气之翼》入口：启动 AppShell。
 * 旧测试场的主循环逻辑已迁移至 js/game/GameRuntime.js（P2 阶段）。
 */
import { AppShell } from './app/AppShell.js';

const shell = new AppShell();
shell.boot();
