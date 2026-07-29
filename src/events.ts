import type { GameStore } from './state';
import type { RandomEvent, RandomEventConfig } from './types';

/**
 * Mischt eine Kopie (Fisher–Yates). Jede Anordnung ist gleich wahrscheinlich —
 * anders als beim beliebten `sort(() => Math.random() - 0.5)`, das je nach
 * Sortierverfahren deutlich schief liegt.
 */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/**
 * Terminplan für die Zufallsevents.
 *
 * Zwei Entscheidungen stecken hier drin:
 *
 * 1. **Gewürfelter Abstand statt Wahrscheinlichkeit pro Takt.** Ein Wurf je
 *    Takt ergibt eine Exponentialverteilung: mal drei Events kurz hintereinander,
 *    mal eine halbe Stunde nichts. Eine Wartezeit aus einem Fenster ist genauso
 *    unvorhersehbar, aber ohne Klumpen und Durststrecken.
 * 2. **Beutel statt unabhängigem Ziehen.** Bei acht Einträgen käme sonst schnell
 *    dasselbe Event zweimal. Erst wenn alle dran waren, wird neu gemischt.
 *
 * Der Zustand (fälliger Zeitpunkt, Beutelinhalt) liegt im Spielstand, nicht im
 * Objekt — deshalb übersteht der Plan Reloads unverändert.
 */
export class RandomEventScheduler {
  constructor(
    private readonly config: RandomEventConfig,
    private readonly store: GameStore,
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => number = Math.random,
  ) {}

  get enabled(): boolean {
    return this.config.enabled && this.config.items.length > 0;
  }

  /**
   * Setzt den ersten Termin, falls noch keiner steht. Ein bereits geplanter
   * Zeitpunkt bleibt unangetastet — sonst würde jedes Neuladen der Seite die
   * Wartezeit von vorn beginnen lassen.
   */
  arm(): void {
    if (!this.enabled || this.store.current.eventDueAt > 0) return;
    this.store.update({
      eventDueAt: this.now() + this.config.firstAfterMinutes * 60000,
    });
  }

  /** Nächsten Termin auswürfeln, gerechnet ab jetzt. */
  scheduleNext(): void {
    if (!this.enabled) return;
    const { minMinutes, maxMinutes } = this.config;
    const minutes = minMinutes + this.random() * (maxMinutes - minMinutes);
    this.store.update({ eventDueAt: this.now() + minutes * 60000 });
  }

  get isDue(): boolean {
    const dueAt = this.store.current.eventDueAt;
    return this.enabled && dueAt > 0 && this.now() >= dueAt;
  }

  /**
   * Schiebt einen bereits überfälligen Termin um die Schonfrist nach hinten.
   * Aufgerufen, sobald die Karte nach einer Station wieder frei ist: Das Event
   * soll nicht in derselben Sekunde aufpoppen, in der der Text zu Ende ist.
   * Ein noch nicht fälliger Termin bleibt stehen.
   */
  deferIfDue(): void {
    if (!this.isDue) return;
    this.store.update({ eventDueAt: this.now() + this.config.cooldownSeconds * 1000 });
  }

  /**
   * Zieht das nächste Event und schreibt Beutel, Zähler und den neuen Termin
   * fort. Gibt `null` zurück, wenn nichts konfiguriert ist.
   */
  draw(): RandomEvent | null {
    if (!this.enabled) return null;

    const state = this.store.current;
    const known = new Set(this.config.items.map((item) => item.id));
    // Gespeicherte IDs gegen die Config prüfen: Wer Events aus der Config
    // entfernt, hätte sonst Karteileichen im Beutel.
    let bag = state.eventBag.filter((id) => known.has(id));

    if (bag.length === 0) {
      bag = shuffle(
        this.config.items.map((item) => item.id),
        this.random,
      );
      // Am Rundenwechsel darf nicht zweimal dasselbe kommen.
      if (bag.length > 1 && bag[0] === state.eventLastId) {
        [bag[0], bag[1]] = [bag[1] as string, bag[0] as string];
      }
    }

    const id = bag.shift() as string;
    const event = this.config.items.find((item) => item.id === id) ?? null;

    this.store.update({
      eventBag: bag,
      eventLastId: id,
      eventsShown: state.eventsShown + 1,
    });
    this.scheduleNext();
    return event;
  }
}
