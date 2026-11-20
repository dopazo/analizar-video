import { useEffect, useState, type RefObject } from "react";

/**
 * Subtítulos dibujados por el visor, no por el navegador.
 *
 * El render nativo de <track> escala la letra con el alto del video (en
 * pantalla completa queda gigante) y la pega al borde inferior, debajo de la
 * barra de controles. Acá se usa la misma pista —así el botón CC y la tecla C
 * siguen funcionando igual— pero el texto lo pinta este componente: tamaño
 * acotado y, como vive en la columna inferior del reproductor, siempre queda
 * por encima de la barra. El render nativo se oculta por CSS (video::cue).
 */
interface Texto {
  hablante: string | null;
  clase: string | null;
  texto: string;
}

const desescapar = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function leer(cue: TextTrackCue): Texto {
  const raw = (cue as VTTCue).text ?? "";
  // Formato que arma lib/subtitulos.ts: "<c.hN>Nombre</c>: texto"
  const m = raw.match(/^<c\.(h\d)>(.*?)<\/c>:\s*(.*)$/s);
  if (m) return { clase: m[1], hablante: desescapar(m[2]), texto: desescapar(m[3]) };
  return { clase: null, hablante: null, texto: desescapar(raw.replace(/<[^>]+>/g, "")) };
}

export function Subtitulos({ mediaRef }: { mediaRef: RefObject<HTMLVideoElement | null> }) {
  const [actual, setActual] = useState<Texto[]>([]);
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    let pista: TextTrack | null = null;
    const actualizar = () => {
      if (!pista || pista.mode !== "showing") return setActual([]);
      setActual([...(pista.activeCues ?? [])].map(leer));
    };
    const enlazar = () => {
      const nueva = [...el.textTracks].find((t) => t.kind === "captions") ?? null;
      if (nueva === pista) return actualizar();
      pista?.removeEventListener("cuechange", actualizar);
      pista = nueva;
      pista?.addEventListener("cuechange", actualizar);
      actualizar();
    };
    enlazar();
    // Al prender/apagar (change) o al llegar una pista nueva (addtrack).
    el.textTracks.addEventListener("change", enlazar);
    el.textTracks.addEventListener("addtrack", enlazar);
    el.textTracks.addEventListener("removetrack", enlazar);
    return () => {
      pista?.removeEventListener("cuechange", actualizar);
      el.textTracks.removeEventListener("change", enlazar);
      el.textTracks.removeEventListener("addtrack", enlazar);
      el.textTracks.removeEventListener("removetrack", enlazar);
    };
  }, [mediaRef]);

  return (
    // noautohide: Media Chrome oculta los hijos de su columna inferior cuando
    // el mouse está quieto; los subtítulos tienen que seguir a la vista.
    <div className="subtitulos" aria-live="off" {...{ noautohide: "" }}>
      {actual.map((c, i) => (
        <span key={i} className="subtitulo">
          {c.hablante && <b className={c.clase ?? undefined}>{c.hablante}: </b>}
          {c.texto}
        </span>
      ))}
    </div>
  );
}
