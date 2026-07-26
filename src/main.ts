import './styles.css';

import { loadConfig } from './config';
import { createDebugPanel, isDebugEnabled } from './debug';
import { distanceMeters, placeStations, PositionTracker, type PositionFix } from './geo';
import { createLoginScreen } from './screens/login';
import { MapScreen } from './screens/map';
import { createStoryScreen } from './screens/story';
import { createTaskScreen } from './screens/task';
import { GameStore } from './state';
import type { Config, LatLng, PlacedStation } from './types';
import { confirmDialog, h, showModal } from './ui';

class Game {
  private readonly stations: PlacedStation[];
  private readonly store: GameStore;
  private readonly mapScreen: MapScreen;
  private readonly overlay: HTMLElement;
  private readonly tracker: PositionTracker;

  /** Verhindert, dass ein bereits gezeigtes Stations-Popup erneut aufpoppt. */
  private triggerPending = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly config: Config,
  ) {
    this.stations = placeStations(config);
    this.store = new GameStore(this.stations.length);
    this.overlay = h('div', { class: 'overlay', hidden: true });
    this.mapScreen = new MapScreen({
      config,
      stations: this.stations,
      onOpenMenu: () => this.openMenu(),
    });
    this.tracker = new PositionTracker(
      (fix) => this.onPosition(fix),
      (message) => this.mapScreen.showError(message),
    );
  }

  start(): void {
    if (!this.store.current.unlocked) {
      this.showLogin();
      return;
    }
    this.showGame();
  }

  private showLogin(): void {
    this.root.replaceChildren(
      createLoginScreen(this.config, () => {
        this.store.update({ unlocked: true });
        this.showGame();
      }),
    );
  }

  private showGame(): void {
    this.root.replaceChildren(this.mapScreen.element, this.overlay);

    if (isDebugEnabled()) {
      this.root.append(
        createDebugPanel({
          config: this.config,
          onSimulate: (coords: LatLng | null) => this.tracker.simulate(coords),
          onSkip: () => this.triggerNext(),
        }),
      );
    }

    this.mapScreen.refreshSize();
    this.tracker.start();
    this.render();
  }

  private render(): void {
    const state = this.store.current;
    this.mapScreen.render(state.stationIndex, state.completed);

    if (state.phase === 'map') {
      this.overlay.hidden = true;
      this.overlay.replaceChildren();
      this.mapScreen.refreshSize();
      // Nach einer Station kann das Team schon im Radius der nächsten stehen.
      const fix = this.tracker.lastFix;
      if (fix) this.onPosition(fix);
      return;
    }

    this.overlay.hidden = false;
    this.overlay.replaceChildren(this.buildOverlayScreen(state.phase, state.stationIndex));
    this.overlay.scrollTop = 0;
  }

  private buildOverlayScreen(phase: string, stationIndex: number): HTMLElement {
    const station = this.stations[stationIndex];

    switch (phase) {
      case 'intro':
        return createStoryScreen({
          eyebrow: this.config.subtitle,
          title: this.config.intro.title,
          text: this.config.intro.text,
          actionLabel: 'Fall übernehmen',
          onContinue: () => this.goTo('map'),
        });

      case 'storyBefore':
        if (!station) return this.missingStationScreen();
        return createStoryScreen({
          eyebrow: station.title,
          title: 'Die Geschichte geht weiter',
          text: station.storyBefore,
          actionLabel: 'Zur Aufgabe',
          onContinue: () => this.goTo('task'),
        });

      case 'task':
        if (!station) return this.missingStationScreen();
        return createTaskScreen({
          station,
          onSolved: () => {
            this.store.markCompleted(station.id);
            this.goTo('storyAfter');
          },
        });

      case 'storyAfter':
        if (!station) return this.missingStationScreen();
        return createStoryScreen({
          eyebrow: station.title,
          title: 'Geschafft!',
          text: station.storyAfter,
          actionLabel:
            stationIndex + 1 < this.stations.length ? 'Weiter zur Karte' : 'Auf zum Ziel',
          onContinue: () => {
            this.store.update({ stationIndex: stationIndex + 1 });
            this.goTo('map');
          },
        });

      case 'outro':
        return createStoryScreen({
          eyebrow: 'Fall gelöst',
          title: this.config.outro.title,
          text: this.config.outro.text,
          actionLabel: 'Von vorn beginnen',
          onContinue: () => this.confirmReset(),
        });

      default:
        return this.missingStationScreen();
    }
  }

  private missingStationScreen(): HTMLElement {
    return createStoryScreen({
      title: 'Hoppla',
      text: 'Der Spielstand passt nicht mehr zur Story. Am besten neu beginnen.',
      actionLabel: 'Spielstand zurücksetzen',
      onContinue: () => this.confirmReset(),
    });
  }

  private goTo(phase: 'map' | 'task' | 'storyAfter'): void {
    this.store.update({ phase });
    this.render();
  }

  private onPosition(fix: PositionFix): void {
    this.mapScreen.setPosition(fix);

    const state = this.store.current;
    if (state.phase !== 'map' || this.triggerPending) return;

    const station = this.stations[state.stationIndex];
    const target = station ? station.position : this.config.route.finish;
    if (distanceMeters(fix.coords, target) <= this.config.triggerRadiusMeters) {
      this.triggerNext();
    }
  }

  /** Öffnet die nächste offene Station bzw. am Ende die Auflösung. */
  private triggerNext(): void {
    if (this.store.current.phase !== 'map' || this.triggerPending) return;
    this.triggerPending = true;

    const state = this.store.current;
    const station = this.stations[state.stationIndex];

    if (!station) {
      showModal({
        title: 'Ihr seid am Ziel!',
        message: 'Der Fall ist gelöst — oder etwa doch nicht?',
        actions: [
          {
            label: 'Auflösung lesen',
            onSelect: () => {
              this.triggerPending = false;
              this.store.update({ phase: 'outro' });
              this.render();
            },
          },
        ],
      });
      return;
    }

    showModal({
      title: `${station.title} erreicht!`,
      message: 'Ihr seid da. Bereit für den nächsten Teil der Geschichte?',
      actions: [
        {
          label: 'Weiterlesen',
          onSelect: () => {
            this.triggerPending = false;
            this.store.update({ phase: 'storyBefore' });
            this.render();
          },
        },
      ],
    });
  }

  private openMenu(): void {
    const state = this.store.current;
    const done = state.completed.length;

    showModal({
      title: 'Menü',
      message: `${done} von ${this.stations.length} Stationen erledigt.`,
      dismissible: true,
      actions: [
        {
          label: 'Station manuell starten',
          variant: 'ghost',
          onSelect: async () => {
            const ok = await confirmDialog(
              'Station manuell starten?',
              'Nur benutzen, wenn das GPS nicht mitspielt: Die nächste Station wird sofort geöffnet, egal wo ihr gerade seid.',
              'Ja, starten',
            );
            if (ok) this.triggerNext();
          },
        },
        {
          label: 'Spielstand zurücksetzen',
          variant: 'ghost',
          onSelect: () => this.confirmReset(),
        },
        { label: 'Schließen', variant: 'ghost', onSelect: () => {} },
      ],
    });
  }

  private async confirmReset(): Promise<void> {
    const ok = await confirmDialog(
      'Spielstand zurücksetzen?',
      'Der gesamte Fortschritt geht verloren und ihr startet wieder beim Intro.',
      'Zurücksetzen',
    );
    if (!ok) return;
    this.store.reset();
    this.triggerPending = false;
    this.render();
  }
}

function showFatalError(root: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  root.replaceChildren(
    h(
      'section',
      { class: 'screen screen-error' },
      h('h1', {}, 'Da ist etwas schiefgelaufen'),
      h('p', {}, message),
      h('p', { class: 'status-sub' }, 'Bitte die Seite neu laden.'),
    ),
  );
}

async function bootstrap(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) throw new Error('#app nicht gefunden');

  try {
    const config = await loadConfig();
    document.title = config.title;
    new Game(root, config).start();
  } catch (error) {
    console.error(error);
    showFatalError(root, error);
  }
}

void bootstrap();
