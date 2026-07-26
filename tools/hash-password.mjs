#!/usr/bin/env node
/**
 * Erzeugt den SHA-256-Hash für auth.passwordHash in public/config.json.
 *
 *   npm run hash -- meinPasswort
 */
import { createHash } from 'node:crypto';

const password = process.argv.slice(2).join(' ');

if (!password) {
  console.error('Aufruf: npm run hash -- <passwort>');
  process.exit(1);
}

const hash = createHash('sha256').update(password, 'utf8').digest('hex');

console.log(`Passwort: ${password}`);
console.log(`Hash:     ${hash}`);
console.log('\nIn public/config.json eintragen:');
console.log(`  "auth": { "passwordHash": "${hash}" }`);
