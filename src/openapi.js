// Documentación OpenAPI 3.0 generada desde las rutas reales del servidor.
// Un endpoint nuevo aparece aquí en cuanto se registra; su resumen sale de SUMMARIES si existe.
const SUMMARIES = {
  'GET /api/config': 'Configuración pública: provincias, categorías, monedas y aviso.',
  'GET /api/health': 'Estado del servicio y de las escrituras pendientes.',
  'GET /api/me': 'Usuario de la sesión actual (o null).',
  'GET /api/info': 'Información por módulo y sección Sobre RESOLVER.',
  'POST /api/auth/register': 'Crear cuenta de usuario.',
  'POST /api/auth/login': 'Iniciar sesión.',
  'POST /api/auth/logout': 'Cerrar sesión.',
  'POST /api/auth/forgot': 'Solicitar enlace de recuperación de contraseña.',
  'POST /api/auth/reset': 'Definir una contraseña nueva con el enlace de recuperación.',
  'POST /api/auth/verify': 'Confirmar el correo con el enlace recibido (24 horas, un solo uso).',
  'POST /api/profile/verify/send': 'Pedir un nuevo enlace para confirmar el correo (máximo 3 por hora).',
  'GET /api/profile': 'Perfil y preferencias del usuario.',
  'PATCH /api/profile': 'Actualizar perfil y preferencias.',
  'POST /api/profile/password': 'Cambiar la contraseña propia.',
  'GET /api/profile/sessions': 'Sesiones abiertas de la cuenta.',
  'DELETE /api/profile/sessions/{id}': 'Cerrar una sesión de la cuenta.',
  'GET /api/groups': 'Grupos registrados con su cobertura.',
  'POST /api/groups': 'Proponer un grupo (queda como solicitud).',
  'GET /api/search': 'Buscar publicaciones con filtros, orden, paginación, análisis y comparación con el período anterior.',
  'GET /api/municipalities': 'Municipios con datos en una provincia.',
  'GET /api/explore': 'Explorar productos, categorías, provincias, municipios, movimientos u oportunidades.',
  'GET /api/dashboard': 'Datos del inicio: cifras, búsquedas, análisis, señales, productos, provincias y actividad.',
  'GET /api/signals': 'Señales detectadas, con filtros por tipo, provincia y fechas.',
  'GET /api/searches': 'Historial de búsquedas del usuario, con filtro por fechas.',
  'GET /api/searches/compare': 'Comparar dos búsquedas anteriores del usuario.',
  'DELETE /api/searches/{id}': 'Quitar una búsqueda del historial propio.',
  'GET /api/saves': 'Búsquedas, análisis y señales guardados por el usuario.',
  'POST /api/saves': 'Guardar una búsqueda, un análisis o una señal.',
  'DELETE /api/saves/{id}': 'Quitar un elemento guardado.',
  'POST /api/reports': 'Enviar incidencia, sugerencia o reclamación.',
  'GET /api/admin/overview': 'Resumen para el panel (superadministrador y moderador).',
  'GET /api/admin/stats': 'Estadísticas del sistema (superadministrador).',
  'GET /api/admin/errors': 'Registro de errores (superadministrador).',
  'GET /api/admin/settings': 'Configuración general (superadministrador).',
  'PATCH /api/admin/settings': 'Actualizar configuración general (superadministrador).',
  'GET /api/admin/users': 'Usuarios (superadministrador).',
  'PATCH /api/admin/users/{id}': 'Cambiar rol, desactivar, restablecer contraseña, editar nombre o correo y confirmar el correo (superadministrador).',
  'GET /api/admin/groups': 'Grupos con cobertura y última carga.',
  'POST /api/admin/groups': 'Alta de grupo con provincia e historial desde una fecha.',
  'PATCH /api/admin/groups/{id}': 'Cambiar estado, provincia, municipio o nombre de un grupo.',
  'DELETE /api/admin/groups/{id}': 'No permitido: los grupos no se eliminan.',
  'GET /api/admin/imports': 'Registro permanente de cargas.',
  'POST /api/admin/imports': 'Cargar publicaciones en CSV, JSON o por líneas.',
  'GET /api/admin/groups/{id}/export': 'Descargar el historial de un grupo en CSV.',
  'GET /api/admin/groups/{id}/history': 'Historial de un grupo con resumen mensual.',
  'GET /api/admin/posts': 'Publicaciones recientes.',
  'POST /api/admin/posts': 'Alta de una publicación individual.',
  'DELETE /api/admin/posts/{id}': 'No permitido: las publicaciones no se eliminan.',
  'GET /api/admin/categories': 'Árbol de categorías.',
  'POST /api/admin/categories': 'Añadir categoría o subcategoría.',
  'PATCH /api/admin/categories/{id}': 'Activar o desactivar una categoría.',
  'DELETE /api/admin/categories/{id}': 'No permitido: las categorías no se eliminan.',
  'GET /api/admin/reports': 'Incidencias, sugerencias y reclamaciones.',
  'PATCH /api/admin/reports/{id}': 'Cambiar el estado de un reporte.',
  'GET /api/admin/signals': 'Señales detectadas (moderador y superadministrador).',
  'PATCH /api/admin/signals/{id}': 'Activar o retirar una señal.',
  'POST /api/admin/signals/sync': 'Detectar señales nuevas con las publicaciones actuales.',
  'GET /api/admin/sources': 'Fuentes registradas y su estado.',
  'POST /api/admin/sources': 'Registrar una fuente.',
  'PATCH /api/admin/sources/{id}': 'Actualizar estado o nota de una fuente.',
  'GET /api/admin/searches': 'Análisis y búsquedas de todos los usuarios, para supervisión.',
  'GET /api/openapi.json': 'Esta especificación.',
  'POST /api/admin/posts/{id}/image': 'Subir una foto a una publicación (JPEG, PNG o WebP, máximo 2 MB) a Supabase Storage.',
  'PATCH /api/admin/posts/{id}': 'Ocultar una publicación con motivo registrado, o volver a mostrarla. Nunca se borra.',
  'GET /api/admin/backup': 'Copia completa del almacén en JSON, sin contraseñas, sesiones ni tokens (superadministrador).',
};

const toOpenApiPath = (path) => path.replace(/:(\w+)/g, '{$1}');

export function buildOpenApi(routes, version = '1.0.0') {
  const paths = {};
  for (const { method, path } of routes) {
    const oaPath = toOpenApiPath(path);
    const key = `${method} ${oaPath}`;
    paths[oaPath] ??= {};
    const isAdmin = oaPath.startsWith('/api/admin');
    const hasBody = ['post', 'patch', 'put', 'delete'].includes(method.toLowerCase());
    paths[oaPath][method.toLowerCase()] = {
      summary: SUMMARIES[key] || `${method} ${oaPath}`,
      tags: [isAdmin ? 'admin' : oaPath.startsWith('/api/auth') ? 'auth' : 'usuario'],
      security: [{ sessionCookie: [] }],
      ...(hasBody && {
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } }, required: false },
      }),
      responses: {
        200: { description: 'Respuesta correcta (JSON).' },
        400: { description: 'Datos no válidos.' },
        401: { description: 'Sesión requerida.' },
        403: { description: 'Sin permiso.' },
        415: { description: 'Las escrituras deben enviar application/json.' },
        429: { description: 'Demasiados intentos.' },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'RESOLVER API',
      version,
      description: 'API de RESOLVER, plataforma de inteligencia de mercado de HINOJOVA Tech. Solo describe oferta observable; no mide demanda.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'resolver_session' },
      },
    },
    paths,
  };
}
