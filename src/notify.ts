import type { AlertConfig } from './types';

/**
 * Bündelt Ton, Vibration und Benachrichtigung zu einem Alarm. Jeder Kanal darf
 * einzeln fehlschlagen — kein Gerät kann alle drei:
 *
 * - Ton läuft überall, braucht aber eine vorherige Nutzergeste (Autoplay-Sperre).
 * - `navigator.vibrate` gibt es auf Android, iOS Safari kennt die API nicht.
 * - Benachrichtigungen zeigt iOS nur für Seiten, die über "Zum Home-Bildschirm"
 *   installiert wurden; in einem normalen Safari-Tab fehlt `window.Notification`.
 */
export class Alerter {
  private audio: AudioContext | null = null;

  constructor(private readonly config: AlertConfig) {}

  /**
   * Muss aus einem Klick-Handler heraus laufen: Browser erlauben Audio erst
   * nach einer Nutzergeste. Aufgerufen beim Login, lange vor der ersten Station.
   */
  unlockAudio(): void {
    if (!this.config.sound || this.audio) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.audio = new Ctor();
      void this.audio.resume();
    } catch {
      this.audio = null;
    }
  }

  get notificationsAvailable(): boolean {
    return this.config.notification && 'Notification' in window;
  }

  get notificationsGranted(): boolean {
    return this.notificationsAvailable && Notification.permission === 'granted';
  }

  get notificationsDecided(): boolean {
    return !this.notificationsAvailable || Notification.permission !== 'default';
  }

  /** Muss aus einer Nutzergeste heraus aufgerufen werden. */
  async requestNotifications(): Promise<boolean> {
    if (!this.notificationsAvailable) return false;
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
    this.notify(title, body);
  }

  /** Nur Benachrichtigung, ohne Ton und Vibration (für die Erinnerung). */
  notify(title: string, body: string): void {
    if (!this.notificationsGranted) return;
    try {
      const notification = new Notification(title, {
        body,
        icon: `${import.meta.env.BASE_URL}icon-192.png`,
        badge: `${import.meta.env.BASE_URL}icon-192.png`,
        tag: 'kastenlauf',
        requireInteraction: true,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // Manche Browser werfen, wenn Notifications nur über einen Service
      // Worker erlaubt sind. Ton und Vibration reichen dann auch.
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
