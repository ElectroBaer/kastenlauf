import type { Config, LatLng, Station } from './types';

const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Entfernung zweier Punkte in Metern (Haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Punkt bei Anteil `t` (0..1) auf der Luftlinie zwischen `from` und `to`. */
export function interpolate(from: LatLng, to: LatLng, t: number): LatLng {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  };
}

/**
 * Wann eine Station fällig ist.
 *
 * - `ring`: sobald die Restentfernung zum **Ziel** unter `remainingMeters`
 *   fällt. Das ist der Normalfall und der Grund für dieses Modell: Ringe um
 *   den Zielpunkt durchquert man auf jeder Route. Feste Punkte auf der
 *   Luftlinie verfehlt man dagegen, sobald der Weg nicht schnurgerade läuft.
 * - `point`: klassisch die Nähe zu festen Koordinaten. Nur wenn in der Config
 *   ausdrücklich `coords` gesetzt ist.
 */
export type StationTrigger =
  | { kind: 'ring'; station: Station; remainingMeters: number }
  | { kind: 'point'; station: Station; coords: LatLng };

/**
 * Baut die Auslöser. Ohne Override liegt Station i von n bei einer
 * Restentfernung von D·(n+1−i)/(n+1) — dieselben Abstände wie zuvor, nur eben
 * als Ring statt als Punkt.
 */
export function buildTriggers(config: Config): StationTrigger[] {
  const total = config.stations.length;
  const routeLength = distanceMeters(config.route.start, config.route.finish);

  return config.stations.map((station, index) => {
    if (station.coords) {
      return { kind: 'point', station, coords: station.coords };
    }
    const remaining = station.remainingMeters ?? (routeLength * (total - index)) / (total + 1);
    return { kind: 'ring', station, remainingMeters: remaining };
  });
}

function isDue(
  trigger: StationTrigger,
  position: LatLng,
  distanceToFinish: number,
  triggerRadiusMeters: number,
): boolean {
  return trigger.kind === 'ring'
    ? distanceToFinish <= trigger.remainingMeters
    : distanceMeters(position, trigger.coords) <= triggerRadiusMeters;
}

/**
 * Wie viele Stationen inzwischen fällig sind. Gesucht wird der **höchste**
 * fällige Index — alles davor gilt damit automatisch als überfällig.
 *
 * Für Ring-Stationen ändert das nichts, die sind ohnehin monoton. Es ist der
 * Überholschutz für `coords`-Stationen: Wer an einem festen Punkt vorbeiläuft,
 * ohne ihn zu treffen, bekommt die Station spätestens beim nächsten fälligen
 * Ring nachgereicht, statt für immer festzuhängen.
 */
export function dueStationCount(
  triggers: StationTrigger[],
  position: LatLng,
  distanceToFinish: number,
  triggerRadiusMeters: number,
): number {
  for (let i = triggers.length - 1; i >= 0; i--) {
    const trigger = triggers[i];
    if (trigger && isDue(trigger, position, distanceToFinish, triggerRadiusMeters)) {
      return i + 1;
    }
  }
  return 0;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
}

export interface PositionFix {
  coords: LatLng;
  accuracy: number;
  simulated: boolean;
}

export type PositionListener = (fix: PositionFix) => void;
export type PositionErrorListener = (message: string) => void;

/**
 * Kapselt `watchPosition`. Solange eine simulierte Position gesetzt ist
 * (Debug-Modus), gewinnt diese gegenüber dem echten GPS-Signal.
 */
export class PositionTracker {
  private watchId: number | null = null;
  private simulated: LatLng | null = null;
  private last: PositionFix | null = null;

  constructor(
    private readonly onFix: PositionListener,
    private readonly onError: PositionErrorListener,
  ) {}

  start(): void {
    if (this.watchId !== null) return;
    if (!('geolocation' in navigator)) {
      this.onError('Dieses Gerät unterstützt keine Standortbestimmung.');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (this.simulated) return;
        this.emit({
          coords: { lat: position.coords.latitude, lng: position.coords.longitude },
          accuracy: position.coords.accuracy,
          simulated: false,
        });
      },
      (error) => this.onError(describeGeolocationError(error)),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /**
   * Holt einmalig eine Position. Gedacht für den Moment, in dem die Seite
   * wieder sichtbar wird: `watchPosition` liefert währenddessen nichts, der
   * letzte bekannte Fix kann also weit veraltet sein.
   *
   * `maximumAge: 10000` ist hier wichtig. Mit 0 wartet der Browser auf eine
   * frisch gemessene Position, was je nach Empfang dauert — und solange
   * parallel ein `watchPosition` läuft, kommt die Antwort teils gar nicht.
   * Ein bis zu 10 s alter Fix liegt im Gehtempo rund 13 m daneben und damit
   * bequem innerhalb des Trigger-Radius, kommt dafür aber sofort.
   */
  refresh(): void {
    if (this.simulated || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (position) =>
        this.emit({
          coords: { lat: position.coords.latitude, lng: position.coords.longitude },
          accuracy: position.coords.accuracy,
          simulated: false,
        }),
      () => {
        // Stillschweigend: watchPosition meldet dauerhafte Probleme ohnehin.
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
  }

  /** Setzt eine simulierte Position (Debug-Modus) oder hebt sie mit `null` auf. */
  simulate(coords: LatLng | null): void {
    this.simulated = coords;
    if (coords) this.emit({ coords, accuracy: 5, simulated: true });
  }

  get lastFix(): PositionFix | null {
    return this.last;
  }

  private emit(fix: PositionFix): void {
    this.last = fix;
    this.onFix(fix);
  }
}

function describeGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Standortzugriff wurde abgelehnt. Bitte in den Browser-Einstellungen erlauben und die Seite neu laden.';
    case error.POSITION_UNAVAILABLE:
      return 'Kein GPS-Signal. Am besten ins Freie gehen.';
    case error.TIMEOUT:
      return 'Standortbestimmung dauert ungewöhnlich lange …';
    default:
      return 'Standort konnte nicht bestimmt werden.';
  }
}
