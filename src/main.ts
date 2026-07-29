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
import { RandomEventScheduler } from './events';
import { Alerter } from './notify';
import { createLoginScreen } from './screens/login';
import { MapScreen } from './screens/map';
import { createStoryScreen } from './screens/story';
import { createTaskScreen } from './screens/task';
import { GameStore } from './state';
import type { Config, LatLng, RandomEvent } from './types';
import { confirmDialog, h, renderStoryText, showModal, showToast, type ModalAction } from './ui';
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

  /**
   * Zufallsevents. Das Popup blockiert währenddessen die Stationsauslösung —
   * showModal() ersetzt einen offenen Dialog, eine fällige Station würde das
   * Event sonst kommentarlos überschreiben.
   */
  private readonly events: RandomEventScheduler;
  private eventPending = false;
  private eventTimer: number | null = null;

  /** Versteckte Geste: acht schnelle Taps auf „Display anlassen“. */
  private debugTaps = 0;
  private lastDebugTap = 0;

  /** Zeitpunkt, zu dem die Seite in den Hintergrund ging (0 = sichtbar). */
  private hiddenSince = 0;
  private reminderTimer: number | null = null;
  private reminderShown = false;

  /** Config aus der Datei, plus Koordinaten aus dem Debug-Menü, falls gesetzt. */
  private readonly config: Config;
  /** Ob gerade Testkoordinaten statt der Config-Werte gelten. */
  private readonly routeIsOverridden: boolean;

  constructor(
    private readonly root: HTMLElement,
    baseConfig: Config,
  ) {
    // Der Spielstand muss vor der Config stehen: Er entscheidet über die Route.
    this.store = new GameStore(baseConfig.stations.length);
    const override = this.store.current.routeOverride;
    this.routeIsOverridden = override !== null;
    this.config = override
      ? {
          ...baseConfig,
          route: {
            // Beschriftungen aus der Config behalten, nur die Punkte tauschen.
            start: { ...baseConfig.route.start, ...override.start },
            finish: { ...baseConfig.route.finish, ...override.finish },
          },
        }
      : baseConfig;

    this.triggers = buildTriggers(this.config);
    this.overlay = h('div', { class: 'overlay', hidden: true });
    this.mapScreen = new MapScreen({
      config: this.config,
      triggers: this.triggers,
      routeIsOverridden: this.routeIsOverridden,
      onOpenMenu: () => this.openMenu(),
    });
    this.tracker = new PositionTracker(
      (fix) => this.onPosition(fix),
      (message) => this.mapScreen.showError(message),
    );
    this.alerter = new Alerter(this.config.alerts);
    this.events = new RandomEventScheduler(this.config.randomEvents, this.store);

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

  /**
   * Die Spielfläche. Das Debug-Panel hängt als Geschwister darunter an `#app`
   * und wird deshalb hier nie mit ersetzt — und kann umgekehrt auch nichts
   * mehr überdecken.
   */
  private get main(): HTMLElement {
    return this.root.querySelector<HTMLElement>('.app-main') ?? this.root;
  }

  private showLogin(): void {
    this.main.replaceChildren(
      createLoginScreen(this.config, () => {
        // Der Klick auf "Los geht's" ist die Nutzergeste, die den AudioContext
        // freischaltet — ohne sie bliebe der Alarm an der ersten Station stumm.
        this.alerter.unlockAudio();
        this.store.update({ unlocked: true, authFingerprint: authFingerprint(this.config) });
        this.showGame();
      }),
    );
  }

  /** Über `?debug=1` in der URL oder über die Tap-Geste im Menü. */
  private get debugMode(): boolean {
    return isDebugEnabled() || this.store.current.debugEnabled;
  }

  /** Blendet das Simulations-Panel passend zum Debug-Modus ein oder aus. */
  private applyDebugMode(): void {
    if (this.debugMode) {
      this.debugPanel ??= createDebugPanel({
        config: this.config,
        onSimulate: (coords: LatLng | null) => this.tracker.simulate(coords),
        onSkip: () => this.triggerNext(),
        onEvent: () => this.fireEventNow(),
      });
      // An #app, nicht an die Spielfläche: eigener Bereich darunter.
      if (!this.debugPanel.isConnected) this.root.append(this.debugPanel);
      return;
    }

    this.debugPanel?.remove();
    // Sonst bliebe eine simulierte Position aktiv, ohne dass man sie noch
    // sehen oder zurücksetzen könnte. Danach gleich eine echte Position holen:
    // simulate(null) allein sendet keine, die Statuszeile würde also weiter
    // "Simulierte Position" behaupten, bis zufällig ein GPS-Update eintrudelt.
    this.tracker.simulate(null);
    this.mapScreen.clearSimulationNotice();
    this.tracker.refresh();
  }

  private showGame(): void {
    this.main.replaceChildren(this.mapScreen.element, this.overlay);
    this.applyDebugMode();
    this.mapScreen.refreshSize();
    this.tracker.start();
    void this.alerter.registerServiceWorker(import.meta.env.BASE_URL);
    if (this.store.current.wakeLockEnabled) void this.wakeLock.enable();
    this.events.arm();
    this.startEventTimer();
    this.render();
  }

  /**
   * Prüft regelmäßig, ob ein Zufallsevent fällig ist. Der Takt ist unkritisch:
   * Verglichen wird gegen einen gespeicherten Zeitstempel, nicht gegen einen
   * heruntergezählten Rest. Drosselt der Browser den Timer im Hintergrund oder
   * friert die Seite ganz ein, kommt das Event beim Zurückkommen nach — dafür
   * sorgt zusätzlich die Prüfung in onVisibilityChange().
   *
   * Höchstens alle 15 s, mindestens aber viermal je kürzester konfigurierter
   * Wartezeit. Bei den echten Werten kommen genau die 15 s heraus; kurze
   * Testintervalle bekommen einen entsprechend feineren Takt.
   */
  private startEventTimer(): void {
    if (this.eventTimer !== null || !this.events.enabled) return;
    const events = this.config.randomEvents;
    const shortest = Math.min(
      events.firstAfterMinutes * 60000,
      events.minMinutes * 60000,
      events.cooldownSeconds * 1000,
    );
    const tick = Math.min(15000, Math.max(1000, shortest / 4));
    this.eventTimer = window.setInterval(() => this.maybeFireEvent(), tick);
  }

  private stopEventTimer(): void {
    if (this.eventTimer !== null) {
      window.clearInterval(this.eventTimer);
      this.eventTimer = null;
    }
  }

  /**
   * Zeigt ein fälliges Event — sofern der Bildschirm frei ist. Läuft gerade ein
   * Stationstext oder steht ein anderes Popup, passiert nichts: Der Termin
   * bleibt stehen, es geht nichts verloren. Sobald das Team zur Karte
   * zurückkehrt, bekommt der überfällige Termin in `goTo()` eine kurze
   * Schonfrist, damit das Event nicht in derselben Sekunde nachschlägt.
   */
  private maybeFireEvent(): void {
    if (!this.events.isDue || !this.canShowEvent) return;
    const event = this.events.draw();
    if (event) this.showEvent(event);
  }

  private get canShowEvent(): boolean {
    const state = this.store.current;
    return (
      state.unlocked && state.phase === 'map' && !this.triggerPending && !this.eventPending
    );
  }

  private showEvent(event: RandomEvent): void {
    this.eventPending = true;
    this.alerter.fire('Zwischenfall!', event.title);
    showModal({
      eyebrow: 'Zufallsereignis',
      title: event.title,
      content: renderStoryText(event.text),
      actions: [
        {
          label: 'Erledigt',
          onSelect: () => {
            this.eventPending = false;
            // Während das Event stand, kann eine Station fällig geworden sein —
            // ausgelöst wurde sie dann nicht, um das Popup nicht zu ersetzen.
            const fix = this.tracker.lastFix;
            if (fix) this.onPosition(fix);
          },
        },
      ],
    });
  }

  /** Debug-Knopf: Event sofort ziehen, egal wie der Termin steht. */
  private fireEventNow(): void {
    if (!this.canShowEvent) {
      showToast('Erst zurück auf die Karte — während eines Stationstexts kommt kein Ereignis.');
      return;
    }
    const event = this.events.draw();
    if (event) this.showEvent(event);
    else showToast('In der Config sind keine Zufallsereignisse hinterlegt.');
  }

  /**
   * Harter Reset für Testläufe: zurück zur Passwortseite, und alles Gespeicherte
   * wird gelöscht. Deshalb steckt der Eintrag im Debug-Block — mitten im Spiel
   * versehentlich angetippt wäre er sonst eine Katastrophe.
   */
  private async logout(): Promise<void> {
    const ok = await confirmDialog(
      'Abmelden und alles löschen?',
      'Löscht alles, was die App gespeichert hat: Fortschritt, Login, Einstellungen und Testkoordinaten. Danach steht ihr wieder ganz am Anfang.',
      'Alles löschen',
    );
    if (!ok) return;

    // Auf der Passwortseite braucht nichts davon zu laufen.
    this.tracker.stop();
    this.stopReminderTimer();
    this.stopEventTimer();
    void this.wakeLock.disable();
    this.triggerPending = false;
    this.eventPending = false;
    this.debugTaps = 0;

    this.store.clear();
    // Das Debug-Flag ist mit gelöscht — ohne ?debug=1 also auch das Panel weg.
    this.applyDebugMode();
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
    // Während die Seite versteckt war, lief der Timer womöglich gar nicht.
    this.maybeFireEvent();

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
          'Schaut mal wieder auf die Karte. Die nächste Station will gefunden werden.',
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
          onOpenMenu: () => this.openMenu(),
        });

      case 'storyBefore':
        if (!station) return this.missingStationScreen();
        return createStoryScreen({
          eyebrow: station.title,
          title: 'Die Geschichte geht weiter',
          text: station.storyBefore,
          actionLabel: 'Zur Aufgabe',
          onContinue: () => this.goTo('task'),
          onOpenMenu: () => this.openMenu(),
        });

      case 'task':
        if (!station) return this.missingStationScreen();
        return createTaskScreen({
          station,
          onSolved: () => {
            this.store.markCompleted(station.id);
            this.goTo('storyAfter');
          },
          onOpenMenu: () => this.openMenu(),
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
          onOpenMenu: () => this.openMenu(),
        });

      case 'outro':
        return createStoryScreen({
          eyebrow: 'Fall gelöst',
          title: this.config.outro.title,
          text: this.config.outro.text,
          actionLabel: 'Von vorn beginnen',
          onContinue: () => this.confirmReset(),
          onOpenMenu: () => this.openMenu(),
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
    // Zurück auf der Karte: Ein Event, das während des Textes fällig geworden
    // ist, bekommt eine Schonfrist. Sonst schlüge es in derselben Sekunde nach,
    // in der die Station zu Ende gelesen ist.
    if (phase === 'map') this.events.deferIfDue();
    this.render();
  }

  private onPosition(fix: PositionFix): void {
    this.mapScreen.setPosition(fix);

    const state = this.store.current;
    // Steht gerade ein Event-Popup, wird die Station aufgeschoben: showModal()
    // ersetzt einen offenen Dialog, das Event wäre sonst weg. Nach „Erledigt"
    // wird die Position erneut ausgewertet und die Station kommt sofort.
    if (state.phase !== 'map' || this.triggerPending || this.eventPending) return;

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
        ? ` Ihr habt einiges aufzuholen. Danach warten noch ${pending} weitere ${
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
    if (this.triggerPending || this.eventPending) return;
    const state = this.store.current;

    // Auf dem iPhone im Safari-Tab gibt es die Benachrichtigungs-API gar nicht.
    // Statt stumm zu bleiben, sagen wir, woran es liegt.
    if (this.alerter.state === 'needsInstall') {
      if (state.installHintShown) return;
      this.store.update({ installHintShown: true });
      showToast(
        'Tipp fürs iPhone: Legt die App über „Teilen → Zum Home-Bildschirm“ ab. ' +
          'Nur dann kann sie euch über eine neue Station benachrichtigen. Ein Ton kommt bei geöffneter App aber so oder so.',
        12000,
      );
      return;
    }

    if (this.alerter.state !== 'default' || state.notificationsAsked) return;
    this.store.update({ notificationsAsked: true });
    showModal({
      title: 'Sollen wir euch Bescheid geben?',
      message:
        'Dann meldet sich das Handy mit Ton und einer Benachrichtigung, sobald ihr eine Station erreicht. Praktisch, wenn es in der Tasche steckt.',
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
                'Danach lässt sich die Berechtigung hier im Menü erteilen. ' +
                'Ein Hinweis-Ton an den Stationen funktioniert bei geöffneter App aber auch ohne das.',
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
                ? 'Alles klar, ihr bekommt ab jetzt eine Meldung an jeder Station.'
                : 'Bleibt aus. Über das Menü könnt ihr es jederzeit nochmal versuchen.',
            );
          },
        };
    }
  }

  /**
   * Schalter fürs Wachhalten des Displays — zeigt seinen Zustand direkt an und
   * lässt das Menü offen, damit man das Ergebnis sieht und ggf. gleich weiter
   * tippen kann. Acht schnelle Taps schalten zusätzlich den Debug-Modus um.
   */
  private wakeLockMenuAction(): ModalAction {
    const label = () => `Display anlassen: ${this.store.current.wakeLockEnabled ? 'An' : 'Aus'}`;
    return {
      label: label(),
      variant: 'ghost',
      keepOpen: true,
      onSelect: async (button) => {
        // Hat dieser Tap den Debug-Modus umgeschaltet? Dann bekommt dessen
        // Meldung den Vorrang und wird ganz zum Schluss gezeigt — showToast
        // ersetzt den vorherigen Hinweis, ein früherer Aufruf wäre also
        // sofort wieder überschrieben.
        const debugToggled = this.countDebugTap();
        const say = (text: string, ms?: number) => {
          if (!debugToggled) showToast(text, ms);
        };

        // Zustand bei jedem Tap frisch lesen: Der Button bleibt stehen und
        // wird mehrfach gedrückt, ein beim Menüaufbau gemerkter Wert wäre
        // schon beim zweiten Tap falsch.
        const on = this.store.current.wakeLockEnabled;

        if (!this.wakeLock.supported) {
          say(
            'Dieser Browser kann das Display nicht wachhalten. Am besten die Bildschirmsperre in den Systemeinstellungen hochsetzen.',
            9000,
          );
        } else if (on) {
          await this.wakeLock.disable();
          this.store.update({ wakeLockEnabled: false });
          button.textContent = label();
          say('Das Display darf sich wieder von selbst ausschalten.');
        } else {
          const ok = await this.wakeLock.enable();
          this.store.update({ wakeLockEnabled: ok });
          button.textContent = label();
          say(
            ok
              ? 'Das Display bleibt jetzt an, solange die App offen ist. Das zieht ordentlich Akku, haltet als eine Powerbank bereit.'
              : 'Hat nicht geklappt. Das geht nur, solange die App im Vordergrund ist.',
            9000,
          );
        }

        if (debugToggled) this.announceDebugMode();
      },
    };
  }

  /**
   * Versteckte Geste: acht Taps in schneller Folge schalten den Debug-Modus um.
   * Eine Pause von mehr als 800 ms setzt die Zählung zurück, damit normales
   * Bedienen des Schalters ihn nicht versehentlich auslöst.
   */
  private countDebugTap(): boolean {
    const now = Date.now();
    this.debugTaps = now - this.lastDebugTap <= 800 ? this.debugTaps + 1 : 1;
    this.lastDebugTap = now;
    if (this.debugTaps < 8) return false;

    this.debugTaps = 0;
    this.store.update({ debugEnabled: !this.store.current.debugEnabled });
    this.applyDebugMode();
    return true;
  }

  private announceDebugMode(): void {
    showToast(
      this.store.current.debugEnabled
        ? 'Debug-Modus aktiviert — unten erscheint die GPS-Simulation, im Menü „Start/Ziel ändern“.'
        : 'Debug-Modus deaktiviert.',
      6000,
    );
  }

  /**
   * Start- und Zielkoordinaten von Hand setzen — nur im Debug-Modus.
   *
   * Nach dem Übernehmen wird die Seite neu geladen: Die Route steckt in den
   * Ringabständen, den Kartenebenen und im Simulations-Regler. Ein Reload baut
   * das nachweislich konsistent neu auf, statt drei Stellen einzeln
   * nachzuziehen. Der Spielstand überlebt das ohnehin.
   */
  private openRouteEditor(): void {
    const { start, finish } = this.config.route;
    const field = (label: string, value: number, step = 'any') => {
      const input = h('input', {
        class: 'input',
        type: 'number',
        step,
        value: String(value),
        'aria-label': label,
      });
      return { input, row: h('label', { class: 'field' }, h('span', {}, label), input) };
    };

    const sLat = field('Start – Breite (lat)', start.lat);
    const sLng = field('Start – Länge (lng)', start.lng);
    const fLat = field('Ziel – Breite (lat)', finish.lat);
    const fLng = field('Ziel – Länge (lng)', finish.lng);
    const error = h('p', { class: 'form-error', role: 'alert' });

    const content = h('div', { class: 'field-grid' }, sLat.row, sLng.row, fLat.row, fLng.row, error);

    const apply = () => {
      const values = [sLat, sLng, fLat, fLng].map((f) => Number(f.input.value.replace(',', '.')));
      const [startLat, startLng, finishLat, finishLng] = values as [number, number, number, number];

      if (values.some((v) => !Number.isFinite(v))) {
        error.textContent = 'Bitte in alle vier Felder eine Zahl eintragen.';
        return false;
      }
      if (Math.abs(startLat) > 90 || Math.abs(finishLat) > 90) {
        error.textContent = 'Breitengrad muss zwischen −90 und 90 liegen.';
        return false;
      }
      if (Math.abs(startLng) > 180 || Math.abs(finishLng) > 180) {
        error.textContent = 'Längengrad muss zwischen −180 und 180 liegen.';
        return false;
      }

      this.store.update({
        routeOverride: {
          start: { lat: startLat, lng: startLng },
          finish: { lat: finishLat, lng: finishLng },
        },
      });
      location.reload();
      return true;
    };

    // Bei ungültiger Eingabe geht der Dialog wieder auf — sonst wäre die
    // Meldung im selben Moment weg, in dem sie erscheint. Das Formular bleibt
    // dasselbe Element, die Eingaben stehen also noch drin.
    const open = () =>
      showModal({
        title: 'Start und Ziel ändern',
        message:
          'Nur zum Testen. Die Werte gelten auch ohne Debug-Modus, die Karte weist dann sichtbar darauf hin. „Spielstand zurücksetzen“ holt die Koordinaten aus der Config zurück.',
        content,
        dismissible: true,
        actions: [
          {
            label: 'Übernehmen und neu laden',
            onSelect: () => {
              if (!apply()) open();
            },
          },
          {
            label: 'Auf Config zurücksetzen',
            variant: 'ghost',
            onSelect: () => {
              this.store.update({ routeOverride: null });
              location.reload();
            },
          },
          { label: 'Abbrechen', variant: 'ghost', onSelect: () => {} },
        ],
      });

    open();
  }

  private openMenu(): void {
    const state = this.store.current;
    const done = state.completed.length;
    const notificationAction = this.notificationMenuAction();
    const events = state.eventsShown;
    const eventNote = events > 0 ? ` ${events} Zwischenfall${events === 1 ? '' : 'e'} überstanden.` : '';

    showModal({
      title: 'Menü',
      message: `${done} von ${this.triggers.length} Stationen erledigt.${eventNote}`,
      dismissible: true,
      actions: [
        // Erst die Einstellungen, dann Aktionen, dann Schließen — und ganz
        // unten abgesetzt die Werkzeuge, die nichts mit dem Spiel zu tun haben.
        this.wakeLockMenuAction(),
        ...(notificationAction ? [notificationAction] : []),
        // Außerhalb der Karte liefe der Eintrag ins Leere: triggerNext() steigt
        // bei einer anderen Phase sofort wieder aus.
        ...(state.phase === 'map'
          ? [
              {
                label: 'Station manuell starten',
                variant: 'ghost' as const,
                onSelect: async () => {
                  const ok = await confirmDialog(
                    'Station manuell starten?',
                    'Nur benutzen, wenn das GPS nicht mitspielt. Die nächste Station wird sofort geöffnet, egal wo ihr gerade seid.',
                    'Ja, starten',
                  );
                  if (ok) this.triggerNext();
                },
              },
            ]
          : []),
        {
          label: 'Spielstand zurücksetzen',
          variant: 'ghost',
          onSelect: () => this.confirmReset(),
        },
        { label: 'Schließen', variant: 'ghost', onSelect: () => {} },
        ...(this.debugMode
          ? [
              {
                label: 'Start/Ziel ändern',
                variant: 'debug' as const,
                onSelect: () => this.openRouteEditor(),
              },
              {
                label: 'Abmelden und alles löschen',
                variant: 'debug' as const,
                onSelect: () => void this.logout(),
              },
            ]
          : []),
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
    this.eventPending = false;
    // reset() räumt auch Termin, Beutel und Zähler weg — der Plan beginnt neu.
    this.events.arm();
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
  const target = root.querySelector<HTMLElement>('.app-main') ?? root;
  target.replaceChildren(
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
