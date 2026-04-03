/**
 * app.js  —  QueryCraft renderer
 *
 * All database calls go through window.db (exposed by preload.js).
 * No Node or Electron APIs are used directly here.
 *
 * This file is intentionally structured as plain sections so it's
 * easy to follow step by step:
 *
 *   1. Element refs
 *   2. State
 *   3. Connection modal
 *   4. Schema sidebar
 *   5. Filter bar
 *   6. Query runner
 *   7. Results renderer
 *   8. History
 *   9. Utility helpers
 */


/* ══════════════════════════════════════════
   1. ELEMENT REFS
══════════════════════════════════════════ */
const dbBadge        = document.getElementById('dbBadge')
const dbDot          = document.getElementById('dbDot')
const dbLabel        = document.getElementById('dbLabel')
const connectBtn     = document.getElementById('connectBtn')

const modalOverlay   = document.getElementById('modalOverlay')
const modalClose     = document.getElementById('modalClose')
const modalCancel    = document.getElementById('modalCancel')
const modalConnect   = document.getElementById('modalConnect')
const modalError     = document.getElementById('modalError')
const hostFields     = document.getElementById('hostFields')
const fileGroup      = document.getElementById('fileGroup')
const filePathInput  = document.getElementById('filePathInput')
const driverTabs     = document.querySelectorAll('.driver-tab')
// Individual connection fields
const fieldHost      = document.getElementById('fieldHost')
const fieldPort      = document.getElementById('fieldPort')
const fieldDatabase  = document.getElementById('fieldDatabase')
const fieldUser      = document.getElementById('fieldUser')
const fieldPassword  = document.getElementById('fieldPassword')
const fieldSSL       = document.getElementById('fieldSSL')
const connPreview    = document.getElementById('connPreview')
const pasteConnBtn   = document.getElementById('pasteConnBtn')
const rawConnGroup   = document.getElementById('rawConnGroup')
const rawConnInput   = document.getElementById('rawConnInput')

const schemaList     = document.getElementById('schemaList')
const historyList    = document.getElementById('historyList')

const filterBar      = document.getElementById('filterBar')
const filterToggleBtn = document.getElementById('filterToggleBtn')
const filterRows     = document.getElementById('filterRows')
const addFilterBtn   = document.getElementById('addFilterBtn')
const clearFiltersBtn= document.getElementById('clearFiltersBtn')
const applyFiltersBtn= document.getElementById('applyFiltersBtn')

const queryInput     = document.getElementById('queryInput')
const runBtn         = document.getElementById('runBtn')

const emptyState       = document.getElementById('emptyState')
const schemaOverview   = document.getElementById('schemaOverview')
const schemaOverviewTitle = document.getElementById('schemaOverviewTitle')
const schemaGrid       = document.getElementById('schemaGrid')
const sqlPanel       = document.getElementById('sqlPanel')
const sqlBody        = document.getElementById('sqlBody')
const sqlBadge       = document.getElementById('sqlBadge')
const comparisonArea = document.getElementById('comparisonArea')
const resultsPanel   = document.getElementById('resultsPanel')
const resultsHead    = document.getElementById('resultsHead')
const resultsBody    = document.getElementById('resultsBody')
const resultsFooter  = document.getElementById('resultsFooter')
const previewPanel   = document.getElementById('previewPanel')
const previewSummary = document.getElementById('previewSummary')
const previewHead    = document.getElementById('previewHead')
const previewBody    = document.getElementById('previewBody')
const previewFooter  = document.getElementById('previewFooter')
const confirmPreviewBtn = document.getElementById('confirmPreviewBtn')
const undoPreviewBtn = document.getElementById('undoPreviewBtn')
const errorPanel     = document.getElementById('errorPanel')
const errorBody      = document.getElementById('errorBody')

const statusMsg      = document.getElementById('statusMsg')
const statusDriver   = document.getElementById('statusDriver')


/* ══════════════════════════════════════════
   2. STATE
══════════════════════════════════════════ */
const state = {
  connected: false,
  driver: 'postgres',
  dbName: '',
  tables: [],
  columns: {},          // { tableName: [ column, ... ] }
  activeTable: null,
  queryHistory: [],
  filters: [],          // [ { column, operator, value, enabled } ]
  pendingPreview: null, // { sql, targetTable }
}

