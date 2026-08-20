---
name: analizar-video
description: Transcribe videos y audios locales (reuniones, levantamientos con cliente, walkthroughs de procesos) con timestamps usando faster-whisper, y responde preguntas, arma resúmenes o actas sobre su contenido. Extrae frames puntuales del video cuando la pregunta toca algo visual (pantalla compartida, código, diagramas). Usar cuando el usuario entregue un archivo de video o audio local, o pida transcribir, resumir, buscar algo dicho en una grabación, o ver qué se mostraba en pantalla.
---

# analizar-video

Transcribe una sola vez en local y responde todas las preguntas siguientes
contra el texto. Solo se extraen frames del video cuando el transcript no
alcanza. Los artefactos quedan **junto al video**, no en una caché oculta.

## Ruta canónica

El usuario normalmente no sabe todo lo que la skill puede hacer. Al terminar
cada paso, **ofrece el siguiente en una línea y espera confirmación**. Nunca
encadenes pasos por tu cuenta.

| # | Paso | Cuándo ofrecerlo |
|---|---|---|
| 0 | **Contexto/glosario** | Antes de transcribir. Si no hay `contexto_video.md`, **pregúntale al usuario** (ver abajo); no lo saltes |
| 1 | **Verificar entorno** (`check_env.py`) | Primera corrida, o si algo falla. Si ya está listo, no molestar |
| 2 | **Transcribir** (`transcribe.py`) | Siempre, salvo que ya exista transcripción reutilizable |
| 3 | **Corregir términos** | Siempre después de transcribir: corre `revisar_terminos.py` y revisa la tabla |
| 4 | **Responder / resumir** | Según lo pedido. Al resumir, mencionar que queda un `.md` en `<video>_analisis/` |
| 5 | **Índice de temas** | En videos largos, donde navegar el transcript se vuelve incómodo |
| 6 | **Frames de apoyo** | Si la pregunta toca contenido visual, o si un walkthrough gana con capturas |

Reglas para que la guía no sea ruido: **una sugerencia a la vez**; no repetir
una que el usuario ya declinó en la sesión; la primera vez sobre un video se
puede anticipar el mapa completo en dos o tres líneas, después solo el paso
siguiente.

## Antes de transcribir

1. **¿Ya hay transcripción?** Busca `<video>_analisis/*_transcripcion_*.txt`.
   Si existe, lee el header (`[modelo | idioma | fecha]`) del más reciente y
   reutilízalo. Solo re-transcribe si el usuario lo pide o quiere otro nivel de
   modelo.
2. **¿Hay `contexto_video.md` o `glosario.md` junto al video?** Si sí, léelo
   completo y **condénsalo tú a ~200 tokens** (nombres propios, siglas, términos
   de dominio; nada de prosa descriptiva) para pasarlo como `--initial-prompt`.
   El límite de Whisper son ~224 tokens.

   **Si no existe, pregúntale al usuario antes de transcribir.** No hace falta
   que tenga el archivo: siempre sabe algo del video, y con tres respuestas
   alcanza para armar el `--initial-prompt`:

   > ¿De qué es el video? ¿Qué nombres propios (personas, empresas, productos) y
   > siglas van a aparecer? ¿Alguna herramienta o jerga técnica?

   No inventes el `--initial-prompt` a ciegas desde el nombre del archivo: un
   glosario incompleto deja pasar errores sistemáticos que después hay que
   corregir a mano. Al terminar, ofrece guardar lo respondido como
   `contexto_video.md` junto al video, con `references/formato_contexto.md` como
   base — el archivo es el subproducto, no el requisito.
3. **Avisa el tiempo estimado** en videos largos y **lanza la corrida en
   background**: en CPU una hora de audio puede tomar 10-20 minutos. Avisa al
   terminar.

## Comandos

Rutas relativas a esta skill. `uv run` resuelve las dependencias solo (bloque
PEP 723 en cada script); si el usuario prefiere su propio entorno,
`python scripts/transcribe.py ...` funciona igual con las dependencias de
`scripts/pyproject.toml` instaladas.

```bash
# Diagnóstico: GPU, VRAM libre, CUDA, ffmpeg, dependencias, modelo sugerido
uv run scripts/check_env.py --json

# Transcribir (--model/--device: usar lo que sugiere check_env.py)
uv run scripts/transcribe.py reunion.mp4 --model large-v3-turbo \
  --initial-prompt "Proyecto Acme. Participantes: Ana, Luis. Términos: dbt, BigQuery, ETL, SKU."

# Otros idiomas, silencios largos, carpeta completa
uv run scripts/transcribe.py demo.mp4 --language en --use-vad
uv run scripts/transcribe.py ./sesiones/            # batch secuencial, tolera errores

# Frames: empezar por el punto exacto
uv run scripts/extract_frame.py reunion.mp4 --at 00:12:34
uv run scripts/extract_frame.py reunion.mp4 --at 00:12:34 --range 3 --fps 2   # si no alcanzó
```

**Revisar términos después de transcribir** (paso 3):

```bash
uv run scripts/revisar_terminos.py video_transcripcion_*.txt \
  --contexto contexto_video.md
```

