# /// script
# requires-python = ">=3.9"
# dependencies = ["pillow"]
# ///
"""Arma una reunión ficticia para capturar el visor en el README.

    uv run docs/demo/generar_demo.py <carpeta_destino>
    uv run .claude/skills/analizar-video/scripts/visor.py <carpeta_destino>/levantamiento_despachos.mp4

Genera un video mudo (pantallas dibujadas con Pillow, simulando una llamada con
pantalla compartida) y, en <video>_analisis/, la transcripción con hablantes,
los tiempos por palabra, un resumen, un índice y notas. Todo es inventado: no
hay datos de ninguna reunión real.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
STEM = "levantamiento_despachos"
STAMP = "261120_101500"

FONDO = (24, 26, 31)
PANEL = (255, 255, 255)
TINTA = (32, 36, 44)
GRIS = (120, 126, 138)
LINEA = (226, 229, 235)
AZUL = (52, 110, 235)
VERDE = (34, 160, 105)
NARANJA = (235, 140, 40)
ROJO = (215, 70, 70)

PERSONAS = [("Camila Torres", (124, 92, 230)), ("Andrés Muñoz", (32, 150, 160)),
            ("Lucía Pérez", (220, 110, 60))]


def fuente(tam: int, negrita: bool = False) -> ImageFont.FreeTypeFont:
    nombres = (["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"] if negrita
               else ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"])
    for n in nombres:
        try:
            return ImageFont.truetype(n, tam)
        except OSError:
            continue
    return ImageFont.load_default()


# --- Pantallas -------------------------------------------------------------

def marco(habla: int, titulo: str) -> tuple[Image.Image, ImageDraw.ImageDraw, tuple[int, int, int, int]]:
    """Ventana de videollamada: pantalla compartida a la izquierda, cámaras a la derecha."""
    img = Image.new("RGB", (W, H), FONDO)
    d = ImageDraw.Draw(img)
    area = (24, 24, 1004, 696)
    d.rounded_rectangle(area, 10, fill=PANEL)
    d.rectangle((area[0], area[1] + 10, area[2], area[1] + 52), fill=(244, 246, 250))
    d.rounded_rectangle((area[0], area[1], area[2], area[1] + 20), 10, fill=(244, 246, 250))
    d.line((area[0], area[1] + 52, area[2], area[1] + 52), fill=LINEA, width=1)
    d.text((area[0] + 24, area[1] + 14), titulo, font=fuente(20, True), fill=TINTA)
    for i, (nombre, color) in enumerate(PERSONAS):
        y = 24 + i * 180
        caja = (1024, y, 1256, y + 164)
        d.rounded_rectangle(caja, 10, fill=(40, 43, 50),
                            outline=(110, 200, 255) if i == habla else None, width=3)
        cx, cy = (caja[0] + caja[2]) // 2, y + 70
        d.ellipse((cx - 38, cy - 38, cx + 38, cy + 38), fill=color)
        ini = "".join(p[0] for p in nombre.split()[:2])
        d.text((cx, cy), ini, font=fuente(28, True), fill="white", anchor="mm")
        d.text((caja[0] + 12, caja[3] - 28), nombre, font=fuente(15), fill=(220, 222, 228))
    return img, d, area


def pantalla_agenda(habla: int) -> Image.Image:
    img, d, (x0, y0, x1, _) = marco(habla, "Levantamiento · Módulo de despachos")
    d.text((x0 + 48, y0 + 100), "Agenda", font=fuente(40, True), fill=TINTA)
    items = ["Cómo se despacha hoy", "Tablero de operaciones", "Reglas de priorización",
             "Integración con el ERP", "Plazos y próximos pasos"]
    for i, t in enumerate(items):
        y = y0 + 180 + i * 64
        d.ellipse((x0 + 52, y + 6, x0 + 80, y + 34), fill=AZUL)
        d.text((x0 + 66, y + 20), str(i + 1), font=fuente(16, True), fill="white", anchor="mm")
        d.text((x0 + 100, y + 4), t, font=fuente(26), fill=TINTA)
    return img


def pantalla_tablero(habla: int, resaltar: bool = False) -> Image.Image:
    img, d, (x0, y0, x1, y1) = marco(habla, "Tablero de operaciones · Despachos")
    kpis = [("Pedidos hoy", "1.284", AZUL), ("Despachados", "962", VERDE),
            ("Atrasados", "47", ROJO), ("En ruta", "275", NARANJA)]
    for i, (t, v, c) in enumerate(kpis):
        bx = x0 + 32 + i * 232
        d.rounded_rectangle((bx, y0 + 80, bx + 212, y0 + 180), 8, outline=LINEA, width=2)
        d.rectangle((bx, y0 + 84, bx + 5, y0 + 176), fill=c)
        d.text((bx + 20, y0 + 94), t, font=fuente(16), fill=GRIS)
        d.text((bx + 20, y0 + 120), v, font=fuente(36, True), fill=TINTA)
    # Barras por día
    gx, gy, gw, gh = x0 + 32, y0 + 220, 560, 380
    d.rounded_rectangle((gx, gy, gx + gw, gy + gh), 8, outline=LINEA, width=2)
    d.text((gx + 20, gy + 14), "Despachos por día", font=fuente(18, True), fill=TINTA)
    vals = [62, 75, 58, 90, 84, 40, 30]
    dias = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
    for i, v in enumerate(vals):
        bx = gx + 40 + i * 72
        alto = int(v * 2.8)
        d.rounded_rectangle((bx, gy + gh - 50 - alto, bx + 44, gy + gh - 50), 4,
                            fill=AZUL if i != 3 else (35, 80, 190))
        d.text((bx + 22, gy + gh - 36), dias[i], font=fuente(14), fill=GRIS, anchor="ma")
    # Tabla de atrasos
    tx = gx + gw + 24
    d.rounded_rectangle((tx, gy, x1 - 32, gy + gh), 8, outline=LINEA, width=2)
    d.text((tx + 20, gy + 14), "Atrasados por comuna", font=fuente(18, True), fill=TINTA)
    filas = [("Maipú", 14), ("Puente Alto", 11), ("Quilicura", 9), ("La Florida", 7), ("Pudahuel", 6)]
    for i, (c, n) in enumerate(filas):
        fy = gy + 64 + i * 56
        if resaltar and i == 0:
            d.rounded_rectangle((tx + 10, fy - 8, x1 - 42, fy + 36), 6, fill=(255, 240, 200))
        d.text((tx + 20, fy), c, font=fuente(18), fill=TINTA)
        d.text((x1 - 60, fy), str(n), font=fuente(18, True), fill=ROJO, anchor="ra")
    return img


def pantalla_reglas(habla: int) -> Image.Image:
    img, d, (x0, y0, x1, _) = marco(habla, "Reglas de priorización · borrador")
    d.text((x0 + 48, y0 + 96), "¿Qué pedido sale primero?", font=fuente(34, True), fill=TINTA)
    reglas = [("1", "Pedidos con compromiso de entrega hoy", VERDE),
              ("2", "Clientes con contrato de nivel de servicio", VERDE),
              ("3", "Ruta: agrupar por comuna antes de las 11:00", NARANJA),
              ("4", "Pedidos parciales: ¿se despachan o se esperan?", ROJO)]
    for i, (n, t, c) in enumerate(reglas):
        y = y0 + 180 + i * 96
        d.rounded_rectangle((x0 + 48, y, x1 - 48, y + 76), 8, outline=LINEA, width=2)
        d.rectangle((x0 + 48, y + 4, x0 + 54, y + 72), fill=c)
        d.text((x0 + 80, y + 22), n + ".", font=fuente(24, True), fill=GRIS)
        d.text((x0 + 120, y + 22), t, font=fuente(24), fill=TINTA)
    return img


def pantalla_erp(habla: int) -> Image.Image:
    img, d, (x0, y0, x1, _) = marco(habla, "Integración con el ERP")
    cajas = [("ERP", "pedidos y stock", (x0 + 70, y0 + 230)),
             ("Integración", "cada 15 min", (x0 + 380, y0 + 230)),
             ("Tablero", "despachos", (x0 + 690, y0 + 230))]
    for t, s, (bx, by) in cajas:
        d.rounded_rectangle((bx, by, bx + 220, by + 130), 12, fill=(238, 243, 255), outline=AZUL, width=2)
        d.text((bx + 110, by + 44), t, font=fuente(26, True), fill=TINTA, anchor="mm")
        d.text((bx + 110, by + 88), s, font=fuente(18), fill=GRIS, anchor="mm")
    for ax in (x0 + 290, x0 + 600):
        d.line((ax + 6, y0 + 295, ax + 84, y0 + 295), fill=AZUL, width=4)
        d.polygon([(ax + 84, y0 + 285), (ax + 84, y0 + 305), (ax + 98, y0 + 295)], fill=AZUL)
    d.text((x0 + 70, y0 + 430), "Pendiente: ¿el ERP expone una API o solo exporta archivos?",
           font=fuente(22), fill=ROJO)
    return img


# --- Guion -----------------------------------------------------------------
# (segundo de inicio, hablante, texto). Los hablantes usan el nombre ya
# confirmado, como en un _hablantes_corregido.txt.

C, A, L = (p[0] for p in PERSONAS)
GUION = [
    (0.0, C, "Bueno, partamos. Hoy la idea es entender cómo despachan y qué esperan del tablero."),
    (6.4, A, "Perfecto. Les comparto pantalla con la agenda que armamos."),
    (12.1, A, "Son cinco puntos, y el más importante para nosotros es el tablero de operaciones."),
    (19.8, L, "Antes de partir, ¿la reunión queda grabada para el equipo de desarrollo?"),
    (24.5, C, "Sí, queda grabada y después sale un acta con los acuerdos."),
    (95.0, A, "Hoy despachamos desde una planilla que se actualiza a mano dos veces al día."),
    (102.6, A, "El problema es que en la tarde ya nadie sabe qué pedido salió y cuál no."),
    (110.3, L, "¿Y quién actualiza esa planilla, el jefe de bodega?"),
    (114.9, A, "El jefe de bodega en la mañana, y en la tarde el que esté de turno."),
    (330.0, A, "Este es el tablero que nos gustaría tener, lo dibujamos con datos de la semana pasada."),
    (338.2, C, "Arriba están los cuatro indicadores: pedidos, despachados, atrasados y en ruta."),
    (346.7, L, "¿Los atrasados se cuentan contra la fecha comprometida o contra la fecha del pedido?"),
    (353.4, A, "Contra la fecha comprometida con el cliente. Eso tiene que quedar claro en el tablero."),
    (361.0, C, "Lo anoto como requerimiento: atraso medido contra la fecha comprometida."),
    (520.0, A, "Fíjense en Maipú: catorce pedidos atrasados, casi todos por la misma ruta."),
    (527.5, L, "Entonces el tablero debería permitir filtrar por comuna y por ruta."),
    (533.8, A, "Exacto, y que el jefe de bodega lo vea en la tablet en el andén."),
    (900.0, A, "Ahora las reglas: primero sale lo que tiene compromiso de entrega para hoy."),
    (907.6, A, "Después los clientes con contrato de nivel de servicio."),
    (914.2, L, "¿Y los pedidos parciales? Eso no está resuelto en el borrador."),
    (920.5, A, "No, eso lo tenemos que conversar con comercial antes de decidir."),
    (926.9, C, "Lo dejo como decisión abierta, con responsable Andrés para la próxima semana."),
    (1380.0, A, "La integración con el ERP sería cada quince minutos, por ahora."),
    (1387.3, L, "¿El ERP tiene una API o solo exporta archivos?"),
    (1392.8, A, "Creo que solo exporta archivos, pero lo confirmo con el proveedor."),
    (1399.5, C, "Eso es un riesgo para el plazo, lo dejo en el acta."),
    (1860.0, C, "Para cerrar: el primer entregable sería el tablero con los cuatro indicadores."),
    (1867.4, A, "Nos sirve para fin de mes si la integración está lista."),
    (1873.1, L, "Entonces partimos por confirmar lo del ERP esta semana."),
    (1879.6, C, "Perfecto, muchas gracias a todos. Les mando el acta hoy en la tarde."),
]
DURACION = 1900  # ~31:40

ESCENAS = [  # (desde, pantalla)
    (0, lambda: pantalla_agenda(1)), (95, lambda: pantalla_agenda(1)),
    (330, lambda: pantalla_tablero(1)), (520, lambda: pantalla_tablero(1, resaltar=True)),
    (900, lambda: pantalla_reglas(1)), (1380, lambda: pantalla_erp(1)),
    (1860, lambda: pantalla_agenda(0)),
]


def ts(seg: float) -> str:
    h, r = divmod(seg, 3600)
    m, s = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def hms(seg: float) -> str:
    return ts(seg)[:8]


def escribir_datos(dest: Path) -> None:
    an = dest / f"{STEM}_analisis"
    an.mkdir(parents=True, exist_ok=True)
    base = an / f"{STEM}_transcripcion_{STAMP}"

    lineas = ["[large-v3-turbo | es | 26-11-20 10:15:00]"]
    palabras = []
    for i, (t, quien, texto) in enumerate(GUION):
        lineas.append(f"[{ts(t)}] {quien}: {texto}")
        tokens = texto.split()
        fin = min(GUION[i + 1][0] - 0.4, t + len(tokens) * 0.36) if i + 1 < len(GUION) else t + len(tokens) * 0.36
        paso = (fin - t) / len(tokens)
        palabras.append({"start": t, "end": fin, "words": [
            [round(t + k * paso, 3), round(t + (k + 1) * paso - 0.04, 3), " " + w]
            for k, w in enumerate(tokens)]})
    Path(f"{base}_hablantes_corregido.txt").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    Path(f"{base}.txt").write_text(
        "\n".join([lineas[0]] + [f"[{ts(t)}] {x}" for t, _, x in GUION]) + "\n", encoding="utf-8")
    Path(f"{base}_palabras.jsonl").write_text(
        "\n".join(json.dumps(p, ensure_ascii=False) for p in palabras) + "\n", encoding="utf-8")

    (an / f"{STEM}_indice_{STAMP}.md").write_text(f"""# Índice de temas

