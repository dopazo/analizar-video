import { useCallback, useEffect, useState, type RefObject } from "react";
import {
  MediaControlBar,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeRange,
  MediaTimeDisplay,
  MediaDurationDisplay,
  MediaMuteButton,
  MediaPlaybackRateButton,
  MediaPipButton,
} from "media-chrome/react";
import { enlace } from "./Reproductor";

/**
 * Pantalla completa del panel de texto (transcripción, resumen, índice): para
 * leer con renglones largos. El video sigue sonando por detrás y se maneja
 * desde una barra flotante.
 *
 * Devuelve [activo, alternar]. Pide la pantalla completa real y, aunque el
 * navegador no la conceda (una vista embebida, por ejemplo), el panel igual se
 * expande a toda la ventana con CSS. Se sale con Esc o con el mismo botón.
 */
export function usePanelCompleto(panel: RefObject<HTMLElement | null>): [boolean, () => void] {
  const [activo, setActivo] = useState(false);
  useEffect(() => {
    // Salir de la pantalla completa real (Esc del navegador) cierra el modo.
    const upd = () => {
      if (!document.fullscreenElement) setActivo(false);
    };
    document.addEventListener("fullscreenchange", upd);
    return () => document.removeEventListener("fullscreenchange", upd);
  }, []);
  useEffect(() => {
    if (!activo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) setActivo(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activo]);
  const alternar = useCallback(() => {
    if (activo) {
      setActivo(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    } else {
      setActivo(true);
      void panel.current?.requestFullscreen?.().catch(() => {});
    }
  }, [activo, panel]);
  return [activo, alternar];
}

export function BotonPanelCompleto({ activo, alternar }: { activo: boolean; alternar: () => void }) {
  const titulo = activo ? "Salir de pantalla completa (Esc)" : "Leer en pantalla completa";
  return (
    <button className="boton-icono" onClick={alternar} title={titulo} aria-label={titulo}>
      {activo ? (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path fill="currentColor" d="M5 16h3v3h2v-5H5v2Zm3-8H5v2h5V5H8v3Zm6 11h2v-3h3v-2h-5v5Zm2-11V5h-2v5h5V8h-3Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path fill="currentColor" d="M7 14H5v5h5v-2H7v-3Zm-2-4h2V7h3V5H5v5Zm12 7h-3v2h5v-5h-2v3ZM14 5v2h3v3h2V5h-5Z" />
        </svg>
      )}
    </button>
  );
}

/** Controles del video, flotando abajo al centro mientras el panel está en pantalla completa. */
export function BarraFlotante({ audio }: { audio: boolean }) {
  return (
    <MediaControlBar className="barra-flotante" {...enlace} aria-label={audio ? "Controles del audio" : "Controles del video"}>
      <MediaPlayButton {...enlace} />
      <MediaSeekBackwardButton seekOffset={10} {...enlace} />
      <MediaSeekForwardButton seekOffset={10} {...enlace} />
      <MediaTimeDisplay {...enlace} />
      <MediaTimeRange {...enlace} />
      <MediaDurationDisplay {...enlace} />
      <MediaPlaybackRateButton rates={[1, 1.25, 1.5, 1.75, 2]} {...enlace} />
      <MediaMuteButton {...enlace} />
      {/* Video en miniatura (P): para ver al que habla mientras se lee a pantalla completa. */}
      {!audio && <MediaPipButton {...enlace} title="Video en miniatura (P)" />}
    </MediaControlBar>
  );
}
