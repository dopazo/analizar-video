# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Extrae uno o varios frames de un video en un timestamp dado, via ffmpeg.

Ver spec seccion 3.5 y 7.2. Formato de salida: PNG (preserva mejor el texto de
codigo o planillas en pantalla, que es el caso de uso principal).
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from _comun import AUDIO_EXTS, carpeta_analisis, fmt_ts, log, parse_ts

# Un PNG 4K de una pantalla con texto pesa del orden de 3-8 MB y puede superar
# el limite de lectura de imagenes (~5 MB). A 1920 px de ancho el texto de una
# pantalla compartida sigue siendo legible y el archivo baja un orden de
# magnitud. Ver decision 21 del spec.
DEFAULT_MAX_WIDTH = 1920
SIZE_WARN_BYTES = 4_500_000
# Factor maximo de ampliacion de un recorte (ver ancho_destino()).
UPSCALE_CROP_MAX = 2


def parse_crop(value: str) -> tuple[int, int, int, int]:
    """Acepta 'x:y:w:h' en pixeles del frame de origen."""
    parts = value.replace(",", ":").split(":")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(
            f"--crop invalido: {value!r}. Formato: x:y:ancho:alto (ej. 875:175:800:450)")
    try:
        x, y, w, h = (int(p) for p in parts)
    except ValueError:
        raise argparse.ArgumentTypeError(f"--crop invalido: {value!r}. Deben ser enteros.")
    if w <= 0 or h <= 0:
        raise argparse.ArgumentTypeError("--crop: ancho y alto deben ser > 0")
    if x < 0 or y < 0:
        raise argparse.ArgumentTypeError("--crop: x e y deben ser >= 0")
    return x, y, w, h


