import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Datos } from "./tipos";
import { buscar, prepararLineas } from "./lib/util";
import { useSincronia } from "./lib/sincronia";
import { Reproductor } from "./components/Reproductor";
import { BarraFlotante, BotonPanelCompleto, usePanelCompleto } from "./components/PanelCompleto";
import { subtitulosVTT } from "./lib/subtitulos";
import { Leyenda, MapaTiempo } from "./components/MapaTiempo";
import { Transcripcion } from "./components/Transcripcion";
import { Documento } from "./components/Documento";
import {
  ATAJOS, Aviso, AtajosFlotantes, Buscador, CompositorNota, Flotante, useElementoPantallaCompleta,
} from "./components/Flotantes";
import { fmt } from "./lib/util";
import type { Documento as Doc } from "./tipos";

export default function App() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duracion, setDuracion] = useState(0);
  const [consulta, setConsulta] = useState("");
  const [actual, setActual] = useState(0);
  // El primer Enter lleva al resultado que ya se muestra; los siguientes avanzan.
  const [visitado, setVisitado] = useState(false);
  const [pedirSeguir, setPedirSeguir] = useState(0);
  const [pestana, setPestana] = useState<string>("transcripcion");
  const conectado = usePresencia();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const columnaTexto = useRef<HTMLElement>(null);
  const [panelCompleto, alternarPanel] = usePanelCompleto(columnaTexto);
  const fsEl = useElementoPantallaCompleta();
  const enPantallaCompleta = panelCompleto || !!fsEl;
  const buscadorFlotante = useRef<HTMLInputElement>(null);
  const [buscarFlotante, setBuscarFlotante] = useState(false);
  const [atajosAbiertos, setAtajosAbiertos] = useState(false);
  // Nota en curso: el momento del video al apretar N, y si hay que reanudar al terminar.
  const [nota, setNota] = useState<{ t: number; reanudar: boolean } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Recargar vuelve a pedir los datos sin recargar la página: si se abrió el
  // visor antes de tener resumen, índice o hablantes, aparecen sin perder el
  // punto del video. `version` fuerza a releer las pistas (capítulos).
  const [version, setVersion] = useState(0);
  const [cargando, setCargando] = useState(false);
  const cargar = useCallback(() => {
    setCargando(true);
    fetch("api/datos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Datos) => {
        setDatos(d);
        setVersion((v) => v + 1);
        document.title = d.video.nombre;
      })
      .catch((e) => setError(String(e)))
      .finally(() => setCargando(false));
  }, []);
  useEffect(cargar, [cargar]);

  const lineas = useMemo(() => (datos ? prepararLineas(datos) : []), [datos]);
  const subtitulos = useMemo(
    () => (datos && lineas.length ? subtitulosVTT(lineas, datos.hablantes) : null),
    [datos, lineas],
  );
  const consultaDiferida = useDeferredValue(consulta);
  // El buscador busca en la pestaña abierta: en la transcripción, por líneas
  // (y salta el video); en resumen, índice o notas, dentro del documento.
  const enTranscripcion = !datos?.documentos?.some((d) => d.tipo === pestana);
  const coincidencias = useMemo(
    () => (enTranscripcion ? buscar(lineas, consultaDiferida) : []),
    [lineas, consultaDiferida, enTranscripcion],
  );
  const [totalDoc, setTotalDoc] = useState(0);
  const totalBusqueda = enTranscripcion ? coincidencias.length : totalDoc;
  useEffect(() => {
    setActual(0);
    setVisitado(false);
  }, [coincidencias, totalDoc, pestana]);

  const lineaActiva = useSincronia(mediaRef, lineas, listaRef);

  // La duración: del video, o del final de la transcripción mientras carga.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const upd = () => Number.isFinite(el.duration) && setDuracion(el.duration);
    upd();
    el.addEventListener("loadedmetadata", upd);
    el.addEventListener("durationchange", upd);
    return () => {
      el.removeEventListener("loadedmetadata", upd);
      el.removeEventListener("durationchange", upd);
    };
  }, [datos]);
  const durMapa = duracion || (lineas.length ? lineas[lineas.length - 1].end : 0);

  const saltar = useCallback((t: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, t);
    setPedirSeguir((n) => n + 1);
  }, []);

  const abrirNota = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    const reanudar = !el.paused;
    el.pause(); // mientras se escribe, el video espera
    setNota({ t: el.currentTime, reanudar });
  }, []);

  const cerrarNota = useCallback((reanudar: boolean) => {
    setNota(null);
    if (reanudar) void mediaRef.current?.play();
  }, []);

  const guardarNota = useCallback(
    async (texto: string) => {
      if (!nota) return;
      const r = await fetch("api/notas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: nota.t, texto }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const doc: Doc = await r.json();
      setDatos((d) => (d ? { ...d, documentos: [...d.documentos.filter((x) => x.tipo !== "notas"), doc] } : d));
      setAviso(`Nota guardada en ${fmt(nota.t)}`);
      cerrarNota(nota.reanudar);
    },
    [nota, cerrarNota],
  );

  useEffect(() => {
    if (!aviso) return;
    const id = window.setTimeout(() => setAviso(null), 2600);
    return () => window.clearTimeout(id);
  }, [aviso]);

  // Mientras se escribe una nota o se busca, los atajos de Media Chrome se
  // apagan: con el video en pantalla completa esos campos viven dentro del
  // reproductor, y su Espacio, K, F o flechas se comerían lo que se escribe.
  useEffect(() => {
    const mc = document.getElementById("reproductor");
    if (!mc) return;
    if (nota || buscarFlotante) mc.setAttribute("nohotkeys", "");
    else mc.removeAttribute("nohotkeys");
  }, [nota, buscarFlotante]);

  // El buscador flotante solo existe en pantalla completa.
  useEffect(() => {
    if (!enPantallaCompleta) setBuscarFlotante(false);
  }, [enPantallaCompleta]);
  useEffect(() => {
    if (buscarFlotante) buscadorFlotante.current?.focus();
  }, [buscarFlotante]);

  const cambiarConsulta = useCallback((q: string) => setConsulta(q), []);
  const cerrarBusqueda = useCallback(() => {
    setConsulta("");
    setBuscarFlotante(false);
    (document.activeElement as HTMLElement | null)?.blur();
    setPedirSeguir((n) => n + 1);
  }, []);

  const moverResultado = useCallback(
    (paso: number) => {
      if (!totalBusqueda) return;
      const n = visitado ? (actual + paso + totalBusqueda) % totalBusqueda : actual;
      setVisitado(true);
      setActual(n);
      // En la transcripción el resultado es un momento del video; en un documento, solo se lee.
      if (enTranscripcion) saltar(lineas[coincidencias[n].linea].start);
    },
    [actual, visitado, totalBusqueda, enTranscripcion, coincidencias, lineas, saltar],
  );

  // Lo que el manejador de teclas necesita leer sin volver a registrarse.
  const estado = useRef({ enPantallaCompleta, notaAbierta: !!nota, abrirNota });
  estado.current = { enPantallaCompleta, notaAbierta: !!nota, abrirNota };

  // Atajos globales (fuera de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = mediaRef.current;
      const enCampo = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      // Ctrl+F / ⌘F: el buscador del visor reemplaza al del navegador, que no ve
      // la transcripción entera (la lista es virtual: solo existe lo visible).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (estado.current.enPantallaCompleta) {
          setBuscarFlotante(true);
          buscadorFlotante.current?.focus();
          buscadorFlotante.current?.select();
        } else {
          buscador.current?.focus();
          buscador.current?.select();
        }
        return;
      }
      if (enCampo || !el || e.ctrlKey || e.metaKey || e.altKey) return;
      if (estado.current.notaAbierta) return;
      if (e.key === "?") {
        e.preventDefault();
        setAtajosAbiertos((v) => !v);
        return;
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        estado.current.abrirNota();
        return;
      }
      const k = e.key.toLowerCase();
      // Con el foco dentro del reproductor, Media Chrome ya atiende estas teclas:
      // atenderlas también acá las aplicaría dos veces (play y pausa a la vez).
      const propiasDelReproductor = [" ", "k", "m", "f", "c", "arrowleft", "arrowright", "arrowup", "arrowdown"];
      if ((e.target as HTMLElement)?.closest("media-controller") && propiasDelReproductor.includes(k)) return;
      if (k === " " || k === "k") {
        e.preventDefault();
        if (el.paused) void el.play();
        else el.pause();
      } else if (k === "j" || k === "arrowleft") {
        e.preventDefault();
        el.currentTime = Math.max(0, el.currentTime - (k === "j" ? 10 : 5));
      } else if (k === "l" || k === "arrowright") {
        e.preventDefault();
        el.currentTime = el.currentTime + (k === "l" ? 10 : 5);
      } else if (k === ".") {
        setPedirSeguir((n) => n + 1);
      } else if (k === "m") {
        el.muted = !el.muted;
      } else if (k === "p" && el instanceof HTMLVideoElement) {
        // Video en miniatura (picture-in-picture): sigue a la vista mientras se lee.
        if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
        else void el.requestPictureInPicture?.().catch(() => {});
      } else if (k === "c") {
        // Subtítulos desde la transcripción: útiles sobre todo en pantalla completa.
        const pista = [...el.textTracks].find((t) => t.kind === "captions");
        if (pista) pista.mode = pista.mode === "showing" ? "disabled" : "showing";
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) {
    return (
      <div className="estado">
        <div className="estado-tarjeta">
          <strong>No pude cargar los datos del visor</strong>
          <span>{error} · ¿sigue corriendo visor.py?</span>
        </div>
      </div>
    );
  }
  if (!datos) return <Esqueleto />;

  const t = datos.transcripcion;
  const docs = datos.documentos ?? [];
  const docActivo = docs.find((d) => d.tipo === pestana) ?? null;
  const pestanas = (
    <div className="pestanas" role="tablist">
      {[{ tipo: "transcripcion", titulo: "Transcripción" }, ...docs].map((p) => (
        <button
          key={p.tipo}
          role="tab"
          aria-selected={pestana === p.tipo}
          className={`pestana${pestana === p.tipo ? " activa" : ""}`}
          onClick={() => setPestana(p.tipo)}
        >
          {p.titulo}
          {"cantidad" in p && p.cantidad ? <span className="pestana-cuenta">{p.cantidad}</span> : null}
        </button>
      ))}
    </div>
  );
  const botonPanel = <BotonPanelCompleto activo={panelCompleto} alternar={alternarPanel} />;
  const modelo = t?.header.replace(/^\[|\]$/g, "").split("|")[0]?.trim();

  return (
    <div className="app">
      <div className="fondo" aria-hidden />
      {!conectado && (
        <div className="aviso-cerrado" role="status">
          El visor se cerró en el equipo. Lo que ya cargó sigue a la vista; para volver a usarlo, pídele al agente que lo abra de nuevo.
        </div>
      )}
      <header className="cabecera">
        <Marca />
        <div className="titulo">
          <h1 title={datos.video.nombre}>{datos.video.nombre}</h1>
          {t && (
            <div className="meta">
              <span className="insignia">{t.lineas.length} líneas</span>
              {datos.hablantes.length > 0 && <span className="insignia">{datos.hablantes.length} hablantes</span>}
              {modelo && <span className="insignia insignia-modelo">{modelo}</span>}
              {t.palabras && <span className="insignia insignia-acento">palabra a palabra</span>}
            </div>
          )}
        </div>
        <button
          className={`boton-icono recargar${cargando ? " girando" : ""}`}
          onClick={cargar}
          disabled={cargando}
          title="Recargar transcripción, resumen e índice (sin perder el punto del video)"
          aria-label="Recargar datos"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z" />
          </svg>
        </button>
        {t && (
          <Buscador
            inputRef={buscador}
            consulta={consulta}
            setConsulta={cambiarConsulta}
            total={totalBusqueda}
            donde={DONDE[docActivo?.tipo ?? ""] ?? "lo que se dijo"}
            actual={actual}
            mover={moverResultado}
            onEscape={cerrarBusqueda}
          />
        )}
      </header>

      <main className="cuerpo">
        <section className="columna-video">
          <Reproductor
            url={datos.video.url}
            nombre={datos.video.nombre}
            audio={datos.video.audio}
            mediaRef={mediaRef}
            capitulos={datos.capitulos ?? 0}
            miniaturas={!!datos.miniaturas}
            subtitulos={subtitulos}
            version={version}
            bajoSlider={
              <MapaTiempo
                lineas={lineas}
                hablantes={datos.hablantes}
                duracion={durMapa}
                coincidencias={coincidencias}
                actual={actual}
                mediaRef={mediaRef}
                onSaltar={saltar}
                lineaActiva={lineaActiva}
              />
            }
          />
          <Leyenda lineas={lineas} hablantes={datos.hablantes} lineaActiva={lineaActiva} />
          <p className="atajos">
            {ATAJOS.slice(0, -1).map(([k, d], i) => (
              <span key={k}>
                {i > 0 && " · "}
                <kbd>{k}</kbd> {d}
              </span>
            ))}
            {" · clic en una palabra para saltar"}
          </p>
        </section>
        <section
          ref={columnaTexto}
          className={`columna-texto${panelCompleto ? " panel-completo" : ""}`}
          aria-label="Transcripción y documentos"
        >
          {docActivo ? (
            <Documento
              doc={docActivo}
              mediaRef={mediaRef}
              onSaltar={saltar}
              pestanas={pestanas}
              acciones={botonPanel}
              consulta={consultaDiferida}
              actual={actual}
              onResultados={setTotalDoc}
              pedirSeguir={pedirSeguir}
            />
          ) : (
          <Transcripcion
            pestanas={pestanas}
            lineas={lineas}
            hablantes={datos.hablantes}
            lineaActiva={lineaActiva}
            coincidencias={coincidencias}
            actual={actual}
            listaRef={listaRef}
            onSaltar={saltar}
            pedirSeguir={pedirSeguir}
            acciones={botonPanel}
          />
          )}
          {panelCompleto && <BarraFlotante audio={datos.video.audio} />}
        </section>
      </main>

      {/* Flotantes: dentro del elemento en pantalla completa si lo hay. */}
      <Flotante destino={fsEl}>
        {nota && (
          <CompositorNota t={nota.t} onGuardar={guardarNota} onCerrar={() => cerrarNota(nota.reanudar)} elevada={enPantallaCompleta} />
        )}
        {!nota && aviso && (
          <Aviso
            texto={aviso}
            elevado={enPantallaCompleta}
            accion={
              pestana !== "notas" && !fsEl ? (
                <button className="aviso-accion" onClick={() => setPestana("notas")}>Ver notas</button>
              ) : undefined
            }
          />
        )}
        {enPantallaCompleta && buscarFlotante && t && (
          <Buscador
            flotante
            inputRef={buscadorFlotante}
            consulta={consulta}
            setConsulta={cambiarConsulta}
            total={totalBusqueda}
            donde={DONDE[docActivo?.tipo ?? ""] ?? "lo que se dijo"}
            actual={actual}
            mover={moverResultado}
            onEscape={cerrarBusqueda}
          />
        )}
        {(enPantallaCompleta || atajosAbiertos) && (
          <AtajosFlotantes abierto={atajosAbiertos} alternar={() => setAtajosAbiertos((v) => !v)} />
        )}
      </Flotante>
    </div>
  );
}

