import {
  quoteTableIdentifier,
  quoteColumnIdentifier,
  toSqlLiteral,
  toSqlInputLiteral,
} from './scripts/sql-utils.js'
import { escapeHtml } from './scripts/text-utils.js'

/* ══════════════════════════════════════════
   1. ELEMENT REFS
══════════════════════════════════════════ */
const dbBadge        = document.getElementById('dbBadge')
const dbDot          = document.getElementById('dbDot')
const dbLabel        = document.getElementById('dbLabel')
const refreshBtn     = document.getElementById('refreshBtn')
const connectBtn     = document.getElementById('connectBtn')
const topbarCommitBtn = document.getElementById('topbarCommitBtn')
const topbarCommitText = document.getElementById('topbarCommitText')

const modalOverlay   = document.getElementById('modalOverlay')
const modalClose     = document.getElementById('modalClose')
const modalCancel    = document.getElementById('modalCancel')
const modalConnect   = document.getElementById('modalConnect')
const modalError     = document.getElementById('modalError')
const hostFields     = document.getElementById('hostFields')

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

const commitModalOverlay    = document.getElementById('commitModalOverlay')
const commitModalClose      = document.getElementById('commitModalClose')
const commitModalCancelBtn  = document.getElementById('commitModalCancelBtn')
const commitModalDiscardBtn = document.getElementById('commitModalDiscardBtn')
const commitModalApplyBtn   = document.getElementById('commitModalApplyBtn')
const commitModalBadge      = document.getElementById('commitModalBadge')
const commitModalBody       = document.getElementById('commitModalBody')

const schemaList     = document.getElementById('schemaList')
const queryInput     = document.getElementById('queryInput')
const runBtn         = document.getElementById('runBtn')

const emptyState       = document.getElementById('emptyState')
const schemaOverview   = document.getElementById('schemaOverview')
const schemaOverviewTitle = document.getElementById('schemaOverviewTitle')
const schemaGrid       = document.getElementById('schemaGrid')

const comparisonArea = document.getElementById('comparisonArea')

const resultsPanel      = document.getElementById('resultsPanel')
const resultsScroll     = document.getElementById('resultsScroll')
const resultsHead       = document.getElementById('resultsHead')
const resultsBody       = document.getElementById('resultsBody')
const resultsFooter     = document.getElementById('resultsFooter')
const addRowBtn         = document.getElementById('addRowBtn')
const removeEntryBtn    = document.getElementById('removeEntryBtn')

const errorPanel     = document.getElementById('errorPanel')
const errorBody      = document.getElementById('errorBody')
const errorReturnBtn = document.getElementById('errorReturnBtn')

const statusMsg      = document.getElementById('statusMsg')
const statusDriver   = document.getElementById('statusDriver')


/* ══════════════════════════════════════════
   2. STATE & GLOBAL STAGED CHANGES
══════════════════════════════════════════ */
const PAGE_SIZE = 50

const pagination = {
  baseSql: '',
  isPaginatable: false,
  offset: 0,
  pageSize: PAGE_SIZE,
  hasMore: false,
  loading: false,
}

const state = {
  connected: false,
  dbName: '',
  tables: [],
  columns: {},
  activeTable: null,
  resultFields: [],
  resultRows: [],
  selectedRowKeys: new Set(),
  resultRightLabel: '',
  cellEditDraft: null, // { rowKey, isInsert, field, value, originalValue }
}

// Global staged changes across all tables:
// Map(tableName -> {
//   updates: Map(pkKey -> { pkWhere: { col: val }, changes: Map(field -> newVal), originalValues: { col: val } }),
//   inserts: [ { clientId: string, values: { [field]: val } } ],
//   deletes: Map(pkKey -> { pkWhere: { col: val }, row: {...} })
// })
const stagedChanges = new Map()

let nextInsertId = 1
function createInsertClientId() {
  return `ins_${Date.now()}_${nextInsertId++}`
}

function getTableStaged(tableName) {
  if (!stagedChanges.has(tableName)) {
    stagedChanges.set(tableName, {
      updates: new Map(),
      inserts: [],
      deletes: new Map(),
    })
  }
  return stagedChanges.get(tableName)
}

function cleanupTableStaged(tableName) {
  if (!stagedChanges.has(tableName)) return
  const entry = stagedChanges.get(tableName)
  if (entry.updates.size === 0 && entry.inserts.length === 0 && entry.deletes.size === 0) {
    stagedChanges.delete(tableName)
  }
}

function getTableStagedCount(tableName) {
  if (!tableName || !stagedChanges.has(tableName)) return 0
  const entry = stagedChanges.get(tableName)
  let updateCount = 0
  for (const [pkKey] of entry.updates) {
    if (!entry.deletes.has(pkKey)) {
      updateCount++
    }
  }
  return entry.inserts.length + entry.deletes.size + updateCount
}

function getGlobalStagedCount() {
  let total = 0
  for (const tableName of stagedChanges.keys()) {
    total += getTableStagedCount(tableName)
  }
  return total
}

function clearAllStagedChanges() {
  stagedChanges.clear()
  syncSidebarStagedBadges()
  updateStagedButtons()
}

function getPrimaryKeyColumns(tableName) {
  if (!tableName) return []
  const cols = state.columns[tableName] || []
  return cols.filter(col => col.is_pk)
}

function getRowPkKey(tableName, row) {
  if (!tableName || !row) return null
  const pkCols = getPrimaryKeyColumns(tableName)
  if (!pkCols || pkCols.length === 0) return null

  const sortedCols = [...pkCols].sort((a, b) => a.column_name.localeCompare(b.column_name))
  const keyParts = []
  for (const col of sortedCols) {
    const val = row[col.column_name]
    if (val === undefined || val === null) return null
    keyParts.push([col.column_name, String(val)])
  }
  return JSON.stringify(keyParts)
}

function getRowPkWhere(tableName, row) {
  if (!tableName || !row) return null
  const pkCols = getPrimaryKeyColumns(tableName)
  if (!pkCols || pkCols.length === 0) return null

  const where = {}
  for (const col of pkCols) {
    where[col.column_name] = row[col.column_name]
  }
  return where
}


