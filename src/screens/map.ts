import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { distanceMeters, formatDistance, type PositionFix } from '../geo';
import type { Config, LatLng, PlacedStation } from '../types';
import { h } from '../ui';

function pin(className: string, label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span class="pin ${className}">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export interface MapScreenOptions {
  config: Config;
  stations: PlacedStation[];
  onOpenMenu: () => void;
}

/**
 * Hauptscreen. Die Leaflet-Instanz lebt so lange wie die App — sie wird beim
 * Wechsel zu Story-/Aufgaben-Screens nur überdeckt, nicht neu aufgebaut.
 */
export class MapScreen {
  readonly element: HTMLElement;

  private readonly map: L.Map;
  private readonly stationLayer = L.layerGroup();
  private readonly title: HTMLElement;
  private readonly statusMain: HTMLElement;
  private readonly statusSub: HTMLElement;
  private readonly recenterButton: HTMLButtonElement;

  private positionMarker: L.CircleMarker | null = null;
  private accuracyCircle: L.Circle | null = null;
  private autoFollow = true;
  private target: LatLng | null = null;
  private targetLabel = 'zur nächsten Station';
  private lastFix: PositionFix | null = null;

  constructor(private readonly options: MapScreenOptions) {
    const canvas = h('div', { class: 'map-canvas' });
    this.title = h('h1', { class: 'map-title' }, options.config.title);
    this.statusMain = h('p', { class: 'status-main' }, 'Warte auf GPS-Signal …');
    this.statusSub = h('p', { class: 'status-sub' }, '');
    this.recenterButton = h(
      'button',
      {
        class: 'btn btn-ghost btn-small',
        type: 'button',
        onclick: () => {
          this.autoFollow = true;
          if (this.lastFix) this.map.setView(this.lastFix.coords, Math.max(this.map.getZoom(), 16));
        },
      },
      'Zentrieren',
    );

    this.element = h(
      'section',
      { class: 'screen screen-map' },
      h(
        'header',
        { class: 'map-header' },
        h(
          'div',
          {},
          h('p', { class: 'eyebrow' }, options.config.subtitle ?? ''),
          this.title,
        ),
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            'aria-label': 'Menü',
            onclick: options.onOpenMenu,
          },
          '☰',
        ),
      ),
      canvas,
      h(
        'div',
        { class: 'map-status' },
        h('div', { class: 'status-text' }, this.statusMain, this.statusSub),
        this.recenterButton,
      ),
    );

    const { start, finish } = options.config.route;
    this.map = L.map(canvas, { zoomControl: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    L.polyline([start, finish], {
      color: '#8a4f0d',
      weight: 4,
      opacity: 0.85,
      dashArray: '8 10',
    }).addTo(this.map);
    L.marker(start, { icon: pin('pin-start', 'S'), title: start.label }).addTo(this.map);
    L.marker(finish, { icon: pin('pin-finish', 'Z'), title: finish.label }).addTo(this.map);
    this.stationLayer.addTo(this.map);

    this.map.fitBounds(L.latLngBounds([start, finish]).pad(0.35));
    // Sobald jemand die Karte selbst bewegt, nicht mehr automatisch nachführen.
    this.map.on('dragstart', () => {
      this.autoFollow = false;
    });
  }

  /** Nach dem Einblenden nötig, da Leaflet die Größe sonst falsch berechnet. */
  refreshSize(): void {
    this.map.invalidateSize();
  }

  /**
   * Zeichnet Stationen und Zielmarkierung passend zum Fortschritt neu.
   * `stationIndex` ist die als Nächstes anstehende Station; liegt er hinter
   * der letzten Station, ist der Zielpunkt das Ziel.
   */
  render(stationIndex: number, completed: number[]): void {
    this.stationLayer.clearLayers();

    this.options.stations.forEach((station, index) => {
      if (completed.includes(station.id)) {
        L.marker(station.position, {
          icon: pin('pin-done', '✓'),
          title: `${station.title} — erledigt`,
        }).addTo(this.stationLayer);
      } else if (index === stationIndex) {
        L.circle(station.position, {
          radius: this.options.config.triggerRadiusMeters,
          color: '#b26a00',
          fillColor: '#b26a00',
          fillOpacity: 0.2,
          weight: 2,
        }).addTo(this.stationLayer);
        L.marker(station.position, {
          icon: pin('pin-next', '?'),
          title: `Nächste Station: ${station.title}`,
        }).addTo(this.stationLayer);
      }
      // Noch nicht erreichte spätere Stationen bleiben absichtlich verborgen.
    });

    const nextStation = this.options.stations[stationIndex];
    if (nextStation) {
      this.target = nextStation.position;
      this.targetLabel = 'zur nächsten Station';
      this.title.textContent = `Station ${stationIndex + 1} von ${this.options.stations.length}`;
    } else {
      this.target = this.options.config.route.finish;
      this.targetLabel = 'bis zum Ziel';
      this.title.textContent = 'Auf zum Ziel';
      L.circle(this.options.config.route.finish, {
        radius: this.options.config.triggerRadiusMeters,
        color: '#c98a3c',
        fillColor: '#c98a3c',
        fillOpacity: 0.15,
        weight: 2,
      }).addTo(this.stationLayer);
    }

    this.updateStatus();
  }

  setPosition(fix: PositionFix): void {
    this.lastFix = fix;

    if (!this.positionMarker) {
      this.accuracyCircle = L.circle(fix.coords, {
        radius: fix.accuracy,
        color: '#1565c0',
        fillColor: '#1565c0',
        fillOpacity: 0.14,
        weight: 1,
      }).addTo(this.map);
      this.positionMarker = L.circleMarker(fix.coords, {
        radius: 8,
        color: '#ffffff',
        weight: 3,
        fillColor: '#1565c0',
        fillOpacity: 1,
      }).addTo(this.map);
      this.map.setView(fix.coords, 16);
    } else {
      this.positionMarker.setLatLng(fix.coords);
      this.accuracyCircle?.setLatLng(fix.coords);
      this.accuracyCircle?.setRadius(fix.accuracy);
      if (this.autoFollow) this.map.panTo(fix.coords, { animate: true });
    }

    this.updateStatus();
  }

  showError(message: string): void {
    this.statusMain.textContent = message;
    this.statusSub.textContent = '';
  }

  private updateStatus(): void {
    if (!this.lastFix || !this.target) return;
    const remaining = distanceMeters(this.lastFix.coords, this.target);
    this.statusMain.textContent = `Noch ${formatDistance(remaining)} ${this.targetLabel}`;
    this.statusSub.textContent = this.lastFix.simulated
      ? 'Simulierte Position (Debug-Modus)'
      : `GPS-Genauigkeit ±${Math.round(this.lastFix.accuracy)} m`;
  }
}
