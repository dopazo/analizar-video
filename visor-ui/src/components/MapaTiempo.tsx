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
  lineaActiva: number;
}

interface Bloque {
  h: string | null;
  a: number;
  b: number;
  desde: number; // primera línea del bloque
  hasta: number; // última línea del bloque
}

/** Turnos contiguos del mismo hablante, fundidos en un solo bloque. */
function armarBloques(lineas: LineaUI[]): Bloque[] {
  const res: Bloque[] = [];
  for (const ln of lineas) {
    const ult = res[res.length - 1];
    if (ult && ult.h === ln.speaker && ln.start - ult.b < 2) {
      ult.b = Math.max(ult.b, ln.end);
      ult.hasta = ln.idx;
    } else res.push({ h: ln.speaker, a: ln.start, b: ln.end, desde: ln.idx, hasta: ln.idx });
  }
  return res;
}

/**
 * Franja bajo el slider: quién habla a lo largo de la grabación y dónde caen los
 * resultados de la búsqueda. El cabezal se mueve por rAF, fuera de React.
 */
export const MapaTiempo = memo(function MapaTiempo({
  lineas, hablantes, duracion, coincidencias, actual, mediaRef, onSaltar, lineaActiva,
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

  const bloques = useMemo(() => armarBloques(lineas), [lineas]);

  const marcas = useMemo(() => {
    const vistas = new Set<number>();
    return coincidencias
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !vistas.has(c.linea) && vistas.add(c.linea));
  }, [coincidencias]);

  if (!duracion) return <div className="mapa-vacio" />;

  const pct = (t: number) => `${Math.min(100, (t / duracion) * 100)}%`;
  const tiempoEn = (clientX: number) => {
    const r = carril.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duracion;
  };

  return (
    <div
      className={`mapa-carril${coincidencias.length ? " buscando" : ""}`}
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
          className={`mapa-bloque h${colorHablante(hablantes, b.h)}${
            lineaActiva >= b.desde && lineaActiva <= b.hasta ? " actual" : ""
          }`}
          style={{ left: pct(b.a), width: `max(3px, ${((b.b - b.a) / duracion) * 100}%)` }}
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
  );
});

/** Hablantes con su porcentaje de tiempo; el que está hablando, encendido. */
export const Leyenda = memo(function Leyenda({
  lineas, hablantes, lineaActiva,
}: { lineas: LineaUI[]; hablantes: string[]; lineaActiva: number }) {
  const tiempos = useMemo(() => {
    const m = new Map<string, number>();
    let total = 0;
    for (const ln of lineas) {
      if (!ln.speaker) continue;
      const d = Math.max(0, ln.end - ln.start);
      m.set(ln.speaker, (m.get(ln.speaker) ?? 0) + d);
      total += d;
    }
    return { m, total };
  }, [lineas]);

  if (!hablantes.length) return null;
  const hablando = lineaActiva >= 0 ? lineas[lineaActiva]?.speaker : null;
  return (
    <div className="leyenda">
      {hablantes.map((h) => {
        const pct = tiempos.total ? Math.round(((tiempos.m.get(h) ?? 0) / tiempos.total) * 100) : 0;
        return (
          <div key={h} className={`leyenda-item h${colorHablante(hablantes, h)}${h === hablando ? " hablando" : ""}`}>
            <Avatar nombre={h} />
            <div className="leyenda-texto">
              <span className="leyenda-nombre">{h}</span>
              <span className="leyenda-barra"><i style={{ width: `${pct}%` }} /></span>
            </div>
            <span className="leyenda-pct">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
});

/** Iniciales: "Ana Pérez" → AP, "speaker_3" → S3. */
export function iniciales(nombre: string): string {
  const m = nombre.match(/^speaker_(\S+)$/i);
  if (m) return `S${m[1]}`.slice(0, 3);
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Avatar({ nombre, chico = false }: { nombre: string; chico?: boolean }) {
  return <span className={`avatar${chico ? " chico" : ""}`}>{iniciales(nombre)}</span>;
}
