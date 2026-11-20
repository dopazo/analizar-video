"""Visor local: el video con su transcripción sincronizada, en el navegador.

    uv run scripts/visor.py reunion.mp4            # abre el navegador
    uv run scripts/visor.py reunion.mp4 --no-open  # solo imprime la URL

Toma la transcripción más reciente de <video>_analisis/ (con la misma
preferencia que el resto de la skill: _hablantes_corregido > _hablantes >
_corregido > crudo) y, si existe, el _palabras.jsonl de esa corrida para
resaltar palabra a palabra. El resumen y el índice más recientes, si existen,
aparecen como pestañas; sus [HH:MM:SS] llevan a ese momento del video.

Se cierra solo: vive mientras haya una pestaña del visor abierta y termina
~12 s después de cerrar la última (una recarga no lo cierra). Si nadie abre la
URL en 10 minutos, también termina. --mantener lo desactiva.

Solo stdlib. Sirve la UI ya compilada (carpeta visor/ de la skill), el video
con soporte de Range (sin eso el navegador no puede adelantar) y los datos en
/api/datos. Escucha solo en 127.0.0.1.

Si el contenedor no se reproduce en un navegador (mkv, avi, wmv...), lo remuxea
con ffmpeg a <video>_analisis/<video>_visor.mp4 sin recodificar; si el códec
tampoco sirve, recodifica a H.264/AAC. Se hace una vez y queda en caché.
"""

from __future__ import annotations

import argparse
import http.server
import json
import mimetypes
import os
import re
import shutil
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import AUDIO_EXTS, carpeta_analisis  # noqa: E402

UI_DIR = Path(__file__).resolve().parent.parent / "visor"

# Lo que Chrome/Edge/Firefox reproducen sin ayuda (si el códec interno es H.264/AAC/VP9/Opus).
NATIVOS = {".mp4", ".m4v", ".webm", ".mov", ".mp3", ".m4a", ".wav", ".ogg",
           ".opus", ".flac", ".aac"}

PREFERENCIA = ["_hablantes_corregido.txt", "_hablantes.txt", "_corregido.txt", ".txt"]
RE_BASE = re.compile(r"^(?P<base>.+_transcripcion_\d{6}_\d{6})(?P<suf>.*)\.txt$")
RE_LINEA = re.compile(r"^\[(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]\s?(.*)$")
RE_HABLANTE = re.compile(r"^([^:]{1,60}):\s(.*)$")


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# --- Transcripción ---------------------------------------------------------

def elegir_transcripcion(media: Path) -> tuple[Path, Path | None] | None:
    """Devuelve (txt preferido, _palabras.jsonl o None) de la corrida más reciente."""
    carpeta = carpeta_analisis(media)
    corridas: dict[str, dict[str, Path]] = {}
    for f in carpeta.glob(f"{media.stem}_transcripcion_*.txt"):
        m = RE_BASE.match(f.name)
        if m:
            corridas.setdefault(m["base"], {})[m["suf"] + ".txt"] = f
    if not corridas:
        return None
    base = max(corridas)  # el timestamp yymmdd_hhmmss ordena bien como texto
    archivos = corridas[base]
    txt = next(archivos[s] for s in PREFERENCIA if s in archivos)
    palabras = carpeta / f"{base}_palabras.jsonl"
    return txt, (palabras if palabras.is_file() else None)


def leer_lineas(txt: Path) -> tuple[str, list[dict]]:
    contenido = txt.read_text(encoding="utf-8").splitlines()
    header = contenido[0] if contenido and contenido[0].startswith("[") and "|" in contenido[0] else ""
    con_hablantes = "_hablantes" in txt.name
    lineas = []
    for raw in contenido[1 if header else 0:]:
        m = RE_LINEA.match(raw.strip())
        if not m:
            continue
        h, mi, s, texto = m.groups()
        hablante = None
        if con_hablantes:
            mh = RE_HABLANTE.match(texto)
            if mh:
                hablante, texto = mh.group(1).strip(), mh.group(2)
        lineas.append({"start": int(h) * 3600 + int(mi) * 60 + float(s),
                       "text": texto.strip(), "speaker": hablante})
    return header, lineas


def leer_palabras(path: Path) -> list[tuple[float, float, str]]:
    palabras = []
    for linea in path.read_text(encoding="utf-8").splitlines():
        if linea.strip():
            for a, b, w in json.loads(linea).get("words", []):
                if w.strip():
                    palabras.append((float(a), float(b), w.strip()))
    return palabras