/* ══════════════════════════════════════════
   3. CONNECTION MODAL
══════════════════════════════════════════ */

let disconnectTimer = null

connectBtn.addEventListener('click', () => {
  if (!state.connected) {
    openModal()
    return
  }

  if (connectBtn.dataset.confirming === 'true') {
    clearTimeout(disconnectTimer)
    connectBtn.dataset.confirming = 'false'
    handleDisconnect()
  } else {
    connectBtn.dataset.confirming = 'true'
    connectBtn.textContent = 'Confirm?'
    connectBtn.classList.remove('btn-disconnect')
    connectBtn.classList.add('btn-confirm')

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

refreshBtn.addEventListener('click', async () => {
  if (!state.connected) return
  if (getGlobalStagedCount() > 0) {
    setStatus('Commit or discard staged changes before refreshing schema.')
    return
  }

  refreshBtn.disabled = true
  try {
    await loadSchema()
    setStatus('Schema refreshed')
  } finally {
    refreshBtn.disabled = !state.connected
  }
})

modalClose.addEventListener('click', closeModal)
modalCancel.addEventListener('click', closeModal)
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal() })

function openModal() {
  modalOverlay.classList.remove('hidden')
  hideModalError()
  updatePreview()
  fieldHost.focus()
}

function closeModal() {
  modalOverlay.classList.add('hidden')
  pasteMode = false
  pasteConnBtn.classList.remove('active')
  rawConnGroup.classList.add('hidden')
  rawConnInput.value = ''
}

;[fieldHost, fieldPort, fieldDatabase, fieldUser, fieldPassword].forEach(el => {
  el.addEventListener('input', updatePreview)
  el.addEventListener('change', updatePreview)
})

fieldSSL.addEventListener('click', () => {
  const active = fieldSSL.dataset.active === 'true'
  fieldSSL.dataset.active = String(!active)
  fieldSSL.classList.toggle('active', !active)
  updatePreview()
})

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

rawConnInput.addEventListener('input', () => {
  connPreview.textContent = rawConnInput.value || buildConnectionString()
})

function updatePreview() {
  connPreview.textContent = buildConnectionString()
}

function buildConnectionString() {
  const host = fieldHost.value.trim() || 'localhost'
  const port = fieldPort.value.trim() || '5432'
  const db   = fieldDatabase.value.trim() || 'postgres'
  const user = fieldUser.value.trim() || 'postgres'
  const pass = fieldPassword.value.trim() || ''
  const ssl  = fieldSSL.dataset.active === 'true'

  let str = `postgres://`
  if (user)       str += user
  if (pass)       str += `:${pass}`
  if (user || pass) str += '@'
  str += host
  if (port)       str += `:${port}`
  str += `/${db}`
  if (ssl)        str += '?sslmode=require'

  return str
}

modalConnect.addEventListener('click', handleConnect)
modalOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (e.target && e.target.tagName === 'BUTTON' && e.target !== modalConnect) {
      return
    }
    e.preventDefault()
    handleConnect()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeModal()
  }
})

async function handleConnect() {
  if (modalConnect.disabled) return

  const connString = (pasteMode && rawConnInput.value.trim())
    ? rawConnInput.value.trim()
    : buildConnectionString()

  modalConnect.disabled = true
  modalConnect.textContent = 'Connecting…'
  hideModalError()

  const result = await window.db.connect(connString)

  modalConnect.disabled = false
  modalConnect.textContent = 'Connect →'

  if (!result.ok) {
    showModalError(result.error)
    return
  }

  state.dbName = fieldDatabase.value.trim() || 'postgres'
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
  state.resultFields = []
  state.resultRows = []
  state.selectedRowKeys.clear()
  state.resultRightLabel = ''
  state.cellEditDraft = null
  clearAllStagedChanges()

  setConnected(false)
  schemaList.innerHTML = '<div class="sidebar-empty">No connection</div>'

  comparisonArea.classList.add('hidden')
  resultsPanel.classList.add('hidden')
  errorPanel.classList.add('hidden')
  schemaOverview.classList.add('hidden')
  schemaGrid.innerHTML = ''
  emptyState.classList.remove('hidden')
  resultsHead.innerHTML = ''
  resultsBody.innerHTML = ''
  resultsFooter.innerHTML = ''
  queryInput.value = ''
  queryInput.style.height = 'auto'
  updateStagedButtons()

  setStatus('Disconnected')
}

function handleConnectionLost(errorMessage) {
  if (!state.connected) return

  state.connected = false
  state.tables = []
  state.columns = {}
  state.activeTable = null
  state.resultFields = []
  state.resultRows = []
  state.selectedRowKeys.clear()
  state.resultRightLabel = ''
  state.cellEditDraft = null
  clearAllStagedChanges()

  setConnected(false)
  schemaList.innerHTML = '<div class="sidebar-empty">Connection lost</div>'

  comparisonArea.classList.add('hidden')
  resultsPanel.classList.add('hidden')
  schemaOverview.classList.add('hidden')
  schemaGrid.innerHTML = ''
  emptyState.classList.add('hidden')

  resultsHead.innerHTML = ''
  resultsBody.innerHTML = ''
  resultsFooter.innerHTML = ''
  queryInput.value = ''
  queryInput.style.height = 'auto'
  updateStagedButtons()

  showPanels('error')
  errorBody.textContent = `Database connection lost: ${errorMessage || 'Connection terminated unexpectedly.'}`
  setStatus('Connection lost')
}

if (window.db?.onConnectionLost) {
  window.db.onConnectionLost((data) => {
    handleConnectionLost(data?.error)
  })
}

