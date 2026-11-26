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
      // La marca se pierde sin que cambie la palabra si la fila se vuelve a
      // pintar (sale y vuelve a entrar a la lista virtual, se cambia de pestaña)
      // o si React reescribe el className del span (al cambiar la búsqueda).
      const w0 = palabraEl.current;
      const perdida = !!w0 && (!w0.isConnected || !w0.classList.contains("palabra-activa"));
      if (k === clave.current && !perdida) return;
      clave.current = k;
      w0?.classList.remove("palabra-activa");
      palabraEl.current = null;
      if (wi >= 0) {
        const w = lista.current?.querySelector(`[data-l="${li}"] [data-w="${wi}"]`);
        if (w) {
          w.classList.add("palabra-activa");
          palabraEl.current = w;
        } else {
          // La fila no está pintada (virtualizada, o la transcripción no está a
          // la vista porque hay otra pestaña abierta): reintentar en el próximo cuadro.
          clave.current = "";
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [media, lineas, lista]);

  return lineaActiva;
}