/* ══════════════════════════════════════════
   3. CONNECTION MODAL
══════════════════════════════════════════ */

// Default values per driver
const DRIVER_DEFAULTS = {
  postgres: { host: 'localhost', port: '5432', user: 'postgres' },
  mysql:    { host: 'localhost', port: '3306', user: 'root'     },
  sqlite:   {}
}

// Open modal — reset fields to defaults for the current driver
let disconnectTimer = null

connectBtn.addEventListener('click', () => {
  if (!state.connected) {
    openModal()
    return
  }

  if (connectBtn.dataset.confirming === 'true') {
    // Second click — confirmed, actually disconnect
    clearTimeout(disconnectTimer)
    connectBtn.dataset.confirming = 'false'
    handleDisconnect()
  } else {
    // First click — enter confirm state
    connectBtn.dataset.confirming = 'true'
    connectBtn.textContent = 'Confirm?'
    connectBtn.classList.remove('btn-disconnect')
    connectBtn.classList.add('btn-confirm')

    // Reset back to Disconnect after 5 seconds if not confirmed
    disconnectTimer = setTimeout(() => {
      if (connectBtn.dataset.confirming === 'true') {
        connectBtn.dataset.confirming = 'false'
        connectBtn.textContent = 'Disconnect'
        connectBtn.classList.remove('btn-confirm')
        connectBtn.classList.add('btn-disconnect')
      }
    }, 5000)
  }
})

modalClose.addEventListener('click', closeModal)
modalCancel.addEventListener('click', closeModal)
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal() })

function openModal() {
  modalOverlay.classList.remove('hidden')
  hideModalError()
  applyDriverDefaults(state.driver)
  updatePreview()
  fieldHost.focus()
}

function closeModal() {
  modalOverlay.classList.add('hidden')
  // Reset paste mode on close
  pasteMode = false
  pasteConnBtn.classList.remove('active')
  rawConnGroup.classList.add('hidden')
  rawConnInput.value = ''
}

// Fill placeholder text with the defaults for the selected driver.
// We use placeholders rather than pre-filling the value so the field
// reads as empty — the default only applies if the user leaves it blank.
function applyDriverDefaults(driver) {
  const d = DRIVER_DEFAULTS[driver] || {}
  fieldHost.placeholder     = d.host || 'localhost'
  fieldPort.placeholder     = d.port || ''
  fieldUser.placeholder     = d.user || ''
  fieldDatabase.placeholder = 'my_database'
  fieldPassword.placeholder = '••••••••'
}

// Driver tab switching
driverTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    driverTabs.forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    state.driver = tab.dataset.driver

    if (state.driver === 'sqlite') {
      hostFields.classList.add('hidden')
      fileGroup.classList.remove('hidden')
    } else {
      hostFields.classList.remove('hidden')
      fileGroup.classList.add('hidden')
      applyDriverDefaults(state.driver)
      updatePreview()
    }
  })
})

// Live preview — rebuild the connection string as the user types
;[fieldHost, fieldPort, fieldDatabase, fieldUser, fieldPassword].forEach(el => {
  el.addEventListener('input',  updatePreview)
  el.addEventListener('change', updatePreview)
})

// SSL toggle button — flip data-active and update preview
fieldSSL.addEventListener('click', () => {
  const active = fieldSSL.dataset.active === 'true'
  fieldSSL.dataset.active = String(!active)
  fieldSSL.classList.toggle('active', !active)
  updatePreview()
})

// Paste mode — toggle the raw connection string input
let pasteMode = false
pasteConnBtn.addEventListener('click', () => {
  pasteMode = !pasteMode
  pasteConnBtn.classList.toggle('active', pasteMode)
  rawConnGroup.classList.toggle('hidden', !pasteMode)
  if (pasteMode) {
    rawConnInput.value = buildConnectionString()
    rawConnInput.focus()
    rawConnInput.select()
  }
})

