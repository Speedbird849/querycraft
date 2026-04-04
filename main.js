const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// ─── DB state ───────────────────────────────────────────────────────────────
let activeConnection = null   // holds the live client/db object
let activeDriver     = null   // 'postgres' | 'mysql' | 'sqlite'
let activeSqlitePath = null   // file path of the open sqlite db (sql.js is in-memory)
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
      //
      // sql.js works differently from better-sqlite3:
      //   - Pure JavaScript — no C++ compilation needed (solves the Windows build error)
      //   - Loads the entire .db file into memory as a byte array
      //   - Queries run against that in-memory copy
      //   - The file on disk is NOT modified unless you explicitly write it back
      //
      const fs = require('fs')
      const initSqlJs = require('sql.js')

      const SQL = await initSqlJs()                        // initialise the sql.js engine
      const fileBuffer = fs.readFileSync(connectionString) // read the .db file from disk
      activeConnection = new SQL.Database(fileBuffer)      // load it into memory
      activeSqlitePath = connectionString                  // remember the path
      activeDriver = 'sqlite'

    } else {
      throw new Error(`Unknown driver: ${driver}`)
    }

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
      const [rows] = await activeConnection.query('SHOW TABLES')
      tables = rows.map(r => Object.values(r)[0])

    } else if (activeDriver === 'sqlite') {
      //
      // sql.js .exec() returns an array of result sets.
      // Each result set looks like: { columns: ['name'], values: [['users'], ['orders']] }
      // Unlike pg/mysql, rows are arrays not objects, so we access by index.
      //
      const result = activeConnection.exec(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      )
      tables = result.length > 0 ? result[0].values.map(row => row[0]) : []
    }

    return { ok: true, tables }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── 4. GET COLUMNS FOR A TABLE ───────────────────────────────────────────────
ipcMain.handle('db:columns', async (_event, { table }) => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }

  try {
    let columns = []

    if (activeDriver === 'postgres') {
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
      columns = res.rows

    } else if (activeDriver === 'mysql') {
      const [rows] = await activeConnection.query(`DESCRIBE \`${table}\``)
      columns = rows.map(r => ({
        column_name: r.Field,
        data_type:   r.Type,
        is_nullable: r.Null === 'YES',
        is_pk:       r.Key === 'PRI'
      }))

    } else if (activeDriver === 'sqlite') {
      //
      // PRAGMA table_info(tablename) returns one row per column:
      //   cid | name | type | notnull | dflt_value | pk
      //
      // sql.js gives us { columns: ['cid','name','type',...], values: [[0,'id','INTEGER',1,null,1], ...] }
      // We zip the column names with each value row to make plain objects.
      //
      const result = activeConnection.exec(`PRAGMA table_info(${table})`)
      if (result.length > 0) {
        const { columns: colNames, values } = result[0]
        columns = values.map(row => {
          const obj = {}
          colNames.forEach((col, i) => { obj[col] = row[i] })
          return {
            column_name: obj.name,
            data_type:   obj.type,
            is_nullable: obj.notnull === 0,
            is_pk:       obj.pk === 1
          }
        })
      }
    }

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


// ── 6. PREVIEW A MUTATION (BEGIN + RUN + SNAPSHOT) ─────────────────────────
ipcMain.handle('db:preview-change', async (_event, { sql, tableHint }) => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }
  if (!isMutatingSql(sql)) return { ok: false, error: 'Only mutating SQL can be previewed.' }

  try {
    if (pendingPreview) {
      await rollbackTransaction()
      pendingPreview = false
    }

    const targetTable = (tableHint || extractTargetTable(sql) || '').trim()
    const before = targetTable ? await safeFetchTableSnapshot(targetTable) : { fields: [], rows: [] }

    await beginTransaction()
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
      try { await rollbackTransaction() } catch (_) {}
      pendingPreview = false
    }
    return { ok: false, error: err.message }
  }
})


// ── 7. COMMIT PREVIEWED CHANGES ─────────────────────────────────────────────
ipcMain.handle('db:commit-preview', async () => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }
  if (!pendingPreview) return { ok: false, error: 'No pending preview to commit.' }

  try {
    await commitTransaction()
    pendingPreview = false
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── 8. UNDO PREVIEWED CHANGES ───────────────────────────────────────────────
ipcMain.handle('db:undo-preview', async () => {
  if (!activeConnection) return { ok: false, error: 'Not connected' }
  if (!pendingPreview) return { ok: true }

  try {
    await rollbackTransaction()
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
      try { await rollbackTransaction() } catch (_) {}
      pendingPreview = false
    }
    if (activeDriver === 'postgres') await activeConnection.end()
    if (activeDriver === 'mysql')    await activeConnection.end()
    if (activeDriver === 'sqlite')   activeConnection.close()
    // sql.js .close() frees the in-memory database. The file on disk is never touched.
  } catch (_) {}

  activeConnection = null
  activeDriver     = null
  activeSqlitePath = null
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

  if (activeDriver === 'postgres') {
    return parts.map(p => `"${p.replace(/"/g, '""')}"`).join('.')
  }
  return parts.map(p => `\`${p.replace(/`/g, '``')}\``).join('.')
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
  return msg.includes('does not exist')
    || msg.includes('unknown table')
    || msg.includes('no such table')
}

async function beginTransaction() {
  if (activeDriver === 'postgres' || activeDriver === 'mysql') {
    await activeConnection.query('BEGIN')
    return
  }
  if (activeDriver === 'sqlite') {
    activeConnection.run('BEGIN TRANSACTION')
  }
}

async function commitTransaction() {
  if (activeDriver === 'postgres' || activeDriver === 'mysql') {
    await activeConnection.query('COMMIT')
    return
  }
  if (activeDriver === 'sqlite') {
    activeConnection.run('COMMIT')
  }
}

async function rollbackTransaction() {
  if (activeDriver === 'postgres' || activeDriver === 'mysql') {
    await activeConnection.query('ROLLBACK')
    return
  }
  if (activeDriver === 'sqlite') {
    activeConnection.run('ROLLBACK')
  }
}

async function executeSql(sql) {
  let rows = []
  let fields = []
  let rowCount = 0

  if (activeDriver === 'postgres') {
    const res = await activeConnection.query(sql)
    rows = res.rows || []
    fields = res.fields ? res.fields.map(f => f.name) : []
    rowCount = typeof res.rowCount === 'number' ? res.rowCount : rows.length
    return { rows, fields, rowCount }
  }

  if (activeDriver === 'mysql') {
    const [result, fieldDefs] = await activeConnection.query(sql)
    if (Array.isArray(result)) {
      rows = result
      fields = (fieldDefs || []).map(f => f.name)
      rowCount = rows.length
    } else {
      rowCount = Number(result?.affectedRows || 0)
    }
    return { rows, fields, rowCount }
  }

  if (activeDriver === 'sqlite') {
    const isRead = /^\s*(select|pragma|with)\b/i.test(sql)
    if (isRead) {
      const result = activeConnection.exec(sql)
      if (result.length > 0) {
        fields = result[0].columns
        rows = result[0].values.map(row => {
          const obj = {}
          fields.forEach((col, i) => { obj[col] = row[i] })
          return obj
        })
      }
      rowCount = rows.length
    } else {
      activeConnection.run(sql)
      const changed = activeConnection.exec('SELECT changes() AS affected_rows')
      if (changed.length > 0 && changed[0].values[0]) {
        rowCount = Number(changed[0].values[0][0] || 0)
      }
    }
    return { rows, fields, rowCount }
  }

  throw new Error('Unsupported driver for query execution.')
}
