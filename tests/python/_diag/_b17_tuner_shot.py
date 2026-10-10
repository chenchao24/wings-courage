# -*- coding: utf-8 -*-
"""b17_tuner.html 验证截图：等模型加载，抓 console 错误，导出节点清单。"""
import asyncio, json, sys
from playwright.async_api import async_playwright

async def main():
    errors, logs = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1600, "height": 900})
        page.on("console", lambda m: (errors if m.type == "error" else logs).append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto("http://127.0.0.1:5173/b17_tuner.html")
        # 等加载层隐藏（模型加载完成）
        try:
            await page.wait_for_selector("#loader.hide", timeout=60000)
        except Exception:
            errors.append("TIMEOUT: loader did not hide in 60s")
        await page.wait_for_timeout(2500)
        await page.screenshot(path="tests/screenshots/b17_tuner_main.png")

        # 节点清单（全部 mesh 节点名 + 尺寸）
        nodes = await page.evaluate("""() => {
          const rows = [...document.querySelectorAll('#node-list .node-row')];
          return rows.map(r => r.querySelector('.n-name').textContent + ' | ' + r.querySelector('.n-size').textContent);
        }""")
        status = await page.evaluate("() => document.getElementById('status').textContent")
        propinfo = await page.evaluate("() => document.getElementById('prop-info').textContent")
        sizeinfo = await page.evaluate("() => document.getElementById('size-info').textContent")

        # 切到炮塔页截图（锥形辅助线可见性）
        await page.click('button[data-tab="turret"]')
        await page.wait_for_timeout(400)
        await page.screenshot(path="tests/screenshots/b17_tuner_turret.png")

        # 命中球页
        await page.click('button[data-tab="hit"]')
        await page.wait_for_timeout(300)
        await page.screenshot(path="tests/screenshots/b17_tuner_hit.png")

        # 导出弹窗（全量）
        await page.click('#btn-export')
        await page.wait_for_timeout(300)
        await page.screenshot(path="tests/screenshots/b17_tuner_export.png")
        export_all = await page.evaluate("() => document.getElementById('export-text').value")
        await page.click('#btn-close-export')

        # 右键拖拽旋转视角后再截一张（看机头朝向）
        await page.mouse.move(800, 450)
        await page.mouse.down(button="right")
        await page.mouse.move(1100, 400, steps=10)
        await page.mouse.up(button="right")
        await page.wait_for_timeout(800)
        await page.screenshot(path="tests/screenshots/b17_tuner_orbit.png")

        await browser.close()

    print("=== STATUS ==="); print(status)
    print("=== PROP INFO ==="); print(propinfo)
    print("=== SIZE INFO ==="); print(sizeinfo)
    print("=== NODES (%d) ===" % len(nodes))
    for n in nodes: print(n)
    print("=== EXPORT (all, first 1200 chars) ==="); print(export_all[:1200])
    print("=== CONSOLE ERRORS (%d) ===" % len(errors))
    for e in errors: print("ERR:", e)
    print("=== DONE ===")

asyncio.run(main())