function setConnected(yes) {
  dbDot.className = 'db-dot ' + (yes ? 'connected' : 'disconnected')
  dbLabel.textContent = yes ? state.dbName : 'Not connected'
  connectBtn.textContent = yes ? 'Disconnect' : 'Connect'
  connectBtn.dataset.confirming = 'false'
  connectBtn.classList.remove('btn-confirm')
  connectBtn.classList.toggle('btn-disconnect', yes)
  connectBtn.classList.toggle('btn-connect', !yes)
  refreshBtn.disabled = !yes
  statusDriver.textContent = yes ? 'PostgreSQL' : ''
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


/* ══════════════════════════════════════════
   4. SCHEMA SIDEBAR
══════════════════════════════════════════ */

async function loadSchema() {
  setStatus('Loading schema…')
  const result = await window.db.tables()

  if (!result.ok) {
    schemaList.innerHTML = `<div class="sidebar-empty">${escapeHtml(result.error)}</div>`
    return
  }

  state.tables = result.tables
  schemaList.innerHTML = ''

  for (const table of result.tables) {
    const colResult = await window.db.columns(table)
    state.columns[table] = colResult.ok ? colResult.columns : []
    schemaList.appendChild(buildTableNode(table, state.columns[table]))
  }

  if (state.activeTable && !result.tables.includes(state.activeTable)) {
    state.activeTable = null
  }
  syncActiveSchemaTable()
  syncSidebarStagedBadges()
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
        <span class="schema-card-name">${escapeHtml(table)}</span>
        <span class="schema-card-count">${cols.length} col${cols.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="schema-card-cols">
        ${preview.map(col => `
          <div class="schema-card-col">
            <span class="schema-card-col-name">${escapeHtml(col.column_name)}</span>
            ${col.is_pk
              ? '<span class="schema-card-col-pk">PK</span>'
              : `<span class="schema-card-col-type">${escapeHtml(col.data_type)}</span>`}
          </div>
        `).join('')}
        ${extra > 0 ? `<div class="schema-card-more">+${extra} more column${extra !== 1 ? 's' : ''}</div>` : ''}
      </div>
    `

    card.addEventListener('click', () => selectTable(table))
    schemaGrid.appendChild(card)
  }

  emptyState.classList.add('hidden')
  schemaOverview.classList.remove('hidden')
}

function buildTableNode(tableName, columns) {
  const wrapper = document.createElement('div')
  wrapper.className = 'schema-table'
  wrapper.dataset.tableName = tableName

  const header = document.createElement('div')
  header.className = 'schema-table-header'
  header.innerHTML = `
    <span class="tbl-icon">▤</span>
    <span class="tbl-name">${escapeHtml(tableName)}</span>
    <span class="tbl-staged-badge hidden" data-table="${escapeHtml(tableName)}">0</span>
    <button class="tbl-toggle-btn" type="button" aria-label="Collapse columns" aria-expanded="true" title="Collapse">−</button>
  `

  const colsDiv = document.createElement('div')
  colsDiv.className = 'schema-cols'
  colsDiv.innerHTML = columns.map(col => `
    <div class="col-row">
      <span class="col-name">${escapeHtml(col.column_name)}</span>
      ${col.is_pk
        ? '<span class="col-pk">PK</span>'
        : `<span class="col-type">${escapeHtml(col.data_type)}</span>`}
    </div>
  `).join('')

  const toggleBtn = header.querySelector('.tbl-toggle-btn')
  let expanded = true
  const setExpanded = (isExpanded) => {
    expanded = isExpanded
    colsDiv.style.display = expanded ? 'block' : 'none'
    toggleBtn.textContent = expanded ? '−' : '+'
    toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    toggleBtn.setAttribute('aria-label', expanded ? 'Collapse columns' : 'Expand columns')
    toggleBtn.title = expanded ? 'Collapse' : 'Expand'
  }

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    setExpanded(!expanded)
  })

  header.addEventListener('click', () => {
    selectTable(tableName)
  })

  wrapper.appendChild(header)
  wrapper.appendChild(colsDiv)
  return wrapper
}

function syncActiveSchemaTable() {
  const nodes = schemaList.querySelectorAll('.schema-table')
  nodes.forEach(node => {
    const isActive = node.dataset.tableName === state.activeTable
    node.classList.toggle('active', isActive)
  })
}

function syncSidebarStagedBadges() {
  const badges = schemaList.querySelectorAll('.tbl-staged-badge')
  badges.forEach(badge => {
    const table = badge.dataset.table
    const count = getTableStagedCount(table)
    if (count > 0) {
      badge.textContent = count
      badge.classList.remove('hidden')
    } else {
      badge.textContent = '0'
      badge.classList.add('hidden')
    }
  })
}

function selectTable(tableName) {
  state.activeTable = tableName
  syncActiveSchemaTable()
  state.selectedRowKeys.clear()
  state.cellEditDraft = null
  updateStagedButtons()
  syncSidebarStagedBadges()
  const sql = `SELECT * FROM ${quoteTableIdentifier(tableName)};`
  queryInput.value = sql
  runQuery(sql)
}

function canPaginateQuery(sql) {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  if (!/^(select|with)\b/i.test(trimmed)) return false
  if (/\blimit\s+\d+/i.test(trimmed)) return false
  return true
}

function buildWindowSql(sql, limit, offset) {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  if (/\b(union|intersect|except)\b/i.test(trimmed)) {
    return `SELECT * FROM (\n${trimmed}\n) AS _window LIMIT ${limit} OFFSET ${offset};`
  }
  return `${trimmed}\nLIMIT ${limit} OFFSET ${offset};`
}

/* ══════════════════════════════════════════
   5. QUERY RUNNER & ACTIONS
══════════════════════════════════════════ */

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

addRowBtn.addEventListener('click', handleAddRow)
removeEntryBtn.addEventListener('click', handleDeleteSelected)
topbarCommitBtn.addEventListener('click', openCommitModal)
commitModalClose.addEventListener('click', closeCommitModal)
commitModalCancelBtn.addEventListener('click', closeCommitModal)
commitModalDiscardBtn.addEventListener('click', () => {
  handleDiscardChanges()
  closeCommitModal()
})
commitModalApplyBtn.addEventListener('click', handleCommitChanges)
commitModalOverlay.addEventListener('click', (e) => {
  if (e.target === commitModalOverlay) closeCommitModal()
})

errorReturnBtn.addEventListener('click', returnToSchemaOverview)
document.addEventListener('keydown', handleGlobalShortcuts)

if (resultsScroll) {
  resultsScroll.addEventListener('scroll', handleResultsScroll)
}
updateStagedButtons()

function handleGlobalShortcuts(e) {
  if (e.key === 'Escape') {
    if (!commitModalOverlay.classList.contains('hidden')) {
      e.preventDefault()
      closeCommitModal()
      return
    }
    if (!errorPanel.classList.contains('hidden')) {
      e.preventDefault()
      returnToSchemaOverview()
      return
    }
  }
}

function returnToSchemaOverview() {
  if (!state.connected) {
    showPanels('empty')
    setStatus('Disconnected')
    return
  }

  showPanels('schema')
  setStatus('Showing schema overview')
}

async function runQuery(sql) {
  setStatus('Running query…')
  showPanels('loading')
  const start = Date.now()

  const trimmed = sql.trim().replace(/;+\s*$/, '')
  const paginatable = canPaginateQuery(trimmed)

  pagination.baseSql = trimmed
  pagination.isPaginatable = paginatable
  pagination.offset = 0
  pagination.pageSize = PAGE_SIZE
  pagination.hasMore = false
  pagination.loading = false

  let execSql = paginatable ? buildWindowSql(trimmed, PAGE_SIZE, 0) : sql
  let result = await window.db.query(execSql)

  if (paginatable && !result.ok) {
    pagination.isPaginatable = false
    result = await window.db.query(sql)
  }

  const ms = Date.now() - start

  if (!result.ok) {
    pagination.isPaginatable = false
    showPanels('error')
    errorBody.textContent = result.error
    setStatus('Query failed')
    return
  }

  if (pagination.isPaginatable) {
    pagination.offset = result.rows.length
    pagination.hasMore = result.rows.length === PAGE_SIZE
  }

  renderResults(result.fields, result.rows, ms)
  showPanels('results')

  if (resultsScroll) {
    resultsScroll.scrollTop = 0
  }

  if (pagination.isPaginatable && pagination.hasMore) {
    setStatus(`${result.rows.length} rows loaded · ${ms}ms · scroll for more`)
    void maybeFillViewport()
  } else {
    setStatus(`${result.rows.length} rows · ${ms}ms`)
  }
}

function updateStagedButtons() {
  const hasTable = Boolean(state.activeTable)
  const pkCount = getPrimaryKeyColumns(state.activeTable).length
  const hasResultFields = state.resultFields.length > 0
  const hasCellEdit = Boolean(state.cellEditDraft)
  const totalCount = getGlobalStagedCount()

  addRowBtn.disabled = !hasTable || !hasResultFields || hasCellEdit

  const hasSelected = state.selectedRowKeys.size > 0
  let canDelete = false
  if (hasTable && hasSelected && !hasCellEdit) {
    const tableEntry = stagedChanges.get(state.activeTable)
    const hasDbRows = Array.from(state.selectedRowKeys).some(key => {
      const isInsert = tableEntry && tableEntry.inserts.some(i => i.clientId === key)
      return !isInsert
    })
    canDelete = !hasDbRows || pkCount > 0
  }
  removeEntryBtn.disabled = !canDelete

  // Topbar commit review button
  if (totalCount > 0) {
    topbarCommitBtn.classList.remove('hidden')
    topbarCommitText.textContent = `Changes (${totalCount})`
  } else {
    topbarCommitBtn.classList.add('hidden')
    topbarCommitText.textContent = 'Changes (0)'
    closeCommitModal()
  }
}

/* ══════════════════════════════════════════
   6. COMBINED COMMIT MODAL & REVIEW VIEW
══════════════════════════════════════════ */

function openCommitModal() {
  if (getGlobalStagedCount() === 0) return
  renderCommitModal()
  commitModalOverlay.classList.remove('hidden')
}

function closeCommitModal() {
  commitModalOverlay.classList.add('hidden')
}

function buildCommitStatements() {
  const statements = []
  let affectedTablesCount = 0

  for (const [tableName, entry] of stagedChanges.entries()) {
    if (entry.updates.size > 0 || entry.deletes.size > 0) {
      const pkFields = getPrimaryKeyColumns(tableName)
      if (pkFields.length === 0) {
        return {
          error: `Table "${tableName}" has updates or deletes but lacks a primary key.`,
          statements: [],
          affectedTablesCount: 0,
        }
      }
    }

    const tableRef = quoteTableIdentifier(tableName)
    let tableHasChanges = false

    // 1. DELETES
    for (const [, delData] of entry.deletes) {
      const { pkWhere } = delData
      if (!pkWhere) continue
      const whereClauses = Object.entries(pkWhere).map(([col, val]) => {
        return `${quoteColumnIdentifier(col)} = ${toSqlLiteral(val)}`
      })
      statements.push(`DELETE FROM ${tableRef} WHERE ${whereClauses.join(' AND ')};`)
      tableHasChanges = true
    }

    // 2. INSERTS
    for (const insert of entry.inserts) {
      const filledFields = Object.keys(insert.values).filter(f => {
        const val = insert.values[f]
        return val !== undefined && val !== null && String(val).trim() !== ''
      })

      if (filledFields.length === 0) {
        statements.push(`INSERT INTO ${tableRef} DEFAULT VALUES;`)
      } else {
        const colsSql = filledFields.map(quoteColumnIdentifier).join(', ')
        const valsSql = filledFields.map(f => toSqlInputLiteral(insert.values[f])).join(', ')
        statements.push(`INSERT INTO ${tableRef} (${colsSql}) VALUES (${valsSql});`)
      }
      tableHasChanges = true
    }

    // 3. UPDATES
    for (const [pkKey, updateData] of entry.updates) {
      if (entry.deletes.has(pkKey)) continue
      const { pkWhere, changes } = updateData
      if (!changes || changes.size === 0 || !pkWhere) continue

      const setClauses = []
      for (const [field, newVal] of changes) {
        setClauses.push(`${quoteColumnIdentifier(field)} = ${toSqlInputLiteral(newVal)}`)
      }

      const whereClauses = Object.entries(pkWhere).map(([col, val]) => {
        return `${quoteColumnIdentifier(col)} = ${toSqlLiteral(val)}`
      })

      statements.push(`UPDATE ${tableRef} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')};`)
      tableHasChanges = true
    }

    if (tableHasChanges) {
      affectedTablesCount++
    }
  }

  return { statements, affectedTablesCount, error: null }
}

