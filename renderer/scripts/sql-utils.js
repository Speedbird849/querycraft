export function isMutatingSql(sql) {
  return /^\s*(insert|update|delete|alter|drop|truncate|create)\b/i.test(sql)
}

export function extractTargetTable(sql) {
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

export function quoteTableIdentifier(tableName, driver = 'postgres') {
  const parts = String(tableName).split('.').map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) return tableName
  return parts.map(part => quoteIdentifierPart(part, driver)).join('.')
}

export function quoteColumnIdentifier(columnName, driver = 'postgres') {
  return quoteIdentifierPart(columnName, driver)
}

function quoteIdentifierPart(identifier, driver) {
  if (driver === 'postgres') return `"${String(identifier).replace(/"/g, '""')}"`
  return `\`${String(identifier).replace(/`/g, '``')}\``
}

export function toSqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return `'${String(value).replace(/'/g, "''")}'`
}

export function toSqlInputLiteral(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return 'NULL'
  if (/^null$/i.test(raw)) return 'NULL'
  if (/^true$/i.test(raw)) return 'TRUE'
  if (/^false$/i.test(raw)) return 'FALSE'
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw
  return toSqlLiteral(raw)
}