// Keep preview in sync when typing into the raw input
rawConnInput.addEventListener('input', () => {
  connPreview.textContent = rawConnInput.value || buildConnectionString()
})

function updatePreview() {
  connPreview.textContent = buildConnectionString()
}

// Build the connection string from the current field values,
// falling back to placeholder defaults for any field left empty.
function buildConnectionString() {
  const driver = state.driver
  const d      = DRIVER_DEFAULTS[driver] || {}

  const host = fieldHost.value.trim()     || d.host || 'localhost'
  const port = fieldPort.value.trim()     || d.port || ''
  const db   = fieldDatabase.value.trim() || ''
  const user = fieldUser.value.trim()     || d.user || ''
  const pass = fieldPassword.value.trim() || ''
  const ssl  = fieldSSL.dataset.active === 'true'

  const scheme = driver === 'mysql' ? 'mysql' : 'postgres'

  let str = `${scheme}://`
  if (user)       str += user
  if (pass)       str += `:${pass}`
  if (user || pass) str += '@'
  str += host
  if (port)       str += `:${port}`
  str += `/${db}`
  if (ssl)        str += '?sslmode=require'

  return str
}

// Connect button
modalConnect.addEventListener('click', handleConnect)
fieldPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleConnect() })

async function handleConnect() {
  // For SQLite, use the file path directly
  // For everything else, build the connection string from the fields
  const connString = state.driver === 'sqlite'
    ? filePathInput.value.trim()
    : (pasteMode && rawConnInput.value.trim())
      ? rawConnInput.value.trim()
      : buildConnectionString()

  if (state.driver === 'sqlite' && !connString) {
    showModalError('Please enter a file path.')
    return
  }

  if (state.driver !== 'sqlite' && !fieldDatabase.value.trim()) {
    showModalError('Please enter a database name.')
    return
  }

  modalConnect.disabled = true
  modalConnect.textContent = 'Connecting…'
  hideModalError()

  const result = await window.db.connect(state.driver, connString)

  modalConnect.disabled = false
  modalConnect.textContent = 'Connect →'

  if (!result.ok) {
    showModalError(result.error)
    return
  }

  state.dbName    = fieldDatabase.value.trim() || filePathInput.value.split('\\').pop().split('/').pop()
  state.connected = true

  closeModal()
  setConnected(true)
  await loadSchema()
}

async function handleDisconnect() {
  await window.db.disconnect()
  state.connected = false
  state.tables = []
  state.columns = {}
  state.activeTable = null
  state.filters = []
  state.queryHistory = []
  state.pendingPreview = null

  setConnected(false)

  // Clear sidebar
  schemaList.innerHTML = '<div class="sidebar-empty">No connection</div>'
  historyList.innerHTML = '<div class="sidebar-empty">No queries yet</div>'

  // Clear filter bar
  filterBar.classList.add('hidden')
  filterRows.innerHTML = ''
  filterToggleBtn.classList.remove('active')

  // Reset output area back to empty state
  sqlPanel.classList.add('hidden')
  comparisonArea.classList.add('hidden')
  previewPanel.classList.add('hidden')
  resultsPanel.classList.add('hidden')
  errorPanel.classList.add('hidden')
  schemaOverview.classList.add('hidden')
  schemaGrid.innerHTML = ''
  emptyState.classList.remove('hidden')
  sqlBody.textContent = ''
  resultsHead.innerHTML = ''
  resultsBody.innerHTML = ''
  resultsFooter.innerHTML = ''
  previewHead.innerHTML = ''
  previewBody.innerHTML = ''
  previewFooter.innerHTML = ''
  previewSummary.textContent = 'Run an UPDATE, INSERT, or DELETE to preview changes.'
  queryInput.value = ''
  queryInput.style.height = 'auto'

  setStatus('Disconnected')
}

function setConnected(yes) {
  dbDot.className = 'db-dot ' + (yes ? 'connected' : 'disconnected')
  dbLabel.textContent = yes ? state.dbName : 'Not connected'
  connectBtn.textContent = yes ? 'Disconnect' : 'Connect'
  connectBtn.dataset.confirming = 'false'
  connectBtn.classList.remove('btn-confirm')
  connectBtn.classList.toggle('btn-disconnect', yes)
  connectBtn.classList.toggle('btn-connect', !yes)
  statusDriver.textContent = yes ? state.driver : ''
  setStatus(yes ? `Connected to ${state.dbName}` : 'Ready')
}

