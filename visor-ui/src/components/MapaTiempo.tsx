import { memo, useEffect, useMemo, useRef, type RefObject } from "react";
import type { Coincidencia, LineaUI } from "../tipos";
import { colorHablante, fmt } from "../lib/util";

interface Props {
  lineas: LineaUI[];
  hablantes: string[];
  duracion: number;
  coincidencias: Coincidencia[];
  actual: number; // índice de la coincidencia seleccionada
  mediaRef: RefObject<HTMLMediaElement | null>;
  onSaltar: (t: number) => void;
}

/**
 * Carril bajo el video: quién habla a lo largo de la grabación y dónde caen los
 * resultados de la búsqueda. El cabezal se mueve por rAF, fuera de React.
 */
export const MapaTiempo = memo(function MapaTiempo({
  lineas, hablantes, duracion, coincidencias, actual, mediaRef, onSaltar,
}: Props) {
  const cabezal = useRef<HTMLDivElement>(null);
  const carril = useRef<HTMLDivElement>(null);
  const hover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = mediaRef.current;
      if (el && cabezal.current && duracion > 0) {
        cabezal.current.style.left = `${(el.currentTime / duracion) * 100}%`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mediaRef, duracion]);

  // Turnos contiguos del mismo hablante se funden en un solo bloque.
  const bloques = useMemo(() => {
    const res: { h: string | null; a: number; b: number }[] = [];
    for (const ln of lineas) {
      const ult = res[res.length - 1];
      if (ult && ult.h === ln.speaker && ln.start - ult.b < 2) ult.b = Math.max(ult.b, ln.end);
      else res.push({ h: ln.speaker, a: ln.start, b: ln.end });
    }
    return res;
  }, [lineas]);

  const marcas = useMemo(() => {
    const vistas = new Set<number>();
    return coincidencias
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !vistas.has(c.linea) && vistas.add(c.linea));
  }, [coincidencias]);

  if (!duracion) return <div className="mapa mapa-vacio" />;

  const pct = (t: number) => `${Math.min(100, (t / duracion) * 100)}%`;
  const tiempoEn = (clientX: number) => {
    const r = carril.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duracion;
  };

  return (
    <div className="mapa">
      <div
        className="mapa-carril"
        ref={carril}
        role="slider"
        aria-label="Mapa de la grabación: hablantes y resultados"
        aria-valuemin={0}
        aria-valuemax={Math.round(duracion)}
        tabIndex={-1}
        onClick={(e) => onSaltar(tiempoEn(e.clientX))}
        onMouseMove={(e) => {
          if (!hover.current) return;
          const t = tiempoEn(e.clientX);
          hover.current.style.left = pct(t);
          hover.current.dataset.t = fmt(t, false);
        }}
      >
        {bloques.map((b, i) => (
          <div
            key={i}
            className={`mapa-bloque h${colorHablante(hablantes, b.h)}`}
            style={{ left: pct(b.a), width: `max(2px, ${((b.b - b.a) / duracion) * 100}%)` }}
            title={b.h ? `${b.h} · ${fmt(b.a, false)}` : fmt(b.a, false)}
          />
        ))}
        {marcas.map(({ c, i }) => (
          <div
            key={`m${i}`}
            className={`mapa-marca${coincidencias[actual]?.linea === c.linea ? " actual" : ""}`}
            style={{ left: pct(lineas[c.linea].start) }}
          />
        ))}
        <div className="mapa-hover" ref={hover} />
        <div className="mapa-cabezal" ref={cabezal} />
      </div>
      {hablantes.length > 0 && (
        <div className="mapa-leyenda">
          {hablantes.map((h) => (
            <span key={h} className={`chip-leyenda h${colorHablante(hablantes, h)}`}>
              <i />
              {h}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
