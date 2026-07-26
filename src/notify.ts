import type { AlertConfig } from './types';

/**
 * In welchem Zustand die Benachrichtigungen auf diesem Gerät sind. Wichtig ist
 * die Unterscheidung zwischen "kann das Gerät nicht" und "muss erst installiert
 * werden" — sonst steht die Oberfläche stumm da und niemand weiß, warum nichts
 * passiert.
 */
export type NotificationState =
  | 'off' // in der Config abgeschaltet
  | 'unsupported' // Browser kann keine Benachrichtigungen
  | 'needsInstall' // iOS: erst als Web-App auf dem Home-Bildschirm möglich
  | 'default' // noch nicht gefragt
  | 'granted'
  | 'denied';

/** Läuft die Seite als installierte Web-App statt im Browser-Tab? */
function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Safari-eigene Variante, die es nur auf iOS gibt.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS meldet sich seit einigen Versionen als Mac mit Touchscreen.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Bündelt Ton, Vibration und Benachrichtigung zu einem Alarm. Jeder Kanal darf
 * einzeln fehlschlagen — kein Gerät kann alle drei:
 *
 * - Ton läuft überall, braucht aber eine vorherige Nutzergeste (Autoplay-Sperre).
 * - `navigator.vibrate` gibt es auf Android, iOS Safari kennt die API nicht.
 * - Benachrichtigungen zeigt iOS nur in Web-Apps, die auf dem Home-Bildschirm
 *   liegen — und dort ausschließlich über den Service Worker.
 */
export class Alerter {
  private audio: AudioContext | null = null;
  private registration: ServiceWorkerRegistration | null = null;

  constructor(private readonly config: AlertConfig) {}

  /**
   * Registriert den Service Worker. Der wird auf iOS gebraucht, um überhaupt
   * eine Benachrichtigung anzeigen zu können; auf anderen Systemen ist er ein
   * netter Bonus (die Benachrichtigung überlebt dort das Schließen des Tabs).
   */
  async registerServiceWorker(scope: string): Promise<void> {
    if (!('serviceWorker' in navigator)) return;
    try {
      this.registration = await navigator.serviceWorker.register(`${scope}sw.js`, { scope });
    } catch {
      // Ohne Service Worker bleibt der direkte Weg über den Konstruktor.
      this.registration = null;
    }
  }

  /**
   * Muss aus einem Klick-Handler heraus laufen: Browser erlauben Audio erst
   * nach einer Nutzergeste. Aufgerufen beim Login, lange vor der ersten Station.
   */
  unlockAudio(): void {
    if (!this.config.sound || this.audio) return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.audio = new Ctor();
      void this.audio.resume();
    } catch {
      this.audio = null;
    }
  }

  get state(): NotificationState {
    if (!this.config.notification) return 'off';
    if (!('Notification' in window)) {
      // Auf iOS fehlt Notification im normalen Safari-Tab komplett — dort ist
      // das kein "geht nicht", sondern ein "erst installieren".
      return isIos() && !isStandalone() ? 'needsInstall' : 'unsupported';
    }
    return Notification.permission as 'default' | 'granted' | 'denied';
  }

  get granted(): boolean {
    return this.state === 'granted';
  }

  /** Muss aus einer Nutzergeste heraus aufgerufen werden. */
  async requestPermission(): Promise<boolean> {
    if (this.state !== 'default') return this.granted;
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  /** Voller Alarm: Ton, Vibration und — falls erlaubt — eine Benachrichtigung. */
  fire(title: string, body: string): void {
    this.playChime();
    this.vibrate([200, 100, 200, 100, 300]);
    void this.notify(title, body);
  }

  /** Nur Benachrichtigung, ohne Ton und Vibration (für die Erinnerung). */
  async notify(title: string, body: string): Promise<void> {
    if (!this.granted) return;
    const options: NotificationOptions = {
      body,
      icon: `${import.meta.env.BASE_URL}icon-192.png`,
      badge: `${import.meta.env.BASE_URL}icon-192.png`,
      tag: 'kastenlauf',
      requireInteraction: true,
    };

    // Erst der Service Worker: iOS kennt den Konstruktor unten gar nicht und
    // wirft dort einen TypeError.
    const registration = this.registration ?? (await this.readyRegistration());
    if (registration) {
      try {
        await registration.showNotification(title, options);
        return;
      } catch {
        // Fällt unten auf den direkten Weg zurück.
      }
    }

    try {
      new Notification(title, options);
    } catch {
      // Ton und Vibration sind dann die einzige Rückmeldung.
    }
  }

  private async readyRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    try {
      return await navigator.serviceWorker.ready;
    } catch {
      return null;
    }
  }

  private vibrate(pattern: number[]): void {
    if (!this.config.vibrate || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Manche Browser blockieren Vibration ohne vorherige Interaktion.
    }
  }

  /** Kurzer Zweiklang, synthetisiert — keine Audiodatei nötig. */
  private playChime(): void {
    if (!this.config.sound) return;
    this.unlockAudio();
    const ctx = this.audio;
    if (!ctx) return;
    void ctx.resume();

    const now = ctx.currentTime;
    [
      { freq: 880, at: 0 },
      { freq: 1320, at: 0.18 },
    ].forEach(({ freq, at }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      // Weiche Hüllkurve — ein harter Rechteck-Einsatz knackt hörbar.
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(0.35, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + at + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.55);
    });
  }
}
