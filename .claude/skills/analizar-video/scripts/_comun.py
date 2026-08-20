"""Piezas compartidas por los scripts de la skill.

Se importa como modulo hermano (`from _comun import ...`): Python antepone el
directorio del script a `sys.path`, asi que funciona con `uv run` desde
cualquier carpeta. **Solo stdlib**, a proposito: `check_env.py` tiene que poder
correr aunque no haya nada instalado, y este modulo no debe romper eso. No lleva
bloque PEP 723 porque no se ejecuta, se importa.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
from pathlib import Path

# --- Formatos de archivo -----------------------------------------------------

AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".opus", ".aac", ".wma"}
VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".wmv", ".flv",
              ".mpg", ".mpeg"}
MEDIA_EXTS = VIDEO_EXTS | AUDIO_EXTS

SUFIJO_ANALISIS = "_analisis"


def carpeta_analisis(media: Path) -> Path:
    """Carpeta con todo lo que la skill genera para un video: <video>_analisis/.

    Agrupar por video evita que una carpeta con varias grabaciones termine con
    decenas de archivos sueltos mezclados. De paso, el audio cacheado deja de
    ser visible para el modo batch, que si no lo tomaria como un input mas y
    transcribiria dos veces el mismo contenido.

    El sufijo evita chocar con una carpeta que ya se llame como el video, y
    distingue reunion.mp4 de reunion.mov.
    """
    return media.parent / f"{media.stem}{SUFIJO_ANALISIS}"

# --- Modelos -----------------------------------------------------------------

# Peso aproximado de los pesos de cada modelo, para avisar antes de descargar.
MODEL_SIZES_MB = {
    "tiny": 75, "base": 145, "small": 464, "medium": 1530,
    "large-v3-turbo": 1550, "large-v3": 3090,
}
MODEL_CHOICES = list(MODEL_SIZES_MB)


def hf_cache_dir() -> Path:
    """Donde faster-whisper deja los pesos descargados."""
    for var in ("HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE"):
        if os.environ.get(var):
            return Path(os.environ[var])
    if os.environ.get("HF_HOME"):
        return Path(os.environ["HF_HOME"]) / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _peso_mb(d: Path) -> int:
    """Tamano real de un modelo en la cache de Hugging Face.

    El layout es blobs/ (los datos) + snapshots/ (enlaces a blobs). Sumar todo
    cuenta cada archivo dos veces, asi que se mide solo blobs/ cuando existe.
    """
    base = d / "blobs" if (d / "blobs").is_dir() else d
    total = 0
    for f in base.rglob("*"):
        try:
            if f.is_file() and not f.is_symlink():
                total += f.stat().st_size
        except OSError:
            continue
    return round(total / 1e6)


def escanear_modelos() -> dict[str, int]:
    """{modelo: MB} de los pesos descargados. Una sola pasada por la cache.

    El nombre del repo cambia segun quien publique el modelo (Systran,
    mobiuslabsgmbh, ...), por eso se busca por sufijo y no por nombre exacto.
    """
    hub = hf_cache_dir()
    if not hub.is_dir():
        return {}

    encontrados: dict[str, int] = {}
    for d in hub.iterdir():
        if not d.is_dir():
            continue
        nombre = d.name.lower()
        for modelo in MODEL_SIZES_MB:
            if nombre.endswith(f"faster-whisper-{modelo}") and modelo not in encontrados:
                # Un directorio sin pesos queda de una descarga interrumpida.
                if any(d.rglob("*.bin")) or any(d.rglob("*.safetensors")):
                    encontrados[modelo] = _peso_mb(d)
                break
    return encontrados


def peso_legible(modelo: str) -> str:
    mb = MODEL_SIZES_MB[modelo]
    return f"~{mb / 1000:.1f} GB" if mb >= 1000 else f"~{mb} MB"


# --- Timestamps --------------------------------------------------------------

def fmt_ts(seconds: float, sep: str = ":") -> str:
    """Segundos -> HH:MM:SS.mmm (o HH-MM-SS.mmm, para nombres de archivo)."""
    ms = int(round(max(seconds, 0.0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}{sep}{m:02d}{sep}{s:02d}.{ms:03d}"


def parse_ts(value: str) -> float:
    """Acepta 'HH:MM:SS[.mmm]', 'MM:SS[.mmm]' o segundos ('754.5')."""
    partes = value.strip().split(":")
    if len(partes) > 3:
        raise argparse.ArgumentTypeError(
            f"Timestamp invalido: {value!r}. Usa HH:MM:SS[.mmm] o segundos.")
    try:
        total = 0.0
        for p in partes:
            total = total * 60 + float(p)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"Timestamp invalido: {value!r}. Usa HH:MM:SS[.mmm] o segundos.")
    return total


# --- Utilidades --------------------------------------------------------------

def log(msg: str) -> None:
    """Sin buffer: la transcripcion corre en background y hay que ver avance."""
    print(msg, flush=True)


def hay_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def correr(cmd: list[str], timeout: int | None = None) -> str | None:
    """stdout del comando, o None si fallo o no existe el binario."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except Exception:
        return None
    return r.stdout if r.returncode == 0 else None


def hay_gpu_nvidia() -> bool:
    if not shutil.which("nvidia-smi"):
        return False
    salida = correr(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                    timeout=15)
    return bool(salida and salida.strip())


def dirs_site_packages() -> list[Path]:
    """Carpetas donde los wheels nvidia-*-cu12 dejan cuBLAS/cuDNN."""
    import sys

    salida = []
    for base in {p for p in sys.path if p.endswith("site-packages")}:
        nvidia = Path(base) / "nvidia"
        if not nvidia.is_dir():
            continue
        for sub in ("bin", "lib"):
            salida.extend(d for d in nvidia.glob(f"*/{sub}") if d.is_dir())
    return salida
