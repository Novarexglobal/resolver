// Programación de ejecuciones. El motor no se ejecuta solo: esto sirve cuando corre como proceso propio (ver README para opciones).
// runAll ya impide ejecuciones solapadas, así que un intervalo corto no duplica trabajo.

export const MIN_INTERVAL_MINUTES = 5;

export function startScheduler(engine, {
  everyMinutes = 60,
  runOnStart = false,
  onResult = () => {},
  onError = () => {},
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  if (!(everyMinutes >= MIN_INTERVAL_MINUTES)) throw new Error(`El intervalo mínimo es de ${MIN_INTERVAL_MINUTES} minutos.`);
  const tick = () => engine
    .runAll()
    .then(onResult)
    .catch(onError);
  const timer = setIntervalImpl(tick, everyMinutes * 60 * 1000);
  timer.unref?.();
  if (runOnStart) tick();
  return { stop: () => clearIntervalImpl(timer) };
}
