# RESOLVER · Informe final

Plataforma de inteligencia de mercado sobre oferta observable en grupos de Facebook cargados manualmente. Primer mercado: Cuba. HINOJOVA Tech.

Este informe es honesto: indica lo que funciona y se ha probado, lo que está parcial y lo que no está construido todavía.

## 1. Qué se construyó

- **Backend** (Node.js 22, sin dependencias externas): API HTTP con autenticación, roles (superadministrador, moderador, usuario), validación, deduplicación, catálogo jerárquico, clasificación con origen declarado o sugerido, análisis de precios, señales persistidas y registro permanente de cargas.
- **Aplicación de usuarios** (`/`), seis pestañas en el móvil:
  - **Inicio**: cifras reales, últimas búsquedas, análisis, señales guardables, productos con presencia, evolución, provincias y actividad de cargas.
  - **Buscar**: marca, modelo, categoría con subcategorías, provincia, municipio, período, orden, paginación, vendedor cuando la fuente lo publica, comparación con el período anterior, precio mediano por municipio y guardado del análisis.
  - **Explorar**: productos, categorías, provincias, municipios, publicaciones recientes, presencia, movimientos de precio y oportunidades.
  - **Historial**: búsquedas con filtro por fechas, comparación lado a lado de dos búsquedas y elementos guardados.
  - **Más**: grupos (propuesta de nuevos grupos), reportes (incidencia, sugerencia o reclamación) y «Sobre RESOLVER».
  - **Cuenta**: perfil, correo, preferencias (tema, período y provincia por defecto), cambio de contraseña y sesiones abiertas con opción de cerrarlas.
  - Botón «i» en cada módulo con qué muestra, cómo se calcula, cómo interpretarlo, de dónde salen los datos y sus límites.
  - Recuperación de contraseña por enlace de un solo uso (30 minutos).
  - Aviso general configurable por el administrador.
- **Panel de administración** (`/admin`), con secciones según el rol:
  - Para el equipo de contenido (superadministrador y moderador): resumen, grupos, cargas, historial por grupo, publicación manual, publicaciones, señales (retirar o reactivar, buscar nuevas), categorías (añadir subcategorías y desactivar), reportes, fuentes y búsquedas de usuarios.
  - Solo superadministrador: usuarios (rol, activar o desactivar, restablecer contraseña), estadísticas, registro de errores y configuración.
- **Almacenamiento**: Supabase (permanente) cuando hay credenciales; archivo local en desarrollo. Escrituras con reintento en cola.
- **Permanencia**: no existe ninguna operación que borre grupos, publicaciones, categorías ni cargas (los endpoints responden 403). Las señales se retiran, no se borran. Las búsquedas del historial propio sí pueden quitarse.
- **Documentación de la API**: `/api/openapi.json`, generada desde las rutas registradas.
- **Móvil**: diseño responsive, instalable como app web en iPhone y Android.

## 2. Qué funciona (verificado)

