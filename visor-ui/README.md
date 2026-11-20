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
uv run ../.claude/skills/analizar-video/scripts/visor.py ruta/al/video.mp4 --no-open
```

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
