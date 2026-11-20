// Revolico: NO conectada. No hay permiso verificado para acceso automatizado, y el motor no extrae datos de sitios web.
// Vías para conectarla después (sin saltarse controles):
//  1. Acuerdo de datos o API oficial de Revolico, si la ofrece. Entonces se usa createHttpFeed con su URL y token.
//  2. Mientras tanto: carga manual de archivos en la carpeta de entrada (adapters/manual-inbox.js).
import { createUnavailableSource } from './unavailable.js';

export function createRevolico() {
  return createUnavailableSource({
    key: 'revolico',
    name: 'Revolico (clasificados)',
    reason: 'No hay permiso verificado para acceso automatizado ni API oficial disponible.',
    requirements: [
      'Acuerdo de datos o autorización escrita de Revolico para usar sus publicaciones.',
      'Si existe API oficial: URL y credencial emitidas por Revolico (se conectaría con el adaptador de feed).',
      'Confirmar qué campos pueden usarse y con qué plazo de conservación.',
    ],
    docs: 'Ver engine/README.md, sección «Fuentes».',
  });
}
