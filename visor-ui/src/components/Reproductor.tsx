import type { ReactNode, RefObject } from "react";
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
  MediaLoadingIndicator,
} from "media-chrome/react";

interface Props {
  url: string;
  nombre: string;
  audio: boolean;
  mediaRef: RefObject<HTMLVideoElement | null>;
  /** lo que va pegado bajo el slider, con su mismo ancho (la franja de hablantes) */
  bajoSlider?: ReactNode;
}

const ID = "reproductor";
// Los controles que viven fuera de <media-controller> se enlazan por id.
// El atributo no está en los tipos del wrapper de React, de ahí el spread.
const enlace = { mediacontroller: ID } as Record<string, string>;

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
      {!audio && <MediaPipButton {...e} />}
      {!audio && <MediaFullscreenButton {...e} />}
    </>
  );
}

export function Reproductor({ url, nombre, audio, mediaRef, bajoSlider }: Props) {
  return (
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
          <video slot="media" src={url} preload="auto" playsInline ref={mediaRef} />
        )}
        {!audio && <MediaLoadingIndicator slot="centered-chrome" noAutohide />}
        {/* Solo en pantalla completa: ahí los controles de abajo no se ven. */}
        {!audio && (
          <MediaControlBar className="barra-pantalla-completa">
            <MediaPlayButton />
            <MediaTimeDisplay />
            <MediaTimeRange />
            <MediaDurationDisplay />
            <MediaPlaybackRateButton rates={[1, 1.25, 1.5, 1.75, 2]} />
            <MediaMuteButton />
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
  );
}
