#!/usr/bin/env node
// Crea (o cambia la contraseña de) el ÚNICO superadministrador de RESOLVER.
// Uso:  npm run create-superadmin -- <usuario>
//       npm run create-superadmin -- <usuario> --reset   (cambia la contraseña existente)
// La contraseña se pide por teclado y no se muestra en pantalla.
import { createInterface } from 'node:readline';
import { Store } from '../src/store.js';
import { config } from '../src/config.js';
import { ROLES, hashPassword, validateUsername, validatePassword } from '../src/auth.js';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const username = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

if (!validateUsername(username)) fail('indica un usuario válido (3 a 30 caracteres: letras, números, punto, guion o guion bajo).');

const store = new Store(config.dataFile);
const existingSuper = store.get('users', (u) => u.role === ROLES.SUPERADMIN);
const target = store.get('users', (u) => u.username === username);

if (existingSuper && !reset) fail('ya existe un superadministrador. Para cambiar su contraseña usa --reset.');
if (!existingSuper && target) fail('ese usuario ya existe como cuenta normal; elige otro nombre.');
if (existingSuper && reset && existingSuper.username !== username) {
  fail(`el superadministrador es "${existingSuper.username}". Usa ese nombre con --reset.`);
}

// Lectura secuencial de líneas: funciona en terminal (con eco oculto) y con entrada por tubería.
const isTTY = Boolean(process.stdin.isTTY);
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: isTTY });
const lines = rl[Symbol.asyncIterator]();
let muted = false;
if (isTTY) {
  rl._writeToOutput = (s) => process.stdout.write(muted ? '*'.repeat(s.length) : s);
}

async function readLine(prompt, hide) {
  process.stdout.write(prompt);
  muted = hide;
  const { value, done } = await lines.next();
  muted = false;
  process.stdout.write('\n');
  return done ? '' : value;
}

const first = await readLine('Contraseña (mínimo 10 caracteres): ', true);
const second = await readLine('Repite la contraseña: ', true);
rl.close();

if (!validatePassword(first)) fail('la contraseña debe tener entre 10 y 200 caracteres.');
if (first !== second) fail('las contraseñas no coinciden.');

if (existingSuper && reset) {
  store.update('users', existingSuper.id, { password_hash: hashPassword(first) });
  // Cierra todas las sesiones abiertas al cambiar la contraseña
  for (const s of store.list('sessions')) store.remove('sessions', s.id);
  console.log(`Contraseña actualizada para el superadministrador "${username}". Sesiones cerradas.`);
} else {
  store.insert('users', { username, password_hash: hashPassword(first), role: ROLES.SUPERADMIN, disabled: false });
  console.log(`Superadministrador "${username}" creado.`);
}
