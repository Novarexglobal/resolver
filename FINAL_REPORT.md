# RESOLVER · Informe final

Plataforma de inteligencia de mercado sobre oferta observable en grupos de Facebook cargados manualmente. Primer mercado: Cuba. HINOJOVA Tech.

Este informe es honesto: indica lo que funciona, lo que no está construido todavía y lo que depende de credenciales.

## 1. Qué se construyó

- **Backend** (Node.js 22, sin dependencias externas): API HTTP con autenticación, roles, validación, deduplicación, análisis de precios y registro permanente de cargas.
- **Aplicación de usuarios** (`/`): acceso, búsqueda con filtros (producto, provincia, municipio, categoría, período de hasta 30 días, fecha final pasada o de hoy), estadísticas, evolución diaria, distribución, publicaciones con enlace a la fuente, grupos, historial de búsquedas, incidencias y sugerencias.
- **Panel de administración** (`/admin`): solo superadministrador. Alta de grupos con provincia y fecha de inicio, activación de solicitudes de usuarios, carga de historial (CSV, JSON, formato rápido por líneas o publicación individual), historial por grupo con resumen mensual y registro de cargas, descarga CSV del historial, gestión de usuarios (activar, desactivar, restablecer contraseña), categorías, reportes y resumen.
- **Almacenamiento**: Supabase (permanente) cuando hay credenciales; archivo local en desarrollo. Escrituras con reintento en cola.
- **Permanencia**: no existe ninguna operación que borre grupos ni publicaciones. Cada carga queda registrada con fecha, usuario y rango.
- **Móvil**: diseño responsive, instalable como app web en iPhone y Android (manifiesto e íconos PNG).

## 2. Qué funciona (verificado)

- Registro, inicio y cierre de sesión; contraseñas con scrypt; sesiones en cookie HttpOnly; límite de intentos de acceso.
- Superadministrador creado por consola o por variables de entorno; no existe registro de administradores desde la web.
- Búsqueda con filtros combinables; ventana de 30 días; validación de fechas en hora de Cuba.
- Análisis: mínimo, máximo, promedio y mediana solo con al menos 3 publicaciones; evolución con al menos 2 días; tendencia entre mitades del período; concentración por fuente.
- Deduplicación por enlace de origen o por huella; re-carga de un tramo ya cargado es segura.
- Cargas por CSV, JSON, formato rápido por líneas y publicación individual, con errores informados fila por fila.
- Descarga del historial en CSV compatible con Excel (BOM UTF-8).
- Protección CSRF por tipo de contenido JSON en todas las escrituras; cabeceras de seguridad; control de rutas estáticas.
- Endpoint `/api/health` con estado de almacenamiento y escrituras pendientes.

## 3. Qué está pendiente (frente a la especificación completa)

Estas funciones de la especificación **no están construidas** o están solo parcialmente:

- **Dashboard público** (Módulo 1): solo existe el resumen del administrador.
- **Buscador avanzado** (Módulo 2): sin búsqueda por marca ni modelo, sin orden por precio o fecha, sin fotografías subidas (solo enlaces de imagen), sin datos del vendedor.
- **Análisis** (Módulo 3): sin comparación entre períodos, sin productos con precios atípicos, sin análisis por categoría, sin comparación entre municipios. Los gráficos son barras SVG simples.
- **Señales** (Módulo 4): solo dos tipos de señal (tendencia de precio y concentración de fuente). No hay módulo de señales persistido ni las demás categorías.
- **Historial** (Módulo 5): solo historial de búsquedas. Faltan análisis guardados, señales, búsquedas guardadas y comparación entre resultados anteriores.
- **Explorar** (Módulo 6): no construido.
- **Categorías jerárquicas** (Módulo 7): lista plana configurable; no la estructura de 14 categorías con jerarquía.
- **Ubicaciones** (Módulo 8): provincias y municipios sí; relación con países y la capa de país no.
- **Cuentas** (Módulo 9): falta recuperación de contraseña por correo, correo electrónico, perfil de usuario y preferencias. El restablecimiento lo hace el administrador.
- **Administración** (Módulo 10): sin roles intermedios, sin reclamaciones, sin registro de errores, sin configuración general.
- **Información por módulo** (Módulo 11) y sección «Sobre RESOLVER»: no construidas.
- **Nexo Data Engine** (sección 5): existe la validación, la deduplicación y el registro de cargas. No hay componentes separados (collector, classifier, detector, synchronizer), ni clasificación automática, ni actualizaciones programadas, ni adaptadores de fuentes.
- **Base de datos** (sección 6): se usa una tabla `resolver_records` con JSON, no un esquema relacional con tablas separadas por entidad. Esto simplifica la operación, pero no cumple el diseño propuesto por la especificación.
- **Documentación OpenAPI**: no generada.
- **Monetización**: no implementada. Es intencional, porque la especificación pide no activar pagos.
- **Copias de seguridad automáticas**: no configuradas. Dependen del plan de Supabase.

