# Motor de datos de RESOLVER (Nexo)

Motor independiente que recopila publicaciones comerciales de fuentes **autorizadas**, las limpia, las clasifica, las analiza y envía a RESOLVER lo que pasa las validaciones. No usa nada de `src/` (la lista de provincias es una copia y una prueba garantiza que coincide con `src/config.js`).

El motor **no extrae datos de sitios web**, no evade controles de acceso, CAPTCHA ni restricciones de terceros, y no simula fuentes conectadas: una fuente sin acuerdo o sin credenciales aparece como «no conectada», con lo que hace falta para conectarla.

## Arquitectura

```
 fuentes autorizadas                                            RESOLVER
 ┌──────────────┐   ┌───────────┐   ┌────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌──────────────┐
 │ carga manual │──▶│ COLLECTOR │──▶│ PROCESSOR  │──▶│ CLASSIFIER       │──▶│ DEDUPLICACIÓN│──▶│ ANALYZER     │
 │ feed HTTP    │   │ guarda la │   │ limpia,    │   │ producto, marca, │   │ mismo origen │   │ mín/máx/med. │
 │ (pendientes) │   │ fila tal  │   │ normaliza  │   │ categoría        │   │ entre fuentes│   │ por día y    │
 └──────────────┘   │ como llegó│   │ precio,    │   └──────────────────┘   └──────────────┘   │ provincia    │
                    └───────────┘   │ fecha, lugar│          │ errores                        └──────┬───────┘
                                    └─────┬──────┘          ▼                                       ▼
                                          │ errores  ┌─────────────┐                          ┌──────────────┐
                                          └────────▶ │ CUARENTENA  │                          │ DETECTOR     │
                                                     │ con motivos │                          │ señales con  │
                                                     └─────────────┘                          │ evidencia    │
                                                                                              └──────┬───────┘
                                                     SYNCHRONIZER ◀──────────────────────────────────┘
                                                     envía por lotes, confirma, reintenta
```

Cada componente vive en su archivo:

| Componente | Archivo | Qué hace |
|---|---|---|
| COLLECTOR | `collector.js` | Pide páginas al adaptador, reintenta fallos temporales, guarda cada fila original (con hash y fecha), guarda el cursor por página. |
| PROCESSOR | `processor.js`, `core/*` | Une nombres de columnas (español/inglés, con o sin acentos), limpia texto, interpreta precios y fechas, marca errores y advertencias. |
| CLASSIFIER | `classifier.js`, `rules/categories.js` | Categoría y marca. La declarada por la fuente siempre gana; la sugerida se marca como sugerida con su confianza. |
| Geografía | `rules/geography.js` | Provincia declarada o alias; si falta, municipio conocido o una sola provincia en el texto. Si no hay ninguna, cuarentena. |
| Calidad | `quality.js` | Errores (van a cuarentena) y advertencias (se guardan con el registro) y una puntuación de 0 a 1. |
| Cuarentena | `store.js` (colección `quarantine`) | Filas que no se pueden guardar, con sus motivos. Nada se borra. |
| Deduplicación | `dedupe.js` | Mismo origen (misma fuente y mismo identificador) = la misma publicación. Otra fuente con la misma huella = se une a un registro existente y se anota en qué fuentes apareció. |
| ANALYZER | `analyzer.js` | Mínimo, máximo, mediana y promedio por producto, provincia, moneda y día. Con menos de 3 publicaciones solo guarda el conteo. |
| DETECTOR | `detector.js` | Señales: cambio de precio, brecha entre provincias, presencia nueva. Cada una con evidencia y confianza (baja, media, alta). |
| SYNCHRONIZER | `synchronizer.js` | Envía los registros pendientes por lotes al destino, marca los confirmados y reintenta los demás (hasta 5 intentos). |
| Orquestador | `index.js` | Une los pasos, impide ejecuciones solapadas, registra cada ejecución y cada error. |
| Almacén | `store.js` | Estado propio del motor (JSON con escritura atómica). Misma interfaz para cambiarlo por una base de datos. |

## Fuentes

| Clave | Estado | Cómo entran los datos | Qué falta para conectarla |
|---|---|---|---|
| `carpeta-manual` | **Activa** | El equipo deja archivos CSV o JSON en `engine/inbox/`. Lo leído se mueve a `engine/processed/` con la fecha; nunca se borra. | Nada. Depende de que alguien cargue los archivos. |
| `feed-autorizado` | **No conectada** (activa solo con `FEED_URL` y `FEED_TOKEN`) | API oficial, proveedor de datos o archivo que el proveedor publica para su cliente. Con token y URL, el motor la consulta. Si rechaza la credencial (401/403), queda como «no disponible». | Acuerdo con el proveedor y la credencial que él emite. |
| `revolico` | **No conectada** | No hay permiso verificado para acceso automatizado. El adaptador no intenta conectarse. | Autorización escrita o API oficial de Revolico. Si la hay, se conecta con el adaptador de feed. |