def asignar_palabras(lineas: list[dict], palabras: list[tuple[float, float, str]]) -> None:
    """Reparte las palabras con tiempo entre las líneas, por ventana temporal.

    La línea puede venir corregida (otro texto que el que oyó Whisper) o ser un
    turno que junta varios segmentos. Si la cantidad de tokens coincide, se usa
    el texto de la línea con los tiempos de Whisper; si no, la línea queda sin
    palabras y la UI la resalta completa.
    """
    j = 0
    for i, ln in enumerate(lineas):
        fin = lineas[i + 1]["start"] if i + 1 < len(lineas) else float("inf")
        propias = []
        while j < len(palabras) and palabras[j][0] < fin - 0.02:
            if palabras[j][0] >= ln["start"] - 0.25:
                propias.append(palabras[j])
            j += 1
        tokens = ln["text"].split()
        if propias and len(tokens) == len(propias):
            ln["words"] = [[round(a, 3), round(b, 3), t] for (a, b, _), t in zip(propias, tokens)]
            ln["end"] = round(propias[-1][1], 3)
        if propias and "end" not in ln:
            ln["end"] = round(propias[-1][1], 3)


# Documentos que la skill escribe junto a la transcripción y que el visor muestra
# en pestañas. De cada tipo, el más reciente (el timestamp del nombre ordena).
DOCUMENTOS = [("resumen", "Resumen"), ("indice", "Índice")]
IMAGENES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def leer_documentos(media: Path) -> list[dict]:
    carpeta = carpeta_analisis(media)
    docs = []
    for tipo, titulo in DOCUMENTOS:
        candidatos = sorted(carpeta.glob(f"{media.stem}_{tipo}_*.md"))
        if candidatos:
            f = candidatos[-1]
            docs.append({"tipo": tipo, "titulo": titulo, "archivo": f.name,
                         "md": f.read_text(encoding="utf-8")})
    return docs


def armar_datos(media: Path, url_media: str) -> dict:
    elegida = elegir_transcripcion(media)
    datos: dict = {"video": {"nombre": media.name, "url": url_media,
                             "audio": media.suffix.lower() in AUDIO_EXTS},
                   "transcripcion": None, "hablantes": [],
                   "documentos": leer_documentos(media)}
    if not elegida:
        return datos
    txt, palabras_path = elegida
    header, lineas = leer_lineas(txt)
    if palabras_path:
        asignar_palabras(lineas, leer_palabras(palabras_path))
    for i, ln in enumerate(lineas):
        if "end" not in ln:
            ln["end"] = lineas[i + 1]["start"] if i + 1 < len(lineas) else ln["start"] + 5
        ln["start"] = round(ln["start"], 3)
    datos["transcripcion"] = {"archivo": txt.name, "header": header,
                              "palabras": bool(palabras_path), "lineas": lineas}
    orden: list[str] = []
    for ln in lineas:
        if ln["speaker"] and ln["speaker"] not in orden:
            orden.append(ln["speaker"])
    datos["hablantes"] = orden
    return datos


# --- Video -----------------------------------------------------------------

def preparar_media(media: Path) -> Path:
    if media.suffix.lower() in NATIVOS:
        return media
    destino = carpeta_analisis(media) / f"{media.stem}_visor.mp4"
    if destino.is_file() and destino.stat().st_mtime >= media.stat().st_mtime:
        return destino
    if not shutil.which("ffmpeg"):
        log(f"AVISO: {media.suffix} puede no reproducirse en el navegador y no hay ffmpeg para convertirlo.")
        return media
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".tmp.mp4")
    base = ["ffmpeg", "-y", "-v", "error", "-i", str(media)]
    log(f"Preparando {media.name} para el navegador (remux sin recodificar)...")
    r = subprocess.run(base + ["-c", "copy", "-movflags", "+faststart", str(tmp)])
    if r.returncode != 0:
        log("El códec no entra en MP4: recodificando a H.264/AAC (puede tardar)...")
        r = subprocess.run(base + ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                                   "-c:a", "aac", "-movflags", "+faststart", str(tmp)])
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        log("AVISO: no se pudo convertir; se sirve el original.")
        return media
    tmp.replace(destino)
    return destino


# --- Servidor --------------------------------------------------------------

