# Fotoarchiv PWA 4.1.0

Diese Version ist für **GitHub Pages + Android/Chrome** vorbereitet.

## Architektur

- **GitHub Pages**: liefert nur den PWA-Programmcode aus.
- **Google Drive**: enthält die Originalfotos.
- **IndexedDB auf dem Tablet**: enthält Tags, Favoriten, Fotoabende und Vorschaubilder.
- **Cloudflare Worker**: tauscht ausschließlich den Google-OAuth-Autorisierungscode gegen einen kurzlebigen Zugriffstoken aus.
- **Google Client Secret**: liegt nur als Cloudflare-Secret im Worker und niemals in diesem Repository.

## Schnellstart

1. Repository anlegen und den Inhalt dieses Ordners hochladen.
2. GitHub Pages aktivieren: `Settings → Pages → Deploy from a branch → main → / (root)`.
3. Die veröffentlichte Seite `SETUP.html` öffnen.
4. Den dort angezeigten Web-Origin und die Redirect-URI in Google Cloud verwenden.
5. `worker/worker.js` als Cloudflare Worker deployen und die vier benötigten Werte setzen.
6. Client-ID und Worker-URL in `SETUP.html` auf dem Tablet speichern.
7. Fotoarchiv öffnen, Drive verbinden und installieren.

## Google-Berechtigung

Die PWA fordert nur:

`https://www.googleapis.com/auth/drive.readonly`

an. Sie kann damit Drive-Dateien lesen und herunterladen, aber nicht verändern oder löschen.

## Wichtige Sicherheitseigenschaften

- Authorization Code Flow mit PKCE (`S256`)
- CSRF-Schutz über zufälligen `state`-Wert
- Client Secret nie im Browser oder GitHub
- kein Refresh-Token im Browser
- Access Token nur in `sessionStorage`
- Worker speichert keine Tokens oder Nutzerdaten
- Worker akzeptiert nur den konfigurierten GitHub-Pages-Origin und die festgelegte Redirect-URI
- Content Security Policy in PWA und Callback-Seite

## Katalogsicherung

Vor dem Löschen von Browser-/App-Daten unbedingt in der App `⋯ → Katalog sichern` verwenden.