Imprime dos tablas. La primera —nombres propios y siglas— es la que importa: son
algunas decenas de filas y ahí caen los errores que más pesan. La segunda
—palabras poco frecuentes— es ruidosa, para una segunda pasada.

**Resolver una frase dudosa** sin re-transcribir todo: corta ese tramo y lo
vuelve a pasar por el modelo, con un `--initial-prompt` apuntado al término en
duda. Imprime a stdout y no guarda archivo.

```bash
uv run scripts/transcribe.py charla.mov --from 00:19:00 --to 00:19:25 \
  --model large-v3-turbo --initial-prompt "progressive disclosure, skills, Anthropic"
```

Cortar 20 segundos de un archivo de 30 GB toma menos de un segundo, porque
ffmpeg hace seek por keyframe. Úsalo antes de adivinar qué dice una frase.

Opciones completas: `--help` en cada script.

**Si hay GPU pero `check_env.py` dice que faltan cuBLAS/cuDNN**, la corrida cae
sola a CPU (más lenta, no falla). Para usar la GPU de verdad, agrégalas al
comando:

```bash
uv run --with nvidia-cublas-cu12 --with "nvidia-cudnn-cu12>=9,<10" \
  scripts/transcribe.py reunion.mp4 --model large-v3-turbo
```

Si el modelo entra en bucle repitiendo la misma frase (audio con música o
tramos largos sin voz), reintenta con `--no-condition`.

## Transcript vs. frame

Responde **siempre primero contra el transcript**. Recurre a `extract_frame.py`
cuando la pregunta apunte a algo que el audio no captura: pantalla, código,
gráfico, diagrama, planilla, UI, "se veía", "mostraban", "qué decía ahí".

- Ubica el timestamp en el transcript y pide **un frame exacto**. Amplía a
  `--range`/`--fps` solo si ese frame no alcanzó.
- Densidad según contenido: pocos frames para código o un diagrama estático,
  más para una demo en movimiento o una secuencia de navegación.
- Los frames salen escalados a 1920 px de ancho como máximo. Si el script avisa
  que el archivo pesa demasiado, baja a `--max-width 1280`.
- **Si el video es un plano de sala** (proyector o TV dentro del encuadre, no una
  captura de pantalla), el texto va a salir ilegible y bajar la resolución no
  ayuda: hay que **recortar**. Patrón: extrae el frame completo, mira dónde está
  la pantalla, y vuelve a extraer con `--crop x:y:ancho:alto`. El script imprime
  la resolución de origen para que puedas calcular las coordenadas.

```bash
uv run scripts/extract_frame.py charla.mov --at 00:22:30
# -> "Resolucion de origen: 1920x1080", pantalla visible en el tercio derecho
uv run scripts/extract_frame.py charla.mov --at 00:22:30 --crop 875:175:800:450
```
- Al responder, **describe en prosa lo que ves y cita siempre la ruta del
  archivo** para que el usuario pueda abrirlo y verificar.
- Si el archivo es solo audio, el script avisa que no hay pista de video: dilo
  claramente en vez de insistir.

No hay regla fija sobre cómo leer el transcript (completo vs. buscar y leer el
tramo): decide según la pregunta, el largo del archivo y el contexto disponible.

## Reglas duras

- **No atribuyas declaraciones a personas.** No hay diarización, así que no se
  sabe quién habla. Cita con timestamp: "en [00:12:30] se plantea que…". Un acta
  sin nombres es mejor que un acta con nombres equivocados.
- **El `.txt` crudo nunca se modifica.** Si detectas términos del glosario mal
  transcritos, *ofrece* generar
  `<video>_transcripcion_yymmdd_hhmmss_corregido.txt`; no lo apliques solo.
- **Nada destructivo sin confirmación**: no instalar dependencias, no borrar
  frames, no sobreescribir corridas previas.
- **No descargues modelos sin permiso.** Los pesos van de 75 MB a 3 GB, se
  acumulan en la caché de Hugging Face y nadie los limpia. Si `transcribe.py`
  avisa que el modelo no está descargado, **pregúntale al usuario** antes de
  volver a correr con `--download`; `check_env.py` muestra qué hay bajado y
  cuánto ocupa. Prefiere un modelo ya descargado cuando sirva.

## Artefactos

Todo lo que se genera para un video queda en **`<video>_analisis/`**, junto al
video:

```
reunion.mp4
reunion_analisis/
├── reunion_transcripcion_yymmdd_hhmmss.txt
├── reunion_transcripcion_yymmdd_hhmmss_corregido.txt
├── reunion_resumen_yymmdd_hhmmss.md
├── reunion_indice_yymmdd_hhmmss.md
├── reunion_audio.m4a                        # caché, se reutiliza
└── frames/
    └── frame_HH-MM-SS.mmm.png
```

El timestamp en el nombre evita que una corrida pise a la anterior. Los scripts
crean la carpeta solos; los resúmenes que escribas tú van ahí también.

Formato del transcript: header `[modelo | idioma | yy-mm-dd hh:mm:ss]` y después
un segmento por línea, `[HH:MM:SS.mmm] texto`.

## Referencias

- `resumir_video.md` — estructuras de resumen por tipo de video. **Léelo solo
  cuando la tarea sea resumir o armar un acta.**
- `references/formato_contexto.md` — plantilla del archivo de contexto/glosario.