# --- Autocierre ---------------------------------------------------------------
# El servidor vive mientras haya una pestaña del visor abierta. Cada pestaña
# mantiene abierta una conexión SSE (/api/vivo); al cerrarla, el navegador la
# corta y el servidor lo nota en el siguiente latido. Así no quedan servidores
# huérfanos corriendo por detrás cuando el usuario solo cierra la ventana.

LATIDO = 3            # s entre latidos por la conexión SSE
GRACIA = 12           # s sin pestañas antes de cerrar (una recarga no lo cierra)
ESPERA_INICIAL = 600  # s para que alguien abra la URL antes de rendirse


class Presencia:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.pestanas = 0
        self.alguna_vez = False
        self.desde = time.monotonic()  # desde cuándo está en 0 pestañas

    def entra(self) -> None:
        with self.lock:
            self.pestanas += 1
            self.alguna_vez = True

    def sale(self) -> None:
        with self.lock:
            self.pestanas -= 1
            if self.pestanas == 0:
                self.desde = time.monotonic()

    def motivo_para_cerrar(self) -> str | None:
        with self.lock:
            if self.pestanas > 0:
                return None
            quieto = time.monotonic() - self.desde
            if self.alguna_vez and quieto > GRACIA:
                return "se cerro la ventana del visor"
            if not self.alguna_vez and quieto > ESPERA_INICIAL:
                return f"nadie abrio el visor en {ESPERA_INICIAL // 60} minutos"
            return None


PRESENCIA = Presencia()


def vigilar(srv: "Servidor") -> None:
    while True:
        time.sleep(1)
        motivo = PRESENCIA.motivo_para_cerrar()
        if motivo:
            print(f"Visor cerrado: {motivo}.", flush=True)
            srv.shutdown()  # desde otro hilo: serve_forever() vuelve y main() termina
            return


