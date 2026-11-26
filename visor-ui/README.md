# visor-ui

Fuente de la interfaz de `scripts/visor.py`: React + TypeScript + Vite, con
[Media Chrome](https://www.media-chrome.org/) para los controles del reproductor y
[TanStack Virtual](https://tanstack.com/virtual) para la lista de la transcripción.

Vive fuera de la skill a propósito: quien instala la skill recibe solo el build
(`.claude/skills/analizar-video/visor/`) y no necesita Node.

## Desarrollar

```bash
cd visor-ui
npm install
npm run dev          # Vite en http://localhost:5173

# en otra terminal, el servidor de datos y video:
uv run ../.claude/skills/analizar-video/scripts/visor.py ruta/al/video.mp4 --no-open --mantener
```

`--mantener` evita que el servidor se cierre solo mientras recargas o reinicias
Vite. Sin esa opción, el servidor termina unos 12 s después de que se cierra la
última pestaña: cada pestaña mantiene abierta una conexión SSE a `/api/vivo`, y
el servidor se da cuenta cuando se corta.

Vite reenvía `/api` y `/media` al servidor Python (puerto 4810; otro con
`VISOR_PY=http://127.0.0.1:<puerto>`).

## Publicar un cambio

```bash
npm run build        # chequea tipos y escribe el build en la skill
```

Commitea el build junto con el cambio en `src/`: la skill instalada usa lo que
esté en `visor/`.

## Rendimiento

- La palabra activa se marca tocando la clase CSS en el DOM dentro de un
  `requestAnimationFrame` (`src/lib/sincronia.ts`), no con estado de React: así
  no se re-renderiza la lista 60 veces por segundo.
- La lista está virtualizada: una reunión de una hora pinta ~30 líneas, no miles.
- El servidor responde `Range` (206), sin lo cual el navegador no puede adelantar.

## Dependencias

Todas van fijas a una versión exacta. `@tanstack/react-virtual` queda en
**3.13.12** a propósito: desde la 3.14 (virtual-core 3.19) el virtualizador
retiene sus correcciones de scroll y pinta corrido respecto del `scrollTop`
real, y eso choca con cómo `Transcripcion.tsx` lleva la lista a una fila
(midiendo la fila en el DOM y corrigiendo en pasadas). Con 3.14 se pierde la
fila que se estaba leyendo al cambiar el ancho del panel. Antes de subirla,
repetir las pruebas de sincronía: saltos desde el mapa, J/L, clic en timestamp,
vuelta desde el resumen, búsqueda y pantalla completa del panel en lectura libre.