## 4. Integraciones

| Integración | Estado | Qué necesita |
|---|---|---|
| Supabase (almacenamiento) | Activa al configurar las variables | `SUPABASE_URL` (configurada) y `SUPABASE_SERVICE_KEY` (pendiente en Render) |
| Facebook | Manual por diseño | Ninguna. No se extrae nada automáticamente, por sus condiciones de uso |
| Render (hosting) | Servicio creado, espera la clave | `SUPABASE_SERVICE_KEY`, `RESOLVER_ADMIN_USER`, `RESOLVER_ADMIN_PASSWORD` |
| GitHub (código) | Rama `resolver-v2` en `Novarexglobal/resolver` | Ninguna adicional |

## 5. Pruebas ejecutadas

- **34 pruebas automáticas** (`npm test`): lógica de período, deduplicación, filtros, análisis, validación, CSV y formato por líneas, contraseñas, enlaces de Facebook, API completa (permisos, grupos, activación, cargas, historial, exportación, restablecimiento de contraseña, seguridad), y el adaptador de Supabase contra un servidor simulado (escritura, recuperación, reintentos, errores de clave, configuración a medias).
- **31 comprobaciones en navegador real** (Chromium con perfiles de iPhone 13 y Pixel 7): registro, grupos, importación, búsqueda con filtros, estadísticas, enlaces a la fuente, historial, reportes, cierre de sesión, panel de administración, historial de grupo y ausencia de errores en consola.

## 6. Errores conocidos

- Un fallo detectado durante la revisión: la fecha final por defecto se calculaba en UTC y, después de las 7 p. m. en Cuba, daba error de «fecha futura». Corregido en la aplicación y en las pruebas.
- Si el proceso se detiene justo antes de enviar una escritura a Supabase, esa escritura se pierde. La ventana es de milisegundos, pero existe.
- El plan gratuito de Render se duerme tras unos 15 minutos sin uso. La primera carga tarda unos 30 segundos.
- Sin límite de intentos en el registro de usuarios, solo en el inicio de sesión.
- Las imágenes de publicaciones se muestran desde el enlace original; si el enlace deja de existir, la imagen no se verá.

## 7. Cómo ejecutar

Requisitos: Node.js 22 o superior.

```bash
npm install            # no instala nada, pero es seguro ejecutarlo
npm run create-superadmin -- tu_usuario   # solo la primera vez, en local
npm start              # http://localhost:3000 (usuarios) y /admin (administrador)
npm test               # 34 pruebas
```

Variables de entorno: ver `.env.example` y la tabla en `README.md`.

## 8. Cómo desplegar

1. Ejecuta `db/supabase-schema.sql` en el SQL Editor de Supabase, o aplica la migración equivalente.
2. Conecta el repositorio en Render (Blueprint con `render.yaml`) o usa el servicio existente `resolver-hinojova`.
3. Define `SUPABASE_SERVICE_KEY`, `RESOLVER_ADMIN_USER` y `RESOLVER_ADMIN_PASSWORD` en Render.
4. Verifica `/api/health`, entra a `/admin` y borra las variables de administrador.

Detalle paso a paso en la sección «Usarla desde iPhone» de `README.md`.
