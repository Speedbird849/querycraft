const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// ─── DB state ───────────────────────────────────────────────────────────────
let activeConnection = null   // holds the live pg client

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
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
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
// ══════════════════════════════════════════════════════════════════════════════

ipcMain.handle('db:connect', async (_event, { connectionString }) => {
  try {
    await disconnectCurrent()

    const { Client } = require('pg')
    const client = new Client({ connectionString })
    
    // Catch unexpected disconnects or network issues
    client.on('error', (err) => {
      console.error('Unexpected DB error:', err)
      activeConnection = null
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send('db:connection-lost', { error: err?.message || String(err) })
        }
      })
    })

    await client.connect()
    activeConnection = client

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('db:disconnect', async () => {
  await disconnectCurrent()
  return { ok: true }
})

ipcMain.handle('db:tables', async () => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }
  try {
    const res = await activeConnection.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    return { ok: true, tables: res.rows.map(r => r.table_name) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

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
    return { ok: true, columns: res.rows }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('db:query', async (_event, { sql }) => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }
  try {
    const result = await executeSql(sql)
    return { ok: true, rows: result.rows, fields: result.fields, rowCount: result.rowCount }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('db:apply-changes', async (_event, { statements }) => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }
  if (!Array.isArray(statements) || statements.length === 0) return { ok: true, count: 0 }

  try {
    await activeConnection.query('BEGIN')
    for (const sql of statements) {
      await activeConnection.query(sql)
    }
    await activeConnection.query('COMMIT')
    return { ok: true, count: statements.length }
  } catch (err) {
    try { await activeConnection.query('ROLLBACK') } catch (_) {}
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
