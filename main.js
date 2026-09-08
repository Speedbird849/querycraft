const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// ─── DB state ───────────────────────────────────────────────────────────────
let activeConnection = null   // holds the live pg client
let pendingPreview   = false  // true when a preview transaction is open

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

ipcMain.handle('db:preview-change', async (_event, { sql, tableHint }) => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }
  if (!isMutatingSql(sql)) return { ok: false, error: 'Only mutating SQL can be previewed.' }

  try {
    if (pendingPreview) {
      await activeConnection.query('ROLLBACK')
      pendingPreview = false
    }

    const targetTable = (tableHint || extractTargetTable(sql) || '').trim()
    const before = targetTable ? await safeFetchTableSnapshot(targetTable) : { fields: [], rows: [] }

    await activeConnection.query('BEGIN')
    pendingPreview = true

    const execResult = await executeSql(sql)
    const after = targetTable ? await safeFetchTableSnapshot(targetTable) : { fields: [], rows: [] }

    return {
      ok: true,
      pending: true,
      targetTable,
      affectedRows: execResult.rowCount,
      beforeFields: before.fields,
      beforeRows: before.rows,
      afterFields: after.fields,
      afterRows: after.rows,
    }
  } catch (err) {
    if (pendingPreview) {
      try { await activeConnection.query('ROLLBACK') } catch (_) {}
      pendingPreview = false
    }
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('db:commit-preview', async () => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }
  if (!pendingPreview) return { ok: false, error: 'No pending preview to commit.' }
  try {
    await activeConnection.query('COMMIT')
    pendingPreview = false
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('db:undo-preview', async () => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }
  if (!pendingPreview) return { ok: true }
  try {
    await activeConnection.query('ROLLBACK')
    pendingPreview = false
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── HELPER: close the active connection ──────────────────────────────────────
async function disconnectCurrent() {
  if (!activeConnection) return
  try {
    if (pendingPreview) {
      try { await activeConnection.query('ROLLBACK') } catch (_) {}
      pendingPreview = false
    }
    await activeConnection.end()
  } catch (_) {}
  activeConnection = null
}

function isMutatingSql(sql) {
  return /^\s*(insert|update|delete|alter|drop|truncate|create)\b/i.test(sql)
}

function extractTargetTable(sql) {
  const patterns = [
    /^\s*update\s+([`"\w.]+)/i,
    /^\s*insert\s+into\s+([`"\w.]+)/i,
    /^\s*delete\s+from\s+([`"\w.]+)/i,
    /^\s*alter\s+table\s+([`"\w.]+)/i,
    /^\s*truncate\s+table\s+([`"\w.]+)/i,
    /^\s*drop\s+table\s+([`"\w.]+)/i,
    /^\s*create\s+table\s+([`"\w.]+)/i,
  ]

  for (const pattern of patterns) {
    const match = sql.match(pattern)
    if (match && match[1]) return match[1].replace(/["`]/g, '')
  }
  return ''
}

function quoteIdentifier(tableName) {
  const parts = tableName.split('.').map(p => p.trim()).filter(Boolean)
  if (parts.length === 0) throw new Error('Unable to infer target table for preview.')
  return parts.map(p => `"${p.replace(/"/g, '""')}"`).join('.')
}

async function fetchTableSnapshot(tableName) {
  const tableRef = quoteIdentifier(tableName)
  return executeSql(`SELECT * FROM ${tableRef} LIMIT 100`)
}

async function safeFetchTableSnapshot(tableName) {
  try {
    return await fetchTableSnapshot(tableName)
  } catch (err) {
    if (isMissingTableError(err)) {
      return { fields: [], rows: [], rowCount: 0 }
    }
    throw err
  }
}

function isMissingTableError(err) {
  const msg = String(err?.message || '').toLowerCase()
  return msg.includes('does not exist') || msg.includes('unknown table')
}

async function executeSql(sql) {
  const res = await activeConnection.query(sql)
  const rows = res.rows || []
  const fields = res.fields ? res.fields.map(f => f.name) : []
  const rowCount = typeof res.rowCount === 'number' ? res.rowCount : rows.length
  return { rows, fields, rowCount }
}
