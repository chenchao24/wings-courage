# -*- coding: utf-8 -*-
"""侧视特写：只留炮塔锥 + 枪口标记，确认四塔锥形辅助线。"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1600, "height": 900})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        await page.goto("http://127.0.0.1:5173/b17_tuner.html")
        await page.wait_for_selector("#loader.hide", timeout=60000)
        await page.wait_for_timeout(1500)
        # 关掉命中球/发动机标记，只留炮塔锥
        await page.click('button[data-tab="hit"]')
        await page.click('#btn-hit-markers')
        await page.click('button[data-tab="engine"]')
        await page.click('#btn-engine-markers')
        await page.click('button[data-tab="turret"]')
        # 右键拖拽转到侧视
        await page.mouse.move(700, 450)
        await page.mouse.down(button="right")
        await page.mouse.move(1150, 480, steps=12)
        await page.mouse.up(button="right")
        await page.wait_for_timeout(900)
        await page.screenshot(path="tests/screenshots/b17_tuner_cones_side.png")
        # 再拉近一点
        await page.mouse.wheel(0, -300)
        await page.wait_for_timeout(600)
        await page.screenshot(path="tests/screenshots/b17_tuner_cones_side2.png")
        await browser.close()
    print("ERRORS:", len(errors))
    for e in errors: print("ERR:", e)

asyncio.run(main())
