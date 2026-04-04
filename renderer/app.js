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
const comparisonGrid = document.querySelector('.comparison-grid')
const resultsPanel   = document.getElementById('resultsPanel')
const resultsHead    = document.getElementById('resultsHead')
const resultsBody    = document.getElementById('resultsBody')
const resultsFooter  = document.getElementById('resultsFooter')
const addEntryBtn    = document.getElementById('addEntryBtn')
const removeEntryBtn = document.getElementById('removeEntryBtn')
const saveEntryBtn   = document.getElementById('saveEntryBtn')
const cancelEntryBtn = document.getElementById('cancelEntryBtn')
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
  resultFields: [],
  resultRows: [],
  selectedRowIndices: [],
  resultRightLabel: '',
  entryDraftActive: false,
  entryDraftValues: {},
  cellEditDraft: null,  // { rowIndex, field, value, originalValue }
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
  state.resultFields = []
  state.resultRows = []
  state.selectedRowIndices = []
  state.resultRightLabel = ''
  state.entryDraftActive = false
  state.entryDraftValues = {}
  state.cellEditDraft = null

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
  refreshEntryButtons()

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
  const setExpanded = (isExpanded) => {
    expanded = isExpanded
    colsDiv.style.display = expanded ? 'block' : 'none'
    header.querySelector('.tbl-chevron').textContent = expanded ? '▾' : '▸'
  }

  header.addEventListener('click', (e) => {
    if (e.target.classList.contains('tbl-chevron')) {
      setExpanded(!expanded)
    } else {
      // Selecting a table keeps it active and toggles schema detail visibility.
      setExpanded(!expanded)
      selectTable(tableName)
    }
  })

  wrapper.appendChild(header)
  wrapper.appendChild(colsDiv)
  return wrapper
}

