# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "torch>=2.14",
#     "numpy",
#     # Primer release con Nemotron-3-Diarization (nemotron3_diarization).
#     "transformers>=5.24.1",
# ]
#
# [tool.uv.sources]
# # Wheel con CUDA en Windows/Linux (tambien corre en CPU); en macOS, el de PyPI.
# # CUDA 13.0: driver NVIDIA 580 o mas nuevo (con uno mas viejo corre en CPU) y
# # soporta las RTX 50. El indice cu128 dejo de recibir versiones en torch 2.11.
# torch = { index = "pytorch-cu130", marker = "sys_platform != 'darwin'" }
#
# [[tool.uv.index]]
# name = "pytorch-cu130"
# url = "https://download.pytorch.org/whl/cu130"
# explicit = true
# ///
"""Diarizacion (quien habla y cuando) con nvidia/Nemotron-3-Diarization.

Dos etapas, cada una cacheada junto al video:

1. Diarizar el audio -> <video>_diarizacion.json con segmentos
   {start, end, speaker}. Speaker es un indice anonimo 0..7 asignado por orden
   de llegada (el primero que habla es speaker_0).
2. Cruzar con el _palabras.jsonl de transcribe.py --words ->
   <transcripcion>_hablantes.txt, mismo formato que la transcripcion pero con
   el hablante: `[HH:MM:SS.mmm] speaker_N: texto`.

El cruce se hace palabra a palabra: cada palabra va al hablante cuyo tramo se
solapa mas con ella. Un segmento de Whisper que cruza un cambio de turno se
parte en dos lineas.

Uso:
  uv run scripts/diarizar.py reunion.mp4 --palabras <transcripcion>_palabras.jsonl
"""

from __future__ import annotations

import argparse
import bisect
import datetime as dt
import json
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import carpeta_analisis, fmt_ts, log  # noqa: E402

MODEL_ID = "nvidia/Nemotron-3-Diarization"
SR = 16000
# Un tramo de otro hablante mas corto que esto dentro de un segmento de Whisper
# se absorbe en el vecino: suele ser ruido de frontera, no un turno real.
MIN_PALABRAS_TRAMO = 2
# Palabra sin solape con ningun tramo: se asigna al tramo mas cercano si esta a
# menos de esto; si no, hereda el hablante de la palabra anterior.
TOLERANCIA_S = 1.0
# Union de lineas seguidas del mismo hablante (ver turnos()).
PAUSA_TURNO_S = 1.5
LARGO_LINEA = 200


# --------------------------------------------------------------------------
# Etapa 1: diarizar
# --------------------------------------------------------------------------

