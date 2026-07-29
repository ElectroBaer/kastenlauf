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
  /**
   * Eigener Ring: Restentfernung zum Ziel in Metern, ab der diese Station
   * auslöst. Ohne Angabe wird sie gleichmäßig zwischen Start und Ziel verteilt.
   */
  remainingMeters?: number | null;
  /**
   * Fester Punkt statt Ring — löst aus, wenn das Gerät näher als
   * `triggerRadiusMeters` herankommt. Nur setzen, wenn eine Station zwingend an
   * einen bestimmten Ort gehört: Anders als ein Ring lässt sich ein Punkt bei
   * ungünstiger Route verfehlen.
   */
  coords?: LatLng | null;
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

export interface RandomEvent {
  /** Eindeutig; steckt im Spielstand, damit der Beutel den Reload überlebt. */
  id: string;
  /** Kopfzeile des Popups. */
  title: string;
  /** Der Einwurf selbst. Gleiche Auszeichnung wie die Story (`*kursiv*`). */
  text: string;
}

export interface RandomEventConfig {
  enabled: boolean;
  /** Untere und obere Grenze der ausgewürfelten Wartezeit. */
  minMinutes: number;
  maxMinutes: number;
  /** Vorlauf nach dem ersten Betreten der Karte. */
  firstAfterMinutes: number;
  /**
   * Schonfrist, nachdem die Karte wieder frei ist. Verhindert, dass ein
   * aufgeschobenes Event in derselben Sekunde aufpoppt, in der ein
   * Stationstext zu Ende geht.
   */
  cooldownSeconds: number;
  items: RandomEvent[];
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
  randomEvents: RandomEventConfig;
  intro: StoryPart;
  outro: StoryPart;
  stations: Station[];
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
  /** Ob das Display während des Spiels anbleiben soll (Screen Wake Lock). */
  wakeLockEnabled: boolean;
  /**
   * Debug-Modus, umgeschaltet über acht schnelle Taps auf „Display anlassen“.
   * Wirkt zusätzlich zum URL-Parameter `?debug=1`.
   */
  debugEnabled: boolean;
  /**
   * Kurzform des Passwort-Hashes, gegen den zuletzt entsperrt wurde. Ändert
   * sich das Passwort in der Config, passt der Wert nicht mehr und das Gerät
   * fragt erneut — ohne das bliebe ein einmal entsperrtes Handy für immer offen.
   */
  authFingerprint: string;
  /**
   * Im Debug-Menü gesetzte Start-/Zielkoordinaten. Gelten auch außerhalb des
   * Debug-Modus, damit sich eine Testroute unter realen Bedingungen
   * durchspielen lässt — die Karte weist dann sichtbar darauf hin.
   * `null` = die Werte aus der Config gelten.
   */
  routeOverride: { start: LatLng; finish: LatLng } | null;
  /**
   * Uhrzeit (ms seit Epoche), zu der das nächste Zufallsevent fällig ist.
   * `0` = noch keins geplant. Bewusst ein Zeitstempel und kein Countdown: Der
   * überlebt Reload, gedrosselte Timer und eingefrorene Seiten.
   */
  eventDueAt: number;
  /**
   * Noch nicht gezogene Event-IDs der laufenden Runde. Ist der Beutel leer,
   * wird neu gemischt — so kommt jedes Event einmal dran, bevor sich etwas
   * wiederholt.
   */
  eventBag: string[];
  /** Zuletzt gezeigtes Event; verhindert Wiederholung am Rundenwechsel. */
  eventLastId: string;
  /**
   * Gezogenes, aber noch nicht abgerufenes Ereignis. Steht hier eine ID, wartet
   * das Ereignis — notfalls über einen Reload hinweg — bis das Team es
   * weggetippt hat. Erst danach beginnt die Wartezeit für das nächste.
   * `''` = keins offen.
   */
  eventPendingId: string;
  /** Wie viele Events bisher gezeigt wurden (Anzeige im Menü). */
  eventsShown: number;
}