function selectTable(tableName) {
  state.activeTable = tableName
  state.selectedRowIndices = []
  refreshEntryButtons()
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

addEntryBtn.addEventListener('click', handleAddEntry)
removeEntryBtn.addEventListener('click', handleRemoveEntry)
saveEntryBtn.addEventListener('click', handleSaveEntry)
cancelEntryBtn.addEventListener('click', handleCancelEntry)
confirmPreviewBtn.addEventListener('click', commitPreview)
undoPreviewBtn.addEventListener('click', undoPreview)
refreshEntryButtons()

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
  state.selectedRowIndices = []
  state.entryDraftActive = false
  state.entryDraftValues = {}
  state.cellEditDraft = null
  refreshEntryButtons()

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
  state.selectedRowIndices = []
  state.entryDraftActive = false
  state.entryDraftValues = {}
  state.cellEditDraft = null
  previewPanel.classList.add('hidden')
  refreshEntryButtons()
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
  state.selectedRowIndices = []
  state.entryDraftActive = false
  state.entryDraftValues = {}
  state.cellEditDraft = null
  previewPanel.classList.add('hidden')
  previewSummary.textContent = 'Preview rolled back. No changes were saved.'
  refreshEntryButtons()
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

async function handleAddEntry() {
  if (!state.activeTable || state.pendingPreview) return
  if (!state.resultFields.length) return

  state.cellEditDraft = null
  state.entryDraftActive = true
  state.entryDraftValues = {}
  state.selectedRowIndices = []
  renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
  refreshEntryButtons()
}

async function handleSaveEntry() {
  if (!state.activeTable || state.pendingPreview || !state.entryDraftActive) return

  const tableRef = quoteTableIdentifier(state.activeTable)
  const filledFields = state.resultFields.filter(field => {
    const raw = state.entryDraftValues[field]
    return raw !== undefined && String(raw).trim() !== ''
  })

  let sql = ''
  if (filledFields.length === 0) {
    sql = state.driver === 'mysql'
      ? `INSERT INTO ${tableRef} () VALUES ();`
      : `INSERT INTO ${tableRef} DEFAULT VALUES;`
  } else {
    const columnsSql = filledFields.map(quoteColumnIdentifier).join(', ')
    const valuesSql = filledFields.map(field => toSqlInputLiteral(state.entryDraftValues[field])).join(', ')
    sql = `INSERT INTO ${tableRef} (${columnsSql}) VALUES (${valuesSql});`
  }

  state.entryDraftActive = false
  state.entryDraftValues = {}
  refreshEntryButtons()

  queryInput.value = sql
  await runQuery(sql)
}

function handleCancelEntry() {
  if (!state.entryDraftActive) return
  state.entryDraftActive = false
  state.entryDraftValues = {}
  renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
  refreshEntryButtons()
}

function startCellEdit(rowIndex, field) {
  if (!state.activeTable || state.pendingPreview || state.entryDraftActive) return

  const row = state.resultRows[rowIndex]
  if (!row || !(field in row)) return

  const originalValue = row[field]
  state.cellEditDraft = {
    rowIndex,
    field,
    value: originalValue === null || originalValue === undefined ? '' : String(originalValue),
    originalValue,
  }

  renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
}

function cancelCellEdit() {
  if (!state.cellEditDraft) return
  state.cellEditDraft = null
  renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
}

async function saveCellEdit() {
  if (!state.cellEditDraft || !state.activeTable || state.pendingPreview) return

  const { rowIndex, field, value, originalValue } = state.cellEditDraft
  const normalizedOriginal = originalValue === null || originalValue === undefined ? '' : String(originalValue)
  if (value === normalizedOriginal) {
    cancelCellEdit()
    return
  }

  const pk = getPrimaryKeyColumn(state.activeTable)
  if (!pk) {
    showPanels('error')
    errorBody.textContent = 'Inline edit requires a primary key column on the selected table.'
    setStatus('Cannot edit without primary key')
    cancelCellEdit()
    return
  }

  const row = state.resultRows[rowIndex]
  const pkValue = row ? row[pk.column_name] : undefined
  if (pkValue === undefined || pkValue === null) {
    showPanels('error')
    errorBody.textContent = `Inline edit failed: missing primary key value (${pk.column_name}) on selected row.`
    setStatus('Cannot edit selected row')
    cancelCellEdit()
    return
  }

  const tableRef = quoteTableIdentifier(state.activeTable)
  const targetCol = quoteColumnIdentifier(field)
  const pkCol = quoteColumnIdentifier(pk.column_name)
  const sql = `UPDATE ${tableRef} SET ${targetCol} = ${toSqlInputLiteral(value)} WHERE ${pkCol} = ${toSqlLiteral(pkValue)};`

  state.cellEditDraft = null
  queryInput.value = sql
  await runQuery(sql)
}

async function handleRemoveEntry() {
  if (!state.activeTable || state.pendingPreview) return
  if (state.selectedRowIndices.length === 0) return

  const pk = getPrimaryKeyColumn(state.activeTable)
  if (!pk) {
    showPanels('error')
    errorBody.textContent = 'Remove requires a primary key column on the selected table.'
    setStatus('Cannot remove without primary key')
    return
  }

  const selectedValues = state.selectedRowIndices
    .map(index => state.resultRows[index]?.[pk.column_name])
    .filter(value => value !== undefined && value !== null)

  if (selectedValues.length === 0) {
    showPanels('error')
    errorBody.textContent = `Selected rows do not contain valid values for primary key: ${pk.column_name}.`
    setStatus('Cannot remove selected rows')
    return
  }

  const tableRef = quoteTableIdentifier(state.activeTable)
  const colRef = quoteColumnIdentifier(pk.column_name)
  const valuesSql = selectedValues.map(toSqlLiteral).join(', ')
  const sql = `DELETE FROM ${tableRef} WHERE ${colRef} IN (${valuesSql});`

  queryInput.value = sql
  await runQuery(sql)
}

function getPrimaryKeyColumn(tableName) {
  const cols = state.columns[tableName] || []
  return cols.find(col => col.is_pk) || null
}

function quoteTableIdentifier(tableName) {
  const parts = tableName.split('.').map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) return tableName
  return parts.map(quoteIdentifierPart).join('.')
}

function quoteColumnIdentifier(columnName) {
  return quoteIdentifierPart(columnName)
}

