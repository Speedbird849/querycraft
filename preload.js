const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('db', {
  // Connect to a database
  // driver: 'postgres' | 'mysql' | 'sqlite'
  // connectionString: full connection URI or file path
  connect: (driver, connectionString) =>
    ipcRenderer.invoke('db:connect', { driver, connectionString }),

  // Disconnect the current connection
  disconnect: () =>
    ipcRenderer.invoke('db:disconnect'),

  // Get list of tables
  tables: () =>
    ipcRenderer.invoke('db:tables'),

  // Get columns for a specific table
  columns: (table) =>
    ipcRenderer.invoke('db:columns', { table }),

  // Run a SQL query
  query: (sql) =>
    ipcRenderer.invoke('db:query', { sql }),
})
