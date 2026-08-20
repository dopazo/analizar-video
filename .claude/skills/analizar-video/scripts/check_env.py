# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Diagnostica el entorno para la skill analizar-video.

Solo stdlib: tiene que poder correr aunque falte todo lo demas.
Ver spec seccion 3.7 y 7.3.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import re
import shutil
import subprocess
import sys

from _comun import (
    MODEL_SIZES_MB, correr, dirs_site_packages, escanear_modelos, hf_cache_dir,
)

PY_DEPS = {
    "faster_whisper": "faster-whisper",
    "ctranslate2": "ctranslate2",
}

# Como habilitar la GPU sin instalar nada global (ver decision 17 del spec).
GPU_HINT = ('uv run --with nvidia-cublas-cu12 --with "nvidia-cudnn-cu12>=9,<10" '
            '<skill>/scripts/transcribe.py <archivo> --device cuda')

# Umbrales de VRAM libre (MiB) -> nivel de modelo sugerido.
# Pendiente spec 8.2.2: afinar empiricamente. Valores conservadores por ahora.
VRAM_TIERS = [
    (6000, "large-v3", "float16"),
    (3500, "large-v3-turbo", "float16"),
    (2000, "medium", "float16"),
]

CPU_FALLBACK = ("small", "int8")


def modelos_locales() -> dict:
    """Que modelos hay descargados y cuanto ocupan.

    Los pesos se acumulan en la cache de Hugging Face y nadie los limpia: hay
    que poder ver que hay antes de bajar uno mas.
    """
    descargados = escanear_modelos()
    return {
        "ruta": str(hf_cache_dir()),
        "descargados": [{"modelo": m, "mb": mb} for m, mb in
                        sorted(descargados.items(), key=lambda kv: -kv[1])],
        "total_mb": sum(descargados.values()),
        "faltantes": [m for m in MODEL_SIZES_MB if m not in descargados],
    }


def gpu_info() -> dict:
    info = {"available": False, "name": None, "vram_free_mib": None,
            "vram_total_mib": None, "driver_version": None, "cuda_version": None}
    if not shutil.which("nvidia-smi"):
        return info

    out = correr(["nvidia-smi",
               "--query-gpu=name,memory.free,memory.total,driver_version",
                  "--format=csv,noheader,nounits"], timeout=20)
    if not out or not out.strip():
        return info

    first = out.strip().splitlines()[0]
    parts = [p.strip() for p in first.split(",")]
    if len(parts) >= 4:
        info.update(available=True, name=parts[0], driver_version=parts[3])
        for key, val in (("vram_free_mib", parts[1]), ("vram_total_mib", parts[2])):
            try:
                info[key] = int(float(val))
            except ValueError:
                pass

    raw = correr(["nvidia-smi"], timeout=20) or ""
    m = re.search(r"CUDA Version:\s*([\d.]+)", raw)
    if m:
        info["cuda_version"] = m.group(1)
    return info


def cuda_libs_present() -> bool | None:
    """Heuristica: estan cuBLAS/cuDNN donde CTranslate2 los va a buscar?

    Tener driver NVIDIA no alcanza: CTranslate2 carga cublas64_12.dll /
    libcublas en tiempo de ejecucion, y si falta, el fallo aparece recien al
    transcribir. None = no se pudo determinar.
    """
    es_windows = platform.system() == "Windows"
    nombres = (["cublas64_12.dll", "cublas64_11.dll"] if es_windows
               else ["libcublas.so.12", "libcublas.so.11"])

    candidatos = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p]
    if not es_windows:
        candidatos += [p for p in os.environ.get("LD_LIBRARY_PATH", "").split(os.pathsep) if p]
        candidatos += ["/usr/lib/x86_64-linux-gnu", "/usr/local/cuda/lib64"]
    # Las wheels de pip (nvidia-cublas-cu12) las dejan aca. Mismo lugar que
    # registra transcribe.register_cuda_libs, para que ambos coincidan.
    candidatos += [str(d) for d in dirs_site_packages()]

    for d in candidatos:
        for n in nombres:
            try:
                if os.path.isfile(os.path.join(d, n)):
                    return True
            except OSError:
                continue
    return False


def python_deps() -> dict:
    return {pkg: importlib.util.find_spec(mod) is not None
            for mod, pkg in PY_DEPS.items()}


def _cpu(reason: str) -> dict:
    modelo, ct = CPU_FALLBACK
    return {"device": "cpu", "model": modelo, "compute_type": ct, "reason": reason}


