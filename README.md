# Antidote

Antidote is a minimalist web app that extracts and tracks 4 indicators from MyTherapy PDFs:
- mood (scale 0 to 4)
- headache
- fatigue
- anxiety

Stack: vanilla HTML/CSS/JS + Node.js/Express + SQLite.

Dashboards are powered by **day-by-day data** extracted from PDFs (not only monthly means).

## Quick start

```powershell
npm install
npm start
```

Then open `http://localhost:3000`.

## Usage

- Use **Select PDFs** to upload files manually.
- Global, monthly, and daily analytics refresh automatically.
- If you upload a duplicate period, the newest uploaded report replaces the older one in DB.

## Useful scripts

```powershell
npm run smoke
npm run dev
```

- `npm run smoke` parses PDFs from `./pdfs` and prints extracted values.
- `npm run dev` starts the server in watch mode.

## Windows troubleshooting

If `npm install` fails with `spawn ... bash.exe ENOENT`, force npm shell to cmd:

```powershell
npm config set script-shell "C:\Windows\System32\cmd.exe"
```

## API

- `GET /api/health`
- `POST /api/upload` (multipart field `pdfs`)
- `GET /api/reports`
- `GET /api/stats`

## Project structure

- `public/` -> front-end assets (`index.html`, `styles.css`, `app.js`)
- `src/server/` -> backend modules (`app.js`, `db.js`, `parser.js`)
- `scripts/` -> utility scripts (`smoke-import.js`)
- `pdfs/` -> your source PDFs

## Extraction notes

Parsing uses regex rules on extracted PDF text. If report format changes, adjust rules in `src/server/parser.js`.

Daily values are stored in SQLite table `daily_metrics`, and `GET /api/stats` returns `daily`, `monthly`, and `global` from that source.