Para **añadir una fuente**, escriba un adaptador con esta forma (`adapters/base.js`) y regístrelo en `app.js`. El motor no cambia:

```js
{
  key: 'mi-fuente',              // 3-40 caracteres: minúsculas, números y guion
  name: 'Mi fuente',
  kind: 'feed',                  // manual | feed | api | pendiente
  country: 'Cuba',
  defaultCurrency: 'CUP',
  describe() { return { key, name, kind, status: 'activa' | 'no conectada', requirements: [], note: '' }; },
  async fetch({ cursor, limit, now }) { return { rows: [...], nextCursor: null, warnings: [] }; },
  async ack(page) { /* opcional: tras guardar lo recibido */ },
}
```

`fetch` lanza `SourceUnavailable` (no conectada o credencial rechazada, sin reintento), `RetryableError` (fallo temporal, con reintento y espera) o `EngineError` (cualquier otro fallo, queda en el registro de errores).

## Configuración (variables de entorno)

| Variable | Obligatoria | Para qué |
|---|---|---|
| `ENGINE_SUPABASE_URL` y `ENGINE_SUPABASE_KEY` | Sí, en producción | Estado del motor en Supabase (`public.engine_state`). La clave es de servicio: secreto de GitHub, nunca en el código. Deben darse juntas. |
| `ENGINE_STATE_FILE` | No (por defecto `engine/data/estado.json`, solo sin Supabase) | Estado del motor en archivo local. |
| `ENGINE_INBOX_DIR` / `ENGINE_PROCESSED_DIR` | No | Carpetas de entrada y de procesados. |
| `ENGINE_GROUP_MAP` | Si hay destino RESOLVER | JSON `{"clave-de-fuente":"id-del-grupo-en-RESOLVER"}`. Cada fuente se entrega a un único grupo. |
| `RESOLVER_URL` | Para sincronizar | Dirección de RESOLVER, por ejemplo `https://resolver-hinojova.onrender.com`. |
| `RESOLVER_ENGINE_USER` / `RESOLVER_ENGINE_PASSWORD` | Si hay `RESOLVER_URL` | Cuenta **de moderador** dedicada al motor. Mínimo privilegio. Nunca en el código ni en el repositorio. |
| `FEED_URL`, `FEED_TOKEN`, `FEED_KEY`, `FEED_FORMAT` (`json`/`csv`), `FEED_ROWS_PATH` | Solo si hay feed | Feed autorizado. El token es una variable de entorno. |

Sin `RESOLVER_URL` el motor analiza y guarda, pero **no envía nada** y lo informa en cada ejecución.

## Uso

```bash
node engine/cli.js check                 # revisa carpetas y configuración (no usa la red)
node engine/cli.js sources               # estado de cada fuente
node engine/cli.js run                   # ejecuta todas las fuentes conectadas
node engine/cli.js run --source carpeta-manual
node engine/cli.js status                # ejecuciones, errores, cuarentena y señales
node engine/cli.js cuarentena            # filas pendientes de revisión, con sus motivos
node engine/cli.js cuarentena revisar <id> --nota "…"   # marca como revisada (no se borra)
node engine/cli.js check                 # ahora también muestra dónde se guarda el estado
node engine/cli.js watch --every 60      # ejecuta cada 60 minutos (mínimo 5), hasta detenerlo
npm test                                 # pruebas de RESOLVER y del motor (151)
npm run respaldo                         # copia de seguridad a Supabase (necesita variables de entorno)
```

## Programación

El motor corre en **GitHub Actions**, gratis en repositorio público (`.github/workflows/motor.yml`, cada 6 horas, y manual con «Run workflow»). Plan gratuito de Render: no tiene tareas programadas, así que no se usa.

- **Estado**: en Supabase (`public.engine_state`, plan gratuito). La tarea falla con un aviso si falta `ENGINE_SUPABASE_URL` o `ENGINE_SUPABASE_KEY`, porque sin estado guardado el motor no debe correr.
- **Guardado antes de mover archivos**: el motor guarda en Supabase antes de mover cualquier archivo de la carpeta de entrada. Si el guardado falla, el archivo se queda donde estaba (probado).
- **Sin solapamientos**: el flujo `motor-datos-resolver` no permite dos ejecuciones a la vez.
- **Límite**: el estado completo va en una sola fila. El plan gratuito de Supabase tiene 500 MB de base de datos; cuando el estado se acerque a ese límite hará falta pasar a tablas (pendiente).
- **Carga manual**: la carpeta `engine/inbox/` es local. En GitHub Actions está vacía, así que la carga manual de archivos solo funciona ejecutando el motor en su propio equipo. La carga normal de grupos ya existe en RESOLVER (importación de administrador).
- Opciones alternativas: `node engine/cli.js watch --every 60` en un equipo propio, o `node engine/cli.js run` desde un cron del sistema.

## Copia de seguridad