function showModalError(msg) {
  modalError.textContent = msg
  modalError.classList.remove('hidden')
}

function hideModalError() {
  modalError.classList.add('hidden')
  modalError.textContent = ''
}

function extractDbName(connStr, driver) {
  try {
    if (driver === 'sqlite') return connStr.split('/').pop()
    const url = new URL(connStr)
    return url.pathname.replace('/', '') || url.hostname
  } catch {
    return connStr.split('/').pop() || 'database'
  }
}


/* ══════════════════════════════════════════
   4. SCHEMA SIDEBAR
══════════════════════════════════════════ */

async function loadSchema() {
  setStatus('Loading schema…')
  const result = await window.db.tables()

  if (!result.ok) {
    schemaList.innerHTML = `<div class="sidebar-empty">${result.error}</div>`
    return
  }

  state.tables = result.tables
  schemaList.innerHTML = ''

  for (const table of result.tables) {
    const colResult = await window.db.columns(table)
    state.columns[table] = colResult.ok ? colResult.columns : []
    schemaList.appendChild(buildTableNode(table, state.columns[table]))
  }

  renderSchemaOverview(result.tables)
  setStatus(`${result.tables.length} tables loaded`)
}

function renderSchemaOverview(tables) {
  schemaOverviewTitle.textContent = `${state.dbName} — ${tables.length} table${tables.length !== 1 ? 's' : ''}`
  schemaGrid.innerHTML = ''

  for (const table of tables) {
    const cols = state.columns[table] || []
    const preview = cols.slice(0, 5)
    const extra   = cols.length - preview.length

    const card = document.createElement('div')
    card.className = 'schema-card'
    card.innerHTML = `
      <div class="schema-card-head">
        <span class="schema-card-name">${table}</span>
        <span class="schema-card-count">${cols.length} col${cols.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="schema-card-cols">
        ${preview.map(col => `
          <div class="schema-card-col">
            <span class="schema-card-col-name">${col.column_name}</span>
            ${col.is_pk
              ? '<span class="schema-card-col-pk">PK</span>'
              : `<span class="schema-card-col-type">${col.data_type}</span>`}
          </div>
        `).join('')}
        ${extra > 0 ? `<div class="schema-card-more">+${extra} more column${extra !== 1 ? 's' : ''}</div>` : ''}
      </div>
    `

    card.addEventListener('click', () => selectTable(table))
    schemaGrid.appendChild(card)
  }

  // Show overview, hide empty state
  emptyState.classList.add('hidden')
  schemaOverview.classList.remove('hidden')
}

function buildTableNode(tableName, columns) {
  const wrapper = document.createElement('div')
  wrapper.className = 'schema-table'

  const header = document.createElement('div')
  header.className = 'schema-table-header'
  header.innerHTML = `
    <span class="tbl-icon">▤</span>
    <span>${tableName}</span>
    <span class="tbl-chevron">▾</span>
  `

  const colsDiv = document.createElement('div')
  colsDiv.className = 'schema-cols'
  colsDiv.innerHTML = columns.map(col => `
    <div class="col-row">
      <span class="col-name">${col.column_name}</span>
      ${col.is_pk
        ? '<span class="col-pk">PK</span>'
        : `<span class="col-type">${col.data_type}</span>`}
    </div>
  `).join('')

  // Single click — select table (run SELECT *)
  // Chevron click toggles columns open/closed
  let expanded = true
  header.addEventListener('click', (e) => {
    if (e.target.classList.contains('tbl-chevron')) {
      expanded = !expanded
      colsDiv.style.display = expanded ? 'block' : 'none'
      header.querySelector('.tbl-chevron').textContent = expanded ? '▾' : '▸'
    } else {
      selectTable(tableName)
    }
  })

  wrapper.appendChild(header)
  wrapper.appendChild(colsDiv)
  return wrapper
}

