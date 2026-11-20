#!/usr/bin/env node
// Línea de comandos del motor de datos.
//   node engine/cli.js check              revisa configuración y carpetas (no usa la red)
//   node engine/cli.js sources            estado de cada fuente
//   node engine/cli.js run [--source k]   ejecuta todas las fuentes conectadas, o solo la indicada
//   node engine/cli.js status             registro de ejecuciones, errores, cuarentena y señales
//   node engine/cli.js watch [--every N]  ejecuta cada N minutos (mínimo 5) hasta detenerlo
import { mkdirSync, accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFromEnv, defaultPaths } from './app.js';
import { startScheduler, MIN_INTERVAL_MINUTES } from './scheduler.js';

function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--source') opts.source = rest[++i];
    else if (rest[i] === '--every') opts.every = Number(rest[++i]);
    else throw new Error(`Opción no reconocida: ${rest[i]}`);
  }
  return { command, opts };
}

const print = (value) => console.log(JSON.stringify(value, null, 2));

function writable(path) {
  try {
    mkdirSync(path, { recursive: true });
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const { command, opts } = parseArgs(argv);
  if (command === 'check') {
    const paths = defaultPaths(env);
    const { engine, sinkConfigured } = buildFromEnv(env);
    print({
      carpetas: {
        estado: { ruta: paths.state, escribible: writable(dirname(paths.state)) },
        entrada: { ruta: paths.inbox, escribible: writable(paths.inbox) },
        procesados: { ruta: paths.processed, escribible: writable(paths.processed) },
      },
      destino_resolver: sinkConfigured ? 'configurado' : 'no configurado (no se envía nada)',
      fuentes: engine.sources(),
    });
    return 0;
  }
  const built = buildFromEnv(env);
  if (command === 'sources') {
    print(built.engine.sources());
    return 0;
  }
  if (command === 'status') {
    print(built.engine.status());
    return 0;
  }
  if (command === 'run') {
    const result = opts.source ? await built.engine.runSource(opts.source) : await built.engine.runAll();
    print(result);
    return result.skipped ? 2 : 0;
  }
  if (command === 'watch') {
    const every = opts.every ?? 60;
    if (!(every >= MIN_INTERVAL_MINUTES)) throw new Error(`El intervalo mínimo es de ${MIN_INTERVAL_MINUTES} minutos.`);
    const scheduler = startScheduler(built.engine, {
      everyMinutes: every,
      runOnStart: true,
      onResult: (r) => console.log(new Date().toISOString(), JSON.stringify(r.skipped ? r : { sources: r.results, analysis: r.analysis, sync: r.sync })),
      onError: (e) => console.error(new Date().toISOString(), e.message),
    });
    // El temporizador del programador no mantiene vivo el proceso; este sí.
    const keepAlive = setInterval(() => {}, 1 << 30);
    const stop = () => {
      scheduler.stop();
      clearInterval(keepAlive);
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return new Promise(() => {});
  }
  throw new Error(`Comando no reconocido: ${command}. Use check, sources, run, status o watch.`);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => { if (code) process.exitCode = code; },
    (err) => {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    },
  );
}

export { main, parseArgs };
