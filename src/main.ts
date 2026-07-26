import './styles.css';

import { loadConfig } from './config';
import { createDebugPanel, isDebugEnabled } from './debug';
import {
  buildTriggers,
  distanceMeters,
  dueStationCount,
  PositionTracker,
  type PositionFix,
  type StationTrigger,
} from './geo';
import { Alerter } from './notify';
import { createLoginScreen } from './screens/login';
import { MapScreen } from './screens/map';
import { createStoryScreen } from './screens/story';
import { createTaskScreen } from './screens/task';
import { GameStore } from './state';
import type { Config, LatLng } from './types';
import { confirmDialog, h, showModal, showToast, type ModalAction } from './ui';
import { WakeLock } from './wakelock';

class Game {
  private readonly triggers: StationTrigger[];
  private readonly store: GameStore;
  private readonly mapScreen: MapScreen;
  private readonly overlay: HTMLElement;
  private readonly tracker: PositionTracker;
  private readonly alerter: Alerter;
  private readonly wakeLock = new WakeLock();

  /** Einmal erzeugt und wiederverwendet — sonst stapelt es sich beim Anmelden. */
  private debugPanel: HTMLElement | null = null;

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
    this.triggers = buildTriggers(config);
    this.store = new GameStore(this.triggers.length);
    this.overlay = h('div', { class: 'overlay', hidden: true });
    this.mapScreen = new MapScreen({
      config,
      triggers: this.triggers,
      onOpenMenu: () => this.openMenu(),
    });
    this.tracker = new PositionTracker(
      (fix) => this.onPosition(fix),
      (message) => this.mapScreen.showError(message),
    );
    this.alerter = new Alerter(config.alerts);