function selectTable(tableName) {
  state.activeTable = tableName
  const sql = `SELECT * FROM ${tableName} LIMIT 100;`
  queryInput.value = sql
  runQuery(sql)
}


/* ══════════════════════════════════════════
   5. FILTER BAR
══════════════════════════════════════════ */

function showFilterBar(tableName) {
  filterBar.classList.remove('hidden')
  filterToggleBtn.classList.add('active')
  filterRows.innerHTML = ''
  state.filters = []
  addFilter(tableName)
}

function addFilter(tableName) {
  const columns = state.columns[tableName] || []
  const filterIndex = state.filters.length

  const filter = { column: columns[0]?.column_name || '', operator: '=', value: '', enabled: true }
  state.filters.push(filter)

  const pill = document.createElement('div')
  pill.className = 'filter-pill'
  pill.dataset.index = filterIndex

  pill.innerHTML = `
    <div class="filter-check" title="Toggle filter">✓</div>
    <select class="filter-select col-select">
      ${columns.map(c => `<option value="${c.column_name}">${c.column_name}</option>`).join('')}
    </select>
    <select class="filter-select op-select">
      <option value="=">=</option>
      <option value="!=">!=</option>
      <option value=">">&gt;</option>
      <option value=">=">&gt;=</option>
      <option value="<">&lt;</option>
      <option value="<=">&lt;=</option>
      <option value="LIKE">LIKE</option>
      <option value="NOT LIKE">NOT LIKE</option>
    </select>
    <input class="filter-value val-input" type="text" placeholder="value" />
    <button class="filter-apply-btn">Apply</button>
    <button class="filter-icon-btn remove-btn" title="Remove">−</button>
    <button class="filter-icon-btn add-btn" title="Add filter">+</button>
  `

  // Wire up changes to state
  pill.querySelector('.col-select').addEventListener('change', (e) => {
    state.filters[filterIndex].column = e.target.value
  })
  pill.querySelector('.op-select').addEventListener('change', (e) => {
    state.filters[filterIndex].operator = e.target.value
  })
  pill.querySelector('.val-input').addEventListener('input', (e) => {
    state.filters[filterIndex].value = e.target.value
  })

  pill.querySelector('.filter-check').addEventListener('click', (e) => {
    state.filters[filterIndex].enabled = !state.filters[filterIndex].enabled
    e.currentTarget.style.opacity = state.filters[filterIndex].enabled ? '1' : '0.3'
  })

  pill.querySelector('.filter-apply-btn').addEventListener('click', () => {
    applyFilters()
  })

  pill.querySelector('.remove-btn').addEventListener('click', () => {
    pill.remove()
    state.filters.splice(filterIndex, 1)
  })

  pill.querySelector('.add-btn').addEventListener('click', () => {
    addFilter(tableName)
  })

  filterRows.appendChild(pill)
}

// Filter toggle button — show/hide the filter bar
filterToggleBtn.addEventListener('click', () => {
  const isVisible = !filterBar.classList.contains('hidden')
  if (isVisible) {
    filterBar.classList.add('hidden')
    filterToggleBtn.classList.remove('active')
  } else {
    if (state.activeTable) {
      showFilterBar(state.activeTable)
    } else {
      filterBar.classList.remove('hidden')
    }
    filterToggleBtn.classList.add('active')
  }
})

addFilterBtn.addEventListener('click', () => {
  if (state.activeTable) addFilter(state.activeTable)
})

clearFiltersBtn.addEventListener('click', () => {
  filterRows.innerHTML = ''
  state.filters = []
  filterBar.classList.add('hidden')
  filterToggleBtn.classList.remove('active')
  if (state.activeTable) selectTable(state.activeTable)
})

applyFiltersBtn.addEventListener('click', applyFilters)

function applyFilters() {
  if (!state.activeTable) return

  const active = state.filters.filter(f => f.enabled && f.value.trim())
  if (active.length === 0) {
    selectTable(state.activeTable)
    return
  }

  const where = active
    .map(f => {
      const val = isNaN(f.value) ? `'${f.value}'` : f.value
      return `${f.column} ${f.operator} ${val}`
    })
    .join(' AND ')

  const sql = `SELECT * FROM ${state.activeTable} WHERE ${where} LIMIT 100;`
  queryInput.value = sql
  runQuery(sql)
}