- Registro, inicio y cierre de sesión; contraseñas con scrypt; sesiones en cookie HttpOnly guardadas como hash; límite de intentos de acceso.
- Superadministrador creado por consola o por variables de entorno; no existe registro de administradores desde la web. El moderador lo asigna el superadministrador.
- Cambio de contraseña cierra las demás sesiones. La recuperación por correo genera un enlace de un solo uso que caduca en 30 minutos; la respuesta es la misma exista o no el correo.
- Búsqueda con filtros combinables; ventana de 30 días; validación de fechas en hora de Cuba.
- Análisis: mínimo, máximo, promedio y mediana solo con al menos 3 publicaciones; evolución con al menos 2 días; precios atípicos por rango intercuartílico; aviso cuando hay varias monedas; comparación con el período anterior de igual duración.
- Categorías: árbol de 14 categorías del módulo 7 con subcategorías. Si la publicación declara una categoría, se respeta; si no, el sistema sugiere una por palabras clave y lo marca como «sugerida».
- Señales: tendencia de precio, diferencia entre provincias, concentración de fuente, precios inusualmente bajos o altos, presencia creciente, movimiento de precio, oportunidad potencial, aumento de disponibilidad y disminución de publicaciones. Se recalculan tras cada carga, no se duplican y muestran evidencia y confianza.
- Fuentes: solo la carga manual figura como activa. Revolico y la API oficial aparecen como «no conectadas» con el motivo y lo que falta. No se simula ninguna conexión.
- Deduplicación por enlace de origen o por huella; re-carga de un tramo ya cargado es segura.
- Cargas por CSV, JSON, formato rápido por líneas y publicación individual, con errores informados fila por fila.
- Descarga del historial en CSV compatible con Excel (BOM UTF-8).
- Protección CSRF por tipo de contenido JSON en todas las escrituras; cabeceras de seguridad; control de rutas estáticas.
- Endpoint `/api/health` con estado de almacenamiento y escrituras pendientes.
- Fotos de publicaciones: el administrador sube JPEG, PNG o WebP (máximo 2 MB). El tipo se verifica por los bytes del archivo, no por su extensión. Se guardan en Supabase Storage y nunca sobrescriben otra foto.
- Copia de seguridad completa en JSON, descargable por el superadministrador desde Configuración. Incluye grupos, publicaciones, cargas, señales, categorías, fuentes y reportes; excluye contraseñas, sesiones y tokens de recuperación.

## 3. Qué está parcial o pendiente

**Parcial**

- **Señales**: el motor y el panel de administración están; las señales de oportunidad dependen de tener varias provincias con datos suficientes, así que en pocos datos aparecen vacías.
- **Análisis por categoría**: se filtra por categoría, pero no hay una vista de análisis separada por rama.
- **Clasificación**: palabras clave con sugerencias marcadas; no hay clasificador automático entrenado.
- **Cuentas**: el correo solo envía recuperaciones si se configura el servicio de correo (Resend). Sin él, la solicitud queda registrada para el administrador, que puede restablecer la contraseña. No hay verificación de correo.
- **Administración por rol**: el moderador tiene sus permisos en el servidor (probados en pruebas de API), pero el recorrido de su panel no tiene prueba de navegador.
- **Fotos**: la subida está probada contra un servidor simulado de Supabase Storage. Falta probarla con el bucket real.

**No construido**

- **Esquema relacional con migraciones versionadas**: los datos se guardan como filas JSON en `resolver_records`. Simplifica la operación, pero no cumple el diseño por tablas que plantea la especificación.
- **Capa de país** (módulo 8): solo provincias y municipios.
- **Verificación de correo** y edición del perfil desde el panel de administración.
- **Nexo Data Engine** (sección 5): existen validación, deduplicación, clasificación, detección de señales y sincronización. No hay adaptadores de fuentes ni actualizaciones programadas: el plan gratuito de Render no ejecuta tareas periódicas.
- **Monetización**: los planes están definidos en `src/catalog.js` como `PLANS`, sin activar ni bloquear funciones, como pide la especificación.
- **Copias de seguridad automáticas**: la descarga manual existe; la programada depende del plan de Supabase y de tareas periódicas, que el plan gratuito de Render no ejecuta.

**Decisiones pendientes del titular**

- Si las publicaciones que un administrador de grupo pida retirar deben ocultarse (sin borrarse) o no mostrarse en absoluto. Hoy RESOLVER no tiene ocultamiento por publicación; solo por grupo (pausa).
- Si los datos de contacto de vendedores de Facebook deben guardarse. Hoy se guardan solo cuando el administrador los carga desde una publicación pública, y son visibles para usuarios registrados. Conviene revisar la base legal antes de ampliar el acceso.

## 4. Integraciones

| Integración | Estado | Qué necesita |
|---|---|---|
| Supabase (almacenamiento) | Activa al configurar las variables | `SUPABASE_SERVICE_KEY` en Render. Para fotos: un bucket público llamado `resolver-fotos` (o el que indique `RESOLVER_IMAGE_BUCKET`) |
| Correo (Resend) | Opcional; sin clave la recuperación queda para el administrador | `RESEND_API_KEY`, `RESOLVER_MAIL_FROM`, `RESOLVER_APP_URL` |
| Facebook | Manual por diseño | Ninguna. No se extrae nada automáticamente, por sus condiciones de uso |
| Revolico | No conectada: no hay permiso verificado para acceso automatizado | Carga manual o un acuerdo de datos |
| Render (hosting) | Servicio `resolver-hinojova` | `SUPABASE_SERVICE_KEY`, `RESOLVER_ADMIN_USER`, `RESOLVER_ADMIN_PASSWORD` |
| GitHub (código) | Rama `resolver-v2` en `Novarexglobal/resolver` | Ninguna adicional |

