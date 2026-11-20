import type { LineaUI } from "../tipos";
import { colorHablante } from "./util";

/**
 * Subtítulos a partir de la transcripción, como WebVTT.
 *
 * Una línea de la transcripción puede ser un turno de 200 caracteres: en
 * pantalla sería un muro de texto. Se parte en trozos de a lo más ~2 renglones,
 * usando los tiempos por palabra cuando existen (cada trozo aparece justo
 * cuando se dice) y, si no, repartiendo el tiempo de la línea según el largo.
 * El nombre de quien habla va solo en el primer trozo de cada turno.
 */
const MAX_CHARS = 84; // ~2 renglones de 42, la convención usual de subtítulos
const PAUSA_CORTE = 0.8; // s de silencio entre palabras que también cortan el trozo
const SOSTENER = 1.0; // s que un trozo sigue en pantalla si no viene otro enseguida

interface Cue {
  start: number;
  end: number;
  text: string;
}

function trozos(tokens: string[], tiempos: [number, number][] | null, ini: number, fin: number): Cue[] {
  const grupos: number[][] = [];
  let actual: number[] = [];
  let largo = 0;
  tokens.forEach((t, i) => {
    const pausa = tiempos && i > 0 ? tiempos[i][0] - tiempos[i - 1][1] : 0;
    if (actual.length && (largo + 1 + t.length > MAX_CHARS || pausa > PAUSA_CORTE)) {
      grupos.push(actual);
      actual = [];
      largo = 0;
    }
    actual.push(i);
    largo += (largo ? 1 : 0) + t.length;
  });
  if (actual.length) grupos.push(actual);

  if (tiempos) {
    return grupos.map((g) => ({
      start: tiempos[g[0]][0],
      end: tiempos[g[g.length - 1]][1],
      text: g.map((i) => tokens[i]).join(" "),
    }));
  }
  // Sin tiempos por palabra: el tiempo de la línea, proporcional a los caracteres.
  const total = tokens.reduce((n, t) => n + t.length + 1, 0) || 1;
  let t = ini;
  return grupos.map((g) => {
    const chars = g.reduce((n, i) => n + tokens[i].length + 1, 0);
    const dur = ((fin - ini) * chars) / total;
    const cue = { start: t, end: t + dur, text: g.map((i) => tokens[i]).join(" ") };
    t += dur;
    return cue;
  });
}

function ts(seg: number): string {
  const ms = Math.round(Math.max(0, seg) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
}

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function subtitulosVTT(lineas: LineaUI[], hablantes: string[]): string {
  const cues: Cue[] = [];
  let previo: string | null = null;
  for (const ln of lineas) {
    const partes = trozos(ln.tokens, ln.tiempos, ln.start, ln.end);
    partes.forEach((c, i) => {
      // Nombre de quien habla al cambiar de turno, con su color (clase ::cue(.hN)).
      if (i === 0 && ln.speaker && ln.speaker !== previo) {
        c.text = `<c.h${colorHablante(hablantes, ln.speaker)}>${escapar(ln.speaker)}</c>: ${escapar(c.text)}`;
      } else {
        c.text = escapar(c.text);
      }
      cues.push(c);
    });
    previo = ln.speaker;
  }
  cues.sort((a, b) => a.start - b.start);
  // Que un trozo no se pise con el siguiente y no desaparezca de golpe.
  for (let i = 0; i < cues.length; i++) {
    const sig = cues[i + 1]?.start ?? Infinity;
    cues[i].end = Math.min(Math.max(cues[i].end, cues[i].start + 0.6) + SOSTENER, sig);
    if (cues[i].end <= cues[i].start) cues[i].end = cues[i].start + 0.3;
  }
  const cuerpo = cues.map((c) => `${ts(c.start)} --> ${ts(c.end)}\n${c.text}`).join("\n\n");
  return `WEBVTT\n\n${cuerpo}\n`;
}