/* ══════════════════════════════════════════
   6. QUERY RUNNER
══════════════════════════════════════════ */

// Auto-resize textarea as content grows
queryInput.addEventListener('input', () => {
  queryInput.style.height = 'auto'
  queryInput.style.height = queryInput.scrollHeight + 'px'
})

runBtn.addEventListener('click', () => {
  const sql = queryInput.value.trim()
  if (sql) runQuery(sql)
})

queryInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    const sql = queryInput.value.trim()
    if (sql) runQuery(sql)
  }
})

confirmPreviewBtn.addEventListener('click', commitPreview)
undoPreviewBtn.addEventListener('click', undoPreview)

async function runQuery(sql) {
  if (isMutatingSql(sql)) {
    await runMutationPreview(sql)
    return
  }

  if (state.pendingPreview) {
    showPanels('error')
    errorBody.textContent = 'A pending preview is open. Confirm Commit or Undo before running another query.'
    setStatus('Pending preview needs confirmation')
    return
  }

  setStatus('Running query…')
  showPanels('loading')
  const start = Date.now()

  const result = await window.db.query(sql)
  const ms = Date.now() - start

  if (!result.ok) {
    if (result.blocked) {
      showPanels('error')
      errorBody.textContent = result.error
      setStatus('Query blocked')
    } else {
      showPanels('error')
      errorBody.textContent = result.error
      setStatus('Query failed')
    }
    return
  }

  // Show SQL panel
  sqlBody.textContent = sql
  sqlBadge.textContent = '✓ safe'
  sqlBadge.className = 'badge badge-safe'

  // Render results
  renderResults(result.fields, result.rows, ms)
  showPanels('results')
  addHistory(sql)
  setStatus(`${result.rows.length} rows · ${ms}ms`)
}

async function runMutationPreview(sql) {
  setStatus('Building preview…')
  showPanels('loading')

  const tableHint = state.activeTable || extractTargetTable(sql)
  const result = await window.db.previewChange(sql, tableHint)

  if (!result.ok) {
    showPanels('error')
    errorBody.textContent = result.error
    setStatus('Preview failed')
    return
  }

  state.pendingPreview = {
    sql,
    targetTable: result.targetTable || tableHint || null,
  }

  sqlBody.textContent = sql
  sqlBadge.textContent = 'pending commit'
  sqlBadge.className = 'badge badge-pending'

  renderResults(result.beforeFields, result.beforeRows, null, 'current')
  renderPreviewResults(result.afterFields, result.afterRows, result.affectedRows, result.targetTable)
  showPanels('preview')
  addHistory(sql)
  setStatus('Preview ready. Confirm Commit to persist, or Undo to rollback.')
}

async function commitPreview() {
  if (!state.pendingPreview) return

  setPreviewButtonsDisabled(true)
  const targetTable = state.pendingPreview.targetTable
  const result = await window.db.commitPreview()
  setPreviewButtonsDisabled(false)

  if (!result.ok) {
    showPanels('error')
    errorBody.textContent = result.error
    setStatus('Commit failed')
    return
  }

  state.pendingPreview = null
  previewPanel.classList.add('hidden')
  setStatus('Changes committed')

  if (targetTable) {
    const sql = `SELECT * FROM ${targetTable} LIMIT 100;`
    queryInput.value = sql
    runQuery(sql)
  }
}

async function undoPreview() {
  if (!state.pendingPreview) return

  setPreviewButtonsDisabled(true)
  const targetTable = state.pendingPreview.targetTable
  const result = await window.db.undoPreview()
  setPreviewButtonsDisabled(false)

  if (!result.ok) {
    showPanels('error')
    errorBody.textContent = result.error
    setStatus('Undo failed')
    return
  }

  state.pendingPreview = null
  previewPanel.classList.add('hidden')
  previewSummary.textContent = 'Preview rolled back. No changes were saved.'
  setStatus('Preview rolled back')

  if (targetTable) {
    const sql = `SELECT * FROM ${targetTable} LIMIT 100;`
    queryInput.value = sql
    runQuery(sql)
  }
}

