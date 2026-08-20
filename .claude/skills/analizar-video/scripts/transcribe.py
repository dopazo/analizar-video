# /// script
# requires-python = ">=3.9"
# dependencies = ["faster-whisper>=1.0.0"]
# ///
"""Transcribe video/audio local con faster-whisper.

Genera <archivo>_transcripcion_yymmdd_hhmmss.txt con un header de metadata y
un segmento por linea con timestamp. Ver spec seccion 3.1.1 y 7.1.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import subprocess
import sys
import traceback
from pathlib import Path

from _comun import (
    AUDIO_EXTS, MEDIA_EXTS, MODEL_CHOICES, carpeta_analisis,
    dirs_site_packages, escanear_modelos, fmt_ts, hay_ffmpeg, hay_gpu_nvidia,
    hf_cache_dir, log, parse_ts, peso_legible,
)

# Fragmentos que delatan que el fallo viene de la pila de GPU y no del audio.
GPU_ERROR_HINTS = ("cublas", "cudnn", "cuda", "libcu", "gpu", "no kernel image")

# Whisper trunca el initial_prompt en silencio pasados ~224 tokens.
LIMITE_PROMPT_PALABRAS = 160


def is_gpu_error(exc: BaseException) -> bool:
    msg = f"{exc.__class__.__name__}: {exc}".lower()
    return any(h in msg for h in GPU_ERROR_HINTS)


def detect_device(requested: str) -> tuple[str, str]:
    """Devuelve (device, compute_type por defecto para ese device)."""
    device = requested if requested != "auto" else ("cuda" if hay_gpu_nvidia() else "cpu")
    return device, ("float16" if device == "cuda" else "int8")


def default_model(device: str) -> str:
    return "large-v3-turbo" if device == "cuda" else "small"


def register_cuda_libs() -> None:
    """Hace visibles cuBLAS/cuDNN instaladas como wheels de pip.

    Los paquetes nvidia-cublas-cu12 / nvidia-cudnn-cu12 dejan las librerias en
    site-packages/nvidia/<lib>/bin (Windows) o /lib (Linux), que no esta en la
    ruta de busqueda del loader. Sin esto, CTranslate2 no las encuentra aunque
    esten instaladas y el error aparece recien al transcribir.
    """
    for libdir in dirs_site_packages():
        if hasattr(os, "add_dll_directory"):  # Windows
            try:
                os.add_dll_directory(str(libdir))
            except OSError:
                continue
        os.environ["PATH"] = str(libdir) + os.pathsep + os.environ.get("PATH", "")


def build_model(model_size: str, device: str, compute_type: str):
    if device == "cuda":
        register_cuda_libs()
    # Import diferido a proposito: tiene que ocurrir despues de registrar las
    # librerias de CUDA, si no CTranslate2 ya resolvio sus dependencias.
    from faster_whisper import WhisperModel

    log(f"Cargando modelo {model_size} en {device} ({compute_type}). "
        "La primera vez descarga los pesos...")
    return WhisperModel(model_size, device=device, compute_type=compute_type)


def extraer_audio(media: Path, destino: Path, desde: float | None = None,
                  hasta: float | None = None) -> bool:
    """Extrae audio mono 16 kHz con ffmpeg. Con desde/hasta corta solo ese tramo.

    ffmpeg hace seek por keyframe: cortar 20 s de un archivo de 30 GB es
    instantaneo porque no lee el archivo completo. Pasarle el video directo a
    faster-whisper, en cambio, decodifica todo el audio siempre.
    """
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
    if desde is not None:
        cmd += ["-ss", f"{desde:.3f}"]
    if hasta is not None:
        cmd += ["-to", f"{hasta:.3f}"]
    cmd += ["-i", str(media), "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "aac", "-b:a", "64k", str(destino)]

    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not destino.exists():
        log(f"AVISO: no se pudo extraer el audio ({r.stderr.strip()[:200]}).")
        destino.unlink(missing_ok=True)
        return False
    return True


def audio_de_trabajo(media: Path, args) -> tuple[Path, str | None, bool]:
    """(archivo_a_transcribir, nota, es_temporal). Cachea el audio junto al video.

    Lo que la cache evita es volver a recorrer un contenedor de video para
    sacarle el audio; con eso, re-transcribir (con otro modelo o mejor glosario)
    sale mucho mas barato en discos lentos.
    """
    if args.es_tramo:
        # Modo tramo: siempre se corta y el recorte se borra al terminar.
        destino = carpeta_analisis(media)
        destino.mkdir(parents=True, exist_ok=True)
        tmp = destino / f"{media.stem}_tramo_tmp.m4a"
        if not extraer_audio(media, tmp, args.from_s, args.to_s):
            raise RuntimeError("no se pudo cortar el tramo pedido con ffmpeg")
        return tmp, "tramo recortado", True

    if media.suffix.lower() in AUDIO_EXTS:
        # Ya es audio: cachearlo solo duplicaria el archivo.
        return media, None, False

    if args.no_audio_cache:
        return media, None, False

    if not hay_ffmpeg():
        log("AVISO: ffmpeg no esta en el PATH; se decodifica el archivo original "
            "directo (mas lento en videos grandes, pero funciona).")
        return media, None, False

    destino = carpeta_analisis(media)
    cache = destino / f"{media.stem}_audio.m4a"
    if cache.is_file() and cache.stat().st_size > 0:
        return cache, f"audio cacheado ({cache.name})", False

    destino.mkdir(parents=True, exist_ok=True)
    log(f"Extrayendo audio a {cache.name} (una sola vez; acelera re-corridas)...")
    if not extraer_audio(media, cache):
        return media, None, False
    return cache, f"audio extraido ({cache.stat().st_size / 1e6:.1f} MB)", False


def transcribe_one(model, media: Path, args, out_dir: Path) -> Path | None:
    """Transcribe un archivo. Devuelve el .txt generado, o None en modo tramo."""
    log(f"\n=== {media.name} ===")

    fuente, nota, es_temporal = audio_de_trabajo(media, args)
    if nota:
        log(f"Fuente de audio: {nota}")

    try:
        segmentos, total = _decodificar(model, fuente, args)
        if args.es_tramo:
            _volcar_a_stdout(segmentos, args.from_s or 0.0, total)
            return None
        return _volcar_a_archivo(segmentos, media, args, out_dir, total)
    finally:
        if es_temporal:
            fuente.unlink(missing_ok=True)


def _decodificar(model, fuente: Path, args):
    segmentos, info = model.transcribe(
        str(fuente),
        language=args.language,
        initial_prompt=args.initial_prompt,
        vad_filter=args.use_vad,
        beam_size=args.beam_size,
        condition_on_previous_text=not args.no_condition,
    )
    total = float(getattr(info, "duration", 0.0) or 0.0)
    log(f"Duracion detectada: {fmt_ts(total)}")
    return segmentos, total


def _volcar_a_stdout(segmentos, offset: float, total: float) -> None:
    """Modo tramo: a stdout y sin archivo.

    Un .txt de 20 segundos que cumpliera la convencion de nombres seria
    reutilizado despues por la logica de cache como si fuera la transcripcion
    completa (ver SKILL.md).
    """
    log(f"--- tramo {fmt_ts(offset)} - {fmt_ts(offset + total)} ---")
    n = 0
    for seg in segmentos:
        texto = (seg.text or "").strip()
        if texto:
            # Los timestamps del recorte arrancan en 0: se devuelven al eje
            # temporal del video o dejan de servir para citar o sacar frames.
            log(f"[{fmt_ts(seg.start + offset)}] {texto}")
            n += 1
    log(f"--- fin del tramo: {n} segmentos (no se guardo archivo) ---")


def _volcar_a_archivo(segmentos, media: Path, args, out_dir: Path,
                      total: float) -> Path:
    ahora = dt.datetime.now()
    out = out_dir / f"{media.stem}_transcripcion_{ahora.strftime('%y%m%d_%H%M%S')}.txt"
    out.parent.mkdir(parents=True, exist_ok=True)

    n = 0
    ultimo_aviso = -10.0
    try:
        with out.open("w", encoding="utf-8") as fh:
            fh.write(f"[{args.model} | {args.language} | {ahora.strftime('%y-%m-%d %H:%M:%S')}]\n")
            fh.flush()
            for seg in segmentos:
                texto = (seg.text or "").strip()
                if not texto:
                    continue
                fh.write(f"[{fmt_ts(seg.start)}] {texto}\n")
                fh.flush()
                n += 1
                if seg.end - ultimo_aviso >= 30:
                    ultimo_aviso = seg.end
                    pct = f" ({seg.end / total * 100:.0f}%)" if total else ""
                    log(f"  {fmt_ts(seg.end)} / {fmt_ts(total)}{pct} - {n} segmentos")
    except BaseException:
        # Un .txt a medias con solo el header seria reutilizado por la logica de
        # cache como si fuera una transcripcion valida. Mejor no dejar rastro.
        out.unlink(missing_ok=True)
        raise

    if n == 0:
        out.unlink(missing_ok=True)
        raise RuntimeError(
            "no se obtuvo ningun segmento de audio (archivo sin voz, corrupto, "
            "o idioma mal forzado con --language)")

    log(f"Listo: {n} segmentos")
    log(f"Transcripcion guardada en: {out}")
    return out


def collect_inputs(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    if target.is_dir():
        return sorted(
            p for p in target.iterdir()
            if p.is_file() and p.suffix.lower() in MEDIA_EXTS
        )
    raise FileNotFoundError(f"No existe la ruta: {target}")


def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        description="Transcribe video/audio local con faster-whisper.",
    )
    ap.add_argument("input", help="Archivo de video/audio, o carpeta (modo batch)")
    ap.add_argument("--model", choices=MODEL_CHOICES, default=None,
                    help="Nivel de modelo (default: segun device disponible)")
    ap.add_argument("--language", default="es", help="Idioma forzado (default: es)")
    ap.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    ap.add_argument("--compute-type", default=None,
                    help="Cuantizacion CTranslate2 (default: int8 en CPU, float16 en GPU)")
    ap.add_argument("--initial-prompt", default=None,
                    help="Prompt condensado (~200 tokens) para sesgar el vocabulario")
    ap.add_argument("--use-vad", action="store_true",
                    help="Activa el filtro VAD de Silero (desactivado por defecto)")
    ap.add_argument("--no-condition", action="store_true",
                    help="Desactiva condition_on_previous_text. Usar si el audio "
                         "tiene musica o tramos sin voz y el modelo entra en bucle "
                         "repitiendo la misma frase")
    ap.add_argument("--from", dest="from_s", type=parse_ts, default=None,
                    help="Transcribe solo desde este punto (HH:MM:SS o segundos). "
                         "Corta el tramo con ffmpeg, imprime a stdout y NO guarda "
                         "archivo. Para resolver una frase dudosa sin re-procesar todo")
    ap.add_argument("--to", dest="to_s", type=parse_ts, default=None,
                    help="Fin del tramo (ver --from)")
    ap.add_argument("--no-audio-cache", action="store_true",
                    help="No generar ni usar el audio cacheado del video")
    ap.add_argument("--download", action="store_true",
                    help="Autoriza descargar los pesos del modelo si no estan en cache")
    ap.add_argument("--beam-size", type=int, default=5,
                    help="Tamano del beam search (default: 5)")
    ap.add_argument("--output-dir", default=None,
                    help="Carpeta de salida (default: <video>_analisis/ junto al input)")

    args = ap.parse_args(argv)
    args.es_tramo = args.from_s is not None or args.to_s is not None
    return args


def validar(args, inputs: list[Path]) -> int:
    """0 si todo bien, o el codigo de salida a devolver."""
    if args.es_tramo:
        if len(inputs) > 1:
            log("ERROR: --from/--to solo aplican a un archivo, no a una carpeta.")
            return 2
        if not hay_ffmpeg():
            log("ERROR: --from/--to necesitan ffmpeg para cortar el tramo. "
                "Corre check_env.py para ver como instalarlo.")
            return 3
        if args.to_s is not None and args.from_s is not None and args.to_s <= args.from_s:
            log("ERROR: --to debe ser mayor que --from.")
            return 2

    if args.initial_prompt:
        palabras = len(args.initial_prompt.split())
        if palabras > LIMITE_PROMPT_PALABRAS:
            log(f"AVISO: el --initial-prompt tiene {palabras} palabras. Whisper "
                "corta en ~224 tokens y descarta el resto en silencio; conviene "
                "dejar solo nombres propios, siglas y terminos de dominio.")
    return 0


def avisar_modelo_faltante(args, descargados: dict[str, int]) -> None:
    log("")
    log(f"El modelo '{args.model}' no esta descargado ({peso_legible(args.model)}).")
    log(f"Se guardaria en: {hf_cache_dir()}")
    log("No se descarga nada sin autorizacion. Opciones:")
    log("  - volver a correr con --download para bajarlo")
    if descargados:
        listado = ", ".join(f"{m} ({mb} MB)" for m, mb in
                            sorted(descargados.items(), key=lambda kv: -kv[1]))
        log(f"  - usar uno ya descargado: {listado}")


def main() -> int:
    args = parse_args()

    target = Path(args.input).expanduser()
    try:
        inputs = collect_inputs(target)
    except FileNotFoundError as e:
        log(f"ERROR: {e}")
        return 2

    if not inputs:
        log(f"ERROR: no se encontraron archivos de video/audio en {target}")
        return 2

    rc = validar(args, inputs)
    if rc:
        return rc

    device, ct_default = detect_device(args.device)
    if args.device == "auto" and device == "cpu":
        log("GPU NVIDIA no detectada: se usara CPU.")
    compute_type = args.compute_type or ct_default
    args.model = args.model or default_model(device)

    base_out = Path(args.output_dir).expanduser() if args.output_dir else None

    log(f"Modelo: {args.model} | device: {device} | compute_type: {compute_type} "
        f"| idioma: {args.language} | vad: {'on' if args.use_vad else 'off'}")
    if len(inputs) > 1:
        log(f"Modo batch: {len(inputs)} archivos (secuencial).")

    if not args.download:
        descargados = escanear_modelos()
        if args.model not in descargados:
            avisar_modelo_faltante(args, descargados)
            return 4

    corredor = Corredor(args, device, compute_type)
    if not corredor.iniciar():
        return 1

    ok: list[tuple[Path, Path | None]] = []
    failed: list[tuple[Path, str]] = []
    try:
        for media in inputs:
            out_dir = base_out or carpeta_analisis(media)
            try:
                ok.append((media, corredor.transcribir(media, out_dir)))
            except Exception as e:
                failed.append((media, f"{e.__class__.__name__}: {e}"))
                log(f"ERROR transcribiendo {media.name}: {e.__class__.__name__}: {e}")
                traceback.print_exc(file=sys.stdout)
                if len(inputs) > 1:
                    log("Continuando con el resto...")
    except KeyboardInterrupt:
        log("\nInterrumpido por el usuario.")
        return 130

    if len(inputs) > 1 or failed:
        log("\n--- Resumen ---")
        for media, out in ok:
            log(f"OK    {media.name} -> {out.name if out else '(tramo a stdout)'}")
        for media, err in failed:
            log(f"FALLO {media.name}: {err}")

    return 1 if failed and not ok else 0


class Corredor:
    """Dueño del modelo y del fallback GPU->CPU.

    Separa la politica de dispositivo de la politica de tolerancia a fallos del
    batch: el bucle de main() solo tiene que atrapar el error del archivo.
    """

    def __init__(self, args, device: str, compute_type: str) -> None:
        self.args = args
        self.device = device
        self.compute_type = compute_type
        self.model = None

    def iniciar(self) -> bool:
        try:
            self.model = build_model(self.args.model, self.device, self.compute_type)
            return True
        except Exception as e:
            if self.device == "cuda" and is_gpu_error(e):
                self._caer_a_cpu(e)
                return True
            log(f"ERROR al cargar el modelo: {e.__class__.__name__}: {e}")
            return False

    def transcribir(self, media: Path, out_dir: Path) -> Path | None:
        try:
            return transcribe_one(self.model, media, self.args, out_dir)
        except Exception as e:
            # El fallo de GPU no aparece al construir el modelo sino al iterar
            # los segmentos, asi que el fallback tiene que vivir tambien aca.
            if self.device != "cuda" or not is_gpu_error(e):
                raise
            self._caer_a_cpu(e)
            return transcribe_one(self.model, media, self.args, out_dir)

    def _caer_a_cpu(self, exc: BaseException) -> None:
        log(f"AVISO: fallo en GPU -> {exc.__class__.__name__}: {exc}")
        log("Faltan librerias de GPU (cuBLAS/cuDNN) o no son compatibles. "
            "Se continua en CPU con compute_type=int8; sera mas lento. "
            "Corre check_env.py para ver que falta.")
        self.device, self.compute_type = "cpu", "int8"
        self.model = build_model(self.args.model, self.device, self.compute_type)


if __name__ == "__main__":
    sys.exit(main())
