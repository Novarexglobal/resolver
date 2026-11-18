# RESOLVER · HINOJOVA Tech

«Lo encuentras. Compras. Resuelves.»

Plataforma de inteligencia de mercado sobre la **oferta observable** publicada en grupos de Facebook que tú registras. No es un marketplace: no vende, no publica anuncios y no intermedia transacciones. No mide la demanda real.

## Cómo funciona la fuente de datos

1. **Agregar grupo (administrador):** en la sección Grupos, registras el grupo con su nombre, enlace, provincia, municipio y, si la conoces, la fecha de creación.
2. **Cargar historial:** justo después de agregarlo, el panel te lleva a Cargar. Pegas o subes las publicaciones desde la fecha de creación del grupo hasta hoy. Repites las cargas cada día con las publicaciones nuevas.
3. **Solicitudes de usuarios:** un usuario puede proponer un grupo desde la app. Queda como solicitud hasta que el administrador la activa, asignándole provincia.
4. **Registro permanente:** cada carga queda registrada con fecha, usuario, formato y rango de fechas. **Nada se borra**: ni grupos ni publicaciones. Los grupos se pausan. Repetir un tramo ya cargado es seguro: lo existente se omite.
5. **Historial del grupo:** en la sección Historial ves la cobertura (primera y última fecha), el resumen mensual de precios, el registro de cargas y todas las publicaciones con sus enlaces.
6. **Carga diaria:** en Grupos, cada grupo activo indica si tiene carga del día (hora de Cuba). El resumen cuenta los pendientes.

RESOLVER **no entra a Facebook por su cuenta** ni extrae datos automáticamente. Toda la información llega por carga manual del administrador.

RESOLVER **no entra a Facebook por su cuenta** ni extrae datos automáticamente. Hacerlo incumple las condiciones de la plataforma.

## Requisitos

- Node.js 22 o superior. No hay dependencias externas que instalar.

## Puesta en marcha

```bash
cd resolver
cp .env.example .env         # opcional: ajusta puerto y rutas
npm run create-superadmin -- tu_usuario   # te pedirá la contraseña (dos veces, sin mostrarla)
npm start                    # abre http://localhost:3000
```

- La app de usuarios está en `/`. El panel de administración está en `/admin`.
- Para cambiar la contraseña del superadministrador: `npm run create-superadmin -- tu_usuario --reset`. Esto cierra todas las sesiones abiertas.
- Solo puede existir **un** superadministrador. No hay forma de crear otro desde la web.

## Formato de importación

CSV (con cabeceras; coma o punto y coma) o JSON (lista de objetos). Columnas:

| Campo | Obligatorio | Notas |
|---|---|---|
| `product` | sí | 2 a 120 caracteres |
| `price` | sí | Número mayor que 0. Acepta `1200`, `1,200.50` o `1.200,50` |
| `currency` | no | `CUP` (por defecto), `USD`, `MLC` o `EUR` |
| `province` | sí | Debe coincidir con el catálogo de 15 provincias + Isla de la Juventud |
| `municipality` | no | Texto libre |
| `published_at` | sí | Fecha `AAAA-MM-DD`, no futura |
| `category` | no | Por defecto `Otros` |
| `description` | no | Hasta 1000 caracteres |
| `source_url` | no | Enlace http(s) a la publicación original |
| `image_url` | no | Enlace http(s) a una imagen |

Las filas con errores se informan una por una y no se importan.

## Análisis

- **Estadísticas de precio** (mínimo, máximo, promedio y mediana) solo aparecen con al menos 3 publicaciones por moneda. Si hay menos, se muestra que los datos son insuficientes.
- **Evolución** requiere publicaciones en al menos 2 días distintos.
- **Señales** son observaciones factuales (tendencia entre mitades del período, concentración en un grupo). No son predicciones.
- Períodos de 1 a 30 días, que terminan en una fecha pasada o en hoy.

## Estructura

```
src/
  server.js      rutas HTTP de la API y arranque
  auth.js        contraseñas (scrypt), sesiones (cookie HttpOnly), límite de intentos
  analysis.js    período, deduplicación, filtros, estadísticas y señales
  ingest.js      lectura de CSV/JSON y validación fila por fila
  store.js       almacenamiento JSON con escritura atómica
  http.js        utilidades HTTP, cabeceras de seguridad, archivos estáticos
public/          app de usuarios (/), panel de administración (/admin), manifiesto PWA
scripts/         creación del superadministrador
tests/           pruebas unitarias e integración de la API
```

## Pruebas

```bash
npm test
```

## Instalar en el celular

- **iPhone (Safari):** abre la dirección, toca Compartir → «Añadir a pantalla de inicio».
- **Android (Chrome):** abre la dirección, menú ⋮ → «Instalar aplicación» o «Añadir a pantalla de inicio».

## Limitaciones actuales

- **Base de datos:** se guarda en un archivo JSON (`data/resolver.json`), adecuado para un solo servidor y un volumen moderado de datos. La migración a Supabase/Postgres está prevista; el almacén tiene una interfaz pequeña para hacerlo sin cambiar las rutas. **Supabase aún no está conectado.**
- **Datos:** la base empieza vacía. No hay datos de ejemplo ni precios inventados.
- **Ícono para iOS:** la app usa un ícono SVG. Safari de iPhone necesita un PNG de 180×180 como `apple-touch-icon` para el ícono de inicio; sin él usa una captura de la página.
- **Despliegue:** la app escucha en HTTP. En producción colócala detrás de HTTPS (y define `COOKIE_SECURE=true`).

## Usarla desde iPhone (sin computadora)

RESOLVER se aloja en internet y tú la usas desde Safari. Todo es gratuito y se hace desde el teléfono:

1. **Supabase** (base de datos permanente): crea un proyecto en supabase.com. En *SQL Editor* pega el contenido de `db/supabase-schema.sql` y ejecútalo. En *Project Settings → API* copia la **URL** y la clave **service_role**.
2. **GitHub** (donde vive el código): crea una cuenta y un repositorio privado con los archivos de este proyecto.
3. **Render** (donde corre la app): entra con tu cuenta de GitHub, elige *New → Blueprint*, selecciona el repositorio. Render lee `render.yaml` y te pide estas variables:
   - `SUPABASE_URL` y `SUPABASE_SERVICE_KEY`: los valores del paso 1.
   - `RESOLVER_ADMIN_USER` y `RESOLVER_ADMIN_PASSWORD`: tu usuario y la contraseña que elijas para entrar al panel.
4. Cuando termine el despliegue, abre la dirección que te da Render en Safari. Entra con tu usuario y ve a `/admin`.
5. **Después de entrar, borra `RESOLVER_ADMIN_USER` y `RESOLVER_ADMIN_PASSWORD`** en Render. El superadministrador ya existe en la base.

Notas:
- El plan gratuito de Render se duerme tras unos 15 minutos sin uso. La primera apertura del día tarda unos 30 segundos. Los datos no se pierden, porque están en Supabase.
- `/api/health` muestra si la app responde y si hay escrituras pendientes hacia Supabase.
- Para actualizar la app, sube los cambios al repositorio: Render vuelve a desplegar.