function quoteIdentifierPart(identifier) {
  if (state.driver === 'postgres') return `"${String(identifier).replace(/"/g, '""')}"`
  return `\`${String(identifier).replace(/`/g, '``')}\``
}

function toSqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return `'${String(value).replace(/'/g, "''")}'`
}

function toSqlInputLiteral(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return 'NULL'
  if (/^null$/i.test(raw)) return 'NULL'
  if (/^true$/i.test(raw)) return 'TRUE'
  if (/^false$/i.test(raw)) return 'FALSE'
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw
  return toSqlLiteral(raw)
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function refreshEntryButtons() {
  const hasTable = Boolean(state.activeTable)
  const hasPendingPreview = Boolean(state.pendingPreview)
  const hasPk = Boolean(getPrimaryKeyColumn(state.activeTable))
  const hasResultFields = state.resultFields.length > 0
  const hasCellEdit = Boolean(state.cellEditDraft)
  const canRemove = hasTable && hasPk && state.selectedRowIndices.length > 0 && !hasPendingPreview && !state.entryDraftActive && !hasCellEdit

  addEntryBtn.disabled = !hasTable || hasPendingPreview || state.entryDraftActive || hasCellEdit || !hasResultFields
  removeEntryBtn.disabled = !canRemove
  saveEntryBtn.disabled = !state.entryDraftActive
  cancelEntryBtn.disabled = !state.entryDraftActive
  addEntryBtn.classList.toggle('hidden', state.entryDraftActive)
  saveEntryBtn.classList.toggle('hidden', !state.entryDraftActive)
  cancelEntryBtn.classList.toggle('hidden', !state.entryDraftActive)
}


/* ══════════════════════════════════════════
   7. RESULTS RENDERER
══════════════════════════════════════════ */

function renderResults(fields, rows, ms, rightLabel = null) {
  state.resultFields = fields
  state.resultRows = rows
  state.selectedRowIndices = []
  state.resultRightLabel = rightLabel ?? (typeof ms === 'number' ? `${ms}ms` : '')

  if (state.cellEditDraft && !rows[state.cellEditDraft.rowIndex]) {
    state.cellEditDraft = null
  }

  // Header row
  resultsHead.innerHTML = '<tr>' + fields.map(f => `<th>${f}</th>`).join('') + '</tr>'

  // Body rows
  const dataRowsHtml = rows.map((row, index) =>
    `<tr class="result-row" data-row-index="${index}">` + fields.map(f => {
      const isEditing = state.cellEditDraft
        && state.cellEditDraft.rowIndex === index
        && state.cellEditDraft.field === f

      if (isEditing) {
        return `<td class="result-cell editing" data-field="${escapeHtml(f)}"><input class="cell-edit-input" data-field="${escapeHtml(f)}" value="${escapeHtml(state.cellEditDraft.value)}" /></td>`
      }

      const val = row[f]
      if (val === null || val === undefined) return `<td class="result-cell" data-field="${escapeHtml(f)}"><span class="null-value">NULL</span></td>`
      return `<td class="result-cell" data-field="${escapeHtml(f)}">${val}</td>`
    }).join('') + '</tr>'
  ).join('')

  let draftRowHtml = ''
  if (state.entryDraftActive) {
    draftRowHtml = '<tr class="entry-row">' + fields.map(field => {
      const val = state.entryDraftValues[field] ?? ''
      return `<td><input class="entry-cell-input" data-field="${escapeHtml(field)}" value="${escapeHtml(val)}" placeholder="${escapeHtml(field)}" /></td>`
    }).join('') + '</tr>'
  }

  resultsBody.innerHTML = draftRowHtml + dataRowsHtml

  if (rows.length === 0) {
    const colSpan = Math.max(fields.length, 1)
    resultsBody.innerHTML = `<tr><td colspan="${colSpan}"><span class="null-value">No rows</span></td></tr>`
  }

  resultsFooter.innerHTML = `<span>${rows.length} rows</span><span>${state.resultRightLabel}</span>`

  bindEntryRowInputs()
  bindCellEditInput()
  bindResultCellEditing()
  bindResultRowSelection()
  refreshEntryButtons()
}

function bindEntryRowInputs() {
  const inputs = resultsBody.querySelectorAll('.entry-cell-input')
  inputs.forEach(input => {
    input.addEventListener('input', (e) => {
      const field = e.currentTarget.dataset.field
      state.entryDraftValues[field] = e.currentTarget.value
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleSaveEntry()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelEntry()
      }
    })
  })

  if (inputs.length > 0) inputs[0].focus()
}

