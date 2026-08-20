# Resumir un video

Referencia para cuando la tarea es **resumir** o **armar un acta**. El resultado
se guarda en `<video>_analisis/<video>_resumen_yymmdd_hhmmss.md`, y se le avisa
al usuario dónde quedó.

## Principio

Las estructuras de abajo son **guías, no plantillas rígidas**. Adapta el foco y
el nivel de detalle a lo que el usuario diga del video y a lo que indique el
`contexto_video.md`. Si el usuario avisa que es un paso a paso, el resumen debe
parecerse a un manual; si es una discusión de alcance, a un acta de decisiones.
Ante la duda, pregunta qué le sirve más antes de escribir uno largo.

## Transversal a todos los tipos

- **Cita con timestamp** todo lo que sea comprometedor (un requerimiento, una
  decisión, un plazo), para poder volver al audio y verificar.
- **No atribuyas a personas.** No hay diarización: "en [00:12:30] se plantea
  que…", nunca "Juan dijo que…". Ver `SKILL.md`.
- **Marca lo inferido.** Si un responsable o un plazo no está dicho de forma
  explícita, escríbelo como supuesto, no como hecho.
- **Glosario emergente**: si aparecen siglas o términos que no estaban en el
  `contexto_video.md`, lístalos al final para ir enriqueciendo el glosario del
  proyecto.
- Si el transcript tiene términos del glosario mal transcritos, ofrece corregir
  antes de resumir (paso 3 de la ruta canónica).

## Levantamiento de requerimientos con cliente

El documento se usa después como respaldo, así que prioriza trazabilidad sobre
prosa.

- **Requerimientos detectados** — uno por punto, cada uno con cita textual y
  timestamp
- **Decisiones cerradas** vs. **temas abiertos / pendientes** — separados, no
  mezclados
- **Acciones** — qué, quién y para cuándo, hasta donde se alcance a inferir
  (marcando lo inferido)
- **Supuestos y riesgos** — lo que el cliente dio por sentado sin decirlo, y los
  riesgos técnicos o de alcance que se ven desde la conversación

## Reunión interna de equipo

Más corto y accionable; nadie va a auditar este documento.

- **Acuerdos alcanzados**
- **Bloqueos y dependencias** — quién o qué está esperando a qué
- **Acciones** — quién hace qué

## Video explicativo / walkthrough de proceso

El objetivo es que alguien pueda reproducir el proceso sin ver el video.

- **Pasos en orden**, cada uno con su timestamp
- **Pantallas involucradas** en cada paso. Extrae frames de las pantallas clave
  con `extract_frame.py` e inclúyelos referenciando la ruta cuando aporten a la
  comprensión (un formulario, una configuración, un menú poco obvio)
- **Nivel de detalle tipo manual reproducible**: nombres exactos de botones,
  campos y rutas de menú, no paráfrasis
- Anota lo que quede ambiguo en el video, para que alguien lo aclare después

## Índice de temas (distinto de un resumen)

Solo bajo demanda. Es una tabla de capítulos —tema y timestamp de inicio— para
navegar videos largos y ubicar dónde extraer un frame. Se guarda en
`<video>_analisis/<video>_indice_yymmdd_hhmmss.md`. No lo generes automáticamente junto con el
resumen.