function renderCommitModal() {
  const totalCount = getGlobalStagedCount()
  const { statements, affectedTablesCount, error } = buildCommitStatements()

  commitModalBadge.textContent = `${totalCount} change${totalCount !== 1 ? 's' : ''} across ${affectedTablesCount} table${affectedTablesCount !== 1 ? 's' : ''}`
  commitModalApplyBtn.textContent = `Commit (${totalCount}) Changes →`
  commitModalApplyBtn.disabled = Boolean(error) || totalCount === 0

  let html = ''

  if (error) {
    html += `<div class="modal-error">${escapeHtml(error)}</div>`
  }

  for (const [tableName, entry] of stagedChanges.entries()) {
    const tableCount = getTableStagedCount(tableName)
    if (tableCount === 0) continue

    html += `
      <div class="commit-table-group">
        <div class="commit-table-group-header">
          <span class="commit-table-group-title">
            <span class="tbl-icon">▤</span>
            <span>${escapeHtml(tableName)}</span>
          </span>
          <span class="tbl-staged-badge">${tableCount}</span>
        </div>
        <div class="commit-table-items">
    `

    // Deletes
    for (const [, delData] of entry.deletes) {
      const { pkWhere, row } = delData
      const pkText = pkWhere
        ? Object.entries(pkWhere).map(([k, v]) => `${k}=${v}`).join(', ')
        : 'row'
      const rowSnippet = row
        ? Object.entries(row).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')
        : ''

      html += `
        <div class="commit-change-item">
          <span class="change-badge badge-delete">DELETE</span>
          <div class="commit-change-desc">
            <strong>Row (${escapeHtml(pkText)})</strong>
            ${rowSnippet ? `<span class="commit-change-diff" style="margin-left:8px; opacity:0.7;">(${escapeHtml(rowSnippet)})</span>` : ''}
          </div>
        </div>
      `
    }

    // Inserts
    for (const insert of entry.inserts) {
      const populated = Object.entries(insert.values).filter(([, v]) => v !== '' && v !== null && v !== undefined)
      const valuesText = populated.length > 0
        ? populated.map(([k, v]) => `<span class="diff-field">${escapeHtml(k)}:</span> <span class="diff-new">${escapeHtml(String(v))}</span>`).join(' · ')
        : '<span class="null-value">[DEFAULT VALUES]</span>'

      html += `
        <div class="commit-change-item">
          <span class="change-badge badge-insert">INSERT</span>
          <div class="commit-change-desc">
            <strong>New row:</strong> ${valuesText}
          </div>
        </div>
      `
    }

    // Updates
    for (const [pkKey, updateData] of entry.updates) {
      if (entry.deletes.has(pkKey)) continue
      const { pkWhere, changes, originalValues } = updateData
      if (!changes || changes.size === 0) continue

      const pkText = pkWhere
        ? Object.entries(pkWhere).map(([k, v]) => `${k}=${v}`).join(', ')
        : 'row'

      const diffItems = []
      for (const [col, newVal] of changes) {
        const oldVal = originalValues?.[col]
        const oldDisplay = (oldVal === null || oldVal === undefined) ? 'NULL' : String(oldVal)
        const newDisplay = (newVal === null || newVal === undefined || newVal === '') ? 'NULL' : String(newVal)
        diffItems.push(`
          <span class="commit-change-diff">
            <span class="diff-field">${escapeHtml(col)}:</span>
            <span class="diff-old">${escapeHtml(oldDisplay)}</span>
            <span class="diff-arrow">→</span>
            <span class="diff-new">${escapeHtml(newDisplay)}</span>
          </span>
        `)
      }

      html += `
        <div class="commit-change-item">
          <span class="change-badge badge-update">UPDATE</span>
          <div class="commit-change-desc">
            <strong>Row (${escapeHtml(pkText)}):</strong> ${diffItems.join(' · ')}
          </div>
        </div>
      `
    }

    html += `
        </div>
      </div>
    `
  }

  // Transaction SQL Preview Block
  if (statements.length > 0) {
    const fullSql = ['BEGIN;', ...statements, 'COMMIT;'].join('\n')
    html += `
      <div class="commit-sql-preview">
        <div class="commit-sql-header" id="commitSqlToggle">
          <span>Transaction SQL Preview (${statements.length} statements)</span>
          <span id="commitSqlToggleIcon">▼</span>
        </div>
        <pre class="commit-sql-code" id="commitSqlCode">${escapeHtml(fullSql)}</pre>
      </div>
    `
  }

  commitModalBody.innerHTML = html

  const toggleBtn = commitModalBody.querySelector('#commitSqlToggle')
  const codeBlock = commitModalBody.querySelector('#commitSqlCode')
  const toggleIcon = commitModalBody.querySelector('#commitSqlToggleIcon')
  if (toggleBtn && codeBlock) {
    toggleBtn.addEventListener('click', () => {
      const isHidden = codeBlock.style.display === 'none'
      codeBlock.style.display = isHidden ? 'block' : 'none'
      if (toggleIcon) toggleIcon.textContent = isHidden ? '▼' : '►'
    })
  }
}

