import {
  isMutatingSql,
  extractTargetTable,
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

const schemaList     = document.getElementById('schemaList')
const queryInput     = document.getElementById('queryInput')
const runBtn         = document.getElementById('runBtn')

const emptyState       = document.getElementById('emptyState')
const schemaOverview   = document.getElementById('schemaOverview')
const schemaOverviewTitle = document.getElementById('schemaOverviewTitle')
const schemaGrid       = document.getElementById('schemaGrid')

const comparisonArea = document.getElementById('comparisonArea')
const comparisonGrid = document.querySelector('.comparison-grid')

const resultsPanel   = document.getElementById('resultsPanel')
const resultsScroll  = document.getElementById('resultsScroll')
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
const errorReturnBtn = document.getElementById('errorReturnBtn')

const statusMsg      = document.getElementById('statusMsg')
const statusDriver   = document.getElementById('statusDriver')


/* ══════════════════════════════════════════
   2. STATE
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
  pendingPreview: null,
  resultFields: [],
  resultRows: [],
  selectedRowIndices: [],
  resultRightLabel: '',
  entryDraftActive: false,
  entryDraftValues: {},
  cellEditDraft: null,
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
  if (state.pendingPreview) {
    setStatus('Finish the staged preview before refreshing schema.')
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
  state.pendingPreview = null
  state.resultFields = []
  state.resultRows = []
  state.selectedRowIndices = []
  state.resultRightLabel = ''
  state.entryDraftActive = false
  state.entryDraftValues = {}
  state.cellEditDraft = null

  setConnected(false)
  schemaList.innerHTML = '<div class="sidebar-empty">No connection</div>'

  comparisonArea.classList.add('hidden')
  previewPanel.classList.add('hidden')
  resultsPanel.classList.add('hidden')
  errorPanel.classList.add('hidden')
  schemaOverview.classList.add('hidden')
  schemaGrid.innerHTML = ''
  emptyState.classList.remove('hidden')
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

function handleConnectionLost(errorMessage) {
  if (!state.connected) return

  state.connected = false
  state.tables = []
  state.columns = {}
  state.activeTable = null
  state.pendingPreview = null
  state.resultFields = []
  state.resultRows = []
  state.selectedRowIndices = []
  state.resultRightLabel = ''
  state.entryDraftActive = false
  state.entryDraftValues = {}
  state.cellEditDraft = null

  setConnected(false)
  schemaList.innerHTML = '<div class="sidebar-empty">Connection lost</div>'

  comparisonArea.classList.add('hidden')
  previewPanel.classList.add('hidden')
  resultsPanel.classList.add('hidden')
  schemaOverview.classList.add('hidden')
  schemaGrid.innerHTML = ''
  emptyState.classList.add('hidden')

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
    <span>${escapeHtml(tableName)}</span>
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

function selectTable(tableName) {
  state.activeTable = tableName
  syncActiveSchemaTable()
  state.selectedRowIndices = []
  refreshEntryButtons()
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
   5. QUERY RUNNER
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

addEntryBtn.addEventListener('click', handleAddEntry)
removeEntryBtn.addEventListener('click', handleRemoveEntry)
saveEntryBtn.addEventListener('click', handleSaveEntry)
cancelEntryBtn.addEventListener('click', handleCancelEntry)
confirmPreviewBtn.addEventListener('click', commitPreview)
undoPreviewBtn.addEventListener('click', undoPreview)
errorReturnBtn.addEventListener('click', returnToSchemaOverview)
document.addEventListener('keydown', handleGlobalShortcuts)
if (resultsScroll) {
  resultsScroll.addEventListener('scroll', handleResultsScroll)
}
refreshEntryButtons()

function handleGlobalShortcuts(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return

  if (e.key === 'Escape' && !errorPanel.classList.contains('hidden')) {
    e.preventDefault()
    returnToSchemaOverview()
    return
  }

  if (e.key !== 'Enter') return
  if (!state.pendingPreview) return

  const activeTag = document.activeElement?.tagName
  const isInputLike = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || document.activeElement?.isContentEditable
  if (isInputLike) return

  e.preventDefault()
  void commitPreview()
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
    // If windowed query failed, fall back to running raw sql directly
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

async function runMutationPreview(sql) {
  setStatus('Building preview…')
  showPanels('loading')

  const tableHint = extractTargetTable(sql) || state.activeTable
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

  renderResults(result.beforeFields, result.beforeRows, null, 'current')
  renderPreviewResults(result.afterFields, result.afterRows, result.affectedRows, result.targetTable)
  showPanels('preview')
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

  await loadSchema()

  if (targetTable) {
    const sql = `SELECT * FROM ${quoteTableIdentifier(targetTable)};`
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
    const sql = `SELECT * FROM ${quoteTableIdentifier(targetTable)};`
    queryInput.value = sql
    runQuery(sql)
  }
}

function setPreviewButtonsDisabled(disabled) {
  confirmPreviewBtn.disabled = disabled
  undoPreviewBtn.disabled = disabled
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
    sql = `INSERT INTO ${tableRef} DEFAULT VALUES;`
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

  const pkFields = getPrimaryKeyColumns(state.activeTable)
  if (pkFields.length === 0) {
    showPanels('error')
    errorBody.textContent = 'Inline edit requires at least one primary key column on the selected table.'
    setStatus('Cannot edit without primary key')
    cancelCellEdit()
    return
  }

  const row = state.resultRows[rowIndex]
  const whereClauses = pkFields.map(pk => {
    const pkValue = row[pk.column_name]
    return `${quoteColumnIdentifier(pk.column_name)} = ${toSqlLiteral(pkValue)}`
  })

  if (whereClauses.some(c => c.includes('= NULL'))) {
    showPanels('error')
    errorBody.textContent = `Inline edit failed: missing primary key value on selected row.`
    setStatus('Cannot edit selected row')
    cancelCellEdit()
    return
  }

  const tableRef = quoteTableIdentifier(state.activeTable)
  const targetCol = quoteColumnIdentifier(field)
  const sql = `UPDATE ${tableRef} SET ${targetCol} = ${toSqlInputLiteral(value)} WHERE ${whereClauses.join(' AND ')};`

  state.cellEditDraft = null
  queryInput.value = sql
  await runQuery(sql)
}

async function handleRemoveEntry() {
  if (!state.activeTable || state.pendingPreview || state.selectedRowIndices.length === 0) return

  const pkFields = getPrimaryKeyColumns(state.activeTable)
  if (pkFields.length === 0) {
    showPanels('error')
    errorBody.textContent = 'Remove requires at least one primary key column on the selected table.'
    setStatus('Cannot remove without primary key')
    return
  }

  // Handle composite or single PK by generating a DELETE statement with ORs or an IN clause
  // For simplicity with composites, we will join them with OR if needed
  const tableRef = quoteTableIdentifier(state.activeTable)
  
  const whereParts = state.selectedRowIndices.map(index => {
    const row = state.resultRows[index]
    const conditions = pkFields.map(pk => {
      return `${quoteColumnIdentifier(pk.column_name)} = ${toSqlLiteral(row[pk.column_name])}`
    })
    return `(${conditions.join(' AND ')})`
  })

  const sql = `DELETE FROM ${tableRef} WHERE ${whereParts.join(' OR ')};`

  queryInput.value = sql
  await runQuery(sql)
}

function getPrimaryKeyColumns(tableName) {
  const cols = state.columns[tableName] || []
  return cols.filter(col => col.is_pk)
}

function refreshEntryButtons() {
  const hasTable = Boolean(state.activeTable)
  const hasPendingPreview = Boolean(state.pendingPreview)
  const pkCount = getPrimaryKeyColumns(state.activeTable).length
  const hasResultFields = state.resultFields.length > 0
  const hasCellEdit = Boolean(state.cellEditDraft)
  const canRemove = hasTable && pkCount > 0 && state.selectedRowIndices.length > 0 && !hasPendingPreview && !state.entryDraftActive && !hasCellEdit

  addEntryBtn.disabled = !hasTable || hasPendingPreview || state.entryDraftActive || hasCellEdit || !hasResultFields
  removeEntryBtn.disabled = !canRemove
  saveEntryBtn.disabled = !state.entryDraftActive
  cancelEntryBtn.disabled = !state.entryDraftActive
  addEntryBtn.classList.toggle('hidden', state.entryDraftActive)
  saveEntryBtn.classList.toggle('hidden', !state.entryDraftActive)
  cancelEntryBtn.classList.toggle('hidden', !state.entryDraftActive)
}

/* ══════════════════════════════════════════
   6. RESULTS RENDERER & DYNAMIC WINDOWING
══════════════════════════════════════════ */

function renderRowHtml(row, index, fields) {
  const isEditing = state.cellEditDraft && state.cellEditDraft.rowIndex === index
  const isSelected = state.selectedRowIndices.includes(index)

  return `<tr class="result-row${isSelected ? ' selected' : ''}" data-row-index="${index}">` + fields.map(f => {
    if (isEditing && state.cellEditDraft.field === f) {
      return `<td class="result-cell editing" data-field="${escapeHtml(f)}"><input class="cell-edit-input" data-field="${escapeHtml(f)}" value="${escapeHtml(state.cellEditDraft.value)}" /></td>`
    }

    const val = row[f]
    if (val === null || val === undefined) return `<td class="result-cell" data-field="${escapeHtml(f)}"><span class="null-value">NULL</span></td>`
    return `<td class="result-cell" data-field="${escapeHtml(f)}">${escapeHtml(String(val))}</td>`
  }).join('') + '</tr>'
}

function renderResults(fields, rows, ms, rightLabel = null) {
  state.resultFields = fields
  state.resultRows = rows
  state.selectedRowIndices = []
  state.resultRightLabel = rightLabel ?? (typeof ms === 'number' ? `${ms}ms` : '')

  if (state.cellEditDraft && !rows[state.cellEditDraft.rowIndex]) {
    state.cellEditDraft = null
  }

  resultsHead.innerHTML = '<tr>' + fields.map(f => `<th>${escapeHtml(f)}</th>`).join('') + '</tr>'

  const dataRowsHtml = rows.map((row, index) =>
    renderRowHtml(row, index, fields)
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

  updateFooterStatus()
  bindEntryRowInputs()
  bindCellEditInput()
  refreshEntryButtons()
}

function appendResults(newRows) {
  const startIndex = state.resultRows.length
  state.resultRows = state.resultRows.concat(newRows)

  const newRowsHtml = newRows.map((row, i) =>
    renderRowHtml(row, startIndex + i, state.resultFields)
  ).join('')

  resultsBody.insertAdjacentHTML('beforeend', newRowsHtml)
  updateFooterStatus()
  refreshEntryButtons()
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

// Delegated row selection on resultsBody
resultsBody.addEventListener('click', (e) => {
  const cellEl = e.target.closest('.result-cell')
  if (!cellEl) return
  const rowEl = cellEl.closest('.result-row')
  if (!rowEl) return
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

  resultsBody.querySelectorAll('.result-row').forEach(el => {
    const idx = Number(el.dataset.rowIndex)
    el.classList.toggle('selected', state.selectedRowIndices.includes(idx))
  })

  refreshEntryButtons()
})

// Delegated double-click cell editing on resultsBody
resultsBody.addEventListener('dblclick', (e) => {
  if (state.pendingPreview || state.entryDraftActive) return

  const cellEl = e.target.closest('.result-cell')
  if (!cellEl) return

  const rowEl = cellEl.closest('.result-row')
  if (!rowEl) return

  const rowIndex = Number(rowEl.dataset.rowIndex)
  const field = cellEl.dataset.field
  if (!Number.isInteger(rowIndex) || !field) return

  e.preventDefault()
  e.stopPropagation()
  startCellEdit(rowIndex, field)
})

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

function renderPreviewResults(fields, rows, affectedRows, targetTable) {
  previewHead.innerHTML = '<tr>' + fields.map(f => `<th>${escapeHtml(f)}</th>`).join('') + '</tr>'

  previewBody.innerHTML = rows.map(row =>
    '<tr>' + fields.map(f => {
      const val = row[f]
      if (val === null || val === undefined) return '<td><span class="null-value">NULL</span></td>'
      return `<td>${escapeHtml(String(val))}</td>`
    }).join('') + '</tr>'
  ).join('')

  if (rows.length === 0) {
    const colSpan = Math.max(fields.length, 1)
    previewBody.innerHTML = `<tr><td colspan="${colSpan}"><span class="null-value">No rows</span></td></tr>`
  }

  previewSummary.textContent = targetTable
    ? `Previewing staged changes on ${escapeHtml(targetTable)}.`
    : 'Previewing staged changes.'
  previewFooter.innerHTML = `<span>${rows.length} rows</span><span>${affectedRows || 0} affected</span>`
}

function showPanels(mode) {
  setComparisonLayout(false)
  emptyState.classList.add('hidden')
  schemaOverview.classList.add('hidden')
  comparisonArea.classList.add('hidden')
  resultsPanel.classList.add('hidden')
  previewPanel.classList.add('hidden')
  errorPanel.classList.add('hidden')

  if (mode === 'results') {
    comparisonArea.classList.remove('hidden')
    resultsPanel.classList.remove('hidden')
  } else if (mode === 'preview') {
    setComparisonLayout(true)
    comparisonArea.classList.remove('hidden')
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
   7. UTILITY
══════════════════════════════════════════ */

function setStatus(msg) {
  statusMsg.textContent = msg
}
