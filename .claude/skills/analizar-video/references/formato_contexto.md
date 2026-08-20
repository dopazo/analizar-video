# Archivo de contexto/glosario por video

Guarda un archivo llamado `contexto_video.md` (o `glosario.md`) **en la misma carpeta
que el video**. La skill lo busca sola antes de transcribir.

## Para qué sirve

Whisper transcribe mal lo que no vio nunca: nombres de clientes, siglas del
proyecto, nombres de tablas, librerías. Con este archivo, el agente arma un
`initial_prompt` que sesga la decodificación hacia ese vocabulario. Sin él, un
"BigQuery" puede terminar como "big carry" y un "Claude" como "cloud".

Es el paso que más mejora la calidad del transcript y el más fácil de saltarse.

## Qué escribir

Lo que más pesa son los **nombres propios, siglas y términos de dominio**: eso
es lo que entra al `initial_prompt` (Whisper acepta ~224 tokens, así que el
agente condensa el archivo). La prosa descriptiva no entra al prompt, pero igual le
le sirve al agente para interpretar el transcript y elegir el enfoque del
resumen.
Escribe todo lo que sepas: nada se pierde.

## Plantilla

Copia esto y complétalo. Borra lo que no aplique.

```markdown
# Contexto del video

**Proyecto / cliente:** Nombre exacto como se pronuncia en la reunión

**Tipo de reunión:** levantamiento con cliente | reunión interna | walkthrough
de proceso | otro (describir)

**Idioma:** español (indicar si hay tramos en otro idioma)

**Participantes esperados:**
- Nombre Apellido (rol)
- Nombre Apellido (rol)

**Siglas y términos del dominio:**
- SKU — unidad de inventario
- ETL — proceso de carga
- NPS — encuesta de satisfacción

**Herramientas y tecnologías que se mencionan:**
dbt, BigQuery, Airflow, Power BI, Snowflake

**Nombres propios difíciles:**
Acme, Kütral, Nahuel

**Contexto adicional:**
Dos o tres líneas sobre de qué viene la reunión, qué se venía discutiendo
antes, o qué se espera que salga de acá.
```

## Ejemplo completo

```markdown
# Contexto del video

**Proyecto / cliente:** Retail Acme

**Tipo de reunión:** levantamiento de requerimientos con cliente

**Idioma:** español, con jerga técnica en inglés

**Participantes esperados:**
- Ana Pérez (data engineer)
- Luis Soto (contraparte cliente, jefe de operaciones)

**Siglas y términos del dominio:**
- SKU — unidad de inventario
- OTIF — on time in full, indicador de despacho
- CD — centro de distribución

**Herramientas y tecnologías que se mencionan:**
dbt, BigQuery, Looker Studio, Fivetran

**Nombres propios difíciles:**
Acme, Nahuel, Kütral

**Contexto adicional:**
Tercera sesión del levantamiento. Las dos anteriores cerraron el alcance de
inventario; esta debería cerrar despachos y definir los indicadores del
tablero de operaciones.
```

## Notas

- Un archivo por carpeta de video alcanza: si varias sesiones del mismo
  proyecto están en la misma carpeta, comparten el mismo `contexto_video.md`.
- Conviene irlo enriqueciendo: al resumir, el agente lista los términos nuevos que
  aparecieron y no estaban acá.