/* ══════════════════════════════════════════
   7. STAGED MUTATIONS (INSERTS, UPDATES, DELETES)
══════════════════════════════════════════ */

function handleAddRow() {
  if (!state.activeTable || state.resultFields.length === 0) return

  const clientId = createInsertClientId()
  const values = {}
  for (const f of state.resultFields) {
    values[f] = ''
  }

  const tableEntry = getTableStaged(state.activeTable)
  tableEntry.inserts.unshift({ clientId, values })

  state.selectedRowKeys = new Set([clientId])
  updateStagedButtons()
  syncSidebarStagedBadges()
  renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)

  if (state.resultFields.length > 0) {
    startCellEdit(clientId, true, state.resultFields[0])
  }
}

function handleDeleteSelected() {
  if (!state.activeTable || state.selectedRowKeys.size === 0) return

  const tableName = state.activeTable
  const pkFields = getPrimaryKeyColumns(tableName)
  const tableEntry = getTableStaged(tableName)

  for (const key of state.selectedRowKeys) {
    const isInsert = tableEntry.inserts.some(i => i.clientId === key)
    if (!isInsert && pkFields.length === 0) {
      showPanels('error')
      errorBody.textContent = 'Deleting database rows requires at least one primary key column on the table.'
      setStatus('Cannot delete without primary key')
      return
    }
  }

  for (const key of state.selectedRowKeys) {
    const insertIdx = tableEntry.inserts.findIndex(i => i.clientId === key)
    if (insertIdx !== -1) {
      tableEntry.inserts.splice(insertIdx, 1)
    } else {
      if (tableEntry.deletes.has(key)) {
        tableEntry.deletes.delete(key)
      } else {
        const row = state.resultRows.find((r, i) => {
          const pk = getRowPkKey(tableName, r)
          return (pk && pk === key) || ('idx_' + i) === key
        })
        if (row) {
          const pkWhere = getRowPkWhere(tableName, row)
          tableEntry.deletes.set(key, { pkWhere, row })
        }
      }
    }
  }

  cleanupTableStaged(tableName)
  state.selectedRowKeys.clear()
  updateStagedButtons()
  syncSidebarStagedBadges()
  renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
}

