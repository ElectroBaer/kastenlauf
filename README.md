# Bierkastenlauf

Eine Web-App für einen Bierkastenlauf als "Die drei ???"-Detektivgeschichte. Das Team
läuft von einem Start- zu einem Zielpunkt; unterwegs löst die GPS-Position der Reihe nach
Stationen aus. Jede Station zeigt einen Story-Teil, dann eine Aufgabe, dann den zweiten
Story-Teil — anschließend geht es zurück auf die Karte. Am Ziel folgt die Auflösung.
Dazwischen platzen in unregelmäßigen Abständen
[Zufallsereignisse](#zufallsereignisse) herein.

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

## Alles Anpassbare: `public/config.json`

Route, Passwort, Zufallsereignisse und die komplette Story stehen in einer einzigen
Datei. Nach dem Bearbeiten reicht ein Reload, es muss nichts neu generiert werden.

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

### Wann eine Station auslöst

Nicht an einem festen Punkt, sondern **sobald die Restentfernung zum Ziel klein genug
wird**. Man kann sich das als konzentrische Ringe um den Zielpunkt vorstellen: Station 1
liegt weit außen, Station 8 kurz vor dem Ziel, und das Team durchquert sie beim
Näherkommen der Reihe nach.

Der Grund: Ein fester Punkt auf der Luftlinie wird verfehlt, sobald der Weg nicht
schnurgerade verläuft — und Straßen verlaufen nun mal nicht schnurgerade. Einen Ring um
das Ziel durchquert man dagegen auf **jeder** Route.

Bei `n` Stationen und einer Luftlinie von `D` Metern löst Station *i* aus, sobald weniger
als `D · (n+1−i) / (n+1)` Meter bis zum Ziel übrig sind. Für die aktuelle Route (4,0 km,
8 Stationen) heißt das: Station 1 bei 3553 m Restentfernung, Station 2 bei 3109 m, …,
Station 8 bei 444 m. Die Abstände entsprechen genau der Aufteilung der Strecke — nur ist
es egal, auf welchem Weg ihr näher kommt.

**Mehrere Stationen auf einmal.** Wer die App eine Weile in der Tasche hatte und dabei
mehrere Ringe überschritten hat, bekommt die Stationen nacheinander in der richtigen
Reihenfolge nachgereicht. Das Popup sagt dann auch, wie viele noch offen sind.

Die Karte zeigt immer nur den **nächsten** Ring als Kreis um das Ziel — die Linie, in die
ihr hineinlaufen müsst. Die Statuszeile nennt die Meter bis dorthin, nicht die Luftlinie
zum Ziel.

#### Einzelne Stationen anders auslösen

Zwei optionale Felder pro Station, beide dürfen **nicht gleichzeitig** gesetzt sein (die
App lehnt das mit einer Fehlermeldung ab):

```json
"remainingMeters": 800
```

Eigener Ring: *"Diese Station auslösen, sobald weniger als 800 m bis zum Ziel übrig
sind."* Die Werte sollten über die Stationen hinweg kleiner werden, sonst rücken frühere
Stationen mit auf (siehe Überholschutz unten).

```json
"coords": { "lat": 48.1402, "lng": 11.5810 }
```

Fester Punkt, wie gehabt über `triggerRadiusMeters` — für Stationen, die zwingend an einen
bestimmten Ort gehören. **Mit Bedacht einsetzen:** Genau so eine Station kann verfehlt
werden, wenn die Route nicht daran vorbeiführt.

Damit daraus keine Sackgasse wird, gibt es einen **Überholschutz**: Eine Station gilt auch
dann als fällig, wenn eine spätere Station fällig ist. Wer an einem festen Punkt
vorbeiläuft, ohne ihn zu treffen, bekommt die Station also spätestens beim nächsten Ring
nachgereicht, statt für immer festzuhängen.

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

### Zufallsereignisse

Zwischen den Stationen kommen Einwürfe aus der Story dazwischen — ein Shot, eine
Tanzpause, 50 m rückwärts laufen. Sie stehen in der Config und lassen sich beliebig
erweitern:

```json
"randomEvents": {
  "enabled": true,
  "minMinutes": 20,
  "maxMinutes": 40,
  "firstAfterMinutes": 5,
  "cooldownSeconds": 60,
  "items": [
    {
      "id": "zwischenmusik",
      "title": "Zwischenmusik",
      "text": "*Funky drei ??? Zwischenmusik*. 1 min Tanzpause!"
    }
  ]
}
```

Für ein neues Ereignis reicht ein weiterer Eintrag in `items` — `id` muss eindeutig
sein, `text` darf dieselben Auszeichnungen wie die Story benutzen (`**fett**`,
`*kursiv*`, Leerzeile = neuer Absatz).

**Ausgelöst wird nach Zeit, nicht nach Strecke.** Nach jedem Ereignis wird die
Wartezeit bis zum nächsten neu ausgewürfelt, gleichverteilt zwischen `minMinutes` und
`maxMinutes`. Das ist bewusst kein Wahrscheinlichkeitswurf pro Zeittakt: Der ergäbe
eine Exponentialverteilung, also mal drei Ereignisse kurz hintereinander und dann eine
halbe Stunde nichts. Zeit statt Strecke, weil die Stationen über die Ringe schon an
der Entfernung hängen und ein Kastenlauf die meiste Zeit steht — genau dann ist ein
Einwurf am willkommensten.

Ausgewählt wird per **Beutel**: Alle Ereignisse werden gemischt und der Reihe nach
gezogen; erst wenn alle dran waren, wird neu gemischt. So wiederholt sich nichts,
solange noch etwas Ungesehenes übrig ist, und auch am Rundenwechsel kommt nicht
zweimal dasselbe.

Ein Ereignis unterbricht **nie** einen Stationstext oder ein Stations-Popup. Ist der
Bildschirm belegt, bleibt der Termin einfach stehen; zurück auf der Karte kommt es
nach `cooldownSeconds` nach. Umgekehrt wartet auch eine fällige Station, bis das
Ereignis weggetippt ist.

**Es kommt immer nur eines, nie eine Salve.** Der Termin ist ein einzelner
Zeitstempel, kein Zähler — war die App zwei Stunden geschlossen, ist trotzdem genau
ein Ereignis fällig. Und die Wartezeit für das nächste beginnt erst, wenn das Team das
aktuelle mit „Erledigt" abgerufen hat, nicht schon beim Erscheinen. Ein Ereignis, das
niemand weggetippt hat, bleibt offen und steht nach einem Reload wieder da; erst
danach läuft die Uhr weiter.

Der Termin steht als Uhrzeit im Spielstand. Ein Reload verschiebt also nichts, und
was fällig wurde, während das Handy in der Tasche steckte, kommt beim Zurückkommen
sofort. `"enabled": false` oder eine leere `items`-Liste schaltet alles ab.

`events.md` ist — wie `story.md` — nur die lesbare Fassung im Repo und wird zur
Laufzeit nicht geladen. Maßgeblich ist `config.json`.

## Das Menü (☰)

Oben rechts erreichbar — auf der Karte **und** während der Stationstexte, damit man
nicht erst einen Text zu Ende klicken muss, um etwas umzustellen.

| Eintrag | Was er tut |
| --- | --- |
| **Display anlassen** | Hält den Bildschirm wach, damit sich das Handy nicht sperrt und die Ortung weiterläuft. **Standardmäßig aus**, weil es ordentlich Akku zieht. Die Einstellung bleibt über Reloads erhalten. Achtmal schnell antippen schaltet den [Debug-Modus](#testen-ohne-durch-die-stadt-zu-laufen) um. |
| **Benachrichtigungen einschalten** | Fragt die Berechtigung an; auf dem iPhone erklärt der Eintrag stattdessen, dass die App dafür auf dem Home-Bildschirm liegen muss. Verschwindet, sobald erteilt. |
| **Station manuell starten** | Notausgang, wenn das GPS streikt: öffnet die nächste Station sofort. Nur auf der Karte — während eines Stationstextes gäbe es nichts auszulösen. |
| **Spielstand zurücksetzen** | Löscht den Fortschritt, zurück zum Intro. Login und Geräte-Einstellungen bleiben; im Debug-Modus gesetzte Testkoordinaten werden verworfen. |

Darunter, abgesetzt und kursiv-rot, die **Debug-Werkzeuge** — nur sichtbar, wenn der
Debug-Modus an ist. So kann das spielende Team sie nicht versehentlich erwischen:

| Eintrag | Was er tut |
| --- | --- |
| ***Ereignis auslösen*** | Ruft das nächste [Zufallsereignis](#zufallsereignisse) sofort ab, ohne auf den Termin zu warten — das Gegenstück zu „Station manuell starten". Wie dieses nur auf der Karte. |
| ***Start/Ziel ändern*** | Koordinaten für eine Testroute setzen. |
| ***Abmelden und alles löschen*** | Der harte Reset: löscht **alles** Gespeicherte — Fortschritt, Login, Einstellungen, Testkoordinaten und das Debug-Flag — und führt zurück zur Passwort-Seite. Weil das Debug-Flag mit weg ist, ist danach auch der Debug-Modus aus; mit `?debug=1` oder acht Taps ist er sofort zurück. |

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
    "answers": ["1234"],
    "hint": null
  },
  "storyAfter": "Text nach der Aufgabe …",
  "remainingMeters": null,
  "coords": null
}
```

- `type: "code"` — Eingabefeld mit Lösungsprüfung. Alle Einträge in `answers` werden
  akzeptiert. Verglichen wird normalisiert, also ohne Rücksicht auf Groß-/Kleinschreibung,
  Satzzeichen, Umlaute und Leerzeichen: `J. Jonas`, `j jonas` und
  `JJonas` gelten alle als richtig.
- `type: "acknowledge"` — für Aufgaben ohne Lösungswort (Video-, Geschicklichkeits- und
  Teamaufgaben). Es erscheint nur ein "Aufgabe erledigt"-Button.
- `hint` — optionaler Tipp; ist er gesetzt, erscheint ein "Tipp anzeigen"-Button.

Im Text funktionieren Absätze (Leerzeile), `*kursiv*` und `**fett**`.

Stationen lassen sich hinzufügen oder streichen — die Ringe verteilen sich automatisch neu.
Nur `id` muss eindeutig bleiben.

`story.md` bleibt als lesbare Fassung im Repo. Es wird zur Laufzeit **nicht** gelesen;
Quelle der Wahrheit ist `config.json`. Wer die Story komplett neu schreibt, kann sie mit
`node tools/story-to-config.mjs --force` erneut übertragen — das überschreibt allerdings
Koordinaten und Passwort-Hash in `config.json`.

## Testen ohne durch die Stadt zu laufen

Zwei Wege hinein: `?debug=1` an die URL hängen (z. B.
`http://localhost:5173/kastenlauf/?debug=1`), oder — praktischer auf dem Handy —
**achtmal schnell hintereinander auf ☰ → „Display anlassen" tippen**. Das Menü bleibt
dabei offen, ein Hinweis bestätigt das Umschalten, und der Zustand übersteht einen Reload.
Nochmal achtmal tippen schaltet wieder aus.

Die Taps schalten nebenbei ganz normal den Wake Lock um; da acht eine gerade Zahl ist,
steht die Einstellung hinterher wieder so wie vorher. Eine Pause von mehr als 800 ms setzt
die Zählung zurück, normales Bedienen des Schalters löst also nichts aus.
Als eigener Bereich unter der Oberfläche erscheint ein Panel mit einem Regler, der eine
simulierte Position entlang der Route schiebt — damit lässt sich der komplette Lauf am
Schreibtisch durchspielen. "GPS" schaltet zurück auf das echte Signal, "Station auslösen"
springt direkt in die nächste Station, "Ereignis auslösen" zieht sofort ein
[Zufallsereignis](#zufallsereignisse), ohne auf den Termin zu warten — dasselbe gibt es
als Menüeintrag **☰ → *Ereignis auslösen***, für Tests auf dem Handy ohne Panel. Das
Spielfeld darüber wird entsprechend kleiner, das Panel überdeckt also nie Eingabefelder
oder Buttons.

Zusätzlich gibt es im Debug-Modus **☰ → Start/Ziel ändern**: vier Felder für die
Koordinaten, mit denen sich eine kurze Testroute vor der Haustür einrichten lässt, statt
die echte Strecke ablaufen zu müssen. Nach dem Übernehmen lädt die Seite neu, damit
Ringabstände, Karte und Regler garantiert zusammenpassen.

> Diese Testkoordinaten gelten **auch ohne `?debug=1`** — nur so lässt sich eine Testroute
> unter realen Bedingungen durchspielen. Damit das nie unbemerkt bleibt, steht dann
> dauerhaft „⚠ Testkoordinaten aktiv" in der Statuszeile der Karte.
> **☰ → Spielstand zurücksetzen** holt die Koordinaten aus der Config zurück.

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
public/config.json    Route, Passwort-Hash, Alarm-Einstellungen, Zufallsereignisse, Story
public/manifest.webmanifest  Web-App-Manifest für die Installation
public/sw.js          Service Worker — nur für Benachrichtigungen auf iOS, kein Cache
src/main.ts           Spielablauf, Phasenwechsel, Stations-Trigger, Hintergrund-Logik
src/geo.ts            Haversine, Stationsverteilung, watchPosition
src/events.ts         Zufallsereignisse: Terminplan und Beutel
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