function setPreviewButtonsDisabled(disabled) {
  confirmPreviewBtn.disabled = disabled
  undoPreviewBtn.disabled = disabled
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


/* ══════════════════════════════════════════
   7. RESULTS RENDERER
══════════════════════════════════════════ */

function renderResults(fields, rows, ms, rightLabel = null) {
  // Header row
  resultsHead.innerHTML = '<tr>' + fields.map(f => `<th>${f}</th>`).join('') + '</tr>'

  // Body rows
  resultsBody.innerHTML = rows.map(row =>
    '<tr>' + fields.map(f => {
      const val = row[f]
      if (val === null || val === undefined) return '<td><span class="null-value">NULL</span></td>'
      return `<td>${val}</td>`
    }).join('') + '</tr>'
  ).join('')

  if (rows.length === 0) {
    const colSpan = Math.max(fields.length, 1)
    resultsBody.innerHTML = `<tr><td colspan="${colSpan}"><span class="null-value">No rows</span></td></tr>`
  }

  const right = rightLabel ?? (typeof ms === 'number' ? `${ms}ms` : '')
  resultsFooter.innerHTML = `<span>${rows.length} rows</span><span>${right}</span>`
}

function renderPreviewResults(fields, rows, affectedRows, targetTable) {
  previewHead.innerHTML = '<tr>' + fields.map(f => `<th>${f}</th>`).join('') + '</tr>'

  previewBody.innerHTML = rows.map(row =>
    '<tr>' + fields.map(f => {
      const val = row[f]
      if (val === null || val === undefined) return '<td><span class="null-value">NULL</span></td>'
      return `<td>${val}</td>`
    }).join('') + '</tr>'
  ).join('')

  if (rows.length === 0) {
    const colSpan = Math.max(fields.length, 1)
    previewBody.innerHTML = `<tr><td colspan="${colSpan}"><span class="null-value">No rows</span></td></tr>`
  }

  previewSummary.textContent = targetTable
    ? `Previewing staged changes on ${targetTable}.`
    : 'Previewing staged changes.'
  previewFooter.innerHTML = `<span>${rows.length} rows</span><span>${affectedRows || 0} affected</span>`
}

function showPanels(mode) {
  emptyState.classList.add('hidden')
  schemaOverview.classList.add('hidden')
  comparisonArea.classList.add('hidden')
  sqlPanel.classList.add('hidden')
  resultsPanel.classList.add('hidden')
  previewPanel.classList.add('hidden')
  errorPanel.classList.add('hidden')

  if (mode === 'results') {
    comparisonArea.classList.remove('hidden')
    sqlPanel.classList.remove('hidden')
    resultsPanel.classList.remove('hidden')
  } else if (mode === 'preview') {
    comparisonArea.classList.remove('hidden')
    sqlPanel.classList.remove('hidden')
    resultsPanel.classList.remove('hidden')
    previewPanel.classList.remove('hidden')
  } else if (mode === 'error') {
    comparisonArea.classList.remove('hidden')
    errorPanel.classList.remove('hidden')
  } else if (mode === 'schema') {
    schemaOverview.classList.remove('hidden')
  } else if (mode === 'empty') {
    emptyState.classList.remove('hidden')
  }
  // 'loading' just shows nothing while waiting
}


/* ══════════════════════════════════════════
   8. HISTORY
══════════════════════════════════════════ */

function addHistory(sql) {
  state.queryHistory.unshift(sql)

  const item = document.createElement('div')
  item.className = 'history-item'
  item.innerHTML = `
    <div class="history-dot"></div>
    <div class="history-text">${sql.slice(0, 60)}${sql.length > 60 ? '…' : ''}</div>
  `
  item.addEventListener('click', () => {
    queryInput.value = sql
  })

  // Remove empty state if present
  const empty = historyList.querySelector('.sidebar-empty')
  if (empty) empty.remove()

  historyList.prepend(item)
}


/* ══════════════════════════════════════════
   9. UTILITY
══════════════════════════════════════════ */

function setStatus(msg) {
  statusMsg.textContent = msg
}
