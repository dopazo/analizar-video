/** [inicio, fin, texto] en segundos del video. */
export type Palabra = [number, number, string];

export interface Linea {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  words?: Palabra[];
}

export interface Datos {
  video: { nombre: string; url: string; audio: boolean };
  transcripcion: {
    archivo: string;
    header: string;
    palabras: boolean;
    lineas: Linea[];
  } | null;
  hablantes: string[];
  documentos: Documento[];
  /** cantidad de capítulos que el servidor sacó del índice (0 = sin índice) */
  capitulos: number;
  /** si ya está la grilla de miniaturas para la vista previa de la barra */
  miniaturas: boolean;
}

export interface Documento {
  tipo: "resumen" | "indice";
  titulo: string;
  archivo: string;
  md: string;
}

/** Una línea ya preparada para pintar y buscar. */
export interface LineaUI extends Linea {
  idx: number;
  tokens: string[];
  /** tiempos por token, si la línea trae palabras alineadas */
  tiempos: [number, number][] | null;
  /** tokens normalizados (sin tildes, minúsculas) para buscar */
  norm: string[];
}

export interface Coincidencia {
  linea: number;
  desde: number; // índice de token
  hasta: number; // índice de token, inclusivo
}
