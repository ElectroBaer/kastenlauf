/**
 * Passwort-Gate.
 *
 * ACHTUNG — das ist bewusst nur eine Hürde, keine Sicherheit: Die App hat kein
 * Backend, also werden config.json samt Story und Lösungen ohnehin an jedes
 * Gerät ausgeliefert und sind über die Entwicklerwerkzeuge einsehbar. Der
 * Hash-Vergleich hält Zufallsbesucher fern, nicht neugierige Mitspielende.
 */
export async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function checkPassword(password: string, expectedHash: string): Promise<boolean> {
  const actual = await hashPassword(password.trim());
  return actual === expectedHash.toLowerCase();
}
