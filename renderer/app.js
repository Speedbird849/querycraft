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
const connStringInput= document.getElementById('connStringInput')
const filePathInput  = document.getElementById('filePathInput')
const connStringGroup= document.getElementById('connStringGroup')
const fileGroup      = document.getElementById('fileGroup')
const driverTabs     = document.querySelectorAll('.driver-tab')

const schemaList     = document.getElementById('schemaList')
const historyList    = document.getElementById('historyList')

const filterBar      = document.getElementById('filterBar')
const filterRows     = document.getElementById('filterRows')
const addFilterBtn   = document.getElementById('addFilterBtn')
const clearFiltersBtn= document.getElementById('clearFiltersBtn')
const applyFiltersBtn= document.getElementById('applyFiltersBtn')

const queryInput     = document.getElementById('queryInput')
const runBtn         = document.getElementById('runBtn')

const emptyState     = document.getElementById('emptyState')
const sqlPanel       = document.getElementById('sqlPanel')
const sqlBody        = document.getElementById('sqlBody')
const sqlBadge       = document.getElementById('sqlBadge')
const resultsPanel   = document.getElementById('resultsPanel')
const resultsHead    = document.getElementById('resultsHead')
const resultsBody    = document.getElementById('resultsBody')
const resultsFooter  = document.getElementById('resultsFooter')
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
}


/* ══════════════════════════════════════════
   3. CONNECTION MODAL
══════════════════════════════════════════ */

// Open modal
connectBtn.addEventListener('click', () => {
  if (state.connected) {
    handleDisconnect()
  } else {
    openModal()
  }
})

modalClose.addEventListener('click', closeModal)
modalCancel.addEventListener('click', closeModal)
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal() })

function openModal() {
  modalOverlay.classList.remove('hidden')
  hideModalError()
  connStringInput.value = ''
  connStringInput.focus()
}

function closeModal() {
  modalOverlay.classList.add('hidden')
}

// Driver tab switching
driverTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    driverTabs.forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    state.driver = tab.dataset.driver

    if (state.driver === 'sqlite') {
      connStringGroup.classList.add('hidden')
      fileGroup.classList.remove('hidden')
      connStringInput.placeholder = ''
    } else {
      connStringGroup.classList.remove('hidden')
      fileGroup.classList.add('hidden')
      connStringInput.placeholder =
        state.driver === 'postgres'
          ? 'postgres://user:pass@localhost:5432/mydb'
          : 'mysql://user:pass@localhost:3306/mydb'
    }
  })
})

// Connect button in modal
modalConnect.addEventListener('click', handleConnect)
connStringInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleConnect() })

async function handleConnect() {
  const connString = state.driver === 'sqlite'
    ? filePathInput.value.trim()
    : connStringInput.value.trim()

  if (!connString) {
    showModalError('Please enter a connection string.')
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

  // Extract db name from connection string for display
  state.dbName = extractDbName(connString, state.driver)
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
  setConnected(false)
  schemaList.innerHTML = '<div class="sidebar-empty">No connection</div>'
  filterBar.classList.add('hidden')
  setStatus('Disconnected')
}

function setConnected(yes) {
  dbDot.className = 'db-dot ' + (yes ? 'connected' : 'disconnected')
  dbLabel.textContent = yes ? state.dbName : 'Not connected'
  connectBtn.textContent = yes ? 'Disconnect' : 'Connect'
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

  setStatus(`${result.tables.length} tables loaded`)
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

  // Toggle column visibility on header click
  let expanded = true
  header.addEventListener('click', () => {
    expanded = !expanded
    colsDiv.style.display = expanded ? 'block' : 'none'
    header.querySelector('.tbl-chevron').textContent = expanded ? '▾' : '▸'
  })

  // Double-click table name → SELECT * from it
  header.addEventListener('dblclick', () => {
    selectTable(tableName)
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
  showFilterBar(tableName)
}


/* ══════════════════════════════════════════
   5. FILTER BAR
══════════════════════════════════════════ */

function showFilterBar(tableName) {
  filterBar.classList.remove('hidden')
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

addFilterBtn.addEventListener('click', () => {
  if (state.activeTable) addFilter(state.activeTable)
})

clearFiltersBtn.addEventListener('click', () => {
  filterRows.innerHTML = ''
  state.filters = []
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

async function runQuery(sql) {
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


/* ══════════════════════════════════════════
   7. RESULTS RENDERER
══════════════════════════════════════════ */

function renderResults(fields, rows, ms) {
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

  resultsFooter.innerHTML = `<span>${rows.length} rows</span><span>${ms}ms</span>`
}

function showPanels(state) {
  emptyState.classList.add('hidden')
  sqlPanel.classList.add('hidden')
  resultsPanel.classList.add('hidden')
  errorPanel.classList.add('hidden')

  if (state === 'results') {
    sqlPanel.classList.remove('hidden')
    resultsPanel.classList.remove('hidden')
  } else if (state === 'error') {
    errorPanel.classList.remove('hidden')
  } else if (state === 'empty') {
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