| Inicio | Tema |
|---|---|
| [00:00:00] | Agenda y objetivo de la reunión |
| [00:01:35] | Cómo se despacha hoy |
| [00:05:30] | Tablero de operaciones |
| [00:15:00] | Reglas de priorización |
| [00:23:00] | Integración con el ERP |
| [00:31:00] | Plazos y próximos pasos |
""", encoding="utf-8")

    (an / f"{STEM}_resumen_{STAMP}.md").write_text("""# Acta · Levantamiento del módulo de despachos

**Participantes:** Camila Torres (consultora), Andrés Muñoz (operaciones), Lucía Pérez (desarrollo)

## Contexto

Hoy despachan desde una planilla que se actualiza a mano dos veces al día
[00:01:35]; en la tarde se pierde el rastro de qué pedido salió [00:01:42].

## Requerimientos

| # | Requerimiento | Cita | Momento |
|---|---|---|---|
| R1 | Cuatro indicadores: pedidos, despachados, atrasados y en ruta | "Arriba están los cuatro indicadores" | [00:05:38] |
| R2 | El atraso se mide contra la fecha comprometida | "Contra la fecha comprometida con el cliente" | [00:05:53] |
| R3 | Filtrar por comuna y por ruta | "debería permitir filtrar por comuna y por ruta" | [00:08:47] |
| R4 | Usable en tablet, en el andén | "que el jefe de bodega lo vea en la tablet" | [00:08:53] |

