import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Marked, type Tokens } from "marked";
import type { Desplazar, Documento as Doc } from "../tipos";
import { PASO_TECLADO } from "./Transcripcion";
import { desplazar, normalizar } from "../lib/util";

/** "01:02:03.5" | "02:03" → segundos */
function aSegundos(ts: string): number {
  return ts.split(":").reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}

/**
 * Centra `el` dentro del documento moviendo solo su scroll. scrollIntoView
 * mueve además todo contenedor con scroll que haya arriba (la página, si la
 * ventana es baja), y eso se veía como un salto de toda la interfaz.
 */
function centrar(raiz: HTMLElement, el: HTMLElement | Element, suave: boolean) {
  const a = el.getBoundingClientRect();
  const b = raiz.getBoundingClientRect();
  const top = raiz.scrollTop + a.top - b.top - (b.height - a.height) / 2;
  raiz.scrollTo({ top, behavior: suave ? "smooth" : "auto" });
}

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function boton(ts: string): string {
  const visible = ts.replace(/\.\d+$/, "");
  return `<button type="button" class="ts-link" data-t="${aSegundos(ts)}" title="Ir a ${visible}">${visible}</button>`;
}

// Un timestamp entre corchetes ([00:12:30], [12:30], [00:12:30–00:15:10]) o uno
// suelto con horas (00:12:30). Un "10:30" suelto no, porque puede ser una hora.
const T = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?`;
const RE_TS = new RegExp(String.raw`^(?:\[(${T})(?:\s*[–—-]\s*(${T}))?\]|(\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?))`);
const RE_INICIO = new RegExp(String.raw`\[\d{1,2}:\d{2}|\d{1,2}:\d{2}:\d{2}`);

const marked = new Marked({ gfm: true });
marked.use({
  extensions: [
    {
      name: "timestamp",
      level: "inline",
      start: (src: string) => src.match(RE_INICIO)?.index,
      tokenizer(src: string) {
        const m = RE_TS.exec(src);
        if (!m) return undefined;
        return { type: "timestamp", raw: m[0], desde: m[1] ?? m[3], hasta: m[2] };
      },
      renderer(tok) {
        const t = tok as unknown as { desde: string; hasta?: string };
        return t.hasta ? `${boton(t.desde)}<span class="ts-guion">–</span>${boton(t.hasta)}` : boton(t.desde);
      },
    },
  ],
  renderer: {
    // El markdown lo escribe el agente, pero el HTML crudo se muestra como texto.
    html(tok: Tokens.HTML | Tokens.Tag) {
      return escapar(tok.text);
    },
    // Los frames del resumen se piden al servidor, que solo entrega imágenes de <video>_analisis/.
    image(tok: Tokens.Image) {
      const remoto = /^https?:/i.test(tok.href);
      const src = remoto ? tok.href : `analisis?ruta=${encodeURIComponent(tok.href)}`;
      const titulo = tok.title ? ` title="${escapar(tok.title)}"` : "";
      return `<figure><img src="${escapar(src)}" alt="${escapar(tok.text)}" loading="lazy"${titulo}>${
        tok.text ? `<figcaption>${escapar(tok.text)}</figcaption>` : ""
      }</figure>`;
    },
    link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, tok: Tokens.Link) {
      return `<a href="${escapar(tok.href)}" target="_blank" rel="noopener noreferrer">${this.parser.parseInline(tok.tokens)}</a>`;
    },
  },
});

interface Props {
  doc: Doc;
  mediaRef: RefObject<HTMLMediaElement | null>;
  onSaltar: (t: number) => void;
  pestanas: ReactNode;
  /** botones a la derecha de la cabecera (pantalla completa del panel) */
  acciones?: ReactNode;
  /** lo que se busca (Ctrl+F) y cuál resultado está elegido */
  consulta: string;
  actual: number;
  onResultados: (n: number) => void;
  /** se incrementa para pedir "vuelve a seguir al video" desde afuera (tecla .) */
  pedirSeguir: number;
  /** donde se deja cómo desplazar el documento con ↑/↓ */
  desplazarRef: RefObject<Desplazar | null>;
}

/**
 * Resalta la consulta en el HTML ya pintado, sin tildes ni mayúsculas, y aunque
 * cruce negritas o enlaces: se arma un solo texto normalizado con el mapa de
 * cada carácter a su nodo, y cada resultado se envuelve en uno o más <mark>
 * con el mismo data-m. Devuelve cuántos hubo.
 */
function resaltar(raiz: HTMLElement, consulta: string): number {
  for (const m of raiz.querySelectorAll("mark.hit-doc")) m.replaceWith(...m.childNodes);
  raiz.normalize();
  const q = normalizar(consulta.trim()).replace(/\s+/g, " ");
  if (q.length < 2) return 0;

  let texto = "";
  const mapa: { nodo: Text; i: number }[] = [];
  const recorrido = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let n = recorrido.nextNode() as Text | null; n; n = recorrido.nextNode() as Text | null) {
    const v = n.data;
    for (let i = 0; i < v.length; i++) {
      if (/\s/.test(v[i])) {
        if (texto.endsWith(" ") || !texto) continue;
        texto += " ";
        mapa.push({ nodo: n, i });
        continue;
      }
      for (const c of normalizar(v[i])) {
        texto += c;
        mapa.push({ nodo: n, i });
      }
    }
  }

  // Tramos [nodo, desde, hasta) por resultado; se envuelven de atrás hacia
  // adelante para que partir un nodo no corra los offsets que faltan.
  const tramos: { nodo: Text; desde: number; hasta: number; m: number }[] = [];
  let m = 0;
  for (let pos = texto.indexOf(q); pos >= 0; pos = texto.indexOf(q, pos + q.length), m++) {
    for (let k = pos; k < pos + q.length; k++) {
      const { nodo, i } = mapa[k];
      const ult = tramos[tramos.length - 1];
      if (ult && ult.m === m && ult.nodo === nodo) ult.hasta = i + 1;
      else tramos.push({ nodo, desde: i, hasta: i + 1, m });
    }
  }
  for (const t of tramos.reverse()) {
    const r = document.createRange();
    r.setStart(t.nodo, t.desde);
    r.setEnd(t.nodo, t.hasta);
    const mark = document.createElement("mark");
    mark.className = "hit-doc";
    mark.dataset.m = String(t.m);
    r.surroundContents(mark);
  }
  return m;
}

export function Documento({ doc, mediaRef, onSaltar, pestanas, acciones, consulta, actual, onResultados, pedirSeguir, desplazarRef }: Props) {
  const html = useMemo(() => marked.parse(doc.md, { async: false }) as string, [doc.md]);
  const cont = useRef<HTMLDivElement>(null);

  // Seguir al video: el índice y las notas van en orden de tiempo, así que se
  // desplazan solos al bloque en curso; el resumen no (sus timestamps saltan
  // de un lado a otro) y se abre arriba, pero igual se puede pedir "Seguir".
  const [siguiendo, setSiguiendo] = useState(doc.tipo !== "resumen");
  const [conTiempos, setConTiempos] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const seguirRef = useRef(siguiendo);
  seguirRef.current = siguiendo && !buscando;
  const marcarRef = useRef<() => void>(() => {});
  const centrarActual = (suave = true) => {
    const raiz = cont.current;
    const fila = raiz?.querySelector<HTMLElement>(".bloque-actual");
    if (raiz && fila) centrar(raiz, fila, suave);
  };
  const volver = () => {
    setSiguiendo(true);
    // Tras un salto, el bloque en curso aún es el de antes (timeupdate llega
    // después): se actualiza primero para no ir al lugar viejo y luego al nuevo.
    marcarRef.current();
    centrarActual();
  };
  // Solo los pedidos nuevos (no el valor que ya traía al abrir la pestaña).
  const pedidoInicial = useRef(pedirSeguir);
  useEffect(() => {
    if (pedirSeguir !== pedidoInicial.current) volver();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedirSeguir]);
  const soltar = () => setSiguiendo(false);

  // ↑/↓ (los atiende App): desplazar es leer, así que deja de seguir al video.
  useEffect(() => {
    desplazarRef.current = (dir, repetida) => {
      setSiguiendo(false);
      if (cont.current) desplazar(cont.current, dir * PASO_TECLADO, repetida);
    };
    return () => {
      desplazarRef.current = null;
    };
  }, [desplazarRef]);

  // Marca el último timestamp ya alcanzado por el video (en un índice, el
  // capítulo en curso). timeupdate llega ~4 veces por segundo: suficiente.
  useEffect(() => {
    const el = mediaRef.current;
    const raiz = cont.current;
    if (!el || !raiz) return;
    // El HTML se pone a mano y no con dangerouslySetInnerHTML: así React no lo
    // reemplaza en un re-render y las marcas de "en curso" no se pierden.
    raiz.innerHTML = html;
    raiz.scrollTop = 0;
    const botones = [...raiz.querySelectorAll<HTMLElement>(".ts-link")]
      .map((b) => ({ b, t: Number(b.dataset.t), fila: b.closest("tr, li, h1, h2, h3, h4, p") }))
      .sort((x, y) => x.t - y.t);
    setConTiempos(botones.length > 0);
    let previo: (typeof botones)[number] | null = null;
    const marcar = () => {
      let actual: (typeof botones)[number] | null = null;
      for (const x of botones) {
        if (x.t <= el.currentTime + 0.25) actual = x;
        else break;
      }
      if (actual === previo) return;
      previo?.b.classList.remove("ts-actual");
      previo?.fila?.classList.remove("bloque-actual");
      actual?.b.classList.add("ts-actual");
      actual?.fila?.classList.add("bloque-actual");
      if (previo && seguirRef.current && actual?.fila) centrar(raiz, actual.fila, true);
      previo = actual;
    };
    marcar();
    marcarRef.current = marcar;
    // En el índice y en las notas se abre donde va el video; un resumen, arriba.
    const inicial = previo as (typeof botones)[number] | null; // marcar() lo asignó
    if (doc.tipo !== "resumen" && inicial?.fila) centrar(raiz, inicial.fila, false);
    el.addEventListener("timeupdate", marcar);
    el.addEventListener("seeked", marcar);
    return () => {
      el.removeEventListener("timeupdate", marcar);
      el.removeEventListener("seeked", marcar);
    };
  }, [html, mediaRef, doc.tipo]);

  // Búsqueda: se vuelve a resaltar cuando cambia el texto o el documento (el
  // efecto de arriba ya reemplazó el HTML, así que va después).
  const [pasada, setPasada] = useState(0);
  useEffect(() => {
    const raiz = cont.current;
    const n = raiz ? resaltar(raiz, consulta) : 0;
    onResultados(n);
    setBuscando(n > 0);
    setPasada((n) => n + 1);
  }, [html, consulta, onResultados]);

  // El resultado elegido: más marcado y centrado en pantalla.
  useEffect(() => {
    const raiz = cont.current;
    if (!raiz) return;
    raiz.querySelectorAll(".hit-actual").forEach((x) => x.classList.remove("hit-actual"));
    const marcas = raiz.querySelectorAll<HTMLElement>(`mark.hit-doc[data-m="${actual}"]`);
    marcas.forEach((x) => x.classList.add("hit-actual"));
    if (marcas[0]) centrar(raiz, marcas[0], true);
  }, [actual, pasada]);

  const vacio = doc.tipo === "notas" && !doc.cantidad;

  return (
    <div className="transcripcion">
      <div className="panel-cabecera">
        {pestanas}
        <div className="cabecera-derecha">
          {conTiempos && !vacio && (
            <>
              {!siguiendo && !buscando && (
                <button className="boton-seguir" onClick={volver} title="Seguir el video (.)">
                  <IconoSeguir />
                  <span>Seguir</span>
                </button>
              )}
              <span className={`estado-seguir${siguiendo && !buscando ? " on" : ""}`}>
                <i />
                {siguiendo && !buscando ? "Siguiendo el video" : "Lectura libre"}
              </span>
            </>
          )}
          {!conTiempos && <span className="archivo-doc" title={doc.archivo}>{doc.archivo}</span>}
          {acciones}
        </div>
      </div>
      {vacio ? (
        <div className="vacia">
          <p>Todavía no hay notas.</p>
          <p className="tenue">
            Presiona <kbd>N</kbd> en cualquier momento del video para anotar algo. Queda guardado en{" "}
            <code>{doc.archivo}</code>, junto a la transcripción, para tus próximas revisiones.
          </p>
        </div>
      ) : (
      <div
        ref={cont}
        className="documento"
        title={conTiempos ? doc.archivo : undefined}
        onWheel={soltar}
        onTouchMove={soltar}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) soltar(); // barra de scroll
        }}
        onClick={(e) => {
          const b = (e.target as HTMLElement).closest<HTMLElement>(".ts-link");
          if (b) onSaltar(Number(b.dataset.t));
        }}
      />
      )}
      {/* En el resumen la lectura libre es lo normal: basta el botón de arriba. */}
      {conTiempos && !vacio && !siguiendo && doc.tipo !== "resumen" && (
        <button className="volver" onClick={volver}>
          <IconoSeguir grande />
          Volver a lo que está sonando
        </button>
      )}
    </div>
  );
}

export function IconoSeguir({ grande }: { grande?: boolean }) {
  const t = grande ? 16 : 14;
  return (
    <svg viewBox="0 0 24 24" width={t} height={t} aria-hidden>
      <path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21v-2Zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z"/>
    </svg>
  );
}
