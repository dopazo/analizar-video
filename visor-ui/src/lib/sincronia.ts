import { useEffect, useRef, useState, type RefObject } from "react";
import type { LineaUI } from "../tipos";
import { buscarIndice } from "./util";

/**
 * Sigue al video sin re-renderizar React en cada cuadro.
 *
 * - La línea activa sí es estado de React: cambia cada pocos segundos.
 * - La palabra activa NO: se marca tocando la clase CSS directo en el DOM,
 *   dentro de un requestAnimationFrame. `timeupdate` llega solo ~4 veces por
 *   segundo y el resaltado se vería a saltos; rAF da 60 fps sin costo.
 */
export function useSincronia(
  media: RefObject<HTMLMediaElement | null>,
  lineas: LineaUI[],
  lista: RefObject<HTMLElement | null>,
) {
  const [lineaActiva, setLineaActiva] = useState(-1);
  const lineaRef = useRef(-1);
  const palabraEl = useRef<Element | null>(null);
  const clave = useRef("");

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = media.current;
      if (!el || !lineas.length) return;
      const t = el.currentTime;
      let li = buscarIndice(lineas, t, (l) => l.start);
      // Entre turnos (silencio largo) no se marca nada.
      if (li >= 0 && t > lineas[li].end + 1.5) li = -1;
      if (li !== lineaRef.current) {
        lineaRef.current = li;
        setLineaActiva(li);
      }
      let wi = -1;
      const ln = li >= 0 ? lineas[li] : null;
      if (ln?.tiempos) {
        wi = buscarIndice(ln.tiempos, t, (w) => w[0]);
        if (wi >= 0 && t > ln.tiempos[wi][1] + 0.6) wi = -1;
      }
      const k = `${li}:${wi}`;
      const desconectado = palabraEl.current && !palabraEl.current.isConnected;
      if (k === clave.current && !desconectado) return;
      clave.current = k;
      palabraEl.current?.classList.remove("palabra-activa");
      palabraEl.current = null;
      if (wi >= 0 && lista.current) {
        const w = lista.current.querySelector(`[data-l="${li}"] [data-w="${wi}"]`);
        if (w) {
          w.classList.add("palabra-activa");
          palabraEl.current = w;
        } else {
          clave.current = ""; // la línea aún no se pinta (virtualizada): reintentar
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [media, lineas, lista]);

  return lineaActiva;
}