def probe(video: Path) -> tuple[bool, float | None, tuple[int, int] | None]:
    """(tiene_pista_de_video, duracion_en_segundos, (ancho, alto))."""
    if not shutil.which("ffprobe"):
        return True, None, None
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json",
             "-show_streams", "-show_format", str(video)],
            capture_output=True, text=True, timeout=60,
        )
        if r.returncode != 0:
            return True, None, None
        data = json.loads(r.stdout or "{}")
    except Exception:
        return True, None, None

    has_video = False
    size = None
    for st in data.get("streams", []):
        if st.get("codec_type") != "video":
            continue
        # Las caratulas embebidas en mp3/m4a aparecen como stream de video.
        if st.get("disposition", {}).get("attached_pic"):
            continue
        if st.get("codec_name") in {"mjpeg", "png"} and st.get("avg_frame_rate") in {"0/0", "0/1"}:
            continue
        has_video = True
        if st.get("width") and st.get("height"):
            size = (int(st["width"]), int(st["height"]))
        break

    duration = None
    try:
        duration = float(data.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        pass
    return has_video, duration, size


def plan_timestamps(at: float, rng: float, fps: float | None, max_frames: int,
                    duration: float | None) -> list[float]:
    if rng <= 0:
        return [max(0.0, at)]

    start = max(0.0, at - rng)
    end = at + rng
    if duration:
        end = min(end, max(0.0, duration - 0.001))
    if end <= start:
        return [start]

    if fps and fps > 0:
        step = 1.0 / fps
        stamps, t = [], start
        while t <= end + 1e-9:
            stamps.append(round(t, 3))
            t += step
        if len(stamps) > max_frames:
            log(f"AVISO: --fps {fps} pedia {len(stamps)} frames; se recortan a "
                f"--max-frames {max_frames} repartidos en la ventana.")
            stamps = _spread(start, end, max_frames)
    else:
        stamps = _spread(start, end, max_frames)
    return stamps


def _spread(start: float, end: float, n: int) -> list[float]:
    if n <= 1:
        return [round((start + end) / 2, 3)]
    step = (end - start) / (n - 1)
    return [round(start + i * step, 3) for i in range(n)]


def ancho_destino(max_width: int, crop: tuple[int, int, int, int] | None) -> int | None:
    """Ancho final del frame, o None si no hay que escalar.

    Sin recorte, `max_width` es un tope: nunca se agranda un video que ya es mas
    chico. Con recorte es un objetivo, porque un recorte suele quedar demasiado
    chico para leer texto; se amplia hasta UPSCALE_CROP_MAX veces. Agrandar no
    agrega detalle, pero evita que la imagen se encoja aun mas al leerla.
    """
    if max_width <= 0:
        return None
    if crop:
        return min(max_width, crop[2] * UPSCALE_CROP_MAX)
    return max_width


def extract(video: Path, ts: float, out: Path, max_width: int,
            crop: tuple[int, int, int, int] | None = None) -> bool:
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
           "-ss", f"{ts:.3f}", "-i", str(video), "-frames:v", "1"]

    filtros = []
    if crop:
        # El orden importa: recortar primero, escalar despues sobre el recorte.
        # ffmpeg espera crop=w:h:x:y; la CLI recibe x:y:w:h por ser mas legible.
        x, y, w, h = crop
        filtros.append(f"crop={w}:{h}:{x}:{y}")

    objetivo = ancho_destino(max_width, crop)
    if objetivo is not None:
        # -2 preserva el aspecto redondeando el alto a par.
        filtros.append(f"scale={objetivo}:-2" if crop
                       else f"scale='min(iw,{objetivo})':-2")
    if filtros:
        cmd += ["-vf", ",".join(filtros)]
    cmd.append(str(out))

    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not out.exists():
        log(f"ERROR extrayendo frame en {ts:.3f}s: {r.stderr.strip()}")
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Extrae frames de un video con ffmpeg.")
    ap.add_argument("video", help="Ruta al archivo de video")
    ap.add_argument("--at", required=True, type=parse_ts,
                    help="Timestamp en HH:MM:SS[.mmm] o en segundos")
    ap.add_argument("--range", dest="range_s", type=float, default=0.0,
                    help="Ventana +/- en segundos alrededor de --at (default: 0)")
    ap.add_argument("--fps", type=float, default=None,
                    help="Frames por segundo a muestrear dentro del rango")
    ap.add_argument("--max-frames", type=int, default=10,
                    help="Tope duro de frames por invocacion (default: 10)")
    ap.add_argument("--max-width", type=int, default=DEFAULT_MAX_WIDTH,
                    help=f"Ancho maximo del frame en px (default: {DEFAULT_MAX_WIDTH}, "
                         "0 = resolucion original). Un PNG 4K puede pesar varios MB "
                         "y superar el limite de lectura de imagenes")
    ap.add_argument("--crop", type=parse_crop, default=None,
                    help="Recorta una region del frame: x:y:ancho:alto en pixeles "
                         "del video de origen (ej. 875:175:800:450). Util cuando la "
                         "pantalla compartida es solo una parte del encuadre (plano "
                         "de sala, proyector): el texto se pierde al redimensionar "
                         "la imagen completa, recortar lo conserva")
    ap.add_argument("--output-dir", default=None,
                    help="Carpeta de salida (default: <video>_analisis/frames/)")
    args = ap.parse_args()

    video = Path(args.video).expanduser()
    if not video.is_file():
        log(f"ERROR: no existe el archivo {video}")
        return 2
    if not shutil.which("ffmpeg"):
        log("ERROR: no se encontro 'ffmpeg' en el PATH. Corre check_env.py para "
            "ver el comando de instalacion de tu sistema.")
        return 3
    if args.max_frames < 1:
        log("ERROR: --max-frames debe ser >= 1")
        return 2
    if args.max_width < 0:
        log("ERROR: --max-width debe ser >= 0 (0 = resolucion original)")
        return 2

    has_video, duration, size = probe(video)
    if not has_video or video.suffix.lower() in AUDIO_EXTS:
        log(f"ERROR: el archivo no contiene pista de video ({video.name}). "
            "No se pueden extraer frames de una grabacion de solo audio; "
            "la transcripcion si funciona sobre este archivo.")
        return 4

    if duration and args.at > duration:
        log(f"ERROR: el timestamp pedido ({args.at:.3f}s) excede la duracion del "
            f"video ({duration:.3f}s).")
        return 2

    if size:
        log(f"Resolucion de origen: {size[0]}x{size[1]}")
    if args.crop and size:
        x, y, w, h = args.crop
        if x + w > size[0] or y + h > size[1]:
            log(f"ERROR: el recorte x={x} y={y} {w}x{h} se sale del frame de "
                f"{size[0]}x{size[1]}. El maximo desde ({x}, {y}) es "
                f"{size[0] - x}x{size[1] - y}.")
            return 2

    out_dir = Path(args.output_dir).expanduser() if args.output_dir \
        else carpeta_analisis(video) / "frames"
    out_dir.mkdir(parents=True, exist_ok=True)

    stamps = plan_timestamps(args.at, args.range_s, args.fps, args.max_frames, duration)
    sufijo = "_crop" if args.crop else ""
    written: list[Path] = []
    for ts in stamps:
        out = out_dir / f"frame_{fmt_ts(ts, '-')}{sufijo}.png"
        if extract(video, ts, out, args.max_width, args.crop):
            written.append(out)

    if not written:
        log("ERROR: no se pudo extraer ningun frame.")
        return 1

    objetivo = ancho_destino(args.max_width, args.crop)
    if args.crop:
        x, y, w, h = args.crop
        log(f"Recorte aplicado: {w}x{h} px desde ({x}, {y}) -> "
            f"{objetivo or w} px de ancho.")
    elif objetivo:
        log(f"Frames escalados a {objetivo} px de ancho como maximo "
            "(--max-width 0 para la resolucion original).")

    pesados = [p for p in written if p.stat().st_size > SIZE_WARN_BYTES]
    if pesados:
        log(f"AVISO: {len(pesados)} frame(s) superan los "
            f"{SIZE_WARN_BYTES / 1_000_000:.1f} MB y pueden no poder leerse como "
            "imagen. Reintenta con un --max-width menor (ej. 1280).")

    log(f"{len(written)} frame(s) extraido(s) en {out_dir}:")
    for p in written:
        log(str(p))
    return 0


if __name__ == "__main__":
    sys.exit(main())
