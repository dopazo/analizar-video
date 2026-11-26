# /// script
# requires-python = ">=3.9"
# dependencies = ["playwright"]
# ///
"""Captura el visor (ya corriendo sobre la demo) para el README.

    uv run docs/demo/capturar.py http://127.0.0.1:4810 docs/

Usa el Edge instalado (channel="msedge"), así que no descarga navegadores.
Deja visor.png (transcripción palabra a palabra + vista previa de capítulo en la
barra) y visor_resumen.png (pestaña Resumen).
"""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4810"
DEST = Path(sys.argv[2] if len(sys.argv) > 2 else "docs")
DEST.mkdir(parents=True, exist_ok=True)


def ir_a(page, seg: float, reproducir: float = 1.2) -> None:
    """Salta a seg y reproduce un poco, para que la transcripción siga y resalte la palabra."""
    page.evaluate(f"""async () => {{
        const v = document.querySelector('video');
        v.currentTime = {seg};
        await v.play();
        await new Promise(r => setTimeout(r, {int(reproducir * 1000)}));
        v.pause();
    }}""")
    page.wait_for_timeout(500)


with sync_playwright() as p:
    nav = p.chromium.launch(channel="msedge",
                            args=["--autoplay-policy=no-user-gesture-required"])
    page = nav.new_page(viewport={"width": 1440, "height": 860}, device_scale_factor=2)
    page.goto(URL)
    page.wait_for_selector(".fila")
    # Las miniaturas de la barra las genera el servidor en segundo plano.
    for _ in range(60):
        if page.evaluate("fetch('/api/estado').then(r => r.json()).then(j => j.miniaturas)"):
            break
        page.wait_for_timeout(1000)
    page.reload()
    page.wait_for_selector(".fila")

    ir_a(page, 528.6)
    # Vista previa del capítulo "Reglas de priorización" (00:15:00 de 31:40).
    barra = page.locator(".slider").first.bounding_box()
    page.mouse.move(barra["x"] + barra["width"] * (960 / 1900), barra["y"] + barra["height"] / 2)
    page.wait_for_timeout(800)
    page.screenshot(path=str(DEST / "visor.png"))

    page.mouse.move(10, 10)
    page.get_by_text("Resumen", exact=True).first.click()
    page.wait_for_timeout(600)
    page.screenshot(path=str(DEST / "visor_resumen.png"))
    nav.close()
