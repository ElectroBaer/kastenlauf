import type { GameState } from './types';

const STORAGE_KEY = 'kastenlauf.state';
const STATE_VERSION = 1;

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
    authFingerprint: '',
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
    const { unlocked, notificationsAsked, installHintShown, wakeLockEnabled, authFingerprint } =
      this.state;
    this.state = {
      ...initialState(),
      unlocked,
      notificationsAsked,
      installHintShown,
      wakeLockEnabled,
      authFingerprint,
    };
    this.write();
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
        authFingerprint: typeof parsed.authFingerprint === 'string' ? parsed.authFingerprint : '',
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