## Decisiones

- **Cerrada:** prioridad 1 = compromiso de entrega hoy; 2 = contrato de nivel de servicio [00:15:00]
- **Abierta:** qué hacer con los pedidos parciales. Responsable: Andrés [00:15:26]

## Riesgos

- El ERP podría no tener API y solo exportar archivos [00:23:12]. Afecta el plazo de fin de mes [00:23:19].

## Próximos pasos

- [ ] Confirmar con el proveedor si el ERP expone API (Andrés, esta semana) [00:31:13]
- [ ] Enviar el acta (Camila, hoy) [00:31:19]
""", encoding="utf-8")

    (an / f"{STEM}_notas.md").write_text("""# Notas

Notas tomadas en el visor, ancladas al momento del video.

- [00:08:40] Maipú concentra los atrasos: preguntar si es una sola ruta · _26-11-20 11:02_
- [00:15:14] Parciales: pedir ejemplos reales a comercial · _26-11-20 11:05_
""", encoding="utf-8")


def escribir_video(dest: Path) -> Path:
    salida = dest / f"{STEM}.mp4"
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        lista = []
        cortes = [e[0] for e in ESCENAS] + [DURACION]
        for i, (desde, dibujar) in enumerate(ESCENAS):
            png = tmp / f"escena_{i}.png"
            dibujar().save(png)
            lista.append(f"file '{png.as_posix()}'\nduration {cortes[i + 1] - desde}")
        lista.append(f"file '{(tmp / f'escena_{len(ESCENAS) - 1}.png').as_posix()}'")
        (tmp / "lista.txt").write_text("\n".join(lista) + "\n", encoding="utf-8")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                        "-i", str(tmp / "lista.txt"),
                        "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
                        "-vf", "fps=1,format=yuv420p", "-c:v", "libx264", "-tune", "stillimage",
                        "-c:a", "aac", "-b:a", "16k", "-t", str(DURACION), "-shortest",
                        "-movflags", "+faststart", str(salida)], check=True)
    return salida


if __name__ == "__main__":
    destino = Path(sys.argv[1] if len(sys.argv) > 1 else "demo").resolve()
    destino.mkdir(parents=True, exist_ok=True)
    escribir_datos(destino)
    print(escribir_video(destino))
