// 逐个点开「工业 4.0」的每个标签页 + 设备管理弹窗，截图并统计空状态块。
// 总览页之前只看了第一屏，六个子页（预测维护/OEE/SPC/能源/边缘/数字孪生/振动）没验过。
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const OUT = 'C:\\Users\\cxx\\scada-app\\.ui-shots\\tabs'
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const PWD = process.env.SCADA_PWD || 'admin123'

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1100'],
    defaultViewport: { width: 1600, height: 1100 },
  })
  const page = await browser.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)))
  page.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/')) errs.push(`${r.status()} ${r.url().split('/api/')[1]}`) })

  await page.goto('http://localhost:5173/#/login', { waitUntil: 'networkidle2' })
  await sleep(1000)
  await page.type('input[type="text"]', 'admin', { delay: 15 })
  const p = await page.$('input[type="password"]')
  if (p) await p.type(PWD, { delay: 15 })
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => /登录|登 录/.test(x.innerText))
    if (b) b.click()
  })
  await sleep(4000)

  await page.evaluate(() => { location.hash = '#/industry40' })
  await sleep(4000)

  const tabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.el-tabs__item')).map(e => e.innerText.trim()).filter(Boolean))
  console.log('标签页:', tabs.join(' | '))

  for (let i = 0; i < tabs.length; i++) {
    const name = tabs[i]
    await page.evaluate((idx) => {
      const items = document.querySelectorAll('.el-tabs__item')
      if (items[idx]) items[idx].click()
    }, i)
    await sleep(3500)
    const info = await page.evaluate(() => {
      const txt = document.body.innerText.replace(/\s+/g, ' ')
      return {
        empties: document.querySelectorAll('.el-empty').length,
        canvases: document.querySelectorAll('canvas').length,
        len: txt.length,
        tail: txt.slice(-180),
      }
    })
    await page.screenshot({ path: `${OUT}/${String(i).padStart(2, '0')}-${name.replace(/[\\/:*?"<>|]/g, '')}.png` })
    console.log(`[${i}] ${name.padEnd(8)} 空块=${info.empties} 图表=${info.canvases} 文本=${info.len} :: ${info.tail.slice(0, 110)}`)
  }

  // 设备管理：打开「预设设备」弹窗看有没有内容
  await page.evaluate(() => { location.hash = '#/devices' })
  await sleep(3000)
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => /预设设备/.test(x.innerText))
    if (b) b.click()
  })
  await sleep(2500)
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('.el-dialog')
    return { open: !!d, rows: d ? d.querySelectorAll('.el-table__row, .preset-item, .device-card').length : 0, len: d ? d.innerText.replace(/\s+/g, ' ').length : 0 }
  })
  await page.screenshot({ path: `${OUT}/90-device-presets.png` })
  console.log(`设备预设弹窗: 打开=${dlg.open} 条目=${dlg.rows} 文本=${dlg.len}`)

  console.log('\n===== 错误 =====')
  console.log([...new Set(errs)].slice(0, 20).join('\n') || '(none)')
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
