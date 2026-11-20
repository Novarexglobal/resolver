// Tipos de error del motor. Cada uno indica qué debe hacer el orquestador.

/** Error general del motor. El código va al registro de errores. */
export class EngineError extends Error {
  constructor(message, code = 'engine_error') {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

/**
 * La fuente no está disponible: no está configurada, sus credenciales fueron rechazadas
 * o nunca se conectó. No se reintenta; la ejecución la marca como «no disponible».
 */
export class SourceUnavailable extends EngineError {
  constructor(message) {
    super(message, 'source_unavailable');
    this.name = 'SourceUnavailable';
  }
}

/** Fallo temporal (red, límite de peticiones, error 5xx). Se reintenta con espera. */
export class RetryableError extends EngineError {
  constructor(message, { retryAfterMs = 0 } = {}) {
    super(message, 'retryable');
    this.name = 'RetryableError';
    this.retryAfterMs = retryAfterMs;
  }
}
