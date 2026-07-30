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
    // Ein offenes Ereignis wartet ohnehin auf seinen Abruf, da gibt es keinen
    // Termin zu verschieben.
    if (this.store.current.eventPendingId || !this.isDue) return;
    this.store.update({ eventDueAt: this.now() + this.config.cooldownSeconds * 1000 });
  }

  /**
   * Das gezogene, aber noch nicht abgerufene Ereignis. Es bleibt im Spielstand
   * stehen, bis das Team es weggetippt hat — auch über einen Reload hinweg.
   *
   * Zeigt der Spielstand auf ein Ereignis, das in der Config nicht mehr steht
   * (Liste inzwischen bearbeitet), wird der Verweis stillschweigend aufgeräumt,
   * damit das Spiel nicht dauerhaft auf ein Phantom wartet.
   */
  pendingEvent(): RandomEvent | null {
    const id = this.store.current.eventPendingId;
    if (!id) return null;
    const event = this.config.items.find((item) => item.id === id);
    if (event) return event;
    this.acknowledge();
    return null;
  }

  /**
   * Das Team hat das Ereignis weggetippt. **Erst jetzt** läuft die Zeit für das
   * nächste — nicht schon beim Anzeigen. Steckte das Handy stundenlang in der
   * Tasche, kommt deshalb genau ein Ereignis und danach wieder ein vollständiges
   * Wartefenster, statt einer Salve.
   */
  acknowledge(): void {
    this.store.update({ eventPendingId: '' });
    this.scheduleNext();
  }

  /** Das fest als erstes gesetzte Ereignis, falls eines markiert ist. */
  private get pinned(): RandomEvent | undefined {
    return this.config.items.find((item) => item.first);
  }

  /**
   * Zieht das nächste Ereignis und merkt es als offen vor. Bewusst **ohne**
   * neuen Termin — den setzt erst `acknowledge()`.
   */
  draw(): RandomEvent | null {
    if (!this.enabled) return null;

    const state = this.store.current;
    const pinned = this.pinned;

    // Das gesetzte Ereignis eröffnet den Lauf. Solche Aufgaben laufen über die
    // ganze Strecke ("sammelt Kronkorken") — sie müssen früh bekannt sein und
    // ergeben später kein zweites Mal Sinn.
    if (pinned && state.eventsShown === 0) {
      this.store.update({
        eventLastId: pinned.id,
        eventPendingId: pinned.id,
        eventsShown: 1,
      });
      return pinned;
    }

    // Alles außer dem gesetzten Ereignis wandert in den Beutel.
    const drawable = this.config.items.filter((item) => item !== pinned);
    const known = new Set(drawable.map((item) => item.id));
    // Gespeicherte IDs gegen die Config prüfen: Wer Events aus der Config
    // entfernt, hätte sonst Karteileichen im Beutel.
    let bag = state.eventBag.filter((id) => known.has(id));

    if (bag.length === 0) {
      bag = shuffle(
        drawable.map((item) => item.id),
        this.random,
      );
      // Am Rundenwechsel darf nicht zweimal dasselbe kommen.
      if (bag.length > 1 && bag[0] === state.eventLastId) {
        [bag[0], bag[1]] = [bag[1] as string, bag[0] as string];
      }
    }

    const id = bag.shift();
    if (id === undefined) {
      // Nur ein gesetztes Ereignis konfiguriert und das ist durch: Termin
      // stilllegen, statt bei jedem Takt erneut ins Leere zu greifen.
      this.store.update({ eventDueAt: 0 });
      return null;
    }
    const event = this.config.items.find((item) => item.id === id) ?? null;

    this.store.update({
      eventBag: bag,
      eventLastId: id,
      eventPendingId: id,
      eventsShown: state.eventsShown + 1,
    });
    return event;
  }
}
