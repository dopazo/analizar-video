---
name: analizar-video
description: Transcribe videos y audios locales (reuniones, levantamientos con cliente, walkthroughs de procesos) con timestamps usando faster-whisper, y responde preguntas, arma resúmenes o actas sobre su contenido. En reuniones identifica quién habla (diarización con Nemotron) y les pone nombre. Extrae frames puntuales del video cuando la pregunta toca algo visual (pantalla compartida, código, diagramas). Usar cuando el usuario entregue un archivo de video o audio local, o pida transcribir, resumir, buscar algo dicho en una grabación, o ver qué se mostraba en pantalla.
---

# analizar-video

Transcribe una sola vez en local y responde todas las preguntas siguientes
contra el texto. Los frames son apoyo: se extraen cuando el transcript no
alcanza, y como sondeo ralo antes de resumir o explicar un video. Los artefactos quedan **junto al video**, no en una caché oculta.

## Ruta canónica

El usuario normalmente no sabe todo lo que la skill puede hacer. Al terminar
cada paso, **ofrece el siguiente en una línea y espera confirmación**. Nunca
encadenes pasos por tu cuenta.

| # | Paso | Cuándo ofrecerlo |
|---|---|---|
| 0 | **Contexto/glosario** | Antes de transcribir. Si no hay `contexto_video.md`, **pregúntale al usuario** (ver abajo); no lo saltes |
| 1 | **Verificar entorno** (`check_env.py`) | Primera corrida, o si algo falla. Si ya está listo, no molestar |
| 2 | **Transcribir** (`transcribe.py`) | Siempre, salvo que ya exista transcripción reutilizable |
| 2b | **Diarizar** (`diarizar.py`) | Reuniones con varias personas, si el usuario quiere saber quién dijo qué. Requiere haber transcrito con `--words` |
| 3 | **Corregir términos y nombrar hablantes** | Siempre después de transcribir: corre `revisar_terminos.py` y revisa la tabla. Si hubo diarización, en el mismo paso se proponen nombres para `speaker_N` (ver abajo) |
| 4 | **Responder / resumir** | Según lo pedido. Resumir o explicar incluye el **sondeo visual** (ver abajo), no es un paso aparte. Al resumir, mencionar que queda un `.md` en `<video>_analisis/` |
| 5 | **Índice de temas** | En videos largos, donde navegar el transcript se vuelve incómodo |
| 6 | **Frames de apoyo** | Si la pregunta toca contenido visual, o si un walkthrough gana con capturas |

Reglas para que la guía no sea ruido: **una sugerencia a la vez**; no repetir
una que el usuario ya declinó en la sesión; la primera vez sobre un video se
puede anticipar el mapa completo en dos o tres líneas, después solo el paso
siguiente.

## Antes de transcribir

1. **¿Ya hay transcripción?** Busca `<video>_analisis/*_transcripcion_*.txt`.
   Si existe, lee el header (`[modelo | idioma | fecha]`) del más reciente y
   reutilízalo. De una misma corrida, prefiere en este orden:
   `_hablantes_corregido.txt` > `_hablantes.txt` > `_corregido.txt` > el `.txt`
   crudo. Solo re-transcribe si el usuario lo pide o quiere otro nivel de
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
3. **¿Es una reunión con varias personas?** Transcribe con `--words`: deja los
   tiempos por palabra que necesita la diarización (paso 2b) y cuesta poco. Sin
   eso, diarizar después obliga a re-transcribir.
4. **Avisa el tiempo estimado** en videos largos y **lanza la corrida en
   background**: en CPU una hora de audio puede tomar 10-20 minutos. Avisa al
   terminar.

## Comandos

Rutas relativas a esta skill. `uv run` resuelve las dependencias solo (bloque
PEP 723 en cada script); si el usuario prefiere su propio entorno,
`python scripts/transcribe.py ...` funciona igual con las dependencias de
`scripts/pyproject.toml` instaladas.

```bash
# Diagnóstico: GPU, VRAM libre, CUDA, ffmpeg, dependencias, modelo sugerido,
# y si la diarización ya está descargada
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

## Diarización: quién habla (paso 2b)

`nvidia/Nemotron-3-Diarization` (~100M parámetros, hasta **8 hablantes**)
detecta quién habla y cuándo; no transcribe. Se cruza con la transcripción de
Whisper palabra a palabra, así que la transcripción tiene que haberse hecho con
`--words` (genera `<transcripcion>_palabras.jsonl`).

```bash
uv run scripts/transcribe.py reunion.mp4 --model large-v3-turbo --words ...
uv run scripts/diarizar.py reunion.mp4 \
  --palabras "reunion_analisis/reunion_transcripcion_yymmdd_hhmmss_palabras.jsonl"
