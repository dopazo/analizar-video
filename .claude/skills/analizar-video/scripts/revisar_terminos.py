# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Encuentra candidatos a termino mal transcrito en una transcripcion.

Apoyo para el paso de correccion (SKILL.md paso 3). No reemplaza leer el
transcript, pero pone los sospechosos arriba para no buscarlos a ojo.

Dos tablas, por orden de utilidad medida:

1. NOMBRES PROPIOS Y SIGLAS - palabras capitalizadas a mitad de frase. Es la
   señal fuerte: ahi caen los nombres de producto, empresas y siglas, que es
   justo donde Whisper falla ("Cloud" por "Claude", "Antropics" por
   "Anthropic"). Suelen ser algunas decenas, revisables de un vistazo.

2. PALABRAS POCO FRECUENTES - los inventos que no quedan capitalizados
   ("esquies" por "skills"). Mucho mas ruidosa: en un video de 34 minutos hay
   cientos de palabras que aparecen una sola vez y la mayoria son vocabulario
   normal. Sirve como segunda pasada, no como primera.

Lo que NINGUNA de las dos detecta son los homofonos plausibles en minuscula
("la pie" por "la API"): son palabras normales, correctas en si mismas. Para
eso hace falta el glosario (contexto_video.md).

Ver spec seccion 3.4.2.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

RE_TIMESTAMP = re.compile(r"^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s*")
RE_HEADER = re.compile(r"^\[[^\]]*\|[^\]]*\|[^\]]*\]\s*$")
_PALABRA = r"[^\W\d_]+(?:-[^\W\d_]+)*"
RE_PALABRA = re.compile(_PALABRA, re.UNICODE)
# Palabras y signos que cierran frase, en orden de aparicion.
RE_TOKEN = re.compile(rf"{_PALABRA}|[.!?]", re.UNICODE)


def normalizar(palabra: str) -> str:
    """Minusculas y sin acentos: comparar contra el glosario no debe fallar por
    un acento de diferencia."""
    desc = unicodedata.normalize("NFD", palabra.lower())
    return "".join(c for c in desc if unicodedata.category(c) != "Mn")


def leer_transcripcion(ruta: Path) -> list[tuple[int, str]]:
    """[(numero_de_linea, texto_sin_timestamp)]"""
    salida = []
    for i, linea in enumerate(ruta.read_text(encoding="utf-8").splitlines(), start=1):
        if RE_HEADER.match(linea):
            continue
        salida.append((i, RE_TIMESTAMP.sub("", linea).strip()))
    return salida


def cargar_exclusiones(rutas: list[Path], extra: str | None) -> set[str]:
    fuentes = []
    for r in rutas:
        if r.is_file():
            fuentes.append(r.read_text(encoding="utf-8"))
        else:
            print(f"AVISO: no existe {r}, se ignora.", file=sys.stderr)
    if extra:
        fuentes.append(extra)
    return {normalizar(p) for texto in fuentes for p in RE_PALABRA.findall(texto)}


class Registro:
    """Frecuencia, primera linea y forma original de cada palabra."""

    def __init__(self) -> None:
        self.frec: Counter[str] = Counter()
        self.linea: dict[str, int] = {}
        self.forma: dict[str, str] = {}

    def add(self, palabra: str, numero: int, clave: str) -> None:
        self.frec[clave] += 1
        if clave not in self.linea:
            self.linea[clave] = numero
            self.forma[clave] = palabra

    def filas(self, claves) -> list[tuple[int, str, int]]:
        return [(self.frec[c], self.forma[c], self.linea[c]) for c in claves]


def tabla(titulo: str, filas: list[tuple[int, str, int]], nota: str) -> None:
    print()
    print(f"## {titulo}")
    if nota:
        print(f"   {nota}")
    print()
    if not filas:
        print("   (ninguna)")
        return
    print(f"   {'frec':>4}  {'linea':>6}  palabra")
    print(f"   {'-' * 4}  {'-' * 6}  {'-' * 30}")
    for f, palabra, numero in filas:
        print(f"   {f:>4}  {numero:>6}  {palabra}")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Candidatos a termino mal transcrito en una transcripcion.")
    ap.add_argument("transcripcion", help="Ruta al .txt de transcripcion")
    ap.add_argument("--contexto", action="append", default=[], metavar="ARCHIVO",
                    help="Glosario/contexto cuyas palabras se excluyen (repetible)")
    ap.add_argument("--initial-prompt", default=None,
                    help="El initial-prompt usado al transcribir; se excluyen sus palabras")
    ap.add_argument("--top", type=int, default=40,
                    help="Filas de la tabla de poco frecuentes (default: 40)")
    ap.add_argument("--max-freq", type=int, default=2,
                    help="Poco frecuentes: frecuencia <= N (default: 2)")
    ap.add_argument("--min-len", type=int, default=4,
                    help="Ignora palabras de menos de N letras (default: 4)")
    args = ap.parse_args()

    ruta = Path(args.transcripcion).expanduser()
    if not ruta.is_file():
        print(f"ERROR: no existe {ruta}", file=sys.stderr)
        return 2

    lineas = leer_transcripcion(ruta)
    excluidas = cargar_exclusiones([Path(c).expanduser() for c in args.contexto],
                                   args.initial_prompt)

    todas = Registro()
    propios = Registro()

    for numero, texto in lineas:
        inicio_frase = True
        for tok in RE_TOKEN.findall(texto):
            if tok in ".!?":
                inicio_frase = True
                continue
            clave = normalizar(tok)
            if clave not in excluidas:
                if len(clave) >= args.min_len:
                    todas.add(tok, numero, clave)
                # Capitalizada sin ser inicio de frase: nombre propio o sigla.
                # Sin filtro de largo: las siglas tienen 2-4 letras (IA, EDA,
                # LLM) y son justo donde mas se equivoca la transcripcion.
                if not inicio_frase and tok[:1].isupper() and len(clave) >= 2:
                    propios.add(tok, numero, clave)
            inicio_frase = False

    print(f"# Revision de terminos: {ruta.name}")
    print(f"# {len(lineas)} lineas | {sum(todas.frec.values())} palabras analizadas "
          f"(>= {args.min_len} letras)"
          + (f" | {len(excluidas)} excluidas por glosario" if excluidas else ""))

    # Nombres propios: los mas repetidos primero, porque un error ahi se
    # propaga por todo el documento.
    claves_p = sorted(propios.frec, key=lambda c: (-propios.frec[c], propios.linea[c]))
    tabla("Nombres propios y siglas (revisar todos)", propios.filas(claves_p),
          "Capitalizadas a mitad de frase. Aca caen los errores que mas pesan.")

    raras = [c for c, f in todas.frec.items()
             if f <= args.max_freq and c not in propios.frec]
    raras.sort(key=lambda c: (todas.frec[c], todas.linea[c]))
    nota = (f"Frecuencia <= {args.max_freq}, sin las ya listadas arriba. "
            f"{len(raras)} en total: es una lista ruidosa, revisar por encima.")
    tabla(f"Palabras poco frecuentes (primeras {min(args.top, len(raras))})",
          todas.filas(raras[:args.top]), nota)

    if len(raras) > args.top:
        print()
        print(f"   # ... y {len(raras) - args.top} mas (--top N para ver mas)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