function handleDiscardChanges() {
  clearAllStagedChanges()
  state.selectedRowKeys.clear()
  state.cellEditDraft = null
  renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
  setStatus('All staged changes discarded')
}

async function handleCommitChanges() {
  const { statements, affectedTablesCount, error } = buildCommitStatements()
  if (error) {
    showPanels('error')
    errorBody.textContent = `Commit failed: ${error}`
    setStatus('Commit failed')
    return
  }
  if (statements.length === 0) {
    clearAllStagedChanges()
    closeCommitModal()
    return
  }

  commitModalApplyBtn.disabled = true
  commitModalDiscardBtn.disabled = true
  setStatus(`Applying ${statements.length} changes across ${affectedTablesCount} table${affectedTablesCount !== 1 ? 's' : ''}…`)

  try {
    const result = await window.db.applyChanges(statements)
    if (!result.ok) {
      showPanels('error')
      errorBody.textContent = `Transaction failed: ${result.error}`
      setStatus('Commit failed')
      return
    }

    clearAllStagedChanges()
    closeCommitModal()
    setStatus(`Successfully committed ${result.count} change${result.count !== 1 ? 's' : ''} across ${affectedTablesCount} table${affectedTablesCount !== 1 ? 's' : ''}`)

    if (state.activeTable) {
      const sql = `SELECT * FROM ${quoteTableIdentifier(state.activeTable)};`
      queryInput.value = sql
      await runQuery(sql)
    }
  } catch (err) {
    showPanels('error')
    errorBody.textContent = `Commit error: ${err.message}`
    setStatus('Commit failed')
  } finally {
    commitModalApplyBtn.disabled = false
    commitModalDiscardBtn.disabled = false
    updateStagedButtons()
    syncSidebarStagedBadges()
  }
}

function startCellEdit(rowKey, isInsert, field) {
  if (!state.activeTable) return
  const tableName = state.activeTable
  const tableEntry = stagedChanges.get(tableName)

  if (isInsert) {
    const insert = tableEntry?.inserts.find(i => i.clientId === rowKey)
    if (!insert || !(field in insert.values)) return
    const originalValue = insert.values[field] ?? ''
    state.cellEditDraft = {
      rowKey,
      isInsert: true,
      field,
      value: originalValue,
      originalValue,
    }
    renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
    return
  }

  const pkFields = getPrimaryKeyColumns(tableName)
  if (pkFields.length === 0) {
    showPanels('error')
    errorBody.textContent = 'Inline edit requires at least one primary key column on the table.'
    setStatus('Cannot edit without primary key')
    return
  }

  const row = state.resultRows.find((r, i) => {
    const pk = getRowPkKey(tableName, r)
    return (pk && pk === rowKey) || ('idx_' + i) === rowKey
  })
  if (!row || !(field in row)) return

  const stagedVal = tableEntry?.updates.get(rowKey)?.changes.get(field)
  const currentValue = stagedVal !== undefined ? stagedVal : row[field]
  const originalValue = row[field]

  state.cellEditDraft = {
    rowKey,
    isInsert: false,
    field,
    value: currentValue === null || currentValue === undefined ? '' : String(currentValue),
    originalValue,
  }

  renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
}

function cancelCellEdit() {
  if (!state.cellEditDraft) return
  state.cellEditDraft = null
  renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
}

function saveCellEdit() {
  if (!state.cellEditDraft || !state.activeTable) return

  const { rowKey, isInsert, field, value, originalValue } = state.cellEditDraft
  const tableName = state.activeTable
  state.cellEditDraft = null

  if (isInsert) {
    const tableEntry = getTableStaged(tableName)
    const insert = tableEntry.inserts.find(i => i.clientId === rowKey)
    if (insert) {
      insert.values[field] = value
      updateStagedButtons()
      syncSidebarStagedBadges()
      renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
    }
    return
  }

  const normalizedOriginal = originalValue === null || originalValue === undefined ? '' : String(originalValue)
  const pkFields = getPrimaryKeyColumns(tableName)

  if (value === normalizedOriginal) {
    if (stagedChanges.has(tableName)) {
      const tableEntry = stagedChanges.get(tableName)
      if (tableEntry.updates.has(rowKey)) {
        tableEntry.updates.get(rowKey).changes.delete(field)
        if (tableEntry.updates.get(rowKey).changes.size === 0) {
          tableEntry.updates.delete(rowKey)
        }
        cleanupTableStaged(tableName)
      }
    }
    updateStagedButtons()
    syncSidebarStagedBadges()
    renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
    return
  }

  if (pkFields.length === 0) {
    showPanels('error')
    errorBody.textContent = 'Inline edit requires at least one primary key column on the table.'
    setStatus('Cannot edit without primary key')
    renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
    return
  }

  const tableEntry = getTableStaged(tableName)
  if (!tableEntry.updates.has(rowKey)) {
    const row = state.resultRows.find((r, i) => {
      const pk = getRowPkKey(tableName, r)
      return (pk && pk === rowKey) || ('idx_' + i) === rowKey
    })
    const pkWhere = getRowPkWhere(tableName, row)
    tableEntry.updates.set(rowKey, {
      pkWhere,
      changes: new Map(),
      originalValues: row ? { ...row } : {},
    })
  }

  tableEntry.updates.get(rowKey).changes.set(field, value)

  updateStagedButtons()
  syncSidebarStagedBadges()
  renderResults(state.resultFields, state.resultRows, null, state.resultRightLabel)
}


