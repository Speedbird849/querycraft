const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// ─── DB state ───────────────────────────────────────────────────────────────
let activeConnection = null   // holds the live client/db object
let activeDriver     = null   // 'postgres' | 'mysql' | 'sqlite'
let activeSqlitePath = null   // file path of the open sqlite db (sql.js is in-memory)

// ─── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',  // macOS: traffic lights sit inside your topbar
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

  // Block destructive statements
  const BLOCKED = /^\s*(drop|delete|truncate|alter|update|insert|grant|revoke|create)\b/i
  if (BLOCKED.test(sql)) {
    return {
      ok: false,
      blocked: true,
      error: 'Destructive statements are not permitted in this mode.'
    }
  }

  try {
    let rows = [], fields = []

    if (activeDriver === 'postgres') {
      const res = await activeConnection.query(sql)
      rows   = res.rows
      fields = res.fields.map(f => f.name)

    } else if (activeDriver === 'mysql') {
      const [result, fieldDefs] = await activeConnection.query(sql)
      rows   = result
      fields = fieldDefs.map(f => f.name)

    } else if (activeDriver === 'sqlite') {
      //
      // sql.js exec() returns: [{ columns: ['id','name',...], values: [[1,'Alice'],[2,'Bob'],...] }]
      //
      // We convert this into the same shape pg/mysql return — an array of plain objects:
      //   [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
      //
      // This way app.js doesn't need to know which driver is active — it always gets the same shape.
      //
      const result = activeConnection.exec(sql)

      if (result.length > 0) {
        fields = result[0].columns
        rows   = result[0].values.map(row => {
          const obj = {}
          fields.forEach((col, i) => { obj[col] = row[i] })
          return obj
        })
      }
    }

    return { ok: true, rows, fields }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})


// ── HELPER: close the active connection ──────────────────────────────────────
async function disconnectCurrent() {
  if (!activeConnection) return
  try {
    if (activeDriver === 'postgres') await activeConnection.end()
    if (activeDriver === 'mysql')    await activeConnection.end()
    if (activeDriver === 'sqlite')   activeConnection.close()
    // sql.js .close() frees the in-memory database. The file on disk is never touched.
  } catch (_) {}

  activeConnection = null
  activeDriver     = null
  activeSqlitePath = null
}
