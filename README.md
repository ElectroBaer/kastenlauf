# Bierkastenlauf

Eine Web-App für einen Bierkastenlauf als "Die drei ???"-Detektivgeschichte. Das Team
läuft von einem Start- zu einem Zielpunkt; unterwegs löst die GPS-Position der Reihe nach
Stationen aus. Jede Station zeigt einen Story-Teil, dann eine Aufgabe, dann den zweiten
Story-Teil — anschließend geht es zurück auf die Karte. Am Ziel folgt die Auflösung.

Kein Backend, kein Login-Server: eine statische Seite, die auf GitHub Pages liegt.
Der Spielstand steckt im `localStorage` des Geräts und übersteht Reloads.

Die Oberfläche ist bewusst hell gehalten und auf Ablesbarkeit bei Sonne ausgelegt —
alle Textfarben liegen deutlich über den Kontrastwerten, die die WCAG fordert. Ein
Dark Mode ist nicht vorgesehen: draußen gewinnt die helle Variante, auch wenn das
Handy systemweit auf dunkel steht.

## Los geht's

```bash
npm install
npm run dev          # http://localhost:5173/kastenlauf/
npm run build        # Typprüfung + Produktions-Build nach dist/
npm run preview      # gebaute Version lokal ansehen
```

Das Passwort ist **`schnickschnackkrautsalat`** (ändern siehe unten).

## Alles Anpassbare: `public/config.json`

Route, Passwort und die komplette Story stehen in einer einzigen Datei. Nach dem
Bearbeiten reicht ein Reload, es muss nichts neu generiert werden.

### Start- und Zielpunkt

```json
"route": {
  "start":  { "lat": 48.1371, "lng": 11.5754, "label": "Start" },
  "finish": { "lat": 48.1500, "lng": 11.6000, "label": "Ziel" }
},
"triggerRadiusMeters": 40
```

Aktuell stehen dort **Platzhalter** (München, Marienplatz → Englischer Garten). Koordinaten
bekommt man z. B. über einen Rechtsklick in Google Maps oder OpenStreetMap.

`triggerRadiusMeters` legt fest, wie nah das Team an eine Station herankommen muss. 40 m ist
ein guter Startwert: eng genug, um sich wie ein echter Zielpunkt anzufühlen, weit genug für
die übliche GPS-Ungenauigkeit in der Stadt. Zwischen Häuserschluchten lieber 60–80 m.

### Stationen verteilen

Die 8 Stationen werden automatisch gleichmäßig auf der Luftlinie zwischen Start und Ziel
verteilt (Station *i* von *n* bei `i/(n+1)`). Wer eine Station lieber an einem bestimmten
Ort haben möchte — an einem Brunnen, einer Bank, einer Kreuzung — trägt bei ihr Koordinaten
ein; alle anderen bleiben automatisch verteilt:

```json
"coords": { "lat": 48.1402, "lng": 11.5810 }
```

### Alarm bei Stationsankunft

```json
"alerts": {
  "sound": true,
  "vibrate": true,
  "notification": true,
  "reminderAfterMinutes": 10
}
```

Erreicht das Team eine Station, meldet sich das Handy mit einem kurzen Ton, Vibration
und einer Benachrichtigung — praktisch, wenn es in der Hosentasche steckt. Die
Berechtigung für Benachrichtigungen wird nach dem Intro einmal erfragt und lässt sich
später über **☰ → Benachrichtigungen einschalten** nachholen.

