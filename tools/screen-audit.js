// 数据大屏（Screen）实时性检查：同一页取两次快照，比对数字有没有在动。
// 答辩场景最怕的就是「大屏数字冻住」——静态截图看不出来，必须隔几秒再采一次。
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const OUT = 'C:\\Users\\cxx\\scada-app\\.ui-shots'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const PWD = process.env.SCADA_PWD || 'admin123'

const NUM = /(\d+(?:\.\d+)?)/g
function nums (txt) { return (txt.match(NUM) || []).join(',') }

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
  })
  const page = await browser.newPage()
  const errs = []
  page.on('pageerror', e => errs.push(String(e).slice(0, 140)))
  page.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/')) errs.push(`${r.status()} ${r.url().split('/api/')[1]}`) })

  await page.goto('http://localhost:5173/#/login', { waitUntil: 'networkidle2' })
  await sleep(900)
  await page.type('input[type="text"]', 'admin', { delay: 12 })
  const p = await page.$('input[type="password"]')
  if (p) await p.type(PWD, { delay: 12 })
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => /登录|登 录/.test(x.innerText))
    if (b) b.click()
  })
  await sleep(4000)

  await page.evaluate(() => { location.hash = '#/screen' })
  await sleep(5000)

  const snap = () => page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, ' ')
    return { text: t.slice(0, 600), canvases: document.querySelectorAll('canvas').length }
  })

  const a = await snap()
  await page.screenshot({ path: `${OUT}/screen-t0.png` })
  console.log('T0 图表数:', a.canvases)
  console.log('T0 文本:', a.text.slice(0, 320))

  await sleep(8000)
  const b = await snap()
  await page.screenshot({ path: `${OUT}/screen-t8.png` })
  console.log('\nT8 文本:', b.text.slice(0, 320))

  const same = a.text === b.text
  console.log('\n两次快照文本完全一致 =', same, same ? '← 大屏可能没刷新' : '← 有变化，实时刷新正常')

  console.log('\n错误:', [...new Set(errs)].slice(0, 10).join('\n') || '(none)')
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
