const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// ─── DB drivers (loaded lazily when a connection is made) ───────────────────
let activeConnection = null   // holds the live client/db object
let activeDriver = null       // 'postgres' | 'mysql' | 'sqlite'

// ─── Window ────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',   // macOS: traffic lights inset into your topbar
    backgroundColor: '#0e1014',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,       // security: renderer can't access Node directly
      nodeIntegration: false        // security: keep Node out of renderer
    }
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools()
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})


// ══════════════════════════════════════════════════════════════════════════════
//  IPC HANDLERS  —  these are the functions the renderer can call via preload
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. Connect to a database ─────────────────────────────────────────────────
ipcMain.handle('db:connect', async (_event, { driver, connectionString }) => {
  try {
    // Close any existing connection first
    await disconnectCurrent()

    if (driver === 'postgres') {
      const { Client } = require('pg')
      const client = new Client({ connectionString })
      await client.connect()
      activeConnection = client
      activeDriver = 'postgres'

    } else if (driver === 'mysql') {
      const mysql = require('mysql2/promise')
      const conn = await mysql.createConnection(connectionString)
      activeConnection = conn
      activeDriver = 'mysql'

    } else if (driver === 'sqlite') {
      // connectionString is a file path for SQLite
      const Database = require('better-sqlite3')
      activeConnection = new Database(connectionString)
      activeDriver = 'sqlite'

    } else {
      throw new Error(`Unknown driver: ${driver}`)
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── 2. Disconnect ────────────────────────────────────────────────────────────
ipcMain.handle('db:disconnect', async () => {
  await disconnectCurrent()
  return { ok: true }
})


// ── 3. List tables (schema sidebar) ──────────────────────────────────────────
ipcMain.handle('db:tables', async () => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }

  try {
    let tables = []

    if (activeDriver === 'postgres') {
      const res = await activeConnection.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `)
      tables = res.rows.map(r => r.table_name)

    } else if (activeDriver === 'mysql') {
      const [rows] = await activeConnection.query(`SHOW TABLES`)
      tables = rows.map(r => Object.values(r)[0])

    } else if (activeDriver === 'sqlite') {
      const rows = activeConnection
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all()
      tables = rows.map(r => r.name)
    }

    return { ok: true, tables }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── 4. Get columns for a table ───────────────────────────────────────────────
ipcMain.handle('db:columns', async (_event, { table }) => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }

  try {
    let columns = []

    if (activeDriver === 'postgres') {
      const res = await activeConnection.query(`
        SELECT column_name, data_type, is_nullable,
               column_default,
               CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT ku.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_name = $1
        ) pk USING (column_name)
        WHERE c.table_name = $1
        ORDER BY ordinal_position
      `, [table])
      columns = res.rows

    } else if (activeDriver === 'mysql') {
      const [rows] = await activeConnection.query(`DESCRIBE \`${table}\``)
      columns = rows.map(r => ({
        column_name: r.Field,
        data_type: r.Type,
        is_nullable: r.Null === 'YES',
        is_pk: r.Key === 'PRI'
      }))

    } else if (activeDriver === 'sqlite') {
      const rows = activeConnection.prepare(`PRAGMA table_info(${table})`).all()
      columns = rows.map(r => ({
        column_name: r.name,
        data_type: r.type,
        is_nullable: r.notnull === 0,
        is_pk: r.pk === 1
      }))
    }

    return { ok: true, columns }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── 5. Run a query ───────────────────────────────────────────────────────────
ipcMain.handle('db:query', async (_event, { sql }) => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }

  // Safety: block destructive statements
  const BLOCKED = /^\s*(drop|delete|truncate|alter|update|insert|grant|revoke|create)\b/i
  if (BLOCKED.test(sql)) {
    return { ok: false, blocked: true, error: 'Destructive statements are not permitted in this mode.' }
  }

  try {
    let rows = [], fields = []

    if (activeDriver === 'postgres') {
      const res = await activeConnection.query(sql)
      rows = res.rows
      fields = res.fields.map(f => f.name)

    } else if (activeDriver === 'mysql') {
      const [result, fieldDefs] = await activeConnection.query(sql)
      rows = result
      fields = fieldDefs.map(f => f.name)

    } else if (activeDriver === 'sqlite') {
      const stmt = activeConnection.prepare(sql)
      const result = stmt.all()
      rows = result
      fields = result.length > 0 ? Object.keys(result[0]) : []
    }

    return { ok: true, rows, fields }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── Helper: close the active connection ──────────────────────────────────────
async function disconnectCurrent() {
  if (!activeConnection) return
  try {
    if (activeDriver === 'postgres') await activeConnection.end()
    else if (activeDriver === 'mysql') await activeConnection.end()
    else if (activeDriver === 'sqlite') activeConnection.close()
  } catch (_) {}
  activeConnection = null
  activeDriver = null
}
