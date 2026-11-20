import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useAmbiente } from "../lib/ambiente";
import { Subtitulos } from "./Subtitulos";
import {
  MediaController,
  MediaControlBar,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeRange,
  MediaTimeDisplay,
  MediaDurationDisplay,
  MediaMuteButton,
  MediaVolumeRange,
  MediaPlaybackRateButton,
  MediaFullscreenButton,
  MediaPipButton,
  MediaCaptionsButton,
  MediaLoadingIndicator,
} from "media-chrome/react";

interface Props {
  url: string;
  nombre: string;
  audio: boolean;
  mediaRef: RefObject<HTMLVideoElement | null>;
  /** lo que va pegado bajo el slider, con su mismo ancho (la franja de hablantes) */
  bajoSlider?: ReactNode;
  capitulos: number;
  miniaturas: boolean;
  /** subtítulos (WebVTT) armados desde la transcripción; se prenden con "c" */
  subtitulos: string | null;
  /** cambia al recargar los datos: obliga a releer la pista de capítulos */
  version: number;
}

/**
 * Media Chrome escucha el `load` solo de la pista de capítulos que había al
 * montar el video: si el índice aparece después, o se recarga, la pista nueva
 * entra vacía y la barra no se entera cuando llegan sus capítulos. Al cargar se
 * le avisa con un `change` en la lista de pistas, que sí escucha siempre.
 */
function useAvisarCapitulos(pista: RefObject<HTMLTrackElement | null>, media: RefObject<HTMLVideoElement | null>, version: number) {
  useEffect(() => {
    const el = pista.current;
    const video = media.current;
    if (!el || !video) return;
    if (el.track.mode === "disabled") el.track.mode = "hidden"; // si no, no baja los cues
    const avisar = () => video.textTracks.dispatchEvent(new Event("change"));
    if (el.readyState === 2) avisar();
    el.addEventListener("load", avisar);
    return () => el.removeEventListener("load", avisar);
  }, [pista, media, version]);
}

/** La pista de subtítulos se sirve como blob: se arma en el navegador. */
function useUrlTexto(texto: string | null, tipo: string): string | null {
  const url = useMemo(() => (texto ? URL.createObjectURL(new Blob([texto], { type: tipo })) : null), [texto, tipo]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

/**
 * Las miniaturas se generan en segundo plano la primera vez. Si aún no están,
 * se pregunta cada pocos segundos y la pista se agrega apenas existan.
 */
function useMiniaturas(inicial: boolean, activo: boolean): boolean {
  const [listas, setListas] = useState(inicial);
  useEffect(() => {
    if (listas || !activo) return;
    const id = window.setInterval(async () => {
      try {
        const r = await fetch("api/estado");
        if (r.ok && (await r.json()).miniaturas) setListas(true);
      } catch {
        /* servidor cerrado: el aviso de presencia ya lo dice */
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [listas, activo]);
  return listas;
}

const ID = "reproductor";
// Los controles que viven fuera de <media-controller> se enlazan por id.
// El atributo no está en los tipos del wrapper de React, de ahí el spread.
export const enlace = { mediacontroller: ID } as Record<string, string>;

function Botones({ audio, externo }: { audio: boolean; externo: boolean }) {
  const e = externo ? enlace : {};
  return (
    <>
      <MediaPlayButton {...e} />
      <MediaSeekBackwardButton seekOffset={10} {...e} />
      <MediaSeekForwardButton seekOffset={10} {...e} />
      <MediaTimeDisplay {...e} />
      <span className="separador-tiempo">/</span>
      <MediaDurationDisplay {...e} />
      <span className="espaciador" />
      <MediaPlaybackRateButton rates={[1, 1.25, 1.5, 1.75, 2]} {...e} />
      <MediaMuteButton {...e} />
      <MediaVolumeRange {...e} />
      {/* Sin enlace propio: la barra que lo contiene ya está enlazada al
          reproductor, y un interruptor enlazado dos veces recibe el clic dos
          veces (prende y apaga). Play o mute no lo notan: piden un estado, no
          lo alternan. */}
      {!audio && <MediaCaptionsButton />}
      {!audio && <MediaPipButton {...e} />}
      {!audio && <MediaFullscreenButton {...e} />}
    </>
  );
}

export function Reproductor({ url, nombre, audio, mediaRef, bajoSlider, capitulos, miniaturas, subtitulos, version }: Props) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const urlSubtitulos = useUrlTexto(audio ? null : subtitulos, "text/vtt");
  const miniListas = useMiniaturas(miniaturas, !audio);
  useAmbiente(mediaRef, lienzo, !audio);
  const pistaCapitulos = useRef<HTMLTrackElement>(null);
  useAvisarCapitulos(pistaCapitulos, mediaRef, capitulos > 0 ? version : -1);
  return (
    <div className="escenario">
      {!audio && <canvas ref={lienzo} className="ambiente" width={32} height={18} aria-hidden />}
    <div className="reproductor-bloque">
      <MediaController id={ID} className={audio ? "reproductor solo-audio" : "reproductor"} audio={audio || undefined}>
        {audio ? (
          <>
            <div className="portada-audio" aria-hidden>
              <svg viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H5a7 7 0 0 1 14 0h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z"/></svg>
              <span>{nombre}</span>
            </div>
            <audio slot="media" src={url} preload="auto" ref={mediaRef as unknown as RefObject<HTMLAudioElement>} />
          </>
        ) : (
          <video slot="media" src={url} preload="auto" playsInline ref={mediaRef}>
            {/* Capítulos del índice: Media Chrome parte la barra en tramos y
                muestra el título del tramo al pasar el mouse, como YouTube. */}
            {capitulos > 0 && <track key={version} ref={pistaCapitulos} kind="chapters" src={`api/capitulos.vtt?v=${version}`} srcLang="es" default />}
            {miniListas && <track kind="metadata" label="thumbnails" src="api/miniaturas.vtt" default />}
            {/* Apagados al inicio; "c" o el botón CC los prenden (también en pantalla completa). */}
            {urlSubtitulos && <track kind="captions" label="Transcripción" srcLang="es" src={urlSubtitulos} />}
          </video>
        )}
        {!audio && <MediaLoadingIndicator slot="centered-chrome" noAutohide />}
        {/* En la columna inferior, antes de la barra: siempre queda encima de ella. */}
        {!audio && <Subtitulos mediaRef={mediaRef} />}
        {/* Solo en pantalla completa: ahí los controles de abajo no se ven. */}
        {!audio && (
          <MediaControlBar className="barra-pantalla-completa">
            <MediaPlayButton />
            <MediaTimeDisplay />
            <MediaTimeRange />
            <MediaDurationDisplay />
            <MediaPlaybackRateButton rates={[1, 1.25, 1.5, 1.75, 2]} />
            <MediaMuteButton />
            <MediaCaptionsButton />
            <MediaFullscreenButton />
          </MediaControlBar>
        )}
      </MediaController>

      <div className="controles">
        <MediaTimeRange className="slider" {...enlace} />
        {bajoSlider}
        <MediaControlBar className="barra-controles" {...enlace}>
          <Botones audio={audio} externo />
        </MediaControlBar>
      </div>
    </div>
    </div>
  );
}