## 5. Pruebas ejecutadas

- **74 pruebas automáticas** (`npm test`):
  - Lógica de período, deduplicación, filtros, análisis, señales, comparación entre períodos, clasificador, validación, CSV y formato por líneas, contraseñas, enlaces de Facebook.
  - API completa: permisos por rol, grupos, cargas, historial, exportación, perfil, sesiones, recuperación de contraseña (con enlace caducado y reutilizado), guardados, exploración, señales, categorías, fuentes, configuración, reportes y ausencia de borrado.
  - Correo con respuesta de error y servicio caído.
  - Fotos: detección por bytes, tamaño máximo, rechazo sin almacenamiento configurado y permisos; copia de seguridad sin contraseñas; resumen OpenAPI en todas las rutas.
  - Adaptador de Supabase contra un servidor simulado.
- **61 comprobaciones en navegador real** (Chromium con perfiles de iPhone 13 y Pixel 7), que cubren registro, grupos, importación, búsqueda con filtros, estadísticas, enlaces a la fuente, Explorar, guardado de análisis, cuenta con cambio de tema, recuperación (formulario), historial, reportes, cierre de sesión, panel de administración, historial de grupo y ausencia de errores en consola. Se ejecutó dos veces seguidas con el mismo resultado.

## 6. Errores conocidos y corregidos

- Corregido: la fecha final por defecto se calculaba en UTC y, después de las 7 p. m. en Cuba, daba error de «fecha futura».
- Corregido: las tarjetas de señales del inicio leían un campo que no existía y salían vacías.
- Corregido: el formulario de acceso conservaba el modo «Crear cuenta» tras cerrar sesión, lo que ocultaba la opción de recuperar la contraseña.
- Si el proceso se detiene justo antes de enviar una escritura a Supabase, esa escritura se pierde. La ventana es de milisegundos, pero existe.
- El plan gratuito de Render se duerme tras unos 15 minutos sin uso. La primera carga tarda unos 30 segundos.
- Sin límite de intentos en el registro de usuarios, solo en el inicio de sesión y la recuperación.
- Las publicaciones cargadas con enlace de imagen externo siguen mostrando esa imagen; si el enlace deja de existir, no se verá. Las fotos subidas con la herramienta no tienen este problema.
- Las seis pestañas del móvil usan texto pequeño (0,78 rem) para caber; en pantallas muy estrechas puede verse apretado.

## 7. Cómo ejecutar

Requisitos: Node.js 22 o superior.

```bash
npm run create-superadmin -- tu_usuario   # solo la primera vez, en local
npm start                                 # http://localhost:3000 (usuarios) y /admin (administración)
npm test                                  # 64 pruebas
npm run test:e2e                          # 61 comprobaciones en navegador (requiere Playwright y Chromium)
```

Variables de entorno: ver `.env.example` y la tabla en `README.md`.

## 8. Cómo desplegar

1. Ejecuta `db/supabase-schema.sql` en el SQL Editor de Supabase.
2. Usa el servicio existente `resolver-hinojova` en Render, rama `resolver-v2`.
3. Define `SUPABASE_SERVICE_KEY`, `RESOLVER_ADMIN_USER` y `RESOLVER_ADMIN_PASSWORD` en Render. Si quieres recuperación por correo, define también `RESEND_API_KEY`, `RESOLVER_MAIL_FROM` y `RESOLVER_APP_URL`. Nunca en el chat.
4. Verifica `/api/health`, entra a `/admin` y borra las variables de administrador.

Detalle paso a paso en la sección «Usarla desde iPhone» de `README.md`.