`scripts/respaldo.js` descarga el respaldo completo de RESOLVER con una cuenta de superadministrador y lo guarda en el bucket **privado** `respaldos` de Supabase. Cada copia tiene fecha y hora en el nombre y no sobrescribe ninguna anterior. Se ejecuta cada domingo con `.github/workflows/respaldo.yml`. Las copias no se borran automáticamente (regla del proyecto: nada se borra).

Requiere una cuenta de superadministrador **dedicada** a la copia, cuya contraseña guarda el titular como secreto. Esa decisión es del titular: sin ella, la tarea falla con un aviso y la copia manual desde el panel sigue funcionando.

## Calidad, validación y registro

- **Preservación del origen**: cada fila se guarda tal como llegó (`raw`), con su archivo de origen, la fecha de captura y un hash. Los registros conservan `source_key` y `source_id`.
- **Fechas**: día del calendario de Cuba (`America/Havana`). Se rechazan fechas inexistentes y futuras.
- **Precios**: se aceptan formatos cubanos (`1.200,50`, `300 000`, `$ 300`). Lo ambiguo (por ejemplo `$` solo) va a cuarentena; nada se convierte de moneda.
- **Monedas**: CUP, USD, MLC, EUR. Sin moneda, se usa la del adaptador y se marca como «por defecto».
- **Errores**: cada ejecución y cada fallo quedan en `runs` y `errors`. Nada se borra.
- **Idempotencia**: repetir una ejecución no duplica datos ni reenvía lo ya confirmado (probado).

## Privacidad

- Los datos de contacto de vendedores (teléfono, enlace) se guardan solo cuando la fuente los publica en dominio público. Es la decisión vigente del titular; el motor no los expone en análisis ni en señales.
- `engine/inbox/` y `engine/processed/` y `engine/data/` están en `.gitignore`: pueden contener datos personales y **no deben subirse al repositorio**.
- Pendiente recomendado: política de retención y minimización (por ejemplo, borrar o anonimizar contactos después de N días). No está implementada.

## Seguridad

- Credenciales solo por variables de entorno. Ningún secreto está en el código ni en la documentación.
- El motor no tiene interfaz pública; el destino RESOLVER se usa con una cuenta de moderador, que no puede ver usuarios, configuración ni estadísticas.
- No se abren puertos ni se aceptan peticiones externas.

## Pruebas

`npm test` incluye `tests/engine/*.test.js` (texto, precios, fechas, CSV, procesador, clasificador, geografía, deduplicación, calidad, analizador, detector, colector con reintentos y cursor, carga manual, feed HTTP con respuestas simuladas, destino RESOLVER con respuestas simuladas, ejecución completa dos veces, programador). No hay pruebas contra servicios reales: ninguna fuente externa está conectada.

## Lo que falta y mejoras propuestas

Hecho: arquitectura, seis componentes, tres fuentes (una activa, dos documentadas), cuarentena con marcado de revisión, deduplicación, análisis, señales, sincronización con reintentos, persistencia en Supabase, programación en GitHub Actions, copia de seguridad semanal y pruebas.

Pendiente, en orden de importancia:

1. **Reprocesar la cuarentena** cuando se corrigen las reglas. Hoy solo se puede marcar como revisada, no corregir y volver a procesar.
2. **Estado en tablas** en lugar de una sola fila JSON, para no chocar con el límite de 500 MB del plan gratuito.
3. **Versión de reglas** en cada registro, para re-clasificar con trazabilidad.
4. **Riesgo de falso positivo en la deduplicación cruzada**: dos vendedores distintos que publican exactamente el mismo texto, precio, provincia y día se unen. Propuesta: usar el enlace o el identificador de la fuente en la huella cuando exista.
5. **Alertas** por correo cuando una fuente falla varias veces seguidas (reutilizando el envío de correo de RESOLVER).
6. **Cobertura** por fuente, grupo, provincia y semana.
7. **Retención y minimización** de contactos y filas originales (ver Privacidad). Las copias de seguridad también crecen sin límite.
8. **Carga manual desde el teléfono**: hoy el motor solo lee archivos de su propio equipo o de un feed autorizado.
9. **Señales**: son observaciones con evidencia, no hechos confirmados; la interfaz debe decirlo así.

## Estado honesto

- **Probado con pruebas automáticas (151 unitarias y de API, 67 de navegador)**: el motor completo, la persistencia con Supabase simulada, la cuarentena, la copia de seguridad con respuestas simuladas y el selector de país en navegador.
- **Creado en Supabase (proyecto `resolver-produccion`)**: tabla `public.engine_state` con RLS activo y sin políticas; buckets `resolver-fotos` (público, para fotos) y `respaldos` (privado).
- **No probado contra servicios reales desde este entorno**: el shell no tiene acceso de red a Supabase, a GitHub Actions ni a Render. Falta una ejecución real de las tareas programadas y una subida real de foto.
- **Pendiente del titular**: los secretos de GitHub (`ENGINE_SUPABASE_URL`, `ENGINE_SUPABASE_KEY`, y los de RESOLVER y de la copia) y la cuenta de moderador del motor.
- **Ninguna fuente externa está conectada**: sin acuerdo o API oficial no hay datos de terceros.

