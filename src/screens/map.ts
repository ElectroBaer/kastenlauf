import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { distanceMeters, formatDistance, type PositionFix, type StationTrigger } from '../geo';
import type { Config, LatLng } from '../types';
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
  triggers: StationTrigger[];
  /** Läuft das Spiel gerade mit im Debug-Menü gesetzten Koordinaten? */
  routeIsOverridden: boolean;
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
  /** Punkt, auf den sich die Statuszeile bezieht. */
  private target: LatLng | null = null;
  /**
   * Bei einem Ring der Radius um das Ziel: Die Statuszeile zeigt dann nicht die
   * Luftlinie zum Ziel, sondern wie viel noch bis zur Ringlinie fehlt.
   */
  private targetRingRadius = 0;
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
   * Zeichnet die nächste Marke passend zum Fortschritt neu. `stationIndex` ist
   * die als Nächstes anstehende Station; liegt er hinter der letzten Station,
   * geht es zum Zielpunkt.
   *
   * Gezeichnet wird immer nur die *nächste* Marke: bei einer Ring-Station der
   * Kreis um das Ziel, in den das Team hineinlaufen muss, bei einer
   * `coords`-Station Pin und Trigger-Radius an ihrem Ort.
   */
  render(stationIndex: number): void {
    this.stationLayer.clearLayers();
    const { finish } = this.options.config.route;
    const next = this.options.triggers[stationIndex];

    if (!next) {
      this.target = finish;
      this.targetRingRadius = 0;
      this.targetLabel = 'bis zum Ziel';
      this.title.textContent = 'Auf zum Ziel';
      L.circle(finish, {
        radius: this.options.config.triggerRadiusMeters,
        color: '#b26a00',
        fillColor: '#b26a00',
        fillOpacity: 0.2,
        weight: 2,
      }).addTo(this.stationLayer);
      this.updateStatus();
      return;
    }

    this.title.textContent = `Station ${stationIndex + 1} von ${this.options.triggers.length}`;
    this.targetLabel = 'zur nächsten Station';

    if (next.kind === 'ring') {
      this.target = finish;
      this.targetRingRadius = next.remainingMeters;
      L.circle(finish, {
        radius: next.remainingMeters,
        color: '#b26a00',
        fillColor: '#b26a00',
        // Nur ein dünner Ring: Die Fläche ist riesig, eine Füllung würde die
        // halbe Karte überdecken. Durchgezogen, damit er nicht mit der
        // gestrichelten Luftlinie verwechselt wird.
        fillOpacity: 0.05,
        weight: 4,
        // Angriffspunkt für die Puls-Animation aus styles.css.
        className: 'ring-next',
      }).addTo(this.stationLayer);
    } else {
      this.target = next.coords;
      this.targetRingRadius = 0;
      L.circle(next.coords, {
        radius: this.options.config.triggerRadiusMeters,
        color: '#b26a00',
        fillColor: '#b26a00',
        fillOpacity: 0.2,
        weight: 2,
      }).addTo(this.stationLayer);
      L.marker(next.coords, {
        icon: pin('pin-next', '?'),
        title: `Nächste Station: ${next.station.title}`,
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
    // Beim Ring zählt nicht die Luftlinie zum Ziel, sondern was bis zur
    // Ringlinie fehlt — also die Strecke, die das Team noch gutmachen muss.
    const remaining = Math.max(
      0,
      distanceMeters(this.lastFix.coords, this.target) - this.targetRingRadius,
    );
    this.statusMain.textContent = `Noch ${formatDistance(remaining)} ${this.targetLabel}`;

    // Überschriebene Koordinaten haben Vorrang in der Anzeige: Sie sollen nie
    // unbemerkt aktiv sein, auch nicht außerhalb des Debug-Modus.
    if (this.options.routeIsOverridden) {
      this.statusSub.textContent = '⚠ Testkoordinaten aktiv';
      this.statusSub.classList.add('status-warn');
      return;
    }
    this.statusSub.classList.remove('status-warn');
    this.statusSub.textContent = this.lastFix.simulated
      ? 'Simulierte Position (Debug-Modus)'
      : `GPS-Genauigkeit ±${Math.round(this.lastFix.accuracy)} m`;
  }
}