/* ══════════════════════════════════════════
   8. RESULTS RENDERER & DYNAMIC WINDOWING
══════════════════════════════════════════ */

function renderResults(fields, rows, ms, rightLabel = null) {
  state.resultFields = fields
  state.resultRows = rows
  state.resultRightLabel = rightLabel ?? (typeof ms === 'number' ? `${ms}ms` : '')

  const tableName = state.activeTable
  const tableEntry = tableName ? stagedChanges.get(tableName) : null

  resultsHead.innerHTML = '<tr>' + fields.map(f => `<th>${escapeHtml(f)}</th>`).join('') + '</tr>'

  let insertedRowsHtml = ''
  if (tableEntry && tableEntry.inserts.length > 0) {
    insertedRowsHtml = tableEntry.inserts.map(insert => {
      const isEditing = state.cellEditDraft && state.cellEditDraft.rowKey === insert.clientId
      const isSelected = state.selectedRowKeys.has(insert.clientId)

      let rowClasses = 'result-row row-inserted'
      if (isSelected) rowClasses += ' selected'

      return `<tr class="${rowClasses}" data-row-key="${escapeHtml(insert.clientId)}" data-is-insert="true">` + fields.map(f => {
        if (isEditing && state.cellEditDraft.field === f) {
          return `<td class="result-cell editing" data-field="${escapeHtml(f)}"><input class="cell-edit-input" data-field="${escapeHtml(f)}" value="${escapeHtml(state.cellEditDraft.value)}" /></td>`
        }
        const val = insert.values[f]
        const displayVal = (val === '' || val === null || val === undefined)
          ? '<span class="null-value">[NEW]</span>'
          : escapeHtml(String(val))
        return `<td class="result-cell" data-field="${escapeHtml(f)}">${displayVal}</td>`
      }).join('') + '</tr>'
    }).join('')
  }

  const dataRowsHtml = rows.map((row, index) => {
    const pkKey = tableName ? getRowPkKey(tableName, row) : null
    const rowKey = pkKey || ('idx_' + index)
    const isEditing = state.cellEditDraft && state.cellEditDraft.rowKey === rowKey
    const isSelected = state.selectedRowKeys.has(rowKey)
    const isDeleted = Boolean(tableEntry && pkKey && tableEntry.deletes.has(pkKey))
    const rowUpdates = tableEntry && pkKey ? tableEntry.updates.get(pkKey) : null

    let rowClasses = 'result-row'
    if (isSelected) rowClasses += ' selected'
    if (isDeleted) rowClasses += ' row-deleted'

    return `<tr class="${rowClasses}" data-row-key="${escapeHtml(rowKey)}" data-row-index="${index}" data-is-insert="false">` + fields.map(f => {
      if (isEditing && state.cellEditDraft.field === f) {
        return `<td class="result-cell editing" data-field="${escapeHtml(f)}"><input class="cell-edit-input" data-field="${escapeHtml(f)}" value="${escapeHtml(state.cellEditDraft.value)}" /></td>`
      }

      const isDirty = Boolean(rowUpdates && rowUpdates.changes && rowUpdates.changes.has(f))
      const val = isDirty ? rowUpdates.changes.get(f) : row[f]
      const origVal = row[f]

      let cellClass = 'result-cell'
      if (isDirty) cellClass += ' cell-dirty'

      let titleAttr = ''
      if (isDirty) {
        titleAttr = ` title="Original: ${origVal === null || origVal === undefined ? 'NULL' : escapeHtml(String(origVal))}"`
      }

      if (val === null || val === undefined) {
        return `<td class="${cellClass}" data-field="${escapeHtml(f)}"${titleAttr}><span class="null-value">NULL</span></td>`
      }
      return `<td class="${cellClass}" data-field="${escapeHtml(f)}"${titleAttr}>${escapeHtml(String(val))}</td>`
    }).join('') + '</tr>'
  }).join('')

  resultsBody.innerHTML = insertedRowsHtml + dataRowsHtml

  const totalInserts = tableEntry ? tableEntry.inserts.length : 0
  if (totalInserts === 0 && rows.length === 0) {
    const colSpan = Math.max(fields.length, 1)
    resultsBody.innerHTML = `<tr><td colspan="${colSpan}"><span class="null-value">No rows</span></td></tr>`
  }

  updateFooterStatus()
  bindCellEditInput()
  updateStagedButtons()
  syncSidebarStagedBadges()
}

function appendResults(newRows) {
  const startIndex = state.resultRows.length
  state.resultRows = state.resultRows.concat(newRows)

  const tableName = state.activeTable
  const tableEntry = tableName ? stagedChanges.get(tableName) : null

  const newRowsHtml = newRows.map((row, i) => {
    const index = startIndex + i
    const pkKey = tableName ? getRowPkKey(tableName, row) : null
    const rowKey = pkKey || ('idx_' + index)
    const isEditing = state.cellEditDraft && state.cellEditDraft.rowKey === rowKey
    const isSelected = state.selectedRowKeys.has(rowKey)
    const isDeleted = Boolean(tableEntry && pkKey && tableEntry.deletes.has(pkKey))
    const rowUpdates = tableEntry && pkKey ? tableEntry.updates.get(pkKey) : null

    let rowClasses = 'result-row'
    if (isSelected) rowClasses += ' selected'
    if (isDeleted) rowClasses += ' row-deleted'

    return `<tr class="${rowClasses}" data-row-key="${escapeHtml(rowKey)}" data-row-index="${index}" data-is-insert="false">` + state.resultFields.map(f => {
      if (isEditing && state.cellEditDraft.field === f) {
        return `<td class="result-cell editing" data-field="${escapeHtml(f)}"><input class="cell-edit-input" data-field="${escapeHtml(f)}" value="${escapeHtml(state.cellEditDraft.value)}" /></td>`
      }

      const isDirty = Boolean(rowUpdates && rowUpdates.changes && rowUpdates.changes.has(f))
      const val = isDirty ? rowUpdates.changes.get(f) : row[f]
      const origVal = row[f]

      let cellClass = 'result-cell'
      if (isDirty) cellClass += ' cell-dirty'

      let titleAttr = ''
      if (isDirty) {
        titleAttr = ` title="Original: ${origVal === null || origVal === undefined ? 'NULL' : escapeHtml(String(origVal))}"`
      }

      if (val === null || val === undefined) {
        return `<td class="${cellClass}" data-field="${escapeHtml(f)}"${titleAttr}><span class="null-value">NULL</span></td>`
      }
      return `<td class="${cellClass}" data-field="${escapeHtml(f)}"${titleAttr}>${escapeHtml(String(val))}</td>`
    }).join('') + '</tr>'
  }).join('')

  resultsBody.insertAdjacentHTML('beforeend', newRowsHtml)
  updateFooterStatus()
  updateStagedButtons()
}