def cargar_audio(media: Path):
    import numpy as np
    cmd = ["ffmpeg", "-v", "error", "-i", str(media), "-ac", "1", "-ar", str(SR),
           "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def fuente_audio(media: Path) -> Path:
    cache = carpeta_analisis(media) / f"{media.stem}_audio.m4a"
    return cache if cache.is_file() and cache.stat().st_size > 0 else media


def reportar(dur: float, t0: float, dispositivo: str) -> None:
    import torch
    seg_s = time.perf_counter() - t0
    vram = (f", VRAM pico {torch.cuda.max_memory_allocated() / 2**20:.0f} MiB"
            if dispositivo == "cuda" else "")
    log(f"Diarizado en {seg_s:.1f} s (RTFx {dur / seg_s:.0f}{vram})")


def diarizar(media: Path, modo: str) -> tuple[list[dict], str]:
    import torch
    from transformers import AutoModelForAudioFrameClassification, AutoProcessor

    fuente = fuente_audio(media)
    log(f"Decodificando audio de {fuente.name}...")
    audio = cargar_audio(fuente)
    dur = len(audio) / SR
    log(f"Audio: {fmt_ts(dur)}")

    dispositivo = "cuda" if torch.cuda.is_available() else "cpu"
    log(f"Cargando {MODEL_ID} en {dispositivo}...")
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForAudioFrameClassification.from_pretrained(MODEL_ID).to(dispositivo)
    model.eval()
    if dispositivo == "cuda":
        torch.cuda.reset_peak_memory_stats()

    if modo == "offline":
        # Buffer de 30,4 s: la configuracion con mejor DER en la ficha.
        t0 = time.perf_counter()
        try:
            inputs = processor(audio, sampling_rate=SR).to(model.device, dtype=model.dtype)
            with torch.inference_mode():
                logits = model(**inputs).logits
            segs = processor.extract_speaker_dict(logits, inputs.attention_mask)[0]
            reportar(dur, t0, dispositivo)
            return [{"start": round(float(s["Start"]), 3), "end": round(float(s["End"]), 3),
                     "speaker": int(s["Speaker"])} for s in segs], modo
        except torch.OutOfMemoryError:
            log("Sin memoria en modo offline; se reintenta en streaming (low_latency).")
            torch.cuda.empty_cache()
            modo = "low_latency"

    processor.set_streaming_mode(modo)

    def chunks():
        yield processor(audio[: processor.num_samples_first_audio_chunk],
                        sampling_rate=SR, is_streaming=True, is_first_audio_chunk=True)
        mel = processor.num_mel_frames_per_step
        ini = processor.audio_chunk_start(mel)
        while (fin := ini + processor.num_samples_per_audio_chunk) <= len(audio):
            yield processor(audio[ini:fin], sampling_rate=SR, is_streaming=True,
                            is_first_audio_chunk=False)
            mel += processor.num_mel_frames_per_step
            ini = processor.audio_chunk_start(mel)
        yield processor(audio[ini:], sampling_rate=SR, is_streaming=True,
                        is_first_audio_chunk=False, is_last_audio_chunk=True)

    t0 = time.perf_counter()
    cache, logits = None, []
    ultimo = 0.0
    with torch.inference_mode():
        for inputs in chunks():
            inputs = inputs.to(model.device, dtype=model.dtype)
            out = model(**inputs, speaker_cache=cache)
            logits.append(out.logits)
            cache = out.speaker_cache
            avance = sum(x.shape[1] for x in logits) / 100  # frames de 10 ms
            if avance - ultimo >= 300:
                ultimo = avance
                log(f"  {fmt_ts(avance)} / {fmt_ts(dur)}")
    logits = torch.cat(logits, dim=1)
    segs = processor.extract_speaker_dict(logits)[0]
    reportar(dur, t0, dispositivo)
    return [{"start": round(float(s["Start"]), 3), "end": round(float(s["End"]), 3),
             "speaker": int(s["Speaker"])} for s in segs], modo


# --------------------------------------------------------------------------
# Etapa 2: cruzar palabras con hablantes
# --------------------------------------------------------------------------

class Indice:
    """Busca, para un intervalo, el hablante con mas solape."""

    def __init__(self, segs: list[dict]):
        self.segs = sorted(segs, key=lambda s: s["start"])
        self.starts = [s["start"] for s in self.segs]
        self.max_len = max((s["end"] - s["start"] for s in self.segs), default=0)

    def hablante(self, a: float, b: float) -> int | None:
        # Candidatos: tramos que empiezan antes de b y podrian llegar hasta a.
        hi = bisect.bisect_right(self.starts, b + TOLERANCIA_S)
        lo = bisect.bisect_left(self.starts, a - self.max_len - TOLERANCIA_S)
        solape: dict[int, float] = defaultdict(float)
        mejor_dist, mas_cerca = TOLERANCIA_S, None
        for s in self.segs[lo:hi]:
            o = min(b, s["end"]) - max(a, s["start"])
            if o > 0:
                solape[s["speaker"]] += o
            else:
                d = -o
                if d < mejor_dist:
                    mejor_dist, mas_cerca = d, s["speaker"]
        if solape:
            return max(solape, key=solape.get)
        return mas_cerca


def tramos_de_segmento(seg: dict, idx: Indice, previo: int | None):
    """Parte un segmento de Whisper en tramos [(hablante, inicio, texto)]."""
    palabras = seg["words"]
    if not palabras:
        h = idx.hablante(seg["start"], seg["end"])
        h = h if h is not None else previo
        return [(h, seg["start"], seg["end"], "")], h

    etiquetas = []
    for a, b, _ in palabras:
        h = idx.hablante(a, b)
        etiquetas.append(h if h is not None else previo)
        previo = etiquetas[-1]

    # Agrupar corridas consecutivas del mismo hablante.
    corridas = []  # [hablante, [indices]]
    for i, h in enumerate(etiquetas):
        if corridas and corridas[-1][0] == h:
            corridas[-1][1].append(i)
        else:
            corridas.append([h, [i]])

    # Absorber corridas cortas en la vecina mas larga.
    cambio = True
    while cambio and len(corridas) > 1:
        cambio = False
        for k, (h, ids) in enumerate(corridas):
            if len(ids) < MIN_PALABRAS_TRAMO:
                vecinos = [j for j in (k - 1, k + 1) if 0 <= j < len(corridas)]
                j = max(vecinos, key=lambda j: len(corridas[j][1]))
                corridas[j][1] = sorted(corridas[j][1] + ids)
                del corridas[k]
                # Fusionar vecinos que quedaron con el mismo hablante.
                fus = []
                for c in corridas:
                    if fus and fus[-1][0] == c[0]:
                        fus[-1][1].extend(c[1])
                    else:
                        fus.append(c)
                corridas = fus
                cambio = True
                break

    tramos = []
    for h, ids in corridas:
        texto = "".join(palabras[i][2] for i in ids).strip()
        tramos.append((h, palabras[ids[0]][0], palabras[ids[-1]][1], texto))
    return tramos, corridas[-1][0]


def turnos(tramos: list[tuple]) -> list[tuple]:
    """Une tramos seguidos del mismo hablante en una sola linea.

    Whisper a veces corta en pedazos de 1-3 palabras (sobre todo despues de
    entrar en bucle); sin esto, un mismo turno queda en decenas de lineas.
    Se corta igual ante una pausa larga o si la linea ya es larga, para que
    cada marca de tiempo siga sirviendo para saltar al punto del video.
    """
    out: list[list] = []
    for h, ini, fin, texto in tramos:
        if (out and out[-1][0] == h and ini - out[-1][2] <= PAUSA_TURNO_S
                and len(out[-1][3]) < LARGO_LINEA):
            out[-1][2] = fin
            out[-1][3] += " " + texto
        else:
            out.append([h, ini, fin, texto])
    return [tuple(t) for t in out]


def etiqueta(h: int | None) -> str:
    return "speaker_?" if h is None else f"speaker_{h}"


def combinar(palabras_path: Path, segs: list[dict]) -> Path:
    txt = palabras_path.with_name(palabras_path.name.replace("_palabras.jsonl", ".txt"))
    header = txt.read_text(encoding="utf-8").splitlines()[0] if txt.is_file() else ""
    out = palabras_path.with_name(palabras_path.name.replace("_palabras.jsonl", "_hablantes.txt"))

    idx = Indice(segs)
    previo = None
    stats = defaultdict(lambda: {"palabras": 0, "lineas": 0, "primera": None, "muestras": []})
    lineas = []
    todos = []
    for linea in palabras_path.read_text(encoding="utf-8").splitlines():
        seg = json.loads(linea)
        tramos, previo = tramos_de_segmento(seg, idx, previo)
        todos.extend(t for t in tramos if t[3])
    for h, ini, _, texto in turnos(todos):
        lineas.append(f"[{fmt_ts(ini)}] {etiqueta(h)}: {texto}")
        st = stats[etiqueta(h)]
        st["palabras"] += len(texto.split())
        st["lineas"] += 1
        st["primera"] = st["primera"] or fmt_ts(ini)
        st["muestras"].append((len(texto), fmt_ts(ini), texto))

    if header.startswith("["):
        header = header.replace("|", f"+ {MODEL_ID.split('/')[1]} |", 1)
    out.write_text("\n".join([header, *lineas]) + "\n", encoding="utf-8")

    # Resumen por hablante: es lo que se usa despues para ponerles nombre.
    seg_por_h = defaultdict(float)
    for s in segs:
        seg_por_h[etiqueta(s["speaker"])] += s["end"] - s["start"]
    log("\nHablante     tiempo   palabras  lineas  primera vez")
    for h in sorted(stats, key=lambda k: -stats[k]["palabras"]):
        st = stats[h]
        log(f"{h:<11} {fmt_ts(seg_por_h.get(h, 0))[:8]}  {st['palabras']:>8}  "
            f"{st['lineas']:>6}  {st['primera']}")
    # Las lineas mas largas de cada uno: los mejores puntos para sacar un frame
    # (Teams/Meet/Zoom destacan a quien habla) o para reconocer a la persona.
    log("\nLineas mas largas por hablante (para identificarlos):")
    for h in sorted(stats, key=lambda k: -stats[k]["palabras"]):
        log(f"  {h}:")
        for _, ts, texto in sorted(stats[h]["muestras"], reverse=True)[:3]:
            log(f"    [{ts}] {texto[:110]}")
    log(f"\nTranscripcion con hablantes en: {out}")
    return out


# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="Video o audio")
    ap.add_argument("--palabras", help="<transcripcion>_palabras.jsonl de transcribe.py --words")
    ap.add_argument("--modo", default="offline",
                    choices=["offline", "low_latency", "very_low_latency", "ultra_low_latency"])
    ap.add_argument("--rehacer", action="store_true",
                    help="Vuelve a diarizar aunque exista el .json cacheado")
    args = ap.parse_args()

    media = Path(args.input).resolve()
    diar = carpeta_analisis(media) / f"{media.stem}_diarizacion.json"
    if diar.is_file() and not args.rehacer:
        log(f"Reutilizando {diar.name}")
        segs = json.loads(diar.read_text(encoding="utf-8"))["segmentos"]
    else:
        segs, modo = diarizar(media, args.modo)
        diar.parent.mkdir(parents=True, exist_ok=True)
        diar.write_text(json.dumps({
            "modelo": MODEL_ID, "modo": modo,
            "fecha": dt.datetime.now().strftime("%y-%m-%d %H:%M:%S"),
            "segmentos": segs,
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        log(f"Diarizacion guardada en: {diar} ({len(segs)} tramos, "
            f"{len({s['speaker'] for s in segs})} hablantes)")

    if args.palabras:
        combinar(Path(args.palabras).resolve(), segs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
