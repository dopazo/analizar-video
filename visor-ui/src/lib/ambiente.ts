import { useEffect, type RefObject } from "react";

/**
 * Resplandor ambiental ("ambilight"): copia el cuadro actual a un canvas de
 * 32×18 px, que el CSS agranda y desenfoca detrás del reproductor. Con ese
 * tamaño, dibujar cuesta microsegundos; se refresca 5 veces por segundo solo
 * mientras el video corre, y una vez al adelantar o al cargar.
 */
export function useAmbiente(
  media: RefObject<HTMLVideoElement | null>,
  lienzo: RefObject<HTMLCanvasElement | null>,
  activo: boolean,
) {
  useEffect(() => {
    const v = media.current;
    const c = lienzo.current;
    if (!activo || !v || !c) return;
    const ctx = c.getContext("2d", { alpha: false });
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const pintar = () => {
      if (v.readyState < 2 || document.hidden) return;
      try {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        c.dataset.listo = "1";
      } catch {
        /* cuadro aún no disponible */
      }
    };
    let timer = 0;
    const arrancar = () => {
      pintar();
      if (!reduce && !timer) timer = window.setInterval(pintar, 200);
    };
    const parar = () => {
      window.clearInterval(timer);
      timer = 0;
      pintar();
    };
    v.addEventListener("loadeddata", pintar);
    v.addEventListener("seeked", pintar);
    v.addEventListener("play", arrancar);
    v.addEventListener("pause", parar);
    v.addEventListener("ended", parar);
    if (!v.paused) arrancar();
    else pintar();
    return () => {
      window.clearInterval(timer);
      v.removeEventListener("loadeddata", pintar);
      v.removeEventListener("seeked", pintar);
      v.removeEventListener("play", arrancar);
      v.removeEventListener("pause", parar);
      v.removeEventListener("ended", parar);
    };
  }, [media, lienzo, activo]);
}
