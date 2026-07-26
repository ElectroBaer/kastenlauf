import type { Config, LatLng } from './types';

function fail(message: string): never {
  throw new Error(`config.json: ${message}`);
}

function assertLatLng(value: unknown, path: string): LatLng {
  const point = value as LatLng | undefined;
  if (
    !point ||
    typeof point.lat !== 'number' ||
    typeof point.lng !== 'number' ||
    Number.isNaN(point.lat) ||
    Number.isNaN(point.lng)
  ) {
    fail(`${path} braucht numerische lat/lng`);
  }
  if (point.lat < -90 || point.lat > 90) fail(`${path}.lat liegt außerhalb von -90..90`);
  if (point.lng < -180 || point.lng > 180) fail(`${path}.lng liegt außerhalb von -180..180`);
  return { lat: point.lat, lng: point.lng };
}

/**
 * Prüft die geladene Config so weit, dass Tippfehler beim Anpassen sofort
 * mit einer verständlichen Meldung auffallen statt später mitten im Lauf.
 */
function validate(raw: unknown): Config {
  const config = raw as Config;

  if (!config || typeof config !== 'object') fail('ist kein Objekt');
  if (!config.auth?.passwordHash) fail('auth.passwordHash fehlt');
  if (!/^[0-9a-f]{64}$/i.test(config.auth.passwordHash)) {
    fail('auth.passwordHash ist kein SHA-256-Hex (64 Zeichen). Erzeugen mit: npm run hash -- <passwort>');
  }
  if (!config.route) fail('route fehlt');
  assertLatLng(config.route.start, 'route.start');
  assertLatLng(config.route.finish, 'route.finish');
  if (typeof config.triggerRadiusMeters !== 'number' || config.triggerRadiusMeters <= 0) {
    fail('triggerRadiusMeters muss eine positive Zahl sein');
  }
  // Der alerts-Block ist optional — ältere Configs bleiben lauffähig.
  config.alerts = {
    sound: config.alerts?.sound ?? true,
    vibrate: config.alerts?.vibrate ?? true,
    notification: config.alerts?.notification ?? true,
    reminderAfterMinutes: config.alerts?.reminderAfterMinutes ?? 10,
  };
  if (
    typeof config.alerts.reminderAfterMinutes !== 'number' ||
    config.alerts.reminderAfterMinutes < 0
  ) {
    fail('alerts.reminderAfterMinutes muss 0 oder größer sein');
  }

  if (!config.intro?.text) fail('intro.text fehlt');
  if (!config.outro?.text) fail('outro.text fehlt');
  if (!Array.isArray(config.stations) || config.stations.length === 0) {
    fail('stations ist leer');
  }

  config.stations.forEach((station, index) => {
    const where = `stations[${index}]`;
    if (typeof station.id !== 'number') fail(`${where}.id fehlt`);
    if (!station.task) fail(`${where}.task fehlt`);
    if (station.task.type !== 'code' && station.task.type !== 'acknowledge') {
      fail(`${where}.task.type muss "code" oder "acknowledge" sein`);
    }
    if (!station.task.prompt) fail(`${where}.task.prompt fehlt`);
    if (station.task.type === 'code' && (station.task.answers?.length ?? 0) === 0) {
      fail(`${where}.task.answers darf bei type "code" nicht leer sein`);
    }
    if (station.coords) assertLatLng(station.coords, `${where}.coords`);
    if (station.remainingMeters !== undefined && station.remainingMeters !== null) {
      if (typeof station.remainingMeters !== 'number' || station.remainingMeters <= 0) {
        fail(`${where}.remainingMeters muss eine positive Zahl sein`);
      }
      if (station.coords) {
        fail(
          `${where}: coords und remainingMeters schließen sich aus — entweder fester Punkt oder Ring um das Ziel`,
        );
      }
    }
  });

  const ids = config.stations.map((s) => s.id);
  if (new Set(ids).size !== ids.length) fail('stations enthält doppelte ids');

  return config;
}

export async function loadConfig(): Promise<Config> {
  // BASE_URL berücksichtigt den Unterpfad auf GitHub Pages (/kastenlauf/).
  const response = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`config.json konnte nicht geladen werden (HTTP ${response.status})`);
  }
  return validate(await response.json());
}
