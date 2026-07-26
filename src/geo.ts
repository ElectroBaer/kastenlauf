import type { Config, LatLng, PlacedStation } from './types';

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
 * Verteilt die Stationen gleichmäßig auf der Luftlinie Start→Ziel: Station i
 * von n liegt bei i/(n+1), also strikt zwischen Start und Ziel. Eine Station
 * mit gesetzten `coords` behält ihre Position aus der Config.
 */
export function placeStations(config: Config): PlacedStation[] {
  const { start, finish } = config.route;
  const total = config.stations.length;
  return config.stations.map((station, index) => ({
    ...station,
    position: station.coords ?? interpolate(start, finish, (index + 1) / (total + 1)),
  }));
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
