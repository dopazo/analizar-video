import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { Datos } from "./tipos";
import { buscar, prepararLineas } from "./lib/util";
import { useSincronia } from "./lib/sincronia";
import { Reproductor } from "./components/Reproductor";
import { Leyenda, MapaTiempo } from "./components/MapaTiempo";
import { Transcripcion } from "./components/Transcripcion";

export default function App() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duracion, setDuracion] = useState(0);
  const [consulta, setConsulta] = useState("");
  const [actual, setActual] = useState(0);
  // El primer Enter lleva al resultado que ya se muestra; los siguientes avanzan.
  const [visitado, setVisitado] = useState(false);
  const [pedirSeguir, setPedirSeguir] = useState(0);
  const mediaRef = useRef<HTMLVideoElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const buscador = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("api/datos")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Datos) => {
        setDatos(d);
        document.title = d.video.nombre;
      })
      .catch((e) => setError(String(e)));
  }, []);

  const lineas = useMemo(() => (datos ? prepararLineas(datos) : []), [datos]);
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
  const modelo = t?.header.replace(/^\[|\]$/g, "").split("|")[0]?.trim();

  return (
    <div className="app">
      <div className="fondo" aria-hidden />
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
        {t && (
          <div className="buscador">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"/></svg>
            <input
              ref={buscador}
              type="search"
              placeholder="Buscar en lo que se dijo  ( / )"
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
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
            <kbd>/</kbd> buscar · <kbd>.</kbd> volver a lo que suena · clic en una palabra para saltar
          </p>
        </section>
        <section className="columna-texto" aria-label="Transcripción">
          <Transcripcion
            lineas={lineas}
            hablantes={datos.hablantes}
            lineaActiva={lineaActiva}
            coincidencias={coincidencias}
            actual={actual}
            listaRef={listaRef}
            onSaltar={saltar}
            pedirSeguir={pedirSeguir}
          />
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
