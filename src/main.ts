import './styles.css';

import { loadConfig } from './config';
import { createDebugPanel, isDebugEnabled } from './debug';
import { distanceMeters, placeStations, PositionTracker, type PositionFix } from './geo';
import { Alerter } from './notify';
import { createLoginScreen } from './screens/login';
import { MapScreen } from './screens/map';
import { createStoryScreen } from './screens/story';
import { createTaskScreen } from './screens/task';
import { GameStore } from './state';
import type { Config, LatLng, PlacedStation } from './types';
import { confirmDialog, h, showModal, showToast } from './ui';

class Game {
  private readonly stations: PlacedStation[];
  private readonly store: GameStore;
  private readonly mapScreen: MapScreen;
  private readonly overlay: HTMLElement;
  private readonly tracker: PositionTracker;
  private readonly alerter: Alerter;

  /** Verhindert, dass ein bereits gezeigtes Stations-Popup erneut aufpoppt. */
  private triggerPending = false;

  /** Zeitpunkt, zu dem die Seite in den Hintergrund ging (0 = sichtbar). */
  private hiddenSince = 0;
  private reminderTimer: number | null = null;
  private reminderShown = false;

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
    this.alerter = new Alerter(config.alerts);
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
        // Der Klick auf "Los geht's" ist die Nutzergeste, die den AudioContext
        // freischaltet — ohne sie bliebe der Alarm an der ersten Station stumm.
        this.alerter.unlockAudio();
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
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
    this.render();
  }

  /**
   * Der wichtigste Teil des Hintergrund-Verhaltens. Während die Seite versteckt
   * ist (anderes Programm im Vordergrund, gesperrtes Display), drosselt der
   * Browser die Timer und friert die Seite irgendwann ganz ein — echte
   * Hintergrund-Ortung gibt es im Web nicht. Deshalb wird beim Zurückkommen
   * sofort eine frische Position geholt und ausgewertet: eine Station, an der
   * das Team mit dunklem Display vorbeigelaufen ist, ploppt dann in dem Moment
   * auf, in dem jemand wieder aufs Handy schaut.
   */
  private onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.hiddenSince = Date.now();
      this.reminderShown = false;
      this.startReminderTimer();
      return;
    }

    this.stopReminderTimer();
    const hiddenMinutes = this.hiddenSince ? (Date.now() - this.hiddenSince) / 60000 : 0;
    this.hiddenSince = 0;

    this.tracker.refresh();
    this.mapScreen.refreshSize();

    // Kam die Erinnerung nicht durch, weil der Browser die Seite eingefroren
    // hat, wird sie hier nachgeholt — dann eben als Hinweis in der App.
    const after = this.config.alerts.reminderAfterMinutes;
    if (after > 0 && hiddenMinutes >= after && !this.reminderShown && !this.triggerPending) {
      showToast('Willkommen zurück! Schaut mal, wie weit es noch zur nächsten Station ist.');
    }
  }

  private startReminderTimer(): void {
    const after = this.config.alerts.reminderAfterMinutes;
    if (after <= 0 || this.store.current.phase === 'outro' || !this.alerter.notificationsGranted) {
      return;
    }
    this.stopReminderTimer();
    const dueAt = this.hiddenSince + after * 60000;
    // Gegen die Uhr prüfen statt einen langen Timeout zu setzen: gedrosselte
    // Timer feuern später als gewünscht, die Uhrzeit stimmt aber trotzdem.
    this.reminderTimer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        this.stopReminderTimer();
        return;
      }
      if (Date.now() >= dueAt) {
        this.alerter.notify(
          'Der Fall wartet!',
          'Schaut mal wieder auf die Karte — die nächste Station will gefunden werden.',
        );
        this.reminderShown = true;
        this.stopReminderTimer();
      }
    }, 20000);
  }

  private stopReminderTimer(): void {
    if (this.reminderTimer !== null) {
      window.clearInterval(this.reminderTimer);
      this.reminderTimer = null;
    }
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
          onContinue: () => {
            this.goTo('map');
            this.offerNotifications();
          },
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
      this.alerter.fire('Ihr seid am Ziel!', 'Zeit für die Auflösung.');
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

    this.alerter.fire(
      `${station.title} erreicht!`,
      'Ihr seid da — die Geschichte geht weiter.',
    );
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

  /**
   * Fragt die Benachrichtigungs-Berechtigung mit Kontext ab, statt direkt beim
   * Laden: ohne Erklärung tippen die meisten auf "Blockieren", und viele
   * Browser lehnen die Abfrage ohne vorherige Nutzergeste ohnehin ab.
   */
  private offerNotifications(): void {
    if (!this.alerter.notificationsAvailable || this.alerter.notificationsDecided) return;
    showModal({
      title: 'Sollen wir euch Bescheid geben?',
      message:
        'Dann meldet sich das Handy mit Ton und einer Benachrichtigung, sobald ihr eine Station erreicht — praktisch, wenn es in der Tasche steckt.',
      dismissible: true,
      actions: [
        { label: 'Ja, gerne', onSelect: () => void this.alerter.requestNotifications() },
        { label: 'Später', variant: 'ghost', onSelect: () => {} },
      ],
    });
  }

  private openMenu(): void {
    const state = this.store.current;
    const done = state.completed.length;
    const canOfferNotifications =
      this.alerter.notificationsAvailable && !this.alerter.notificationsGranted;

    showModal({
      title: 'Menü',
      message: `${done} von ${this.stations.length} Stationen erledigt.`,
      dismissible: true,
      actions: [
        ...(canOfferNotifications
          ? [
              {
                label: 'Benachrichtigungen einschalten',
                variant: 'ghost' as const,
                onSelect: async () => {
                  const granted = await this.alerter.requestNotifications();
                  showToast(
                    granted
                      ? 'Alles klar — ihr bekommt ab jetzt eine Meldung an jeder Station.'
                      : 'Benachrichtigungen sind blockiert. Das lässt sich in den Browser-Einstellungen für diese Seite ändern.',
                  );
                },
              },
            ]
          : []),
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
