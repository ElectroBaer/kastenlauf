#!/usr/bin/env node
/**
 * Einmal-Werkzeug: erzeugt public/config.json aus story.md.
 *
 * ACHTUNG: Nach dem ersten Lauf ist public/config.json die Quelle der Wahrheit.
 * Ein erneuter Lauf überschreibt alle dort von Hand gemachten Änderungen
 * (Koordinaten, Passwort-Hash, zusätzliche Lösungsvarianten).
 *
 *   node tools/story-to-config.mjs [--force]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storyPath = resolve(root, 'story.md');
const configPath = resolve(root, 'public/config.json');

if (existsSync(configPath) && !process.argv.includes('--force')) {
  console.error(
    'public/config.json existiert bereits. Zum Überschreiben mit --force aufrufen.',
  );
  process.exit(1);
}

/**
 * Zusätzliche akzeptierte Schreibweisen je Station. story.md nennt nur eine
 * Musterlösung; hier großzügiger, damit am Spieltag nicht an Tippfehlern
 * gescheitert wird. Der Vergleich normalisiert ohnehin Groß-/Kleinschreibung,
 * Satzzeichen und Leerzeichen (siehe src/task.ts).
 */
const EXTRA_ANSWERS = {
  2: ['Skinner Norris', 'Skinny Norris', 'E.S. Norris', 'Skinny'],
  6: ['Hugenay'],
};

const md = readFileSync(storyPath, 'utf8');

/** Zerlegt das Dokument an den `# `-Überschriften in benannte Abschnitte. */
function splitSections(text) {
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    const heading = /^#\s+(.*)$/.exec(line);
    if (heading) {
      current = { title: heading[1].trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

/** Zerlegt einen Abschnitt an den `### `-Überschriften in Blöcke. */
function splitBlocks(lines) {
  const blocks = [];
  let current = { heading: null, lines: [] };
  for (const line of lines) {
    const heading = /^###\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(current);
      current = { heading: heading[1].trim().replace(/:$/, ''), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  blocks.push(current);
  return blocks.filter((b) => b.lines.join('').trim() !== '' || b.heading);
}

/** Absätze zusammenfassen und überflüssige Leerzeilen entfernen. */
function normalizeText(lines) {
  return lines
    .join('\n')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((p) => p.split('\n').map((l) => l.trimEnd()).join('\n').trim())
    .filter(Boolean)
    .join('\n\n');
}

const sections = splitSections(md);
const intro = sections.find((s) => /^intro$/i.test(s.title));
const outro = sections.find((s) => /^auflösung$/i.test(s.title));
if (!intro || !outro) throw new Error('Intro- oder Auflösungs-Abschnitt fehlt in story.md');

const stations = sections
  .filter((s) => /^station\s+\d+/i.test(s.title))
  .map((section) => {
    const id = Number(/(\d+)/.exec(section.title)[1]);
    const blocks = splitBlocks(section.lines);

    // Ein Block ist die Aufgabe, wenn er eine `-> …`-Lösungszeile enthält.
    // Das ist verlässlicher als die Überschrift: Station 6 hat ihren ersten
    // Story-Block in story.md versehentlich mit "### Aufgabe" überschrieben.
    const taskIndex = blocks.findIndex((b) => b.lines.some((l) => l.trimStart().startsWith('->')));
    if (taskIndex === -1) throw new Error(`Station ${id}: kein Aufgaben-Block gefunden`);

    const taskBlock = blocks[taskIndex];
    const solutionLine = taskBlock.lines.find((l) => l.trimStart().startsWith('->')).trim();
    const promptLines = taskBlock.lines.filter((l) => !l.trimStart().startsWith('->'));

    let answers = [];
    const match = /^->\s*Gültige\s+Lösung(?:en)?:\s*(.+)$/i.exec(solutionLine);
    if (match) {
      answers = match[1].split(',').map((a) => a.trim()).filter(Boolean);
      answers.push(...(EXTRA_ANSWERS[id] ?? []));
    } else if (!/keine\s+lösung/i.test(solutionLine)) {
      throw new Error(`Station ${id}: Lösungszeile nicht verstanden: ${solutionLine}`);
    }

    return {
      id,
      title: `Station ${id}`,
      storyBefore: normalizeText(blocks.slice(0, taskIndex).flatMap((b) => b.lines)),
      task: {
        type: answers.length > 0 ? 'code' : 'acknowledge',
        prompt: normalizeText(promptLines),
        answers,
        hint: null,
      },
      storyAfter: normalizeText(blocks.slice(taskIndex + 1).flatMap((b) => b.lines)),
      coords: null,
    };
  })
  .sort((a, b) => a.id - b.id);

const config = {
  version: 1,
  title: 'Bierkastenlauf',
  subtitle: 'Ein Fall für die drei ???',
  auth: {
    // Platzhalter-Passwort: "kastenlauf" — vor dem Spieltag ändern!
    // Neuen Hash erzeugen mit: npm run hash -- <passwort>
    passwordHash: createHash('sha256').update('kastenlauf', 'utf8').digest('hex'),
  },
  route: {
    // PLATZHALTER (Marienplatz → Englischer Garten, München).
    // Vor dem Spieltag durch die echten Koordinaten ersetzen.
    start: { lat: 48.1371, lng: 11.5754, label: 'Start' },
    finish: { lat: 48.15, lng: 11.6, label: 'Ziel' },
  },
  triggerRadiusMeters: 40,
  intro: { title: 'Intro', text: normalizeText(intro.lines) },
  outro: { title: 'Auflösung', text: normalizeText(outro.lines) },
  stations,
};

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(
  `public/config.json geschrieben: ${stations.length} Stationen ` +
    `(${stations.filter((s) => s.task.type === 'code').length}× Code, ` +
    `${stations.filter((s) => s.task.type === 'acknowledge').length}× Bestätigung).`,
);
