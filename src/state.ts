import type { GameState, LatLng } from './types';

const STORAGE_KEY = 'kastenlauf.state';
const STATE_VERSION = 1;

const isLatLng = (value: unknown): value is LatLng => {
  const point = value as LatLng | undefined;
  return (
    !!point &&
    typeof point.lat === 'number' &&
    typeof point.lng === 'number' &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lng) <= 180
  );
};

/** Unbrauchbare Werte werden verworfen, statt die App damit lahmzulegen. */
function readRouteOverride(value: unknown): GameState['routeOverride'] {
  const override = value as GameState['routeOverride'];
  if (!override || !isLatLng(override.start) || !isLatLng(override.finish)) return null;
  return { start: override.start, finish: override.finish };
}

function initialState(): GameState {
  return {
    stateVersion: STATE_VERSION,
    unlocked: false,
    phase: 'intro',
    stationIndex: 0,
    completed: [],
    notificationsAsked: false,
    installHintShown: false,
    wakeLockEnabled: false,
    debugEnabled: false,
    authFingerprint: '',
    routeOverride: null,
    eventDueAt: 0,
    eventBag: [],
    eventLastId: '',
    eventsShown: 0,
  };
}

/**
 * Spielstand im localStorage — überlebt Reloads und das Schließen des Tabs,
 * anders als Cookies ohne Größenlimit und ohne bei jedem Request mitzureisen.
 */
export class GameStore {
  private state: GameState;

  constructor(private readonly stationCount: number) {
    this.state = this.read();
  }

  get current(): Readonly<GameState> {
    return this.state;
  }

  update(patch: Partial<GameState>): Readonly<GameState> {
    this.state = { ...this.state, ...patch };
    this.write();
    return this.state;
  }

  markCompleted(stationId: number): void {
    if (this.state.completed.includes(stationId)) return;
    this.update({ completed: [...this.state.completed, stationId] });
  }

  reset(): void {
    // Nur der Spielfortschritt geht zurück. Login und die einmal beantworteten
    // Gerätefragen sind keine Story und sollen nicht erneut aufpoppen.
    //
    // routeOverride wird bewusst NICHT übernommen: Zurücksetzen soll auch die
    // Start-/Zielkoordinaten wieder auf die Werte aus der Config bringen.
    //
    // Der Zufallsevent-Plan (Termin, Beutel, Zähler) geht ebenfalls mit zurück:
    // Er steht in initialState() und wird hier nicht durchgereicht.
    const {
      unlocked,
      notificationsAsked,
      installHintShown,
      wakeLockEnabled,
      debugEnabled,
      authFingerprint,
    } = this.state;
    this.state = {
      ...initialState(),
      unlocked,
      notificationsAsked,
      installHintShown,
      wakeLockEnabled,
      // Mitten im Testen aus dem Debug-Modus zu fliegen wäre lästig.
      debugEnabled,
      authFingerprint,
    };
    this.write();
  }

  /**
   * Löscht wirklich alles, was die App gespeichert hat — Fortschritt, Login,
   * Geräte-Einstellungen, Testkoordinaten, Debug-Flag. Anders als `reset()`,
   * das nur die Story zurückdreht.
   */
  clear(): void {
    this.state = initialState();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Kein Speicher verfügbar — der Zustand im Arbeitsspeicher ist ohnehin weg.
    }
  }

  private read(): GameState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return initialState();
      const parsed = JSON.parse(raw) as Partial<GameState>;
      if (parsed.stateVersion !== STATE_VERSION) return initialState();

      // Gegen eine gekürzte Story absichern: ein gespeicherter Index, den es
      // nicht mehr gibt, würde sonst zu einem leeren Screen führen.
      const stationIndex =
        typeof parsed.stationIndex === 'number'
          ? Math.min(Math.max(parsed.stationIndex, 0), this.stationCount)
          : 0;

      // Fehlende Felder werden ergänzt, statt STATE_VERSION zu erhöhen — ein
      // Versionssprung würde laufende Spielstände löschen.
      return {
        stateVersion: STATE_VERSION,
        unlocked: parsed.unlocked === true,
        phase: parsed.phase ?? 'intro',
        stationIndex,
        completed: Array.isArray(parsed.completed) ? parsed.completed : [],
        notificationsAsked: parsed.notificationsAsked === true,
        installHintShown: parsed.installHintShown === true,
        wakeLockEnabled: parsed.wakeLockEnabled === true,
        debugEnabled: parsed.debugEnabled === true,
        authFingerprint: typeof parsed.authFingerprint === 'string' ? parsed.authFingerprint : '',
        routeOverride: readRouteOverride(parsed.routeOverride),
        eventDueAt: typeof parsed.eventDueAt === 'number' ? parsed.eventDueAt : 0,
        eventBag: Array.isArray(parsed.eventBag)
          ? parsed.eventBag.filter((id): id is string => typeof id === 'string')
          : [],
        eventLastId: typeof parsed.eventLastId === 'string' ? parsed.eventLastId : '',
        eventsShown: typeof parsed.eventsShown === 'number' ? parsed.eventsShown : 0,
      };
    } catch {
      // Privater Modus oder beschädigter Eintrag: lieber frisch anfangen.
      return initialState();
    }
  }

  private write(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Kein Speicher verfügbar — das Spiel läuft weiter, nur ohne Persistenz.
    }
  }
}
