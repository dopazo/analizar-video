import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { Marked, type Tokens } from "marked";
import type { Documento as Doc } from "../tipos";

/** "01:02:03.5" | "02:03" → segundos */
function aSegundos(ts: string): number {
  return ts.split(":").reduce((acc, p) => acc * 60 + parseFloat(p), 0);
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
}

export function Documento({ doc, mediaRef, onSaltar, pestanas, acciones }: Props) {
  const html = useMemo(() => marked.parse(doc.md, { async: false }) as string, [doc.md]);
  const cont = useRef<HTMLDivElement>(null);

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
      previo = actual;
    };
    marcar();
    // En el índice y en las notas se abre donde va el video; un resumen, arriba.
    const inicial = previo as (typeof botones)[number] | null; // marcar() lo asignó
    if (doc.tipo !== "resumen") inicial?.fila?.scrollIntoView({ block: "center" });
    el.addEventListener("timeupdate", marcar);
    el.addEventListener("seeked", marcar);
    return () => {
      el.removeEventListener("timeupdate", marcar);
      el.removeEventListener("seeked", marcar);
    };
  }, [html, mediaRef, doc.tipo]);

  const vacio = doc.tipo === "notas" && !doc.cantidad;

  return (
    <div className="transcripcion">
      <div className="panel-cabecera">
        {pestanas}
        <div className="cabecera-derecha">
          <span className="archivo-doc" title={doc.archivo}>{doc.archivo}</span>
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
        onClick={(e) => {
          const b = (e.target as HTMLElement).closest<HTMLElement>(".ts-link");
          if (b) onSaltar(Number(b.dataset.t));
        }}
      />
      )}
    </div>
  );
}
