import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import type { Coincidencia, LineaUI } from "../tipos";
import { buscarIndice, colorHablante, fmt } from "../lib/util";
import { Avatar } from "./MapaTiempo";

interface Props {
  lineas: LineaUI[];
  hablantes: string[];
  lineaActiva: number;
  coincidencias: Coincidencia[];
  actual: number;
  listaRef: RefObject<HTMLDivElement | null>;
  mediaRef: RefObject<HTMLMediaElement | null>;
  onSaltar: (t: number) => void;
  /** se incrementa para pedir "vuelve a seguir al video" desde afuera (tecla ., un salto) */
  pedirSeguir: number;
  pestanas: ReactNode;
  /** botones a la derecha de la cabecera (pantalla completa del panel) */
  acciones?: ReactNode;
}

const ALTO_ESTIMADO = 72;
/** Aire sobre la primera fila: va en el virtualizador y no en el CSS, para que sus cuentas calcen con el DOM. */
const MARGEN_SUPERIOR = 8;

/**
 * Lo que la lista ya midió, para no partir de cero al volver desde otra
 * pestaña (la transcripción se desmonta mientras se lee el resumen). Sin esto
 * todas las filas vuelven al alto estimado, el destino calculado cae lejos de
 * la fila real y la lista llega en dos o tres saltos.
 */
let memoria: { lineas: LineaUI[]; ancho: number; alto: number; medidas: VirtualItem[] } | null = null;

/** Opciones de `llevar`. */
interface Ir {
  /** animar si el destino está cerca (si está lejos, siempre se salta directo) */
  suave?: boolean;
  /** dejar la fila a esta distancia del borde superior, en vez de centrada */
  arriba?: number;
  /** volver a posicionar aunque ya se esté yendo a esa fila */
  forzar?: boolean;
  /** se llama cuando la fila quedó en su lugar */
  listo?: () => void;
  /**
   * Dar por terminado solo tras una pasada después de pintar (por omisión).
   * Sin esto, una fila que ya está en su lugar antes de que React repinte con
   * medidas nuevas (tras un cambio de ancho) se da por buena y luego se corre.
   */
  confirmar?: boolean;
}