`reminderAfterMinutes` steuert die Erinnerung, wenn die App länger weggelegt wurde
(`0` schaltet sie ab). Was die kann und was nicht, steht unter
[Grenzen im Hintergrund](#grenzen-im-hintergrund).

Was auf welchem Gerät ankommt:

| | Ton | Vibration | Benachrichtigung |
| --- | --- | --- | --- |
| Android (Chrome) | ✅ | ✅ | ✅ |
| iPhone (Safari, normaler Tab) | ✅ | ❌ | ❌ |
| iPhone (zum Home-Bildschirm hinzugefügt) | ✅ | ❌ | ✅ |

Vibration kennt iOS Safari nicht, daran lässt sich nichts ändern.

**Auf dem iPhone gibt es Benachrichtigungen ausschließlich in der installierten
Web-App.** In einem normalen Safari-Tab existiert die Notification-API gar nicht —
die App fragt dort also nicht nach der Berechtigung, sondern erklärt im Menü unter
*Benachrichtigungen einschalten*, wie sich das ändern lässt. Siehe
[Auf dem Handy installieren](#auf-dem-handy-installieren).

Und noch eine iOS-Eigenheit, die im Code steckt: Safari kennt den
`new Notification(...)`-Konstruktor nicht, sondern zeigt Benachrichtigungen nur über
`ServiceWorkerRegistration.showNotification()`. Genau dafür — und für nichts anderes —
gibt es `public/sw.js`. Der Service Worker **cacht bewusst nichts**, damit eine
kurzfristige Änderung an Story oder Koordinaten am Spieltag garantiert ankommt.

## Das Menü (☰)

Auf dem Kartenscreen oben rechts:

| Eintrag | Was er tut |
| --- | --- |
| **Display anlassen** | Hält den Bildschirm wach, damit sich das Handy nicht sperrt und die Ortung weiterläuft. **Standardmäßig aus**, weil es ordentlich Akku zieht. Die Einstellung bleibt über Reloads erhalten. |
| **Benachrichtigungen einschalten** | Fragt die Berechtigung an; auf dem iPhone erklärt der Eintrag stattdessen, dass die App dafür auf dem Home-Bildschirm liegen muss. Verschwindet, sobald erteilt. |
| **Station manuell starten** | Notausgang, wenn das GPS streikt: öffnet die nächste Station sofort. |
| **Spielstand zurücksetzen** | Löscht den Fortschritt, zurück zum Intro. Login und Geräte-Einstellungen bleiben. |
| **Abmelden** | Zurück zur Passwort-Seite. **Der Spielstand bleibt erhalten** — nach dem Anmelden geht es genau dort weiter. |

### Passwort ändern

```bash
npm run hash -- meinNeuesPasswort
```

Der ausgegebene Hash kommt nach `auth.passwordHash`. Das Passwort selbst steht nirgends im
Repo.

Ein geändertes Passwort greift auch auf Geräten, die schon entsperrt waren: Die App merkt
sich im Spielstand, gegen welchen Hash zuletzt entsperrt wurde, und fragt bei einer
Abweichung erneut. Der Spielfortschritt bleibt dabei stehen. Ohne diesen Abgleich bliebe
ein einmal entsperrtes Handy dauerhaft offen und würde die Änderung nie bemerken.

> **Wichtig:** Das Passwort ist eine Hürde, keine Sicherheit. Weil die App kein Backend hat,
> wird `config.json` mit der ganzen Story und allen Lösungen an jedes Gerät ausgeliefert und
> lässt sich über die Entwicklerwerkzeuge des Browsers auch ohne Passwort lesen. Es hält
> zufällige Besucher:innen fern — nicht neugierige Mitspielende.

### Story und Aufgaben

Jede Station hat denselben Aufbau:

```json
{
  "id": 1,
  "title": "Station 1",
  "storyBefore": "Text vor der Aufgabe …",
  "task": {
    "type": "code",
    "prompt": "Was das Team tun soll …",
    "answers": ["7592"],
    "hint": null
  },
  "storyAfter": "Text nach der Aufgabe …",
  "coords": null
}
```

- `type: "code"` — Eingabefeld mit Lösungsprüfung. Alle Einträge in `answers` werden
  akzeptiert. Verglichen wird normalisiert, also ohne Rücksicht auf Groß-/Kleinschreibung,
  Satzzeichen, Umlaute und Leerzeichen: `E. Skinner Norris`, `e skinner norris` und
  `ESkinnerNorris` gelten alle als richtig.
- `type: "acknowledge"` — für Aufgaben ohne Lösungswort (Video-, Geschicklichkeits- und
  Teamaufgaben). Es erscheint nur ein "Aufgabe erledigt"-Button.
- `hint` — optionaler Tipp; ist er gesetzt, erscheint ein "Tipp anzeigen"-Button.

Im Text funktionieren Absätze (Leerzeile), `*kursiv*` und `**fett**`.

Stationen lassen sich hinzufügen oder streichen — die Verteilung auf der Karte passt sich
automatisch an. Nur `id` muss eindeutig bleiben.

`story.md` bleibt als lesbare Fassung im Repo. Es wird zur Laufzeit **nicht** gelesen;
Quelle der Wahrheit ist `config.json`. Wer die Story komplett neu schreibt, kann sie mit
`node tools/story-to-config.mjs --force` erneut übertragen — das überschreibt allerdings
Koordinaten und Passwort-Hash in `config.json`.

## Testen ohne durch die Stadt zu laufen

`?debug=1` an die URL hängen, also z. B. `http://localhost:5173/kastenlauf/?debug=1`.
Unten erscheint ein Panel mit einem Regler, der eine simulierte Position entlang der Route
schiebt — damit lässt sich der komplette Lauf am Schreibtisch durchspielen. "GPS" schaltet
zurück auf das echte Signal, "Station auslösen" springt direkt in die nächste Station.

Im normalen Spiel gibt es zusätzlich unter **☰ → Station manuell starten** einen Notausgang,
falls am Spieltag das GPS streikt.

Standortzugriff funktioniert nur über HTTPS oder `localhost`. GitHub Pages liefert HTTPS,
also passt das. Wer auf dem Handy gegen den Dev-Server testen will, braucht deshalb einen
Tunnel (z. B. `ngrok`) — über die nackte lokale IP verweigern die Browser den Standort.

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` baut und veröffentlicht bei jedem Push auf `main`.

**Einmalig nötig:** in den Repo-Einstellungen unter **Settings → Pages → Build and
deployment → Source** auf **GitHub Actions** stellen. Ohne das läuft der Workflow ins Leere.

Danach liegt die App unter `https://<user>.github.io/kastenlauf/`. Der Unterpfad steht als
`base` in `vite.config.ts` — bei eigener Domain oder einer User-Page dort auf `'/'` ändern.

Über **Actions → Deploy to GitHub Pages → Run workflow** lässt sich auch von einem anderen
Branch aus deployen, etwa für eine Generalprobe vor dem Merge.

## Auf dem Handy installieren

Die App bringt ein Web-App-Manifest mit und lässt sich auf den Home-Bildschirm legen:

- **iPhone:** Safari → Teilen-Symbol → *Zum Home-Bildschirm*.
- **Android:** Chrome → ⋮ → *App installieren* bzw. *Zum Startbildschirm hinzufügen*.

Auf dem iPhone ist das **Voraussetzung für Benachrichtigungen** — in einem normalen
Safari-Tab gibt es die schlicht nicht. Die App weist beim ersten Start selbst darauf
hin; danach lässt sich die Berechtigung über **☰ → Benachrichtigungen einschalten**
erteilen. Nebenbei läuft die App dann ohne Browserleiste, was auf dem kleinen Display
spürbar mehr Platz für die Karte lässt.

Wichtig: Nach dem Hinzufügen die App **vom Home-Bildschirm aus** starten, nicht weiter
den Safari-Tab benutzen — sonst ändert sich nichts.

Die Icons liegen als PNG in `public/`. Wer ein eigenes will, ersetzt sie einfach — oder
passt `tools/make-icons.mjs` an und lässt sie neu erzeugen (`node tools/make-icons.mjs`).

## Grenzen im Hintergrund

Kurz gesagt: **Solange das Display aus ist, ortet die App nicht.** Das ist keine
Nachlässigkeit, sondern eine harte Grenze des Web-Plattform — Service Worker haben
gar keinen Zugriff auf die Geolocation-API, die Geofencing-API wurde nie ausgeliefert,
und Browser frieren versteckte Seiten samt ihrer Timer nach kurzer Zeit ein. Nur native
Apps dürfen das. Ein Backend würde daran nichts ändern.

Was die App stattdessen tut:

1. **Nachprüfen beim Zurückkommen** — sobald jemand das Handy wieder entsperrt und die
   App im Vordergrund ist, wird sofort die aktuelle Position geholt. Ist das Team mit
   dunklem Display an einer Station vorbeigelaufen, ploppt sie in genau diesem Moment
   auf. Nichts geht verloren, es kommt nur später.
2. **Alarm im Hintergrund, solange die Seite noch lebt** — wechselt jemand nur kurz in
   eine andere App, läuft die Ortung meist weiter und der Alarm kommt sofort.
3. **Erinnerung nach längerer Pause** — nach `reminderAfterMinutes` meldet sich das
   Handy mit *"Der Fall wartet!"*. Das ist ein Bonus, kein Versprechen: ob der Browser
   die Seite so lange am Leben lässt, entscheidet er selbst. Klappt es nicht, erscheint
   der Hinweis beim nächsten Öffnen in der App.

**Praktischer Rat für den Spieltag:** Im Menü **Display anlassen** einschalten und die App
offen lassen. Dann sperrt sich das Handy nicht, die Ortung läuft durch und die Stationen
kommen so, wie sie sollen — kostet aber spürbar Akku, also Powerbank einpacken. Alternativ
oder zusätzlich die Bildschirmsperre im System hochsetzen (iOS: *Einstellungen → Anzeige &
Helligkeit → Automatische Sperre → Nie*, Android: *Einstellungen → Display →
Bildschirm-Timeout*).

## Am Spieltag

- Karte und Story werden beim ersten Laden geholt; die **Kartenkacheln kommen unterwegs
  laufend nach** und brauchen Mobilfunk. Ohne Empfang bleibt die Karte leer — Stationen
  lösen aber trotzdem aus, weil GPS ohne Netz funktioniert.
- Der Spielstand hängt an Gerät und Browser. Ein Team spielt auf **einem** Telefon; im
  privaten Modus geht der Fortschritt beim Schließen verloren.
- Akku: Dauerhaftes GPS bei angeschaltetem Display zieht ordentlich. Powerbank einpacken.

## Aufbau

```
public/config.json    Route, Passwort-Hash, Alarm-Einstellungen, komplette Story
public/manifest.webmanifest  Web-App-Manifest für die Installation
public/sw.js          Service Worker — nur für Benachrichtigungen auf iOS, kein Cache
src/main.ts           Spielablauf, Phasenwechsel, Stations-Trigger, Hintergrund-Logik
src/geo.ts            Haversine, Stationsverteilung, watchPosition
src/notify.ts         Ton, Vibration, Benachrichtigungen
src/wakelock.ts       Display wachhalten (Screen Wake Lock)
src/state.ts          Spielstand im localStorage
src/config.ts         Laden und Prüfen der Config
src/auth.ts           SHA-256-Passwortprüfung
src/screens/          Login, Karte, Story, Aufgabe
src/debug.ts          Positionssimulator (?debug=1)
tools/hash-password.mjs    Passwort-Hash erzeugen
tools/make-icons.mjs       App-Icons erzeugen
tools/story-to-config.mjs  story.md → config.json (einmalig)
```
