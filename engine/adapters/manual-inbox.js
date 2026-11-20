// Fuente manual: archivos CSV o JSON que el equipo deja en una carpeta.
// Es la vía para grupos y proveedores que entregan datos por archivo. Los archivos ya leídos se MUEVEN a la carpeta de procesados, nunca se borran.
import { readdirSync, readFileSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parseCsv } from '../core/csv.js';

const EXTENSIONS = ['.csv', '.json'];
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

function rowsFromJson(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (!list.every((x) => x && typeof x === 'object')) throw new Error('el JSON debe ser una lista de objetos');
  return list;
}

export function createManualInbox({
  key = 'carpeta-manual',
  name = 'Carga manual por archivo',
  dir,
  processedDir,
  country = 'Cuba',
  defaultCurrency = 'CUP',
} = {}) {
  if (!dir || !processedDir) throw new Error('La carpeta de entrada y la de procesados son obligatorias.');
  return {
    key,
    name,
    kind: 'manual',
    country,
    defaultCurrency,
    describe() {
      return {
        key,
        name,
        kind: 'manual',
        status: 'activa',
        requirements: [],
        note: 'Coloque archivos CSV o JSON en la carpeta de entrada. Los procesados se mueven a la carpeta de procesados.',
      };
    },
    async fetch() {
      mkdirSync(dir, { recursive: true });
      const files = readdirSync(dir)
        .filter((f) => EXTENSIONS.includes(extname(f).toLowerCase()))
        .sort();
      const rows = [];
      const warnings = [];
      const readFiles = [];
      for (const file of files) {
        const path = join(dir, file);
        if (statSync(path).size > MAX_FILE_BYTES) {
          warnings.push({ message: `${file}: archivo mayor de 5 MB; se omite.` });
          continue;
        }
        try {
          const text = readFileSync(path, 'utf8');
          const parsed = extname(file).toLowerCase() === '.json' ? rowsFromJson(text) : parseCsv(text);
          parsed.forEach((row, i) => rows.push({ ...row, source_id: `${file}#${i + 1}`, source_file: file }));
          readFiles.push(file);
        } catch (err) {
          warnings.push({ message: `${file}: no se pudo leer (${err.message}). Queda en la carpeta de entrada.` });
        }
      }
      return { rows, nextCursor: null, warnings, files: readFiles };
    },
    /** Mueve los archivos leídos a procesados con su fecha. Solo se llama cuando lo recibido ya está guardado. */
    async ack(page) {
      if (!page.files?.length) return;
      mkdirSync(processedDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      for (const file of page.files) {
        renameSync(join(dir, file), join(processedDir, `${stamp}-${file}`));
      }
    },
  };
}
