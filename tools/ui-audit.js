// 真机界面验收：用真实 Chrome 登录后逐页打开、截图，并把
// 控制台报错与 4xx/5xx 请求打出来。单测覆盖的是 mock，这一层覆盖「页面到底有没有东西」。
//
// 为什么需要（2026-10-23）：一批问题（OEE 全 0、历史页空、socket 400）
// 单测全绿但页面上肉眼可见坏 —— 必须真跑一遍浏览器。
//
// 前置：
//   1. 后端在 127.0.0.1:5000 跑着（npm run 后端或 backend/scada-backend.exe）
//   2. 前端 dev server 在 5173（npx vite）
//   3. puppeteer-core 与本机 Chrome：
//        npm i -g 或 NODE_PATH 指向装有 puppeteer-core 的目录
// 用法：
//   NODE_PATH=<puppeteer-core 所在 node_modules> node tools/ui-audit.js
// 产出：.ui-shots/*.png（已被 .gitignore 忽略）
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const OUT = 'C:\\Users\\cxx\\scada-app\\.ui-shots'
fs.mkdirSync(OUT, { recursive: true })

const ROUTES = [
  ['dashboard', '/dashboard'],
  ['devices', '/devices'],
  ['control', '/control'],
  ['history', '/history'],
  ['alarms', '/alarms'],
  ['alarm-output', '/alarm-output'],
  ['industry40', '/industry40'],
  ['config', '/config'],
  ['users', '/users'],
  ['performance', '/performance'],
  ['screen', '/screen'],
]

const errors = []
const netFails = []
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  })
  const page = await browser.newPage()

  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 200)}`) })
  page.on('pageerror', e => errors.push('[pageerror] ' + String(e).slice(0, 200)))
  page.on('response', r => { if (r.status() >= 400) netFails.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:5173', '')}`) })

  await page.goto('http://localhost:5173/#/login', { waitUntil: 'networkidle2' })
  await sleep(1200)
  await page.screenshot({ path: path.join(OUT, '00-login.png') })

  // 登录
  await page.type('input[type="text"]', 'admin', { delay: 20 }).catch(() => {})
  const pwd = await page.$('input[type="password"]')
  if (pwd) await pwd.type('admin123', { delay: 20 })
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /登录|登 录/.test(b.innerText))
    if (btn) btn.click()
  })
  await sleep(4500)
  await page.screenshot({ path: path.join(OUT, '01-after-login.png') })
  console.log('AFTER LOGIN:', page.url(), '|', (await page.evaluate(() => document.body.innerText.slice(0, 120).replace(/\s+/g, ' '))))

  for (const [name, route] of ROUTES) {
    try {
      await page.evaluate((r) => { location.hash = '#' + r }, route)
      await sleep(3500)
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false })
      const info = await page.evaluate(() => {
        const body = document.body.innerText.replace(/\s+/g, ' ').trim()
        return { len: body.length, empty: document.querySelectorAll('.el-empty').length, text: body.slice(0, 160) }
      })
      console.log(`ROUTE ${name.padEnd(12)} textLen=${String(info.len).padEnd(5)} emptyBlocks=${info.empty} :: ${info.text}`)
    } catch (e) {
      console.log(`ROUTE ${name.padEnd(12)} THREW ${e.message}`)
    }
  }

  console.log('\n===== CONSOLE =====')
  console.log([...new Set(errors)].slice(0, 50).join('\n') || '(none)')
  console.log('\n===== HTTP >=400 =====')
  console.log([...new Set(netFails)].slice(0, 50).join('\n') || '(none)')

  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
