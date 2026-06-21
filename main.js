const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// ─── DB state ───────────────────────────────────────────────────────────────
let activeConnection = null   // holds the live postgres client

// ─── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e1014',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,      // renderer cannot access Node directly
      nodeIntegration: false       // keep Node out of the renderer
    }
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Uncomment to open DevTools automatically:
  // win.webContents.openDevTools()
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})


// ══════════════════════════════════════════════════════════════════════════════
//  IPC HANDLERS
//  Each handler responds to a message sent from the renderer via preload.js.
//  Pattern: ipcMain.handle(channel, async (event, args) => { return result })
// ══════════════════════════════════════════════════════════════════════════════


// ── 1. CONNECT ───────────────────────────────────────────────────────────────
ipcMain.handle('db:connect', async (_event, { driver, connectionString }) => {
  try {
    await disconnectCurrent()  // close any existing connection first

    if (driver !== 'postgres') {
      throw new Error('This build supports PostgreSQL only.')
    }

    const { Client } = require('pg')
    const client = new Client({ connectionString })
    await client.connect()
    activeConnection = client

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── 2. DISCONNECT ────────────────────────────────────────────────────────────
ipcMain.handle('db:disconnect', async () => {
  await disconnectCurrent()
  return { ok: true }
})


// ── 3. LIST TABLES ───────────────────────────────────────────────────────────
ipcMain.handle('db:tables', async () => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }

  try {
    const res = await activeConnection.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    const tables = res.rows.map(r => r.table_name)

    return { ok: true, tables }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── 4. GET COLUMNS FOR A TABLE ───────────────────────────────────────────────
ipcMain.handle('db:columns', async (_event, { table }) => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }

  try {
    const res = await activeConnection.query(`
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
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
    const columns = res.rows

    return { ok: true, columns }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── 5. RUN A QUERY ───────────────────────────────────────────────────────────
ipcMain.handle('db:query', async (_event, { sql }) => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }

  try {
    const result = await executeSql(sql)
    return { ok: true, rows: result.rows, fields: result.fields, rowCount: result.rowCount }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── HELPER: close the active connection ──────────────────────────────────────
async function disconnectCurrent() {
  if (!activeConnection) return
  try {
    await activeConnection.end()
  } catch (_) {}

  activeConnection = null
}

async function executeSql(sql) {
  const res = await activeConnection.query(sql)
  const rows = res.rows || []
  const fields = res.fields ? res.fields.map(f => f.name) : []
  const rowCount = typeof res.rowCount === 'number' ? res.rowCount : rows.length

  return { rows, fields, rowCount }
}
