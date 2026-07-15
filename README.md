# QueryCraft

A lightweight desktop database GUI built with Electron.

Supports **PostgreSQL**.

## Tech stack

- **Electron** for the desktop shell and window lifecycle.
- **Vanilla HTML, CSS, and JavaScript** in the renderer for the interface and live table editing.
- **Node.js + `pg`** in the main process for PostgreSQL connectivity and transactional commits.
- **Preload IPC bridge** for a narrow, secure API between the UI and database layer.

The renderer stages inserts, updates, and deletes locally, shows them in a pending-change queue, and commits the whole batch atomically through IPC.

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
│                      Creates the window, handles the PostgreSQL connection via IPC
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
                    └── runs SQL via pg
                          └── returns result back up the chain
```

## Connecting

- **PostgreSQL:** `postgres://user:password@localhost:5432/dbname`

## Keyboard shortcuts

| Action | Shortcut |
|--------|----------|
| Run query | Cmd/Ctrl + Enter |

## Editing model

- Double-click a table cell to edit it inline.
- Row inserts and deletes are staged first instead of applying immediately.
- Use the staged changes panel to review, remove, or commit the full batch at once.

## Next steps

- [ ] Add NL-to-SQL via Claude API
- [ ] Export results as CSV
- [ ] Multiple connection tabs
- [ ] Query formatting / syntax highlighting