    // Genau einmal registrieren. Früher hing das in showGame(), was beim
    // Abmelden und Wiederanmelden zu mehrfach angehängten Listenern geführt
    // hätte — mit doppelten Positionsabfragen und doppelten Erinnerungen.
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
  }

  start(): void {
    // Passwort in der Config geändert? Dann muss es auch auf diesem Gerät neu
    // eingegeben werden. Der Fortschritt bleibt dabei stehen.
    const state = this.store.current;
    if (state.unlocked && state.authFingerprint !== authFingerprint(this.config)) {
      this.store.update({ unlocked: false });
    }

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
        this.store.update({ unlocked: true, authFingerprint: authFingerprint(this.config) });
        this.showGame();
      }),
    );
  }

  private showGame(): void {
    this.root.replaceChildren(this.mapScreen.element, this.overlay);

    if (isDebugEnabled()) {
      this.debugPanel ??= createDebugPanel({
        config: this.config,
        onSimulate: (coords: LatLng | null) => this.tracker.simulate(coords),
        onSkip: () => this.triggerNext(),
      });
      this.root.append(this.debugPanel);
    }

    this.mapScreen.refreshSize();
    this.tracker.start();
    void this.alerter.registerServiceWorker(import.meta.env.BASE_URL);
    if (this.store.current.wakeLockEnabled) void this.wakeLock.enable();
    this.render();
  }

  /** Zurück zur Passwortseite. Der Spielfortschritt bleibt erhalten. */
  private async logout(): Promise<void> {
    const ok = await confirmDialog(
      'Abmelden?',
      'Ihr landet wieder auf der Passwort-Seite. Der Spielstand bleibt erhalten — nach dem Anmelden geht es genau hier weiter.',
      'Abmelden',
    );
    if (!ok) return;

    // Auf der Passwortseite braucht nichts davon zu laufen.
    this.tracker.stop();
    this.stopReminderTimer();
    void this.wakeLock.disable();
    this.triggerPending = false;

    this.store.update({ unlocked: false });
    this.showLogin();
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
    // Auf der Passwortseite läuft weder Ortung noch Erinnerung.
    if (!this.store.current.unlocked) return;

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
    // Den Wake Lock gibt das Betriebssystem im Hintergrund selbst frei.
    void this.wakeLock.reacquireIfWanted();

    // Kam die Erinnerung nicht durch, weil der Browser die Seite eingefroren
    // hat, wird sie hier nachgeholt — dann eben als Hinweis in der App.
    const after = this.config.alerts.reminderAfterMinutes;
    if (after > 0 && hiddenMinutes >= after && !this.reminderShown && !this.triggerPending) {
      showToast('Willkommen zurück! Schaut mal, wie weit es noch zur nächsten Station ist.');
    }
  }

  private startReminderTimer(): void {
    const after = this.config.alerts.reminderAfterMinutes;
    if (after <= 0 || this.store.current.phase === 'outro' || !this.alerter.granted) {
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
        void this.alerter.notify(
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
    this.mapScreen.render(state.stationIndex);

    if (state.phase === 'map') {
      this.overlay.hidden = true;
      this.overlay.replaceChildren();
      this.mapScreen.refreshSize();
      // Nach einer Station kann das Team schon im Radius der nächsten stehen.
      const fix = this.tracker.lastFix;
      if (fix) this.onPosition(fix);
      // Erst nach der Stationsprüfung: ein Stations-Popup hat Vorrang und darf
      // nicht vom Benachrichtigungs-Angebot überschrieben werden.
      this.maybeOfferNotifications();
      return;
    }

    this.overlay.hidden = false;
    this.overlay.replaceChildren(this.buildOverlayScreen(state.phase, state.stationIndex));
    this.overlay.scrollTop = 0;
  }

  private buildOverlayScreen(phase: string, stationIndex: number): HTMLElement {
    const station = this.triggers[stationIndex]?.station;

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
            stationIndex + 1 < this.triggers.length ? 'Weiter zur Karte' : 'Auf zum Ziel',
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

    if (state.stationIndex < this.dueCount(fix.coords)) {
      this.triggerNext();
      return;
    }

    // Alle Stationen durch: Jetzt zählt nur noch der Zielpunkt selbst.
    if (
      state.stationIndex >= this.triggers.length &&
      distanceMeters(fix.coords, this.config.route.finish) <= this.config.triggerRadiusMeters
    ) {
      this.triggerNext();
    }
  }

  /**
   * Wie viele Stationen an dieser Position fällig sind. Mehr als eine ist der
   * Normalfall, wenn die App eine Weile in der Tasche war — sie werden dann
   * nacheinander abgearbeitet, weil `render()` nach jeder Station erneut prüft.
   */
  private dueCount(position: LatLng): number {
    return dueStationCount(
      this.triggers,
      position,
      distanceMeters(position, this.config.route.finish),
      this.config.triggerRadiusMeters,
    );
  }

  /** Öffnet die nächste offene Station bzw. am Ende die Auflösung. */
  private triggerNext(): void {
    if (this.store.current.phase !== 'map' || this.triggerPending) return;
    this.triggerPending = true;

    const state = this.store.current;
    const station = this.triggers[state.stationIndex]?.station;

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

    // Waren mehrere Stationen zugleich fällig, sagen wir das dazu — sonst
    // wundert sich das Team, warum sich die Geschichten plötzlich stapeln.
    const fix = this.tracker.lastFix;
    const pending = fix ? this.dueCount(fix.coords) - state.stationIndex - 1 : 0;
    const backlog =
      pending > 0
        ? ` Ihr habt einiges aufzuholen — danach warten noch ${pending} weitere ${
            pending === 1 ? 'Station' : 'Stationen'
          }.`
        : '';

    this.alerter.fire(
      `${station.title} erreicht!`,
      'Ihr seid da — die Geschichte geht weiter.',
    );
    showModal({
      title: `${station.title} erreicht!`,
      message: `Ihr seid da. Bereit für den nächsten Teil der Geschichte?${backlog}`,
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
   * Bietet Benachrichtigungen einmalig an, sobald das Team auf der Karte steht.
   * Bewusst nicht beim Laden: ohne Erklärung tippen die meisten auf
   * "Blockieren", und viele Browser lehnen die Abfrage ohne vorherige
   * Nutzergeste ohnehin ab. Und bewusst nicht mehr nur direkt nach dem Intro —
   * wer den Spielstand schon weiter hat, wäre sonst nie gefragt worden.
   */
  private maybeOfferNotifications(): void {
    if (this.triggerPending) return;
    const state = this.store.current;

    // Auf dem iPhone im Safari-Tab gibt es die Benachrichtigungs-API gar nicht.
    // Statt stumm zu bleiben, sagen wir, woran es liegt.
    if (this.alerter.state === 'needsInstall') {
      if (state.installHintShown) return;
      this.store.update({ installHintShown: true });
      showToast(
        'Tipp fürs iPhone: Legt die App über „Teilen → Zum Home-Bildschirm“ ab. ' +
          'Nur dann kann sie euch an einer Station benachrichtigen — der Ton kommt aber so oder so.',
        12000,
      );
      return;
    }

    if (this.alerter.state !== 'default' || state.notificationsAsked) return;
    this.store.update({ notificationsAsked: true });
    showModal({
      title: 'Sollen wir euch Bescheid geben?',
      message:
        'Dann meldet sich das Handy mit Ton und einer Benachrichtigung, sobald ihr eine Station erreicht — praktisch, wenn es in der Tasche steckt.',
      dismissible: true,
      actions: [
        { label: 'Ja, gerne', onSelect: () => void this.alerter.requestPermission() },
        { label: 'Später', variant: 'ghost', onSelect: () => {} },
      ],
    });
  }

  /**
   * Menüeintrag zu Benachrichtigungen. Erklärt jeden Zustand, statt sich
   * kommentarlos auszublenden — genau daran ist die iPhone-Abfrage vorher
   * gescheitert.
   */
  private notificationMenuAction(): ModalAction | null {
    switch (this.alerter.state) {
      case 'granted':
      case 'off':
        return null;

      case 'needsInstall':
        return {
          label: 'Benachrichtigungen einschalten',
          variant: 'ghost',
          onSelect: () =>
            showModal({
              title: 'Auf dem iPhone erst installieren',
              message:
                'Safari zeigt Benachrichtigungen nur für Web-Apps auf dem Home-Bildschirm. ' +
                'Tippt unten auf das Teilen-Symbol, dann auf „Zum Home-Bildschirm“, und startet die App von dort. ' +
                'Danach lässt sich die Berechtigung hier im Menü erteilen. Der Ton an den Stationen funktioniert auch ohne das.',
              dismissible: true,
              actions: [{ label: 'Verstanden', onSelect: () => {} }],
            }),
        };

      case 'unsupported':
        return {
          label: 'Benachrichtigungen einschalten',
          variant: 'ghost',
          onSelect: () =>
            showToast('Dieser Browser kann keine Benachrichtigungen. Ton und Vibration kommen trotzdem.'),
        };

      case 'denied':
        return {
          label: 'Benachrichtigungen einschalten',
          variant: 'ghost',
          onSelect: () =>
            showToast(
              'Benachrichtigungen sind für diese Seite blockiert. Das lässt sich nur in den Browser-Einstellungen wieder ändern.',
              9000,
            ),
        };

      case 'default':
        return {
          label: 'Benachrichtigungen einschalten',
          variant: 'ghost',
          onSelect: async () => {
            this.store.update({ notificationsAsked: true });
            const granted = await this.alerter.requestPermission();
            showToast(
              granted
                ? 'Alles klar — ihr bekommt ab jetzt eine Meldung an jeder Station.'
                : 'Bleibt aus. Über das Menü könnt ihr es jederzeit nochmal versuchen.',
            );
          },
        };
    }
  }

  /** Schalter fürs Wachhalten des Displays — zeigt seinen Zustand direkt an. */
  private wakeLockMenuAction(): ModalAction {
    const on = this.store.current.wakeLockEnabled;
    return {
      label: `Display anlassen: ${on ? 'An' : 'Aus'}`,
      variant: 'ghost',
      onSelect: async () => {
        if (!this.wakeLock.supported) {
          showToast('Dieser Browser kann das Display nicht wachhalten. Am besten die Bildschirmsperre in den Systemeinstellungen hochsetzen.', 9000);
          return;
        }
        if (on) {
          await this.wakeLock.disable();
          this.store.update({ wakeLockEnabled: false });
          showToast('Das Display darf sich wieder von selbst ausschalten.');
          return;
        }
        const ok = await this.wakeLock.enable();
        this.store.update({ wakeLockEnabled: ok });
        showToast(
          ok
            ? 'Das Display bleibt jetzt an, solange die App offen ist. Das zieht ordentlich Akku — Powerbank bereithalten.'
            : 'Hat nicht geklappt. Das geht nur, solange die App im Vordergrund ist.',
          9000,
        );
      },
    };
  }

  private openMenu(): void {
    const state = this.store.current;
    const done = state.completed.length;
    const notificationAction = this.notificationMenuAction();

    showModal({
      title: 'Menü',
      message: `${done} von ${this.triggers.length} Stationen erledigt.`,
      dismissible: true,
      actions: [
        // Erst die Einstellungen, dann Aktionen, zuletzt das Heikle.
        this.wakeLockMenuAction(),
        ...(notificationAction ? [notificationAction] : []),
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
        {
          label: 'Abmelden',
          variant: 'ghost',
          onSelect: () => void this.logout(),
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

/**
 * Kurzform des Passwort-Hashes. Steckt im Spielstand, damit ein Passwortwechsel
 * in der Config auch auf Geräten greift, die schon entsperrt waren — sonst
 * bliebe dort für immer das alte Passwort gültig. Kein Sicherheitsmerkmal, nur
 * ein Vergleichswert: der volle Hash steht ohnehin in der ausgelieferten
 * config.json.
 */
function authFingerprint(config: Config): string {
  return config.auth.passwordHash.slice(0, 12);
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
