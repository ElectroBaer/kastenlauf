#!/usr/bin/env node
/**
 * Überträgt die Zufallsereignisse aus events.md nach public/config.json.
 *
 * Anders als story-to-config.mjs ist das kein Einmal-Werkzeug: Es tauscht
 * ausschließlich `randomEvents.items` aus und lässt alles andere in der Config
 * unangetastet — Route, Passwort-Hash, Story, Zeiteinstellungen. Nach dem
 * Bearbeiten von events.md also einfach erneut aufrufen.
 *
 *   node tools/events-to-config.mjs
 *
 * Erwartetes Format je Zeile (Reihenfolge zählt, siehe unten):
 *
 *   * *Titel:* Text des Ereignisses.
 *
 * Das **erste** Ereignis der Datei wird mit `"first": true` markiert und kommt
 * im Spiel immer als erstes — für Aufgaben, die den ganzen Lauf über laufen und
 * deshalb früh bekannt sein müssen.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eventsPath = resolve(root, 'events.md');
const configPath = resolve(root, 'public/config.json');

/** „Der Schrottplatz" → „der-schrottplatz“. Umlaute ausgeschrieben. */
function slug(title) {
  return title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const lines = readFileSync(eventsPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('* '));

if (lines.length === 0) {
  console.error('events.md enthält keine Einträge (erwartet: Zeilen mit "* ").');
  process.exit(1);
}

const items = lines.map((line, index) => {
  const body = line.slice(2).trim();
  // Titel steht kursiv am Anfang, der Doppelpunkt darf innerhalb oder außerhalb
  // der Sternchen stehen.
  const match = /^\*([^*]+?)\s*:?\s*\*\s*:?\s*(.+)$/s.exec(body);
  if (!match) {
    console.error(`Zeile ${index + 1} hat keinen Titel im Format "* *Titel:* Text":\n  ${body}`);
    process.exit(1);
  }
  const [, title, text] = match;
  const item = { id: slug(title), title: title.trim(), text: text.trim() };
  // Das erste Ereignis der Datei ist gesetzt.
  return index === 0 ? { ...item, first: true } : item;
});

const ids = items.map((item) => item.id);
const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
if (duplicate) {
  console.error(`Doppelte id "${duplicate}" — zwei Ereignisse haben denselben Titel.`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.randomEvents = { ...config.randomEvents, items };
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

console.log(`public/config.json aktualisiert: ${items.length} Ereignisse.`);
console.log(`Fest als erstes gesetzt: „${items[0].title}“ (${items[0].id}).`);
