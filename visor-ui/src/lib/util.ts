import type { Coincidencia, Datos, LineaUI } from "../tipos";

export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function fmt(seg: number, conHoras = true): string {
  const t = Math.max(0, Math.floor(seg));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return conHoras || h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function prepararLineas(datos: Datos): LineaUI[] {
  const lineas = datos.transcripcion?.lineas ?? [];
  return lineas.map((ln, idx) => {
    const tokens = ln.words ? ln.words.map((w) => w[2]) : ln.text.split(/\s+/).filter(Boolean);
    return {
      ...ln,
      idx,
      tokens,
      tiempos: ln.words ? ln.words.map((w) => [w[0], w[1]] as [number, number]) : null,
      norm: tokens.map(normalizar),
    };
  });
}

/** Último índice con clave(i) <= t, o -1. */
export function buscarIndice<T>(arr: T[], t: number, clave: (x: T) => number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clave(arr[mid]) <= t) {
      res = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return res;
}

/**
 * Busca la frase (sin tildes ni mayúsculas) dentro de cada línea, a nivel de
 * caracteres sobre los tokens unidos por un espacio, y la traduce a rangos de
 * tokens para poder resaltar palabra por palabra.
 */
export function buscar(lineas: LineaUI[], consulta: string): Coincidencia[] {
  const q = normalizar(consulta.trim()).replace(/\s+/g, " ");
  if (q.length < 2) return [];
  const res: Coincidencia[] = [];
  for (const ln of lineas) {
    const texto = ln.norm.join(" ");
    let pos = texto.indexOf(q);
    if (pos < 0) continue;
    // offsets de inicio de cada token
    const inicios: number[] = [];
    let acc = 0;
    for (const t of ln.norm) {
      inicios.push(acc);
      acc += t.length + 1;
    }
    while (pos >= 0) {
      const fin = pos + q.length - 1;
      const desde = buscarIndice(inicios, pos, (x) => x);
      const hasta = buscarIndice(inicios, fin, (x) => x);
      res.push({ linea: ln.idx, desde, hasta });
      pos = texto.indexOf(q, pos + q.length);
    }
  }
  return res;
}

/** Color estable por hablante, del 1 al 8 (tokens --h1..--h8 en CSS). */
export function colorHablante(hablantes: string[], h: string | null): number {
  if (!h) return 0;
  const i = hablantes.indexOf(h);
  return i < 0 ? 0 : (i % 8) + 1;
}

/** Destino pendiente de cada contenedor mientras dura un desplazamiento suave. */
const destinos = new WeakMap<HTMLElement, number>();

/**
 * Desplaza `el` en `dy` px (↑/↓). Varias pulsaciones seguidas suman sobre el
 * destino pendiente y no sobre la posición a medio camino: si no, cada una
 * cortaba la animación anterior y la distancia se perdía. Con la tecla
 * mantenida (`repetida`) va sin animación, que a 30 pulsaciones por segundo
 * solo se vería trabada.
 */
export function desplazar(el: HTMLElement, dy: number, repetida: boolean): void {
  const max = el.scrollHeight - el.clientHeight;
  const desde = destinos.get(el) ?? el.scrollTop;
  const top = Math.max(0, Math.min(max, desde + dy));
  // Ya en el borde: no habrá scroll ni scrollend que limpie el destino.
  if (repetida || Math.abs(top - el.scrollTop) < 1) {
    destinos.delete(el);
    el.scrollTop = top;
    return;
  }
  destinos.set(el, top);
  el.addEventListener("scrollend", () => destinos.delete(el), { once: true });
  el.scrollTo({ top, behavior: "smooth" });
}