function bindCellEditInput() {
  const input = resultsBody.querySelector('.cell-edit-input')
  if (!input) return

  let cancelled = false

  input.addEventListener('input', (e) => {
    if (!state.cellEditDraft) return
    state.cellEditDraft.value = e.currentTarget.value
    autoSizeCellEditInput(e.currentTarget)
  })

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      await saveCellEdit()
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      cancelled = true
      cancelCellEdit()
    }
  })

  input.addEventListener('blur', async () => {
    if (cancelled) return
    await saveCellEdit()
  })

  autoSizeCellEditInput(input)
  input.focus()
  input.select()
}

function autoSizeCellEditInput(input) {
  const cell = input.closest('td')
  if (!cell) return

  const computed = window.getComputedStyle(input)
  const canvas = autoSizeCellEditInput._canvas || (autoSizeCellEditInput._canvas = document.createElement('canvas'))
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`
  const text = input.value || input.placeholder || ''
  const textWidth = ctx.measureText(text).width

  const maxWidth = Math.max(52, cell.clientWidth - 14)
  const targetWidth = Math.min(maxWidth, Math.max(52, Math.ceil(textWidth + 20)))

  input.style.width = `${targetWidth}px`
  input.style.maxWidth = `${maxWidth}px`
}

function bindResultCellEditing() {
  const cells = resultsBody.querySelectorAll('.result-row .result-cell')
  cells.forEach(cellEl => {
    cellEl.addEventListener('dblclick', (e) => {
      if (state.pendingPreview || state.entryDraftActive) return

      const rowEl = e.currentTarget.closest('.result-row')
      if (!rowEl) return

      const rowIndex = Number(rowEl.dataset.rowIndex)
      const field = e.currentTarget.dataset.field
      if (!Number.isInteger(rowIndex) || !field) return

      e.preventDefault()
      e.stopPropagation()
      startCellEdit(rowIndex, field)
    })
  })
}

function bindResultRowSelection() {
  const rows = resultsBody.querySelectorAll('.result-row')
  rows.forEach(rowEl => {
    rowEl.addEventListener('click', (e) => {
      if (state.pendingPreview || !state.activeTable || state.entryDraftActive || state.cellEditDraft) return
      const rowIndex = Number(rowEl.dataset.rowIndex)
      if (!Number.isInteger(rowIndex)) return

      const multiSelect = e.ctrlKey || e.metaKey

      if (multiSelect) {
        if (state.selectedRowIndices.includes(rowIndex)) {
          state.selectedRowIndices = state.selectedRowIndices.filter(i => i !== rowIndex)
        } else {
          state.selectedRowIndices.push(rowIndex)
        }
      } else {
        state.selectedRowIndices = [rowIndex]
      }

      rows.forEach(el => {
        const idx = Number(el.dataset.rowIndex)
        el.classList.toggle('selected', state.selectedRowIndices.includes(idx))
      })

      refreshEntryButtons()
    })
  })
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
  setComparisonLayout(false)
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
    setComparisonLayout(true)
    comparisonArea.classList.remove('hidden')
    sqlPanel.classList.remove('hidden')
    resultsPanel.classList.remove('hidden')
    previewPanel.classList.remove('hidden')
    triggerPreviewPanelAnimation()
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

function setComparisonLayout(showPreview) {
  if (!comparisonGrid) return
  comparisonGrid.classList.toggle('preview-active', showPreview)
}

function triggerPreviewPanelAnimation() {
  previewPanel.classList.remove('preview-animate')
  void previewPanel.offsetWidth
  previewPanel.classList.add('preview-animate')
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