const DONDE: Record<string, string> = { resumen: "el resumen", indice: "el índice", notas: "las notas" };

function Marca() {
  return (
    <div className="marca" aria-hidden>
      <svg viewBox="0 0 24 24" width="20" height="20">
        <path fill="currentColor" d="M8 6.5v11a1 1 0 0 0 1.52.85l8.5-5.5a1 1 0 0 0 0-1.7l-8.5-5.5A1 1 0 0 0 8 6.5Z" />
      </svg>
    </div>
  );
}

/** Mientras llegan los datos: la silueta de la página, sin saltos al cargar. */
function Esqueleto() {
  return (
    <div className="app">
      <div className="fondo" aria-hidden />
      <header className="cabecera">
        <Marca />
        <div className="titulo">
          <div className="hueso" style={{ width: 220, height: 16 }} />
          <div className="hueso" style={{ width: 300, height: 12, marginTop: 8 }} />
        </div>
      </header>
      <main className="cuerpo">
        <section className="columna-video">
          <div className="hueso hueso-video" />
        </section>
        <section className="columna-texto">
          <div className="esqueleto-lista">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="hueso" style={{ height: 14, width: `${60 + ((i * 37) % 35)}%` }} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

/**
 * Mantiene abierta la conexión /api/vivo: mientras exista, el servidor sabe que
 * hay una pestaña abierta; al cerrarla, se apaga solo. Si el servidor ya no
 * está (se cerró o el equipo durmió), devuelve false para avisarlo.
 */
function usePresencia(): boolean {
  const [conectado, setConectado] = useState(true);
  useEffect(() => {
    const es = new EventSource("api/vivo");
    let timer = 0;
    es.onopen = () => {
      window.clearTimeout(timer);
      timer = 0;
      setConectado(true);
    };
    es.onerror = () => {
      // EventSource reintenta solo (cada ~3 s); si en 4 s no volvió, avisamos.
      // El temporizador no se reinicia en cada reintento fallido.
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        if (es.readyState !== EventSource.OPEN) setConectado(false);
      }, 4000);
    };
    return () => {
      window.clearTimeout(timer);
      es.close();
    };
  }, []);
  return conectado;
}
