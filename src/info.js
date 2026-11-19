// Información por módulo (módulo 11) y sección «Sobre RESOLVER». Se sirve desde la API para que el texto no quede duplicado en la app.
export const MODULE_INFO = {
  inicio: {
    title: 'Inicio',
    what: 'Resumen del mercado observado: cuántas publicaciones hay, qué productos aparecen con más frecuencia, cómo se mueven los precios y qué señales se han detectado.',
    how: 'Se calcula en cada consulta a partir de las publicaciones de los grupos activos. Las búsquedas y los análisis recientes son solo tuyos.',
    interpret: 'Un producto con presencia muestra cuántas veces aparece en publicaciones. No indica cuánta gente lo quiere ni cuánto se vende.',
    sources: 'Publicaciones cargadas por el administrador desde grupos de Facebook registrados, con su fecha y su enlace original.',
    limits: 'Si hay pocos datos, las cifras no se muestran o aparecen como insuficientes. Nada se completa con estimaciones.',
  },
  buscar: {
    title: 'Encuéntralo',
    what: 'Busca publicaciones por producto, marca, modelo, categoría, provincia, municipio y período, y calcula estadísticas de precio sobre lo que encuentra.',
    how: 'Los filtros se combinan entre sí. Ordenar por precio separa las monedas: un CUP y un USD nunca se comparan entre sí. «Comparar con el período anterior» contrasta la misma búsqueda con el mismo número de días inmediatamente antes.',
    interpret: 'El mínimo, el máximo, el promedio y la mediana solo aparecen con al menos 3 publicaciones en la moneda. La evolución diaria necesita publicaciones en al menos 2 días distintos. Los precios atípicos son valores que se alejan mucho de los demás del mismo producto.',
    sources: 'Publicaciones de grupos activos dentro del período elegido. Cada resultado enlaza a su publicación original y a su grupo.',
    limits: 'La marca y el modelo se toman del campo propio de la publicación o de la frase exacta en el texto; no se adivinan. El vendedor solo aparece si la fuente lo publicó.',
  },
  explorar: {
    title: 'Explorar',
    what: 'Recorre el mercado observado por productos, categorías, provincias, municipios, movimientos de precio y oportunidades identificadas.',
    how: 'Cada vista calcula sus datos sobre el período elegido. Los movimientos comparan los últimos 7 días con los 7 anteriores.',
    interpret: 'Un movimiento de precio es un cambio observado entre dos períodos. Una oportunidad potencial es una diferencia de precio entre provincias: no confirma que se pueda comprar y revender con ganancia.',
    sources: 'Las mismas publicaciones de los grupos activos que usa el buscador.',
    limits: 'Las categorías siguen la clasificación declarada en la publicación. Si no se declara, RESOLVER sugiere una por palabras clave y lo marca como sugerida.',
  },
  historial: {
    title: 'Historial',
    what: 'Guarda tus búsquedas, tus análisis y las señales que te interesan, para volver a ellas y compararlas.',
    how: 'Las búsquedas se guardan automáticamente. Puedes guardar un análisis o una señal con un toque. Puedes comparar dos búsquedas anteriores lado a lado.',
    interpret: 'Un análisis guardado muestra el estado de la oferta en el momento en que se hizo la búsqueda. No se recalcula ni se actualiza.',
    sources: 'Tus propias búsquedas y las señales detectadas por RESOLVER.',
    limits: 'No se reconstruyen períodos anteriores para los que no hubo consulta. Lo que no se buscó no aparece en el historial.',
  },
  grupos: {
    title: 'Grupos',
    what: 'Lista los grupos de Facebook registrados y permite proponer nuevos.',
    how: 'Tu propuesta queda como solicitud hasta que el administrador la revisa y la activa. Solo los grupos activos alimentan las búsquedas.',
    interpret: 'Un grupo pausado conserva su historial, pero deja de aparecer en las búsquedas.',
    sources: 'El enlace del grupo y su estado en RESOLVER.',
    limits: 'RESOLVER no entra a los grupos ni lee sus publicaciones por sí mismo. Las publicaciones se cargan a mano por el administrador.',
  },
  cuenta: {
    title: 'Cuenta',
    what: 'Gestiona tu perfil, tus preferencias, tu contraseña y las sesiones abiertas.',
    how: 'Puedes cerrar sesiones en otros dispositivos. Si olvidas la contraseña, recibes un enlace por correo que caduca en 30 minutos.',
    interpret: 'La contraseña se guarda como hash irreversible y nunca se muestra. Las sesiones muestran cuándo se abrieron y cuándo vencen.',
    sources: 'Los datos que tú introduces en tu perfil.',
    limits: 'La recuperación por correo solo funciona si el servicio de correo está configurado en el servidor.',
  },
  reportes: {
    title: 'Reportes',
    what: 'Envía incidencias, sugerencias y reclamaciones al equipo de RESOLVER.',
    how: 'Cada envío llega al panel de administración con su estado: abierto, revisado o cerrado.',
    interpret: 'Un estado cerrado no significa que el problema se haya resuelto en todos los casos; significa que se revisó.',
    sources: 'Lo que escribes en el formulario.',
    limits: 'No hay respuesta automática. Las reclamaciones se revisan por personas.',
  },
};

export const ABOUT = {
  product: 'RESOLVER',
  slogan: 'Lo encuentras. Compras. Resuelves.',
  company: 'HINOJOVA Tech',
  founder: 'Lemuel Hinojosa',
  description:
    'RESOLVER organiza la oferta observable en grupos de compra y venta para dar información de precios y disponibilidad por provincia y municipio. Empieza en Cuba y está preparado para otros mercados emergentes.',
  not: 'RESOLVER no es un marketplace. No publica productos propios, no vende, no procesa pagos ni gestiona entregas.',
  principles: [
    'Solo se analiza la oferta publicada. No se mide la demanda real.',
    'Las señales son observaciones con evidencia y nivel de confianza, no hechos confirmados.',
    'Nada se borra: las cargas y los grupos forman un historial permanente.',
  ],
};
