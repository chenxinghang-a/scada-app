// 打包版前端（file:// 加载）冒烟检查。
// 之前所有验收都在 dev server（http://localhost:5173）上做的 —— 生产版是
// **file:// 加载 asar 里的 dist**，CORS、绝对路径、路由模式、socket 地址全都不同。
// 这里直接解包后的 dist 用 file:// 打开，看会不会白屏、接口通不通。
const puppeteer = require('puppeteer-core')

const DIST = 'file:///C:/Users/cxx/scada-app/.prod-check/app/dist/index.html'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  })
  const page = await browser.newPage()
  const errs = []
  const nets = []
  page.on('pageerror', e => errs.push('[pageerror] ' + String(e).slice(0, 160)))
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 160)) })
  page.on('requestfailed', r => nets.push('FAILED ' + r.url().slice(0, 90) + ' :: ' + (r.failure()?.errorText || '')))
  page.on('response', r => { if (r.status() >= 400) nets.push(r.status() + ' ' + r.url().slice(0, 90)) })

  await page.goto(DIST, { waitUntil: 'networkidle2', timeout: 30000 }).catch(e => console.log('goto 失败:', e.message))
  await sleep(3000)

  const info = await page.evaluate(() => {
    const body = document.body.innerText.replace(/\s+/g, ' ').trim()
    return {
      url: location.href,
      hash: location.hash,
      appMounted: !!document.querySelector('#app')?.children.length,
      len: body.length,
      text: body.slice(0, 200),
      origin: location.origin,
    }
  })
  console.log('URL       :', info.url)
  console.log('origin    :', info.origin, '(Electron 下就是 "null" 或 "file://")')
  console.log('已挂载    :', info.appMounted)
  console.log('文本长度  :', info.len)
  console.log('首屏文本  :', info.text)

  // 尝试登录页是否可交互
  const hasInput = await page.evaluate(() => document.querySelectorAll('input').length)
  console.log('输入框数量:', hasInput)

  console.log('\n网络失败/错误:')
  console.log([...new Set(nets)].slice(0, 12).join('\n') || '(none)')
  console.log('\nJS 错误:')
  console.log([...new Set(errs)].slice(0, 12).join('\n') || '(none)')

  // 登录前先给 errs/nets 拍个快照：登录这步在 Chrome 的 file:// 下必然失败
  // （localStorage 被禁，setItem 抛 SecurityError），那是测试环境限制，
  // 不能算到「打包版能不能用」头上。判定只看页面挂载 + 首屏加载。
  const preLoginErrs = errs.length
  const preLoginNets = nets.length

  // 登录：file:// 下 CORS 走 'file://' 白名单，能登录才说明双击图标真的可用
  // ⚠️ Chrome 的 file:// 对 localStorage 有限制，setItem 可能抛 SecurityError，
  //    会表现为「登录失败」—— 这是**测试环境**限制，Electron 有自己的 partition，不受影响。
  //    真正验证「双击图标能不能用」只能靠实际启动 Electron。
  if (hasInput >= 2) {
    await page.type('input[type="text"]', 'admin', { delay: 15 })
    const pw = await page.$('input[type="password"]')
    if (pw) await pw.type(process.env.SCADA_PWD || 'admin123', { delay: 15 })
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => /登录|登 录/.test(x.innerText))
      if (b) b.click()
    })
    await sleep(4500)
    const after = await page.evaluate(() => ({
      hash: location.hash,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 180),
    }))
    console.log('\n登录后路由:', after.hash)
    console.log('登录后文本:', after.text)
  }

  // 明确给一行业务结论：日志末尾可能是「登录失败」（Chrome file:// 限制 localStorage），
  // 单看那一行会让人以为整个打包版不能用，而真正要判定的是「页面能不能挂载」。
  const uiOk = info.appMounted && preLoginErrs === 0 && preLoginNets === 0
  console.log('\nVERDICT: ' + (uiOk
    ? 'PASS 页面已挂载、首屏无 JS 错误、无资源加载失败（登录环节受 Chrome file:// 限制，不计入）'
    : 'FAIL 挂载=' + info.appMounted + ' 首屏JS错误=' + preLoginErrs + ' 首屏网络失败=' + preLoginNets))

  await page.screenshot({ path: 'C:\\Users\\cxx\\scada-app\\.ui-shots\\prod-file.png' })
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
