/**
 * Hält das Display an, solange das Spiel läuft — sonst sperrt sich das Handy
 * nach einer Minute und die Ortung steht still, bis jemand wieder hinschaut.
 *
 * Standardmäßig aus, denn das kostet spürbar Akku. Ein- und ausschaltbar über
 * das Menü, die Einstellung liegt im Spielstand.
 */
export class WakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  get supported(): boolean {
    return 'wakeLock' in navigator;
  }

  /** Ob gerade tatsächlich ein Lock gehalten wird. */
  get active(): boolean {
    return this.sentinel !== null;
  }

  /** Ob der Lock gewünscht ist — auch wenn er im Hintergrund gerade ruht. */
  get enabled(): boolean {
    return this.wanted;
  }

  /** Fordert den Lock an. Gibt zurück, ob es geklappt hat. */
  async enable(): Promise<boolean> {
    this.wanted = true;
    return this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    await this.release();
  }

  /**
   * Beim Wechsel in den Hintergrund gibt das Betriebssystem den Lock von sich
   * aus frei — das ist so vorgesehen. Kommt die Seite zurück, muss er deshalb
   * neu angefordert werden.
   */
  async reacquireIfWanted(): Promise<void> {
    if (!this.wanted || this.sentinel || document.visibilityState !== 'visible') return;
    await this.acquire();
  }

  private async acquire(): Promise<boolean> {
    if (!this.supported || this.sentinel) return this.sentinel !== null;
    try {
      const sentinel = await navigator.wakeLock.request('screen');

      // Während des await kann längst wieder abgeschaltet worden sein — beim
      // schnellen Hin- und Herschalten passiert genau das. Dann den frisch
      // erhaltenen Lock sofort wieder hergeben, statt ihn zu behalten: sonst
      // bliebe das Display an, obwohl die Einstellung "Aus" anzeigt.
      if (!this.wanted) {
        try {
          await sentinel.release();
        } catch {
          // Schon weg — nichts zu tun.
        }
        return false;
      }

      this.sentinel = sentinel;
      // Auch das System kann den Lock jederzeit fallen lassen (Akkusparmodus,
      // Hintergrund). Dann muss das Feld wieder leer sein, damit ein späteres
      // reacquireIfWanted() erneut anfordert.
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
      return true;
    } catch {
      // Häufigster Fall: Die Seite ist gerade nicht sichtbar.
      this.sentinel = null;
      return false;
    }
  }

  private async release(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (!sentinel) return;
    try {
      await sentinel.release();
    } catch {
      // Schon freigegeben — nichts zu tun.
    }
  }
}
