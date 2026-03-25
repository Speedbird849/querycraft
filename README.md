# QueryCraft

A lightweight desktop database GUI built with Electron.

Supports **PostgreSQL**, **MySQL**, and **SQLite**.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Run in development
npm start
```

## Project structure

```
querycraft/
├── main.js          ← Electron main process (Node.js)
│                      Creates the window, handles all DB connections via IPC
├── preload.js       ← Secure bridge — exposes window.db to the renderer
├── renderer/
│   ├── index.html   ← UI shell
│   ├── styles.css   ← All styles
│   └── app.js       ← All UI logic (vanilla JS)
└── package.json
```

## How the layers talk to each other

```
renderer/app.js
  └── calls window.db.query(sql)          ← defined by preload.js
        └── ipcRenderer.invoke('db:query')
              └── ipcMain.handle('db:query') ← in main.js
                    └── runs SQL via pg / mysql2 / better-sqlite3
                          └── returns result back up the chain
```

## Connecting

- **PostgreSQL:** `postgres://user:password@localhost:5432/dbname`
- **MySQL:**      `mysql://user:password@localhost:3306/dbname`
- **SQLite:**     `/absolute/path/to/file.db`

## Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| Run query | Cmd/Ctrl + Enter |

## Next steps

- [ ] Add NL-to-SQL via Claude API
- [ ] Inline cell editing
- [ ] Export results as CSV
- [ ] Multiple connection tabs
- [ ] Query formatting / syntax highlighting
