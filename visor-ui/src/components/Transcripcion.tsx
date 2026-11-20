import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Coincidencia, LineaUI } from "../tipos";
import { colorHablante, fmt } from "../lib/util";
import { Avatar } from "./MapaTiempo";

interface Props {
  lineas: LineaUI[];
  hablantes: string[];
  lineaActiva: number;
  coincidencias: Coincidencia[];
  actual: number;
  listaRef: RefObject<HTMLDivElement | null>;
  onSaltar: (t: number) => void;
  /** se incrementa para pedir "vuelve a seguir al video" desde afuera (tecla .) */
  pedirSeguir: number;
  pestanas: ReactNode;
}

export function Transcripcion({
  lineas, hablantes, lineaActiva, coincidencias, actual, listaRef, onSaltar, pedirSeguir, pestanas,
}: Props) {
  const [siguiendo, setSiguiendo] = useState(true);
  const programatico = useRef(false);

  const virt = useVirtualizer({
    count: lineas.length,
    getScrollElement: () => listaRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  // Rangos de tokens resaltados por línea.
  const hits = useMemo(() => {
    const m = new Map<number, { desde: number; hasta: number; actual: boolean }[]>();
    coincidencias.forEach((c, i) => {
      const arr = m.get(c.linea) ?? [];
      arr.push({ desde: c.desde, hasta: c.hasta, actual: i === actual });
      m.set(c.linea, arr);
    });
    return m;
  }, [coincidencias, actual]);

  const irA = useCallback(
    (idx: number) => {
      if (idx < 0) return;
      programatico.current = true;
      virt.scrollToIndex(idx, { align: "center", behavior: "smooth" });
      window.setTimeout(() => (programatico.current = false), 600);
    },
    [virt],
  );

  // Seguir al video mientras el usuario no se haya ido a leer otra parte.
  useEffect(() => {
    if (siguiendo && lineaActiva >= 0 && !coincidencias.length) irA(lineaActiva);
  }, [lineaActiva, siguiendo, irA, coincidencias.length]);

  // Al moverse entre resultados, llevar la lista a ese resultado.
  useEffect(() => {
    const c = coincidencias[actual];
    if (c) irA(c.linea);
  }, [actual, coincidencias, irA]);

  useEffect(() => {
    if (pedirSeguir > 0) {
      setSiguiendo(true);
      irA(lineaActiva);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedirSeguir]);

  // Cualquier gesto del usuario sobre la lista suspende el seguimiento.
  const soltar = () => {
    if (!programatico.current) setSiguiendo(false);
  };

  if (!lineas.length) {
    return (
      <div className="transcripcion">
        <div className="panel-cabecera">{pestanas}</div>
        <div className="vacia">
          <p>No hay transcripción para este video.</p>
          <p className="tenue">Pídele al agente que lo transcriba y recarga esta página.</p>
        </div>
      </div>
    );
  }

  const items = virt.getVirtualItems();
  return (
    <div className="transcripcion">
      <div className="panel-cabecera">
        {pestanas}
        <span className={`estado-seguir${siguiendo && !coincidencias.length ? " on" : ""}`}>
          <i />
          {coincidencias.length ? `${coincidencias.length} resultados` : siguiendo ? "Siguiendo el video" : "Lectura libre"}
        </span>
      </div>
      <div
        className="lista"
        ref={listaRef}
        onWheel={soltar}
        onTouchMove={soltar}
        onMouseDown={(e) => {
          // arrastrar la barra de scroll (clic fuera de las líneas)
          if (e.target === e.currentTarget) soltar();
        }}
      >
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          <div style={{ transform: `translateY(${items[0]?.start ?? 0}px)` }}>
            {items.map((it) => {
              const ln = lineas[it.index];
              return (
                <div key={it.key} data-index={it.index} ref={virt.measureElement}>
                  <Fila
                    ln={ln}
                    color={colorHablante(hablantes, ln.speaker)}
                    mostrarHablante={!!ln.speaker && lineas[it.index - 1]?.speaker !== ln.speaker}
                    activa={it.index === lineaActiva}
                    hits={hits.get(it.index)}
                    onSaltar={onSaltar}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {!siguiendo && lineaActiva >= 0 && (
        <button
          className="volver"
          onClick={() => {
            setSiguiendo(true);
            irA(lineaActiva);
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21v-2Zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z"/></svg>
          Volver a lo que está sonando
        </button>
      )}
    </div>
  );
}

interface FilaProps {
  ln: LineaUI;
  color: number;
  mostrarHablante: boolean;
  activa: boolean;
  hits?: { desde: number; hasta: number; actual: boolean }[];
  onSaltar: (t: number) => void;
}

const Fila = memo(function Fila({ ln, color, mostrarHablante, activa, hits, onSaltar }: FilaProps) {
  const [copiado, setCopiado] = useState(false);
  const claseHit = (i: number) => {
    if (!hits) return "";
    for (const h of hits) if (i >= h.desde && i <= h.hasta) return h.actual ? " hit hit-actual" : " hit";
    return "";
  };
  const copiar = async () => {
    const quien = ln.speaker ? `${ln.speaker}: ` : "";
    try {
      await navigator.clipboard.writeText(`[${fmt(ln.start)}] ${quien}${ln.tokens.join(" ")}`);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1200);
    } catch {
      /* sin permiso de portapapeles: no hacer nada */
    }
  };

  return (
    <div className={`fila h${color}${activa ? " activa" : ""}${mostrarHablante ? " nuevo-turno" : ""}`} data-l={ln.idx}>
      {mostrarHablante && (
        <div className="hablante">
          <Avatar nombre={ln.speaker!} chico />
          <span>{ln.speaker}</span>
        </div>
      )}
      <div className="fila-cuerpo">
        <button className="ts" onClick={() => onSaltar(ln.start)} title="Ir a este momento">
          {fmt(ln.start)}
        </button>
        <p className="texto">
          {ln.tokens.map((tok, i) => (
            <Fragment key={i}>
              <span
                data-w={i}
                className={`w${claseHit(i)}`}
                onClick={() => onSaltar(ln.tiempos ? ln.tiempos[i][0] : ln.start)}
              >
                {tok}
              </span>{" "}
            </Fragment>
          ))}
        </p>
        <button className={`copiar${copiado ? " ok" : ""}`} onClick={copiar} title="Copiar con timestamp" aria-label="Copiar con timestamp">
          {copiado ? (
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden><path fill="currentColor" d="m9 16.2-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden><path fill="currentColor" d="M16 1H6a2 2 0 0 0-2 2v12h2V3h10V1Zm3 4H10a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16h-9V7h9v14Z"/></svg>
          )}
        </button>
      </div>
    </div>
  );
});
