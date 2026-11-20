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
  const coincidencias = useMemo(() => buscar(lineas, consultaDiferida), [lineas, consultaDiferida]);
  useEffect(() => {
    setActual(0);
    setVisitado(false);
  }, [coincidencias]);

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

  const moverResultado = useCallback(
    (paso: number) => {
      if (!coincidencias.length) return;
      const n = visitado ? (actual + paso + coincidencias.length) % coincidencias.length : actual;
      setVisitado(true);
      setActual(n);
      saltar(lineas[coincidencias[n].linea].start);
    },
    [actual, visitado, coincidencias, lineas, saltar],
  );

  // Atajos globales (fuera de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = mediaRef.current;
      const enCampo = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if (e.key === "/" && !enCampo) {
        e.preventDefault();
        buscador.current?.focus();
        return;
      }
      if (enCampo || !el || e.ctrlKey || e.metaKey || e.altKey) return;
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
          <div className="buscador">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"/></svg>
            <input
              ref={buscador}
              type="search"
              placeholder="Buscar en lo que se dijo  ( / )"
              value={consulta}
              onChange={(e) => {
                setConsulta(e.target.value);
                setPestana("transcripcion"); // la búsqueda es sobre lo que se dijo
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  moverResultado(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  setConsulta("");
                  (e.target as HTMLInputElement).blur();
                  setPedirSeguir((n) => n + 1);
                }
              }}
              aria-label="Buscar en la transcripción"
            />
            {consulta.trim().length >= 2 && (
              <div className="buscador-nav">
                <span className="contador">
                  {coincidencias.length ? `${actual + 1} / ${coincidencias.length}` : "0"}
                </span>
                <button onClick={() => moverResultado(-1)} disabled={!coincidencias.length} aria-label="Resultado anterior">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="m7.4 15.4 4.6-4.6 4.6 4.6L18 14l-6-6-6 6z"/></svg>
                </button>
                <button onClick={() => moverResultado(1)} disabled={!coincidencias.length} aria-label="Resultado siguiente">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>
                </button>
              </div>
            )}
          </div>
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
            <kbd>Espacio</kbd> reproducir · <kbd>J</kbd>/<kbd>L</kbd> ±10 s · <kbd>←</kbd>/<kbd>→</kbd> ±5 s ·{" "}
            <kbd>/</kbd> buscar · <kbd>.</kbd> volver a lo que suena · <kbd>C</kbd> subtítulos · clic en una
            palabra para saltar
          </p>
        </section>
        <section
          ref={columnaTexto}
          className={`columna-texto${panelCompleto ? " panel-completo" : ""}`}
          aria-label="Transcripción y documentos"
        >
          {docActivo ? (
            <Documento doc={docActivo} mediaRef={mediaRef} onSaltar={saltar} pestanas={pestanas} acciones={botonPanel} />
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
    </div>
  );
}

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