def suggest(gpu: dict, cuda_libs: bool | None, descargados: dict[str, int]) -> dict:
    """Nivel de modelo sugerido segun GPU, VRAM libre y que hay descargado."""
    if not gpu["available"]:
        return _cpu("No se detecto GPU NVIDIA: CPU con cuantizacion int8.")

    if cuda_libs is False:
        return _cpu("Hay GPU, pero no se encontraron las librerias cuBLAS/cuDNN "
                    "que CTranslate2 necesita. Ver gpu_enable_hint.")

    libre = gpu["vram_free_mib"]
    if libre is None:
        elegido, ct = "large-v3-turbo", "float16"
        motivo = "GPU detectada pero no se pudo leer la VRAM libre: nivel balanceado."
    else:
        for umbral, modelo, tipo in VRAM_TIERS:
            if libre >= umbral:
                elegido, ct = modelo, tipo
                motivo = f"{libre} MiB de VRAM libre (>= {umbral} MiB)."
                break
        else:
            return _cpu(f"Solo {libre} MiB de VRAM libre: no alcanza con holgura, "
                        "conviene CPU int8 antes que arriesgar un OOM a mitad de "
                        "corrida.")

    # SKILL.md pide preferir un modelo ya descargado; el script tiene el dato,
    # asi que lo hace cumplir en vez de dejarlo como sugerencia en prosa.
    if descargados and elegido not in descargados:
        alternativa = next((m for _, m, _ in VRAM_TIERS if m in descargados), None)
        if alternativa:
            motivo += (f" {elegido} no esta descargado ({MODEL_SIZES_MB[elegido]} MB); "
                       f"se sugiere {alternativa}, que ya esta.")
            elegido = alternativa

    return {"device": "cuda", "model": elegido, "compute_type": ct, "reason": motivo}


def ffmpeg_install_cmd() -> str:
    system = platform.system()
    if system == "Windows":
        return "winget install --id Gyan.FFmpeg -e"
    if system == "Darwin":
        return "brew install ffmpeg"
    return "sudo apt install ffmpeg"


def collect() -> dict:
    gpu = gpu_info()
    deps = python_deps()
    cuda_libs = cuda_libs_present() if gpu["available"] else None
    modelos = modelos_locales()
    descargados = {d["modelo"]: d["mb"] for d in modelos["descargados"]}
    report = {
        "os": f"{platform.system()} {platform.release()}",
        "python": sys.version.split()[0],
        "uv": shutil.which("uv") is not None,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ffprobe": shutil.which("ffprobe") is not None,
        "gpu": gpu,
        "cuda_libs_present": cuda_libs,
        "python_deps": deps,
        "suggested": suggest(gpu, cuda_libs, descargados),
        "modelos": modelos,
        "gpu_enable_hint": None,
        "warnings": [],
        "missing": [],
    }

    if not report["ffmpeg"]:
        report["missing"].append("ffmpeg")
        report["warnings"].append(
            "Falta el binario ffmpeg (necesario para extraer frames). "
            "Instalar con: " + ffmpeg_install_cmd())

    missing_py = [pkg for pkg, ok in deps.items() if not ok]
    if missing_py:
        report["missing"].extend(missing_py)
        if report["uv"]:
            report["warnings"].append(
                "Faltan dependencias de Python en este interprete, pero con "
                "'uv run <skill>/scripts/transcribe.py ...' no hace falta instalarlas: "
                "uv resuelve el bloque PEP 723 del propio script en un entorno aislado.")
        else:
            report["warnings"].append(
                "Faltan dependencias de Python: " + ", ".join(missing_py) +
                ". Instalar con: pip install " + " ".join(missing_py) +
                "  (o instalar uv, que las resuelve solo al correr los scripts).")

    if cuda_libs is False:
        report["gpu_enable_hint"] = GPU_HINT
        report["warnings"].append(
            "Hay GPU NVIDIA pero no se encontraron cuBLAS/cuDNN, que es lo que "
            "CTranslate2 carga al transcribir (el fallo tipico aparece recien a "
            "mitad de corrida: 'cublas64_12.dll is not found'). Sin eso la GPU no "
            "se usa: transcribe.py lo detecta y sigue en CPU. Para habilitarla, "
            "agrega las librerias a la propia corrida:\n    " + GPU_HINT +
            "\n  (o, si usas tu propio entorno de Python en vez de uv: "
            "pip install nvidia-cublas-cu12 \"nvidia-cudnn-cu12>=9,<10\")")

    cuda = gpu.get("cuda_version")
    if gpu["available"] and cuda:
        try:
            major = int(cuda.split(".")[0])
        except ValueError:
            major = 99  # ilegible: no vale la pena avisar de un pin de version
        if major < 12:
            report["warnings"].append(
                "El driver reporta CUDA " + cuda + ". Las versiones recientes de "
                "ctranslate2 requieren CUDA 12 + cuDNN 9: hay que fijar "
                "'ctranslate2==3.24.0' en pyproject.toml o usar CPU.")
    return report


