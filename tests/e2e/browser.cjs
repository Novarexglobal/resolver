const { chromium, devices } = require('playwright');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').resolve(__dirname, '../..');
const PORT = 3931;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = require('path').join(require('os').tmpdir(), 'resolver-e2e-data.json');
const SUPER = 'lemuel';
const SUPER_PASS = 'clave-superadmin-2026';
const USER = 'vendedor_1';
const USER_PASS = 'clave-usuario-2026';
const results = [];
process.chdir(require('os').tmpdir());
fs.mkdirSync('shots', { recursive: true });
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };

(async () => {
  for (const f of [DATA]) if (fs.existsSync(f)) fs.unlinkSync(f);
  execSync(`printf '${SUPER_PASS}\\n${SUPER_PASS}\\n' | RESOLVER_DATA_FILE=${DATA} node scripts/create-superadmin.js ${SUPER}`, { cwd: ROOT, stdio: 'pipe' });
  const server = spawn('node', ['src/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), RESOLVER_DATA_FILE: DATA }, stdio: 'pipe' });
  await new Promise((r) => setTimeout(r, 1200));

  try {
    // Superadmin: login por API e importación de publicaciones (flujo del administrador)
    const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: SUPER, password: SUPER_PASS }) });
    const adminCookie = login.headers.get('set-cookie').split(';')[0];
    const browser = await chromium.launch();

    for (const profile of ['iPhone 13', 'Pixel 7']) {
      console.log(`\n=== Perfil: ${profile} ===`);
      const tag = profile.replace(/\s/g, '');
      const ctx = await browser.newContext({ ...devices[profile] });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

      await page.goto(BASE + '/');
      await page.waitForSelector('#auth-user');
      check(`${tag}: pantalla de acceso visible`, await page.isVisible('#auth'));

      // Primer perfil: registro. Segundo perfil: la misma cuenta entra con contraseña.
      if (profile === 'iPhone 13') {
        await page.click('[data-auth="register"]');
        await page.fill('#auth-user', USER);
        await page.fill('#auth-pass', USER_PASS);
        await page.click('#auth-submit');
        await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
        check(`${tag}: registro de usuario y entrada a la app`, true);
      } else {
        await page.fill('#auth-user', USER);
        await page.fill('#auth-pass', USER_PASS);
        await page.click('#auth-submit');
        await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
        check(`${tag}: inicio de sesión con cuenta existente`, true);
      }

      // Al entrar, la vista por defecto es el inicio (panel)
      await page.waitForSelector('#view-inicio:not(.hidden)', { timeout: 5000 });
      check(`${tag}: el inicio es la vista por defecto`, true);

      // Grupos (solo en el primer perfil; el segundo reutiliza el grupo ya registrado)
      await page.click('[data-view="grupos"]');
      if (profile === 'iPhone 13') {
        await page.fill('#group-name', 'Ventas La Habana');
        await page.fill('#group-url', 'https://m.facebook.com/groups/ventas-habana/?ref=share');
        await page.click('#group-form button[type="submit"]');
      }
      await page.waitForFunction(() => document.getElementById('groups-list')?.textContent.includes('Ventas La Habana'), null, { timeout: 5000 });
      check(`${tag}: grupo de Facebook visible en la lista`, true);

      // Importación por el superadministrador (vía API con su sesión)
      if (profile === 'iPhone 13') {
        const groups = await (await fetch(`${BASE}/api/admin/groups`, { headers: { Cookie: adminCookie } })).json();
        const gid = groups.groups[0].id;
        const csv = [
          'product,price,currency,province,municipality,published_at,description,source_url,category',
          'iPhone 16,950,USD,La Habana,Playa,2026-11-10,Nuevo con caja,https://www.facebook.com/groups/ventas-habana/posts/1,Celulares',
          'iPhone 16,920,USD,La Habana,Playa,2026-11-14,Usado,https://www.facebook.com/groups/ventas-habana/posts/2,Celulares',
          'iPhone 16 Pro,1100,USD,La Habana,Plaza de la Revolución,2026-11-17,Sellado,https://www.facebook.com/groups/ventas-habana/posts/3,Celulares',
          'Samsung A15,250,USD,Matanzas,Cárdenas,2026-11-16,,,Celulares',
        ].join('\n');
        const imp = await (await fetch(`${BASE}/api/admin/imports`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ group_id: gid, format: 'csv', content: csv }) })).json();
        check('importación del superadministrador', imp.inserted === 4, `insertadas=${imp.inserted}`);
        const act = await fetch(`${BASE}/api/admin/groups/${gid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ status: 'activo', province: 'La Habana', municipality: 'Playa' }) });
        check('administrador activa el grupo solicitado', act.status === 200);
      }

      // Búsqueda
      await page.click('[data-view="buscar"]');
      await page.fill('#q', 'iphone');
      await page.selectOption('#province', 'La Habana');
      await page.waitForFunction(() => document.querySelectorAll('#municipality option').length > 1, null, { timeout: 5000 });
      await page.selectOption('#days', '30');
      await page.selectOption('#sort', 'precio_asc');
      await page.click('#search-submit');
      await page.waitForSelector('#results .post', { timeout: 8000 });
      const posts = await page.locator('#results .post').count();
      check(`${tag}: búsqueda 'iphone' en La Habana devuelve 3 publicaciones`, posts === 3, `encontradas=${posts}`);
      const firstPrice = await page.textContent('#results .post .price');
      check(`${tag}: orden por precio de menor a mayor`, firstPrice.includes('920'), `primero=${firstPrice}`);
      check(`${tag}: estadísticas de precio y evolución visibles`, (await page.locator('#results .stat').count()) >= 3 && (await page.locator('#results .chart').count()) >= 1);
      check(`${tag}: la publicación enlaza a la fuente`, (await page.locator('#results a[href*="/posts/"]').count()) >= 3);
      check(`${tag}: muestra el vendedor (o que no viene en la fuente)`, (await page.locator('#results .seller').count()) === 3);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${tag}: sin desplazamiento horizontal`, overflow <= 0, `desbordamiento=${overflow}px`);
      await page.screenshot({ path: `shots/${tag}-buscar.png`, fullPage: true });

      // Filtro por modelo: solo debe quedar el iPhone 16 Pro
      await page.fill('#model', '16 Pro');
      await page.click('#search-submit');
      await page.waitForFunction(() => document.querySelectorAll('#results .post').length === 1, null, { timeout: 8000 });
      check(`${tag}: filtro por modelo reduce resultados`, true);
      await page.fill('#model', '');

      // Inicio con datos reales, después de la búsqueda
      await page.click('[data-view="inicio"]');
      // Espera el dato nuevo, no el panel anterior que queda visible mientras llega la respuesta
      await page.waitForFunction(() => document.getElementById('dash-market')?.textContent.includes('Publicaciones4'), null, { timeout: 8000 });
      const market = await page.textContent('#dash-market');
      check(`${tag}: inicio muestra el total real de publicaciones`, market.includes('Publicaciones4'), market.slice(0, 80));
      check(`${tag}: inicio lista la búsqueda reciente`, (await page.textContent('#dash-recent')).includes('iphone'));
      check(`${tag}: inicio muestra productos con presencia`, (await page.textContent('#dash-featured')).includes('iPhone 16'));
      check(`${tag}: inicio muestra la actividad de cargas`, (await page.textContent('#dash-activity')).includes('Ventas La Habana'));
      await page.screenshot({ path: `shots/${tag}-inicio.png`, fullPage: true });

      // Historial y reportes
      await page.click('[data-view="historial"]');
      await page.waitForSelector('#history-list .list-item');
      check(`${tag}: búsqueda aparece en historial`, (await page.textContent('#history-list')).includes('iphone'));
      await page.click('[data-view="reportes"]');
      await page.fill('#report-message', 'Me gustaría filtrar por grupo específico');
      await page.click('#report-form button[type="submit"]');
      await page.waitForSelector('#toast:not(.hidden)');
      check(`${tag}: envío de sugerencia`, true);

      // Cierre de sesión
      await page.click('#logout');
      await page.waitForSelector('#auth:not(.hidden)');
      check(`${tag}: cerrar sesión`, true);

      check(`${tag}: sin errores en consola`, errors.length === 0, errors.slice(0, 3).join(' | '));
      await ctx.close();
    }

    // Panel de administración, en iPhone
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(BASE + '/admin');
    await page.fill('#admin-user', USER);
    await page.fill('#admin-pass', USER_PASS);
    await page.click('#admin-login-form button[type="submit"]');
    await page.waitForSelector('#admin-login-error:not(.hidden)');
    check('admin: usuario normal no entra al panel', (await page.textContent('#admin-login-error')).includes('solo para el administrador'));

    await page.fill('#admin-user', SUPER);
    await page.fill('#admin-pass', SUPER_PASS);
    await page.click('#admin-login-form button[type="submit"]');
    await page.waitForSelector('#admin-app:not(.hidden)');
    await page.waitForSelector('text=Resumen general');
    check('admin: superadministrador entra al panel', true);
    await page.screenshot({ path: 'shots/admin-resumen.png', fullPage: true });

    await page.click('[data-panel="publicaciones"]');
    await page.waitForSelector('table tbody tr td');
    check('admin: lista de publicaciones recientes', (await page.locator('table tbody tr').count()) === 4);
    await page.screenshot({ path: 'shots/admin-publicaciones.png', fullPage: true });

    await page.click('[data-panel="usuarios"]');
    await page.waitForSelector('text=vendedor_1');
    check('admin: lista de usuarios', true);

    await page.click('[data-panel="historial"]');
    await page.waitForFunction(() => document.querySelectorAll('#his-group option').length > 1);
    await page.selectOption('#his-group', { index: 1 });
    await page.waitForSelector('text=Todas las publicaciones');
    check('admin: historial del grupo muestra publicaciones y cargas', (await page.locator('table tbody tr').count()) >= 4);
    await page.screenshot({ path: 'shots/admin-historial.png', fullPage: true });

    await page.click('[data-panel="importar"]');
    await page.waitForFunction(() => document.querySelectorAll('#imp-group option').length > 1);
    check('admin: importar muestra grupos registrados', true);
    check('admin: sin errores en consola', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
    await browser.close();
  } finally {
    server.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nResultado: ${results.length - failed}/${results.length} comprobaciones correctas`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
