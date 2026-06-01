const { app } = require('electron')
const path = require('path')
const fs = require('fs')

const CONFIG_FILE = 'first-run-complete.json'

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

function isFirstRun() {
  return !fs.existsSync(getConfigPath())
}

function markComplete() {
  try {
    const configPath = getConfigPath()
    const dir = path.dirname(configPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify({
      completedAt: new Date().toISOString(),
      version: app.getVersion(),
    }, null, 2))
  } catch (e) {
    console.warn('first-run markComplete failed:', e.message)
  }
}

module.exports = { isFirstRun, markComplete }
