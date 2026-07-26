export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoutePoint extends LatLng {
  label: string;
}

export type TaskType = 'code' | 'acknowledge';

export interface Task {
  /** `code`: Eingabefeld mit Lösungsprüfung. `acknowledge`: nur Bestätigen-Button. */
  type: TaskType;
  prompt: string;
  /** Akzeptierte Antworten; normalisiert verglichen. Leer bei `acknowledge`. */
  answers: string[];
  hint: string | null;
}

export interface Station {
  id: number;
  title: string;
  storyBefore: string;
  task: Task;
  storyAfter: string;
  /** Überschreibt die automatisch berechnete Position auf der Route. */
  coords: LatLng | null;
}

export interface StoryPart {
  title: string;
  text: string;
}

export interface AlertConfig {
  /** Kurzer Ton bei Stationsankunft. */
  sound: boolean;
  /** Vibration bei Stationsankunft (nur Android). */
  vibrate: boolean;
  /** Systembenachrichtigung bei Stationsankunft. */
  notification: boolean;
  /**
   * Minuten, nach denen im Hintergrund eine Erinnerung kommt, mal wieder auf
   * die Karte zu schauen. 0 schaltet die Erinnerung ab.
   */
  reminderAfterMinutes: number;
}

export interface Config {
  version: number;
  title: string;
  subtitle?: string;
  auth: { passwordHash: string };
  route: { start: RoutePoint; finish: RoutePoint };
  /** Abstand in Metern, ab dem eine Station ausgelöst wird. */
  triggerRadiusMeters: number;
  alerts: AlertConfig;
  intro: StoryPart;
  outro: StoryPart;
  stations: Station[];
}

/** Eine Station samt ihrer aufgelösten Position auf der Karte. */
export interface PlacedStation extends Station {
  position: LatLng;
}

/**
 * Wo im Spiel das Team gerade steht.
 * - `intro`      – Intro-Text, noch vor Station 1
 * - `map`        – Hauptscreen, unterwegs zur nächsten Station
 * - `storyBefore`– erster Textteil der aktuellen Station
 * - `task`       – Aufgabe der aktuellen Station
 * - `storyAfter` – zweiter Textteil der aktuellen Station
 * - `outro`      – Auflösung, Spiel beendet
 */
export type Phase = 'intro' | 'map' | 'storyBefore' | 'task' | 'storyAfter' | 'outro';

export interface GameState {
  stateVersion: number;
  unlocked: boolean;
  phase: Phase;
  /** Index der Station, die gerade läuft bzw. als Nächstes ansteht (0-basiert). */
  stationIndex: number;
  /** IDs bereits abgeschlossener Stationen. */
  completed: number[];
  /** Ob nach Benachrichtigungen schon gefragt wurde — damit es nicht nervt. */
  notificationsAsked: boolean;
  /** Ob der iOS-Installationshinweis schon gezeigt wurde. */
  installHintShown: boolean;
}