class Handler(http.server.BaseHTTPRequestHandler):
    media: Path      # lo que se sirve (puede ser el remux)
    original: Path   # el video que pidió el usuario: de ahí salen los datos

    def log_message(self, fmt, *args):  # silencioso: el navegador pide muchos rangos
        pass

    def _host_ok(self) -> bool:
        # Guardia contra DNS rebinding: solo nombres locales.
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
        return host in {"127.0.0.1", "localhost", "[::1]"}

    def do_GET(self):
        self._servir(cuerpo=True)

    def do_HEAD(self):
        self._servir(cuerpo=False)

    def _servir(self, cuerpo: bool):
        if not self._host_ok():
            return self.send_error(403)
        url = urlparse(self.path)
        ruta = unquote(url.path)
        if ruta == "/api/datos":
            # Se arma en cada carga: un resumen o índice escrito con el visor
            # abierto aparece al recargar la página.
            datos = armar_datos(self.original, "media")
            data = json.dumps(datos, ensure_ascii=False).encode("utf-8")
            return self._enviar(200, "application/json; charset=utf-8", data, cuerpo)
        if ruta == "/media":
            return self._servir_media(cuerpo)
        if ruta == "/api/vivo":
            return self._vivo()
        if ruta == "/analisis":
            return self._servir_imagen(parse_qs(url.query).get("ruta", [""])[0], cuerpo)
        return self._servir_ui(ruta, cuerpo)

    def _vivo(self):
        """Conexión SSE que dura lo que dura la pestaña: es la señal de presencia."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        PRESENCIA.entra()
        try:
            while True:
                self.wfile.write(b"event: latido\ndata: {}\n\n")
                self.wfile.flush()
                time.sleep(LATIDO)
        except OSError:  # BrokenPipe / ConnectionReset / ConnectionAborted (Windows)
            pass
        finally:
            PRESENCIA.sale()

    def _servir_imagen(self, pedida: str, cuerpo: bool):
        """Frames que un resumen referencia. Solo imágenes dentro de <video>_analisis/."""
        carpeta = carpeta_analisis(self.original).resolve()
        p = Path(pedida)
        destino = (p if p.is_absolute() else carpeta / p).resolve()
        if (carpeta not in destino.parents or destino.suffix.lower() not in IMAGENES
                or not destino.is_file()):
            return self.send_error(404)
        tipo = mimetypes.guess_type(destino.name)[0] or "application/octet-stream"
        self._enviar(200, tipo, destino.read_bytes(), cuerpo)

    def _enviar(self, code: int, tipo: str, data: bytes, cuerpo: bool, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if cuerpo:
            self.wfile.write(data)

    def _servir_ui(self, ruta: str, cuerpo: bool):
        if not UI_DIR.is_dir():
            msg = b"No esta compilada la UI (carpeta visor/ de la skill)."
            return self._enviar(500, "text/plain; charset=utf-8", msg, cuerpo)
        destino = (UI_DIR / ruta.lstrip("/")).resolve()
        if ruta in ("", "/") or not destino.is_file():
            destino = UI_DIR / "index.html"
        if UI_DIR.resolve() not in destino.resolve().parents:
            return self.send_error(404)
        tipo = mimetypes.guess_type(destino.name)[0] or "application/octet-stream"
        if tipo.startswith("text/") or tipo.endswith("javascript"):
            tipo += "; charset=utf-8"
        self._enviar(200, tipo, destino.read_bytes(), cuerpo)

    def _servir_media(self, cuerpo: bool):
        size = self.media.stat().st_size
        tipo = mimetypes.guess_type(self.media.name)[0] or "application/octet-stream"
        rango = self.headers.get("Range")
        inicio, fin, code = 0, size - 1, 200
        if rango:
            m = re.match(r"bytes=(\d*)-(\d*)$", rango.strip())
            if not m or (not m.group(1) and not m.group(2)):
                return self._rango_invalido(size)
            if m.group(1):
                inicio = int(m.group(1))
                fin = int(m.group(2)) if m.group(2) else size - 1
            else:  # sufijo: los últimos N bytes
                inicio = max(size - int(m.group(2)), 0)
            fin = min(fin, size - 1)
            if inicio > fin:
                return self._rango_invalido(size)
            code = 206
        largo = fin - inicio + 1
        self.send_response(code)
        self.send_header("Content-Type", tipo)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(largo))
        if code == 206:
            self.send_header("Content-Range", f"bytes {inicio}-{fin}/{size}")
        self.end_headers()
        if not cuerpo:
            return
        try:
            with self.media.open("rb") as fh:
                fh.seek(inicio)
                restante = largo
                while restante > 0:
                    trozo = fh.read(min(1 << 20, restante))
                    if not trozo:
                        break
                    self.wfile.write(trozo)
                    restante -= len(trozo)
        except (BrokenPipeError, ConnectionResetError):
            pass  # el navegador corta conexiones al adelantar: es normal

    def _rango_invalido(self, size: int):
        self.send_response(416)
        self.send_header("Content-Range", f"bytes */{size}")
        self.send_header("Content-Length", "0")
        self.end_headers()


class Servidor(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    # En Windows SO_REUSEADDR deja a dos procesos escuchar el mismo puerto: el
    # segundo visor "robaría" conexiones al primero. Ahí se desactiva.
    allow_reuse_address = os.name != "nt"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="Video o audio")
    ap.add_argument("--port", type=int, default=4810)
    ap.add_argument("--no-open", action="store_true", help="No abrir el navegador")
    ap.add_argument("--mantener", action="store_true",
                    help="No cerrarse solo al cerrar la ventana (para desarrollar la UI)")
    args = ap.parse_args()

    media = Path(args.input).resolve()
    if not media.is_file():
        log(f"No existe: {media}")
        return 2

    Handler.media = preparar_media(media)
    Handler.original = media
    datos = armar_datos(media, "media")
    t = datos["transcripcion"]
    if t:
        log(f"Transcripcion: {t['archivo']} ({len(t['lineas'])} lineas"
            f"{', palabra a palabra' if t['palabras'] else ''})")
    else:
        log("AVISO: no hay transcripcion en "
            f"{carpeta_analisis(media).name}/; el visor mostrara solo el video.")
    for d in datos["documentos"]:
        log(f"{d['titulo']}: {d['archivo']}")

    srv = None
    for puerto in range(args.port, args.port + 20):
        try:
            srv = Servidor(("127.0.0.1", puerto), Handler)
            break
        except OSError:
            continue
    if srv is None:
        log(f"No hay puerto libre entre {args.port} y {args.port + 19}")
        return 1
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    if args.mantener:
        print(f"Visor en {url}  (Ctrl+C para cerrar)", flush=True)
    else:
        print(f"Visor en {url}  (se cierra solo al cerrar la ventana)", flush=True)
        threading.Thread(target=vigilar, args=(srv,), daemon=True).start()
    if not args.no_open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