function updateFooterStatus() {
  const count = state.resultRows.length
  let text = ''
  if (pagination.loading) {
    text = `<span>${count} rows loaded · loading more…</span>`
  } else if (pagination.isPaginatable && pagination.hasMore) {
    text = `<span>${count} rows loaded · scroll for more</span>`
  } else if (pagination.isPaginatable && !pagination.hasMore) {
    text = `<span>All ${count} rows loaded</span>`
  } else {
    text = `<span>${count} rows</span>`
  }
  resultsFooter.innerHTML = `${text}<span>${escapeHtml(state.resultRightLabel)}</span>`
}

async function loadNextWindow() {
  if (!pagination.isPaginatable || !pagination.hasMore || pagination.loading) return

  pagination.loading = true
  updateFooterStatus()

  const offset = state.resultRows.length
  const nextSql = buildWindowSql(pagination.baseSql, pagination.pageSize, offset)

  try {
    const result = await window.db.query(nextSql)
    if (!result.ok) {
      pagination.hasMore = false
      setStatus(`Error loading more rows: ${result.error}`)
      return
    }

    const newRows = result.rows || []
    if (newRows.length === 0) {
      pagination.hasMore = false
    } else {
      if (newRows.length < pagination.pageSize) {
        pagination.hasMore = false
      }
      appendResults(newRows)
      setStatus(`${state.resultRows.length} rows loaded`)
    }
  } catch (err) {
    pagination.hasMore = false
    setStatus(`Failed to load more rows: ${err.message}`)
  } finally {
    pagination.loading = false
    updateFooterStatus()
  }
}

let scrollTicking = false
function handleResultsScroll() {
  if (scrollTicking) return
  scrollTicking = true
  requestAnimationFrame(() => {
    scrollTicking = false
    if (!pagination.isPaginatable || !pagination.hasMore || pagination.loading) return
    const threshold = 160
    const { scrollTop, scrollHeight, clientHeight } = resultsScroll
    if (scrollTop + clientHeight >= scrollHeight - threshold) {
      void loadNextWindow()
    }
  })
}

async function maybeFillViewport() {
  if (!resultsScroll) return
  let attempts = 0
  while (
    pagination.isPaginatable &&
    pagination.hasMore &&
    !pagination.loading &&
    attempts < 4 &&
    resultsScroll.scrollHeight <= resultsScroll.clientHeight + 80
  ) {
    attempts++
    await loadNextWindow()
  }
}

resultsBody.addEventListener('click', (e) => {
  const cellEl = e.target.closest('.result-cell')
  if (!cellEl) return
  const rowEl = cellEl.closest('.result-row')
  if (!rowEl) return
  if (!state.activeTable || state.cellEditDraft) return

  const rowKey = rowEl.dataset.rowKey
  if (!rowKey) return

  const multiSelect = e.ctrlKey || e.metaKey

  if (multiSelect) {
    if (state.selectedRowKeys.has(rowKey)) {
      state.selectedRowKeys.delete(rowKey)
    } else {
      state.selectedRowKeys.add(rowKey)
    }
  } else {
    state.selectedRowKeys = new Set([rowKey])
  }

  resultsBody.querySelectorAll('.result-row').forEach(el => {
    el.classList.toggle('selected', state.selectedRowKeys.has(el.dataset.rowKey))
  })

  updateStagedButtons()
})

resultsBody.addEventListener('dblclick', (e) => {
  const cellEl = e.target.closest('.result-cell')
  if (!cellEl) return

  const rowEl = cellEl.closest('.result-row')
  if (!rowEl) return

  const rowKey = rowEl.dataset.rowKey
  const isInsert = rowEl.dataset.isInsert === 'true'
  const field = cellEl.dataset.field
  if (!rowKey || !field) return

  e.preventDefault()
  e.stopPropagation()
  startCellEdit(rowKey, isInsert, field)
})

function bindCellEditInput() {
  const input = resultsBody.querySelector('.cell-edit-input')
  if (!input) return

  let cancelled = false

  input.addEventListener('input', (e) => {
    if (!state.cellEditDraft) return
    state.cellEditDraft.value = e.currentTarget.value
    autoSizeCellEditInput(e.currentTarget)
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveCellEdit()
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      cancelled = true
      cancelCellEdit()
    }
  })

  input.addEventListener('blur', () => {
    if (cancelled) return
    saveCellEdit()
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

function showPanels(mode) {
  emptyState.classList.add('hidden')
  schemaOverview.classList.add('hidden')
  comparisonArea.classList.add('hidden')
  resultsPanel.classList.add('hidden')
  errorPanel.classList.add('hidden')

  if (mode === 'results') {
    comparisonArea.classList.remove('hidden')
    resultsPanel.classList.remove('hidden')
  } else if (mode === 'error') {
    comparisonArea.classList.remove('hidden')
    errorPanel.classList.remove('hidden')
  } else if (mode === 'schema') {
    schemaOverview.classList.remove('hidden')
  } else if (mode === 'empty') {
    emptyState.classList.remove('hidden')
  }
}

/* ══════════════════════════════════════════
   9. UTILITY
══════════════════════════════════════════ */

function setStatus(msg) {
  statusMsg.textContent = msg
}
