# Bierkastenlauf

Eine Web-App für einen Bierkastenlauf als "Die drei ???"-Detektivgeschichte. Das Team
läuft von einem Start- zu einem Zielpunkt; unterwegs löst die GPS-Position der Reihe nach
Stationen aus. Jede Station zeigt einen Story-Teil, dann eine Aufgabe, dann den zweiten
Story-Teil — anschließend geht es zurück auf die Karte. Am Ziel folgt die Auflösung.

Kein Backend, kein Login-Server: eine statische Seite, die auf GitHub Pages liegt.
Der Spielstand steckt im `localStorage` des Geräts und übersteht Reloads.

## Los geht's

```bash
npm install
npm run dev          # http://localhost:5173/kastenlauf/
npm run build        # Typprüfung + Produktions-Build nach dist/
npm run preview      # gebaute Version lokal ansehen
```

Das Standard-Passwort ist **`kastenlauf`** — vor dem Spieltag ändern (siehe unten).

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

### Passwort ändern

```bash
npm run hash -- meinNeuesPasswort
```

Der ausgegebene Hash kommt nach `auth.passwordHash`. Das Passwort selbst steht nirgends im
Repo.

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

## Am Spieltag

- Karte und Story werden beim ersten Laden geholt; die **Kartenkacheln kommen unterwegs
  laufend nach** und brauchen Mobilfunk. Ohne Empfang bleibt die Karte grau — Stationen
  lösen aber trotzdem aus, weil GPS ohne Netz funktioniert.
- Der Spielstand hängt an Gerät und Browser. Ein Team spielt auf **einem** Telefon; im
  privaten Modus geht der Fortschritt beim Schließen verloren.
- Akku: Dauerhaftes GPS zieht ordentlich. Powerbank einpacken.

## Aufbau

```
public/config.json    Route, Passwort-Hash, komplette Story
src/main.ts           Spielablauf, Phasenwechsel, Stations-Trigger
src/geo.ts            Haversine, Stationsverteilung, watchPosition
src/state.ts          Spielstand im localStorage
src/config.ts         Laden und Prüfen der Config
src/auth.ts           SHA-256-Passwortprüfung
src/screens/          Login, Karte, Story, Aufgabe
src/debug.ts          Positionssimulator (?debug=1)
tools/hash-password.mjs    Passwort-Hash erzeugen
tools/story-to-config.mjs  story.md → config.json (einmalig)
```