export function Transcripcion({
  lineas, hablantes, lineaActiva, coincidencias, actual, listaRef, mediaRef, onSaltar, pedirSeguir, pestanas, acciones,
}: Props) {
  const [siguiendo, setSiguiendo] = useState(true);
  const buscando = coincidencias.length > 0;

  /** La línea del momento del video: la última que ya empezó (en un silencio, la anterior). */
  const lineaEnCurso = useCallback(() => {
    const t = mediaRef.current?.currentTime ?? 0;
    return Math.max(0, buscarIndice(lineas, t, (l) => l.start));
  }, [mediaRef, lineas]);

  // Al montar: con lo medido la vez anterior (mismo texto), la lista abre ya
  // centrada en lo que suena. Igual se oculta hasta quedar en su lugar: si
  // llega en la primera pasada se muestra antes de pintar; si hacen falta más
  // (filas que nunca se midieron), no se ve pasar.
  const [inicio] = useState(() => {
    const m = memoria && memoria.lineas === lineas ? memoria : null;
    const objetivo = lineaEnCurso();
    const it = m?.medidas[objetivo];
    const offset = it && m ? Math.max(0, it.start + it.size / 2 - m.alto / 2) : objetivo * ALTO_ESTIMADO;
    return { m, objetivo, offset };
  });
  const [posicionando, setPosicionando] = useState(true);

  const virt = useVirtualizer({
    count: lineas.length,
    getScrollElement: () => listaRef.current,
    estimateSize: () => ALTO_ESTIMADO,
    overscan: 10,
    paddingStart: MARGEN_SUPERIOR,
    initialOffset: inicio.offset,
    ...(inicio.m && {
      initialMeasurementsCache: inicio.m.medidas,
      initialRect: { width: inicio.m.ancho, height: inicio.m.alto },
    }),
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

  // --- Llevar la lista a una fila -------------------------------------------
  //
  // El virtualizador conoce el alto real solo de las filas que ya pintó; para
  // el resto usa un estimado. Por eso el destino se ajusta midiendo la fila en
  // el DOM, en pasadas (cada una pinta y mide filas nuevas), hasta que queda
  // quieta. Solo se anima un salto corto hacia una fila ya pintada; mientras
  // dura la animación, el virtualizador no corrige el scroll por cambios de
  // alto (esa corrección es instantánea y cortaba la animación a medio camino).
  // Al terminar, una pasada sin animación deja la fila exacta.
  //
  // Cada pedido nuevo invalida los anteriores (`gen`): un salto no compite con
  // la corrección pendiente del anterior.
  const gen = useRef(0);
  const destino = useRef(-1);
  const espera = useRef(0);
  const cuadro = useRef(0);

  const detener = useCallback(() => {
    gen.current++;
    destino.current = -1;
    window.clearTimeout(espera.current);
    cancelAnimationFrame(cuadro.current);
    virt.shouldAdjustScrollPositionOnItemSizeChange = undefined;
  }, [virt]);

  const llevar = useCallback(
    (idx: number, { suave = true, arriba, forzar = false, listo, confirmar = true }: Ir = {}) => {
      const lista = listaRef.current;
      if (!lista || idx < 0 || idx >= lineas.length) return listo?.();
      if (!forzar && destino.current === idx) return; // ya va hacia allá
      detener();
      const g = gen.current;
      destino.current = idx;

      /** Cuánto hay que mover el scroll para dejar la fila en su lugar; null si no está pintada. */
      const error = () => {
        const fila = lista.querySelector<HTMLElement>(`[data-index="${idx}"]`);
        if (!fila) return null;
        const a = fila.getBoundingClientRect();
        const b = lista.getBoundingClientRect();
        return a.top - b.top - (arriba ?? (b.height - a.height) / 2);
      };
      const fin = () => {
        if (g !== gen.current) return;
        destino.current = -1;
        virt.shouldAdjustScrollPositionOnItemSizeChange = undefined;
        listo?.();
      };
      let pasada = 0;
      const corregir = () => {
        if (g !== gen.current) return;
        virt.shouldAdjustScrollPositionOnItemSizeChange = undefined;
        const d = error();
        const antes = lista.scrollTop;
        if (d === null) {
          const o = arriba == null
            ? virt.getOffsetForIndex(idx, "center")?.[0]
            : (virt.getOffsetForIndex(idx, "start")?.[0] ?? 0) - arriba;
          if (o != null) lista.scrollTop = o;
        } else if (Math.abs(d) > 1) {
          lista.scrollTop = antes + d;
        }
        // Quieta: ya está en su lugar, o el scroll no da para más (las primeras
        // y las últimas filas no alcanzan el centro).
        const quieta = d !== null && (Math.abs(d) <= 1 || Math.abs(lista.scrollTop - antes) < 0.5);
        if ((quieta && (pasada > 0 || !confirmar)) || ++pasada > 20) return fin();
        // Dos cuadros: en el primero se pintan y se miden las filas nuevas.
        cuadro.current = requestAnimationFrame(() => (cuadro.current = requestAnimationFrame(corregir)));
      };

      const d = error();
      if (suave && d !== null && Math.abs(d) < lista.clientHeight) {
        if (Math.abs(d) <= 1) return fin();
        virt.shouldAdjustScrollPositionOnItemSizeChange = () => false;
        const tras = () => {
          if (g !== gen.current) return;
          window.clearTimeout(espera.current);
          corregir();
        };
        lista.addEventListener("scrollend", tras, { once: true });
        espera.current = window.setTimeout(tras, 900); // por si no llega scrollend
        lista.scrollTo({ top: lista.scrollTop + d, behavior: "smooth" });
      } else {
        corregir();
      }
    },
    [listaRef, lineas.length, virt, detener],
  );

  // Lo que leen los manejadores que se registran una sola vez.
  const estado = useRef({ siguiendo, buscando });
  estado.current = { siguiendo, buscando };

  // Abrir en lo que suena, antes de pintar.
  useLayoutEffect(() => {
    const id = window.setTimeout(() => setPosicionando(false), 600); // por si otro pedido lo reemplaza
    // Sin confirmar: si las medidas guardadas ya la dejan en su lugar, la
    // lista se muestra antes del primer cuadro.
    llevar(inicio.objetivo, { suave: false, forzar: true, confirmar: false, listo: () => setPosicionando(false) });
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al salir (otra pestaña), guardar lo medido para la vuelta.
  const dims = useRef({ ancho: 0, alto: 0 });
  useEffect(
    () => () => {
      detener();
      if (dims.current.alto) memoria = { lineas, ...dims.current, medidas: virt.measurementsCache };
    },
    [lineas, virt, detener],
  );

  // La primera fila visible y su altura, tomada al leer (en cada scroll): es
  // el ancla si cambia el ancho. Se toma antes y no al cambiar, porque para
  // entonces los renglones ya se reacomodaron y la fila visible es otra.
  const anclaLectura = useRef<{ idx: number; arriba: number } | null>(null);
  const cuadroAncla = useRef(0);
  const tomarAncla = () => {
    cancelAnimationFrame(cuadroAncla.current);
    cuadroAncla.current = requestAnimationFrame(() => {
      const el = listaRef.current;
      if (!el) return;
      const tope = el.getBoundingClientRect().top;
      const fila = [...el.querySelectorAll<HTMLElement>("[data-index]")].find((f) => f.getBoundingClientRect().bottom > tope);
      anclaLectura.current = fila ? { idx: Number(fila.dataset.index), arriba: fila.getBoundingClientRect().top - tope } : null;
    });
  };
  useEffect(() => () => cancelAnimationFrame(cuadroAncla.current), []);

  // Si cambia el ancho de la lista (pantalla completa del panel, ventana más
  // angosta), los renglones cambian de alto y las medidas quedan viejas: se
  // re-mide todo y se vuelve a anclar. Siguiendo, a lo que suena; leyendo, a
  // la primera fila visible, a la misma altura en que estaba.
  useEffect(() => {
    const el = listaRef.current;
    if (!el) return;
    let ancho = el.clientWidth;
    // El ancho puede cambiar en dos tiempos (el panel se expande y luego el
    // navegador entra a pantalla completa): si el segundo llega mientras se
    // ancla el primero, se conserva el ancla original y no la fila que en ese
    // momento está a medio ubicar.
    let previa: { idx: number; arriba?: number } | null = null;
    const ro = new ResizeObserver(() => {
      dims.current = { ancho: el.clientWidth, alto: el.clientHeight };
      if (el.clientWidth === ancho) return;
      ancho = el.clientWidth;
      let ancla: { idx: number; arriba?: number } = { idx: -1 };
      if (previa && destino.current === previa.idx) {
        ancla = previa;
      } else if (estado.current.siguiendo && !estado.current.buscando) {
        ancla = { idx: lineaEnCurso() };
      } else if (anclaLectura.current) {
        ancla = anclaLectura.current;
      }
      previa = ancla;
      // measure() olvida todos los altos, también los de las filas pintadas,
      // que el virtualizador ya había medido con el ancho nuevo y que no
      // volverán a avisar (no cambian más de tamaño): se miden de nuevo acá.
      virt.measure();
      el.querySelectorAll<HTMLElement>("[data-index]").forEach((n) => virt.measureElement(n));
      llevar(ancla.idx, { suave: false, arriba: ancla.arriba, forzar: true });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [listaRef, virt, llevar, lineaEnCurso]);

  // Seguir al video mientras el usuario no se haya ido a leer otra parte. El
  // destino sale del tiempo del video y no de `lineaActiva`, que tras un salto
  // sigue un cuadro en la línea vieja.
  useEffect(() => {
    if (siguiendo && lineaActiva >= 0 && !buscando) llevar(lineaEnCurso());
  }, [lineaActiva, siguiendo, buscando, llevar, lineaEnCurso]);

  // Un salto que no pasa por el visor (barra del reproductor, J/L, flechas)
  // puede caer en un silencio, donde no hay línea activa: igual se lleva la
  // lista a la línea anterior a ese punto.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const alSaltar = () => {
      if (estado.current.siguiendo && !estado.current.buscando) llevar(lineaEnCurso());
    };
    el.addEventListener("seeked", alSaltar);
    return () => el.removeEventListener("seeked", alSaltar);
  }, [mediaRef, llevar, lineaEnCurso]);

  // Al moverse entre resultados, llevar la lista a ese resultado.
  useEffect(() => {
    const c = coincidencias[actual];
    if (c) llevar(c.linea);
  }, [actual, coincidencias, llevar]);

  // Pedido de volver a seguir (tecla ., un salto desde la lista o el mapa). El
  // destino sale del tiempo del video, que ya cambió, y no de `lineaActiva`,
  // que se actualiza un cuadro después: con ella la lista iba primero a la
  // línea vieja, y durante una búsqueda le ganaba al resultado elegido. Solo
  // pedidos nuevos, no el que ya venía al montar.
  //
  // Si se venía leyendo, volver a seguir cambia la cabecera (se va el botón
  // "Seguir") y con ella el alto de la lista: el destino se calcula después de
  // ese cambio, o la fila queda corrida y hay que corregirla con un rebote.
  const pendiente = useRef<(() => void) | null>(null);
  const seguir = (forzar = false) => {
    const ir = () => llevar(lineaEnCurso(), { forzar });
    if (estado.current.siguiendo) return ir();
    pendiente.current = ir;
    setSiguiendo(true);
  };
  useLayoutEffect(() => {
    if (!siguiendo || !pendiente.current) return;
    const ir = pendiente.current;
    pendiente.current = null;
    ir();
  }, [siguiendo]);

  const pedidoInicial = useRef(pedirSeguir);
  useEffect(() => {
    if (pedirSeguir !== pedidoInicial.current) seguir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedirSeguir]);

  // Cualquier gesto del usuario sobre la lista suspende el seguimiento y
  // cancela lo que estuviera en camino (si no, la corrección pendiente de un
  // salto devolvía la lista a su lugar en medio del gesto).
  const soltar = () => {
    detener();
    pendiente.current = null;
    setSiguiendo(false);
  };

  const volver = () => seguir(true);
  const puedeVolver = !siguiendo;

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
        className={`lista${posicionando ? " posicionando" : ""}`}
        ref={listaRef}
        onScroll={tomarAncla}
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
                // flow-root: el margen de arriba de un cambio de hablante queda
                // dentro de lo que se mide. Sin eso se escapaba del contenedor,
                // el virtualizador medía cada turno 10 px más corto y lo pintado
                // saltaba al desplazarse.
                <div key={it.key} data-index={it.index} ref={virt.measureElement} style={{ display: "flow-root" }}>
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