def print_human(r: dict) -> None:
    gpu = r["gpu"]
    print("=== Entorno para analizar-video ===")
    print("SO           : " + r["os"])
    print("Python       : " + r["python"])
    print("uv           : " + ("si" if r["uv"] else "no (opcional pero recomendado)"))
    print("ffmpeg       : " + ("si" if r["ffmpeg"] else "NO"))
    if gpu["available"]:
        if gpu["vram_free_mib"] is not None:
            vram = f"{gpu['vram_free_mib']} MiB libres de {gpu['vram_total_mib']} MiB"
        else:
            vram = "VRAM desconocida"
        print(f"GPU          : {gpu['name']} ({vram})")
        print(f"CUDA / driver: {gpu['cuda_version'] or '?'} / {gpu['driver_version'] or '?'}")
        libs = r["cuda_libs_present"]
        print("cuBLAS/cuDNN : " + {True: "si", False: "NO encontradas",
                                   None: "no determinado"}[libs])
    else:
        print("GPU          : no se detecto GPU NVIDIA")
    print("Dependencias :")
    for pkg, ok in r["python_deps"].items():
        print(f"  - {pkg}: {'presente' if ok else 'ausente'}")

    m = r["modelos"]
    print("")
    print("--- Modelos de Whisper descargados ---")
    if m["descargados"]:
        for d in m["descargados"]:
            print(f"  - {d['modelo']:<16} {d['mb']:>5} MB")
        print(f"  Total: {m['total_mb']} MB en {m['ruta']}")
    else:
        print(f"  Ninguno todavia. Se descargaran a {m['ruta']}")
    if m["faltantes"]:
        pend = ", ".join(f"{n} (~{MODEL_SIZES_MB[n]} MB)" for n in m["faltantes"])
        print(f"  Sin descargar: {pend}")

    s = r["suggested"]
    print("")
    print("--- Sugerencia ---")
    print(f"  --model {s['model']} --device {s['device']} --compute-type {s['compute_type']}")
    print("  Motivo: " + s["reason"])

    print("")
    if r["warnings"]:
        print("--- Pendientes ---")
        for w in r["warnings"]:
            print("  * " + w)
    else:
        print("Todo listo: no falta nada para transcribir ni extraer frames.")


def do_install(r: dict, assume_yes: bool) -> int:
    if not r["missing"]:
        print("")
        print("Nada que instalar.")
        return 0

    print("")
    print("--- Instalacion ---")
    print("Falta: " + ", ".join(r["missing"]))

    if "ffmpeg" not in r["missing"]:
        print("Las dependencias de Python no se instalan desde aqui: usa el comando "
              "indicado arriba, o corre los scripts con 'uv run' y se resuelven solas.")
        return 0

    cmd = ffmpeg_install_cmd()
    if not assume_yes:
        interactive = bool(sys.stdin) and sys.stdin.isatty()
        if not interactive:
            print("Comando a ejecutar: " + cmd)
            print("Volve a correr con --install --yes para ejecutarlo.")
            return 0
        answer = input("Ejecutar '" + cmd + "'? [s/N] ").strip().lower()
        if answer not in {"s", "si", "y", "yes"}:
            print("Cancelado. Comando para correr a mano: " + cmd)
            return 0

    print("Ejecutando: " + cmd)
    rc = subprocess.run(cmd, shell=True).returncode
    if rc != 0:
        print(f"La instalacion fallo (codigo {rc}). Corre a mano: {cmd}")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser(description="Diagnostica el entorno de la skill.")
    ap.add_argument("--install", action="store_true",
                    help="Tras diagnosticar, instala lo que falte (pide confirmacion)")
    ap.add_argument("--yes", action="store_true",
                    help="No preguntar al instalar (solo si el usuario ya confirmo)")
    ap.add_argument("--json", action="store_true", help="Salida estructurada")
    args = ap.parse_args()

    report = collect()

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_human(report)

    if args.install:
        return do_install(report, args.yes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
