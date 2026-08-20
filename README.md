# analizar-video

Skill para que tu agente de código (Claude Code, Codex, etc.)
**trabaje con grabaciones locales**: transcribirlas con timestamps, preguntarles
cosas, sacar actas, y mirar lo que se mostró en pantalla, todo sin subir el
archivo a ningún lado.

Pensada para reuniones internas, levantamientos de requerimientos con clientes y
walkthroughs de procesos.

Son cuatro scripts de Python sin estado y un archivo de instrucciones. Los
scripts los puede invocar cualquier agente —o tú a mano—; el archivo de
instrucciones le enseña al agente cuándo y cómo usarlos.

## Instalar

Párate en la carpeta donde quieras la skill —`~/.claude/skills/` para tenerla en
todos tus proyectos— y descárgala sin clonar el repo:

```bash
curl -sL https://github.com/dopazo/analizar-video/archive/refs/heads/main.tar.gz \
  | tar -xz --strip-components=3 analizar-video-main/.claude/skills/analizar-video
```

En PowerShell es el mismo comando, con `curl.exe` en vez de `curl` (`curl` a
secas es un alias de `Invoke-WebRequest` y rompe el pipe).

Requiere [uv](https://docs.astral.sh/uv/) y `ffmpeg`; el detalle está en
[Requisitos](#requisitos).

## Qué puedes pedirle

```
> transcribe reunion_cliente.mp4 y hazme un acta
> ¿qué se dijo sobre los plazos de despacho?
> lista los requerimientos con su cita textual y timestamp
> ¿en qué minuto se habló del tablero de operaciones?
> muéstrame qué había en pantalla cuando explicaban el proceso de carga
> resume esta sesión como manual paso a paso
> transcribe toda la carpeta de sesiones del levantamiento
```

Tu agente te va ofreciendo el siguiente paso de a uno —glosario, corrección de
términos, índice de temas, frames— para que no tengas que conocer de antemano
todo lo que la skill sabe hacer.

## Capacidades

**Transcripción con timestamps.** Un `.txt` plano, un segmento por línea, con
header de modelo/idioma/fecha. Legible por el agente sin parsear nada y por ti sin
herramientas.

```
[large-v3-turbo | es | 26-08-20 16:56:00]
[00:00:00.000] Bueno, partamos con la agenda de hoy.
[00:00:07.910] Primero quería mostrarles el avance del tablero.
```

**Respuestas con cita y timestamp.** Todo lo comprometedor —un requerimiento,
una decisión, un plazo— queda referenciado al minuto exacto, para poder volver
al audio y verificar.

**Actas y resúmenes que se adaptan al tipo de video.** Un levantamiento con
cliente sale con requerimientos, decisiones cerradas vs. abiertas, acciones,
supuestos y riesgos. Un walkthrough sale como manual reproducible con capturas
de las pantallas clave. Se guardan como `.md` en la carpeta del video, listos
para compartir.

**Frames del video cuando el audio no alcanza.** Si la pregunta menciona una
pantalla, código, un diagrama o "lo que se veía", el agente ubica el minuto en
la transcripción y extrae ese fotograma. Si el video es un plano de sala con un
proyector al fondo, `--crop` recorta la pantalla y la amplía hasta que el texto
se lea.

**Corrección de términos mal transcritos.** Whisper inventa nombres propios y
siglas: en una charla técnica de 34 minutos, "Claude" salió 18 veces como
"cloud", "Anthropic" como "Antropics" y "skills" como "esquíes".
`revisar_terminos.py` los pone en una tabla de unas decenas de filas en vez de
hacerte releer todo. El `.txt` original nunca se toca: la versión corregida se
escribe aparte.

**Re-transcribir solo un tramo dudoso.** Cuando una frase queda incomprensible,
se vuelve a pasar ese pedazo por un modelo mejor con un glosario apuntado.
Cortar 20 segundos de un archivo de 30 GB toma menos de un segundo.

**Batch.** Una carpeta entera en una corrida, secuencial y tolerante a errores:
si un archivo falla, se registra y sigue con el resto.

**Audio suelto también.** `.mp3`, `.m4a`, `.wav` de grabaciones sin video pasan
por el mismo pipeline.

## Qué genera

Todo lo de un video queda agrupado en su propia carpeta, junto al archivo
original:

```
reunion.mp4
reunion_analisis/
├── reunion_transcripcion_yymmdd_hhmmss.txt
├── reunion_transcripcion_yymmdd_hhmmss_corregido.txt
├── reunion_resumen_yymmdd_hhmmss.md
├── reunion_indice_yymmdd_hhmmss.md
├── reunion_audio.m4a                        # caché de audio, se reutiliza
└── frames/
    └── frame_HH-MM-SS.mmm.png
```

El timestamp en el nombre evita que una corrida nueva pise a la anterior, así
que puedes re-transcribir con otro modelo sin perder lo anterior. Nada de
carpetas de caché ocultas: encuentras, lees y compartes los resultados sin saber
cómo funciona la skill por dentro.

## Lo que más mejora la calidad

Un `contexto_video.md` junto al video con los nombres propios, siglas y términos
del proyecto. Sin él, "BigQuery" termina como "big carry".

No hace falta que lo escribas de antemano: si no existe, tu agente te pregunta
de qué es el video antes de transcribir y te ofrece guardar la respuesta
después.
Plantilla en [`references/formato_contexto.md`](.claude/skills/analizar-video/references/formato_contexto.md).

## Limitaciones

- **No identifica quién habla.** Sin diarización no hay etiquetas de hablante
  confiables, así que las actas citan con timestamp pero no atribuyen frases a
  personas. Es deliberado: un acta con nombres equivocados es peor que una sin
  nombres. Queda como mejora futura.
- **No descarga desde URLs** (Drive, Meet, YouTube): el archivo tiene que estar
  en disco.
- **Idioma forzado a español por defecto.** La autodetección de Whisper decide
  con los primeros 30 segundos y falla seguido en videos que arrancan con
  saludos o jerga en inglés. `--language en` para cambiarlo.
- **La calidad depende del audio.** Grabaciones de sala con eco o micrófono
  lejano dan transcripciones con tramos incomprensibles, por más glosario que
  haya.

## Otras formas de instalar

### Clonando el repo

La skill ya vive en `.claude/skills/analizar-video/`, así que al clonar **queda
disponible al abrir el proyecto** sin copiar nada.

### Otros agentes

La carpeta puede vivir donde tu agente busque sus instrucciones; la estructura
interna no cambia. Apúntalo al `SKILL.md`, que tiene la ruta de trabajo
completa, los comandos y las reglas.

Los ejemplos de este README usan `.claude/skills/analizar-video/` como ruta.

## Entorno

### Verifica que esté todo

```bash
uv run ~/.claude/skills/analizar-video/scripts/check_env.py
```

Te dice si falta `ffmpeg`, si hay GPU NVIDIA utilizable, qué modelos tienes
descargados y qué nivel conviene según la VRAM libre.

### Requisitos

- **Python 3.9+**
- **[uv](https://docs.astral.sh/uv/)** (recomendado): los scripts declaran sus
  dependencias inline (PEP 723), así que `uv run script.py` las resuelve solo,
  sin instalar nada global. Si prefieres tu propio entorno, instala las
  dependencias del `pyproject.toml` de la skill y usa `python script.py`.
- **ffmpeg** en el PATH — para frames, recortes de tramo y caché de audio. La
  transcripción funciona sin él.
- **GPU NVIDIA** — opcional. Sin GPU funciona igual, más lento.

## Detalles técnicos

<details>
<summary><b>GPU: cuBLAS y cuDNN</b></summary>

Tener el driver NVIDIA no alcanza. CTranslate2 (el motor de faster-whisper)
carga `cuBLAS` y `cuDNN` recién al transcribir, así que si faltan, el error
aparece a mitad de corrida (`cublas64_12.dll is not found`). `transcribe.py`
detecta ese fallo y **continúa en CPU con un aviso**, no se cae. Para usar la
GPU de verdad:

```bash
# con uv, por corrida
uv run --with nvidia-cublas-cu12 --with "nvidia-cudnn-cu12>=9,<10" \
  .claude/skills/analizar-video/scripts/transcribe.py reunion.mp4

# o en tu propio entorno de Python
pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12>=9,<10"
```

En Windows esas wheels dejan los DLL en `site-packages/nvidia/*/bin`, que el
loader no mira; `transcribe.py` registra ese directorio antes de importar
faster-whisper. Si `check_env.py` reporta CUDA 11 en el driver, hay que fijar
además `ctranslate2==3.24.0` (ver comentario en el `pyproject.toml` de la skill).

</details>

<details>
<summary><b>Modelos de Whisper: nada se descarga sin permiso</b></summary>

Los pesos van de 75 MB (`tiny`) a ~3 GB (`large-v3`), se guardan en la caché de
Hugging Face (`~/.cache/huggingface/hub`) y **no se limpian solos**. Por eso
`transcribe.py` no descarga nada por su cuenta: si el modelo que pediste no está
bajado, avisa cuánto pesa y qué modelos ya tienes, y hay que confirmar con
`--download`. `check_env.py` muestra el inventario y el total ocupado.

| Nivel | Modelo | Cuándo |
|---|---|---|
| Liviano | `small` | Sin GPU, o prioriza velocidad |
| Balanceado | `large-v3-turbo` | Buen equilibrio; viable en CPU y GPU |
| Máxima precisión | `large-v3` | GPU con ≥6 GB de VRAM libre |

</details>

<details>
<summary><b>Videos pesados y en 4K</b></summary>

El **peso del archivo casi no afecta a la transcripción**: faster-whisper solo
decodifica la pista de audio, así que lo que manda es la duración, no los GB.
Medido sobre un `.mov` ProRes de 31,9 GB en SSD NVMe, extraer el audio toma 11
segundos. Ese audio queda cacheado en `<video>_analisis/` (~16 MB por hora),
así que re-transcribir con otro modelo no vuelve a pagar la lectura del disco.

Para los **frames** sí importa la resolución. Ubicar el fotograma es igual de
rápido en un archivo de 30 GB que en uno de 500 MB (ffmpeg hace seek por
keyframe), pero un PNG 4K de una pantalla con texto pesa 3-8 MB y puede pasarse
del límite de lectura de imágenes. `extract_frame.py` escala a 1920 px de ancho
por defecto; `--max-width 0` da la original, `--max-width 1280` achica más, y
nunca agranda un video que ya sea más chico.

Si el video es un **plano de sala** (proyector o TV dentro del encuadre), bajar
la resolución empeora las cosas: hay que recortar.

```bash
uv run .claude/skills/analizar-video/scripts/extract_frame.py charla.mov \
  --at 00:22:30 --crop 875:175:800:450
```

</details>

<details>
<summary><b>Uso directo de los scripts</b></summary>

```bash
SKILL=.claude/skills/analizar-video

uv run $SKILL/scripts/check_env.py --json
uv run $SKILL/scripts/transcribe.py reunion.mp4 --model large-v3-turbo
uv run $SKILL/scripts/transcribe.py ./sesiones/            # batch secuencial
uv run $SKILL/scripts/extract_frame.py reunion.mp4 --at 00:12:34

# Candidatos a término mal transcrito
uv run $SKILL/scripts/revisar_terminos.py reunion_transcripcion_*.txt

# Re-transcribir un tramo dudoso (a stdout, no guarda archivo)
uv run $SKILL/scripts/transcribe.py reunion.mp4 --from 00:19:00 --to 00:19:25
```

`--help` en cada script para las opciones completas.

</details>

## Estructura

```
analizar-video/                        # el repo
├── README.md
└── .claude/skills/analizar-video/     # la skill instalable
    ├── SKILL.md                       # entry point
    ├── resumir_video.md               # estructuras de resumen por tipo de video
    ├── scripts/
    │   ├── transcribe.py
    │   ├── extract_frame.py
    │   ├── check_env.py
    │   ├── revisar_terminos.py
    │   ├── _comun.py                  # piezas compartidas, solo stdlib
    │   └── pyproject.toml
    └── references/
        └── formato_contexto.md
```

## Créditos

Transcripción vía [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
(SYSTRAN, MIT) sobre CTranslate2.