```

Genera `<video>_diarizacion.json` (los tramos, se reutiliza) y
`<transcripcion>_hablantes.txt`, con líneas `[HH:MM:SS.mmm] speaker_N: texto`.
`speaker_N` es anónimo y se numera por orden de aparición. Al final imprime
cuánto habló cada uno y sus líneas más largas con timestamp: con eso se les pone
nombre en el paso 3.

**Primera corrida: pide permiso antes.** Descarga ~3 GB (torch con CUDA,
transformers desde GitHub y el modelo) a la caché de uv y de Hugging Face.
`check_env.py` dice si ya está todo (`diarizacion.listo`) y cuánto falta bajar.

Referencia (35 min de reunión, RTX 4060 Laptop): 6 s y ~650 MiB de VRAM en el
modo por defecto (`offline`, ventana de 30,4 s). Si no hay memoria, cae solo a
`low_latency`. Más de 8 personas hablando: el modelo no lo soporta, avisa
antes.

### Nombrar hablantes (dentro del paso 3)

Los nombres reales se resuelven junto con la corrección de términos y quedan
solo en `_hablantes_corregido.txt`; `_hablantes.txt` no se toca.

1. **Pide la lista de participantes** si no está en `contexto_video.md`, con
   cualquier pista útil (quién expuso, quién habló más).
2. **Junta evidencia por hablante**: a partir de las líneas que imprime
   `diarizar.py`, busca en la transcripción saludos o menciones ("gracias,
   Robert") y, en Meet/Zoom/Teams, **extrae un frame** en una línea larga de
   cada `speaker_N` para leer el nombre que la plataforma destaca. Ojo: el
   destacado llega con ~1 s de retraso y en turnos cortos puede seguir en quien
   habló antes. Saca el frame a mitad del turno, no al inicio, y no deduzcas
   un nombre de que *nadie* esté destacado.
3. **Muestra la tabla de mapeo** (`speaker_N` → nombre, evidencia con
   timestamp o ruta del frame) y **espera confirmación**. Lo que no se pueda
   respaldar queda como `speaker_N`.
4. Con la confirmación, genera `_hablantes_corregido.txt` con nombres y
   términos corregidos.

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

### Sondeo visual antes de resumir o explicar

Lo anterior aplica a preguntas puntuales. Cuando la tarea es **analizar** el
video —resumir, armar un acta, explicar un proceso—, conviene mirar unos pocos
frames *antes* de escribir, aunque nadie haya preguntado nada visual. El
transcript no dice si alguien estuvo veinte minutos compartiendo pantalla, y un
resumen escrito a ciegas de eso describe la conversación y se pierde la mitad
del contenido.

- **Cuándo**: una sola vez, después de transcribir y antes de redactar. Es parte
  del trabajo de resumir, no un paso que se ofrece: hazlo sin preguntar, igual
  que leer el transcript. La regla de no encadenar pasos aplica entre pasos de
  la ruta, no dentro de uno.
- **Cuánto**: un muestreo ralo, del orden de 3 a 6 frames repartidos a lo largo
  del video, apuntando a los tramos que el transcript marca como importantes
  (una demo, un "miren esto", un cambio de tema). No es un barrido.
- **Para qué**: decidir si hay una capa visual que el resumen deba considerar.
  Si los frames muestran solo caras o cámaras apagadas, dilo y sigue con el
  resumen en modo texto, sin extraer más.
- **Si la hay**: trata lo visto como contexto del resumen —qué herramienta se
  estaba usando, qué documento se revisaba— y extrae frames adicionales en los
  puntos concretos que valga la pena mostrar, con las reglas de arriba.
- Sáltalo sin comentarios si el input es solo audio.

No hay regla fija sobre cómo leer el transcript (completo vs. buscar y leer el
tramo): decide según la pregunta, el largo del archivo y el contexto disponible.

## Reglas duras

- **No atribuyas declaraciones a personas** salvo que exista un
  `_hablantes_corregido.txt` con nombres que el usuario confirmó (paso 3). Un
  `speaker_N` sin confirmar no es un nombre: cítalo como `speaker_N`. Sin
  diarización no se sabe quién habla: cita con timestamp, "en [00:12:30] se
  plantea que…". Un acta sin nombres es mejor que un acta con nombres
  equivocados.

  **Excepción — Meet, Zoom, Teams:** suelen destacar en pantalla a quien está
  hablando (nombre al pie, recuadro resaltado). Ahí sí puedes atribuir, extrayendo
  el frame de ese momento y **citando su ruta** como respaldo. Útil cuando las citas 
  cargan un compromiso o una decisión.
- **Formato fijo de timestamp: `[HH:MM:SS]`**, dos dígitos por campo, con las
  horas siempre presentes aunque sean `00` (`[00:04:42]`, nunca `[4:42]` ni
  `(00:04:42)`). Los rangos se escriben como dos marcas unidas por guion:
  `[00:04:42]-[00:05:10]`. Es un formato parseable: se apunta a que un
  reproductor pueda convertir cada marca en un salto al segundo exacto, así que
  no lo varíes por estética.
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
├── reunion_transcripcion_yymmdd_hhmmss_palabras.jsonl     # con --words
├── reunion_transcripcion_yymmdd_hhmmss_hablantes.txt      # diarizar.py
├── reunion_transcripcion_yymmdd_hhmmss_hablantes_corregido.txt
├── reunion_diarizacion.json                 # caché de diarizar.py
├── reunion_resumen_yymmdd_hhmmss.md
├── reunion_indice_yymmdd_hhmmss.md
├── reunion_audio.m4a                        # caché, se reutiliza
└── frames/
    └── frame_HH-MM-SS.mmm.png
```

El timestamp en el nombre evita que una corrida pise a la anterior. Los scripts
crean la carpeta solos; los resúmenes que escribas tú van ahí también.

Formato del transcript: header `[modelo | idioma | yy-mm-dd hh:mm:ss]` y después
un segmento por línea, `[HH:MM:SS.mmm] texto`. En `_hablantes*.txt`:
`[HH:MM:SS.mmm] speaker_N: texto` (o el nombre, en el corregido).

## Referencias

- `resumir_video.md` — estructuras de resumen por tipo de video. **Léelo solo
  cuando la tarea sea resumir o armar un acta.**
- `references/formato_contexto.md` — plantilla del archivo de contexto/glosario.
