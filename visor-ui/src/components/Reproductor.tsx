import type { RefObject } from "react";
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
}

export function Reproductor({ url, nombre, audio, mediaRef }: Props) {
  return (
    <MediaController className={audio ? "reproductor solo-audio" : "reproductor"} audio={audio || undefined}>
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
      <MediaControlBar className="barra-controles">
        <MediaPlayButton />
        <MediaSeekBackwardButton seekOffset={10} />
        <MediaSeekForwardButton seekOffset={10} />
        <MediaTimeDisplay />
        <MediaTimeRange />
        <MediaDurationDisplay />
        <MediaPlaybackRateButton rates={[1, 1.25, 1.5, 1.75, 2]} />
        <MediaMuteButton />
        <MediaVolumeRange />
        {!audio && <MediaPipButton />}
        {!audio && <MediaFullscreenButton />}
      </MediaControlBar>
    </MediaController>
  );
}
