import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { fmt } from "../lib/util";

/**
 * Lo que flota sobre la página (la nota, el buscador, los atajos) tiene que
 * verse también en pantalla completa: el navegador solo muestra el elemento que
 * está en pantalla completa y lo que tiene adentro. Por eso se monta dentro de
 * él cuando existe, y en el cuerpo de la página si no.
 */
export function useElementoPantallaCompleta(): Element | null {
  const [el, setEl] = useState<Element | null>(() => document.fullscreenElement);
  useEffect(() => {
    const upd = () => setEl(document.fullscreenElement);
    document.addEventListener("fullscreenchange", upd);
    return () => document.removeEventListener("fullscreenchange", upd);
  }, []);
  return el;
}

export function Flotante({ children, destino }: { children: ReactNode; destino: Element | null }) {
  return createPortal(children, destino ?? document.body);
}

export const ES_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const TECLA_BUSCAR = ES_MAC ? "⌘F" : "Ctrl+F";

/** Lista única de atajos: la usan el pie de página y el flotante de pantalla completa. */
export const ATAJOS: [string, string][] = [
  ["Espacio", "reproducir / pausar"],
  ["J / L", "−10 s / +10 s"],
  ["← / →", "−5 s / +5 s"],
  ["N", "nota en este momento"],
  [TECLA_BUSCAR, "buscar en lo dicho"],
  ["C", "subtítulos"],
  [".", "volver a lo que suena"],
  ["M", "silenciar"],
  ["Esc", "cerrar / salir"],
];

// ---------------------------------------------------------------------------

interface PropsNota {
  t: number;
  onGuardar: (texto: string) => Promise<void>;
  onCerrar: () => void;
  elevada: boolean; // sobre la barra flotante del panel en pantalla completa
}

/** Panel inferior central para escribir una nota anclada al momento del video. */
export function CompositorNota({ t, onGuardar, onCerrar, elevada }: PropsNota) {
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);

  const guardar = async () => {
    if (!texto.trim() || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await onGuardar(texto);
    } catch {
      setError("No se pudo guardar. ¿Sigue corriendo el visor?");
      setGuardando(false);
    }
  };

  return (
    <div className={`nota-flotante${elevada ? " elevada" : ""}`} role="dialog" aria-label="Nueva nota">
      <div className="nota-cabecera">
        <span className="nota-titulo">Nota en</span>
        <span className="nota-ts">{fmt(t)}</span>
        <span className="espaciador" />
        <button className="boton-icono chico" onClick={onCerrar} aria-label="Cancelar (Esc)" title="Cancelar (Esc)">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <textarea
        ref={area}
        value={texto}
        rows={3}
        placeholder="¿Qué quieres recordar de este momento?"
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          // Que ninguna tecla escrita acá dispare atajos del reproductor.
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCerrar();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void guardar();
          }
        }}
      />
      <div className="nota-pie">
        <span className="tenue-chico">{error ?? <><kbd>Enter</kbd> guardar · <kbd>Shift+Enter</kbd> salto de línea · <kbd>Esc</kbd> cancelar</>}</span>
        <button className="boton-primario" onClick={() => void guardar()} disabled={!texto.trim() || guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

/** Aviso breve abajo al centro ("Nota guardada"). */
export function Aviso({ texto, accion, elevado }: { texto: string; accion?: ReactNode; elevado?: boolean }) {
  return (
    <div className={`aviso-flotante${elevado ? " elevada" : ""}`} role="status">
      {texto}
      {accion}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Atajos, plegados en una pastilla abajo a la izquierda; se abren con clic o con "?". */
export function AtajosFlotantes({ abierto, alternar }: { abierto: boolean; alternar: () => void }) {
  return (
    <div className={`atajos-flotantes${abierto ? " abierto" : ""}`}>
      {abierto && (
        <dl className="atajos-lista">
          {ATAJOS.map(([k, d]) => (
            <div key={k}>
              <dt><kbd>{k}</kbd></dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      )}
      <button className="atajos-pastilla" onClick={alternar} title="Atajos de teclado (?)">
        <kbd>?</kbd> {abierto ? "Ocultar atajos" : "Atajos"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface PropsBuscador {
  inputRef: RefObject<HTMLInputElement | null>;
  consulta: string;
  setConsulta: (q: string) => void;
  total: number;
  actual: number;
  mover: (paso: number) => void;
  onEscape: () => void;
  flotante?: boolean;
}

/** El buscador de la cabecera; en pantalla completa, el mismo flotando arriba. */
export function Buscador({ inputRef, consulta, setConsulta, total, actual, mover, onEscape, flotante }: PropsBuscador) {
  return (
    <div className={`buscador${flotante ? " buscador-flotante" : ""}`}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"/></svg>
      <input
        ref={inputRef}
        type="search"
        placeholder={`Buscar en lo que se dijo  (${TECLA_BUSCAR})`}
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            mover(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onEscape();
          }
        }}
        aria-label="Buscar en la transcripción"
      />
      {consulta.trim().length >= 2 && (
        <div className="buscador-nav">
          <span className="contador">{total ? `${actual + 1} / ${total}` : "0"}</span>
          <button onClick={() => mover(-1)} disabled={!total} aria-label="Resultado anterior">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="m7.4 15.4 4.6-4.6 4.6 4.6L18 14l-6-6-6 6z"/></svg>
          </button>
          <button onClick={() => mover(1)} disabled={!total} aria-label="Resultado siguiente">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}
