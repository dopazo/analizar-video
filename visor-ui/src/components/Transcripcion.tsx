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
  /** botones a la derecha de la cabecera (pantalla completa del panel) */
  acciones?: ReactNode;
}

export function Transcripcion({
  lineas, hablantes, lineaActiva, coincidencias, actual, listaRef, onSaltar, pedirSeguir, pestanas, acciones,
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

  const correccion = useRef(0);
  const irA = useCallback(
    (idx: number, suave = true) => {
      if (idx < 0) return;
      programatico.current = true;
      window.clearTimeout(correccion.current);
      const lista = listaRef.current;
      if (!lista) return;
      // El virtualizador calcula con altos estimados para las filas que aún no
      // pintó: en un salto largo (del inicio al minuto 20) el destino estimado
      // puede quedar lejos de la fila real, que entonces ni siquiera existe en
      // el DOM. Se ajusta en pasadas: mientras la fila no esté, se vuelve a
      // pedir su posición (ya con más filas medidas); cuando está, se mide y se
      // corrige lo que falte para centrarla, hasta que quede quieta.
      // Un salto lejano va sin animación: animar 20 minutos de texto no aporta.
      const destino0 = virt.getOffsetForIndex(idx, "center")?.[0];
      const lejos = destino0 != null && Math.abs(destino0 - lista.scrollTop) > lista.clientHeight * 3;
      const anim: ScrollBehavior = suave && !lejos ? "smooth" : "auto";
      if (destino0 != null) lista.scrollTo({ top: destino0, behavior: anim });
      let pasada = 0;
      const ajustar = () => {
        const fila = lista.querySelector<HTMLElement>(`[data-index="${idx}"]`);
        let movio = false;
        if (fila) {
          const a = fila.getBoundingClientRect();
          const b = lista.getBoundingClientRect();
          const delta = a.top + a.height / 2 - (b.top + b.height / 2);
          if (Math.abs(delta) > 6) {
            lista.scrollTo({ top: lista.scrollTop + delta, behavior: pasada === 0 ? anim : "auto" });
            movio = true;
          }
        } else {
          const d = virt.getOffsetForIndex(idx, "center")?.[0];
          if (d != null) lista.scrollTo({ top: d, behavior: "auto" });
          movio = true;
        }
        if (movio && ++pasada < 8) correccion.current = window.setTimeout(ajustar, 60);
        else correccion.current = window.setTimeout(() => (programatico.current = false), anim === "smooth" ? 450 : 50);
      };
      correccion.current = window.setTimeout(ajustar, anim === "smooth" ? 380 : 60);
    },
    [virt, listaRef],
  );

  // Si cambia el ancho de la lista (pantalla completa del panel, ventana más
  // angosta), los renglones cambian de alto y las medidas quedan viejas: se
  // re-mide y se vuelve a centrar lo que suena, sin animación (un scroll suave
  // calculado con medidas viejas termina en otro lado).
  const seguirRef = useRef({ siguiendo, lineaActiva });
  seguirRef.current = { siguiendo, lineaActiva };
  useEffect(() => {
    const el = listaRef.current;
    if (!el) return;
    let ancho = el.clientWidth;
    let timers: number[] = [];
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === ancho) return;
      ancho = el.clientWidth;
      timers.forEach(window.clearTimeout);
      virt.measure();
      // Los altos reales llegan de a poco (cada fila se mide al pintarse): se
      // corrige en varias pasadas cortas hasta que la posición se asienta.
      timers = [0, 80, 200, 400, 700].map((ms) =>
        window.setTimeout(() => {
          const { siguiendo: s, lineaActiva: l } = seguirRef.current;
          if (s && l >= 0) irA(l, false);
        }, ms),
      );
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      timers.forEach(window.clearTimeout);
    };
  }, [listaRef, virt, irA]);

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

  const volver = () => {
    setSiguiendo(true);
    irA(lineaActiva);
  };
  const puedeVolver = !siguiendo && lineaActiva >= 0;

  if (!lineas.length) {
    return (
      <div className="transcripcion">
        <div className="panel-cabecera">{pestanas}{acciones}</div>
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
        <div className="cabecera-derecha">
          {puedeVolver && !coincidencias.length && (
            <button className="boton-seguir" onClick={volver} title="Seguir el video (.)">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21v-2Zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z"/></svg>
              <span>Seguir</span>
            </button>
          )}
          <span className={`estado-seguir${siguiendo && !coincidencias.length ? " on" : ""}`}>
            <i />
            {coincidencias.length ? `${coincidencias.length} resultados` : siguiendo ? "Siguiendo el video" : "Lectura libre"}
          </span>
          {acciones}
        </div>
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
      {puedeVolver && (
        <button className="volver" onClick={volver}>
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
