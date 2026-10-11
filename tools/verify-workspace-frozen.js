#!/usr/bin/env node
/**
 * 第八道闸门：**双时刻工作区断言**（构建窗口内不许有人落盘）。
 *
 * 为什么必须要有这一道
 * --------------------
 * 2026-10-10 实测事故：本机 `npm run electron:build` 期间，二号机（另一个 AI
 * 会话）往**后端仓库**落了 round 210 的改动 —— PyInstaller 收的是**工作区快照**、
 * **不是 git HEAD**，于是「后端源码改了一半、前端却是干净的」这个中间态被冻结
 * 进了 v1083 的产物里。
 *
 *   * 那次靠人工逐文件 `diff -q` 对账才确认「功能安全」；
 *   * `verify:staging` 拦不住它 —— 它判的是「产物是不是后端当前源码的产物」，
 *     而**构建窗口内工作区变了**这件事，它看不见（mtime 只在复制那一刻被刷新）。
 *   * 七道闸门全部只管「产物内部的一致性 / 可用性」，**没有一道管「构建过程本身
 *     有没有被污染」**。
 *
 * 判据
 * ----
 *   ① `pre`（构建前）与 `post`（构建后）两次指纹必须**完全相等**。
 *      * 仓库集合（前端 + 探测到的后端仓库）
 *      * 每个仓库的 `HEAD` commit + `git status --porcelain`（工作区脏指纹）
 *      * 已跟踪文件的**内容哈希**（`git diff HEAD` 的哈希，见下）
 *   ② 任一项不等 ⇒ 判负，并把**具体变了什么**打出来（哪个仓库、哪个文件、怎么变）。
 *
 * 为什么用「git 层面」而不是「文件 mtime 全树扫描」
 * ------------------------------------------------
 *   * 后端产物目录有 **2000+ 文件 / 几百 MB**，全树 mtime 扫描在 Windows 上要几十秒，
 *     且 `node_modules` / `.venv` / `dist` 全是噪声，需要维护一份易错的白名单。
 *   * 我们要防的是**源码被改**，而源码是被 git 跟踪的 —— 直接问 git 最准：
 *     `git status --porcelain` 覆盖「新增/修改/删除/重命名」，
 *     `git diff HEAD` 的 sha256 覆盖**已跟踪文件的精确内容**。
 *   * 未跟踪文件（`git status` 的 `??`）会出现在 porcelain 输出里 → 一样被捕捉。
 *     （`git status --porcelain` 会列出 untracked，而 `.gitignore` 覆盖的不列 ——
 *     这正是我们想要的：`.gitignore` 里的东西本来就不进产物。）
 *
 * ⚠️ 已知盲区（写清楚，不假装它能防住一切）
 *    * **`.gitignore` 覆盖的文件被改** → 指纹不变。但这类文件本来就不该进产物
 *      （`electron-builder` 不看 `.gitignore`，但我们的 extraResources 只收
 *      显式目录，且下游还有各自的排除规则）。
 *    * **构建工具自己写的中间产物**（`dist/` / `.vite/` / `release/`）→ 在
 *      `.gitignore` 里，不参与指纹 —— 这是**必须**的，否则闸门每次都会红。
 *    * 只探测得到的仓库：探测不到后端仓库时**只断言前端**，并**显式打印降级**，
 *      不静默通过（参照 `verify-staging.js` 的同类降级约定）。
 *
 * 用法
 * ----
 *   # 构建前（写基线）
 *   node tools/verify-workspace-frozen.js --pre
 *   # 构建后（比对）
 *   node tools/verify-workspace-frozen.js --post
 *
 *   # 默认路径（可用 env 覆盖）
 *   #   SCADA_FRONTEND_REPO（默认 = 本仓库根）
 *   #   SCADA_BACKEND_REPO （默认 = 逐个候选探测，同 verify-staging.js）
 *
 * 退出码：0 = 一致（或 pre 成功写基线）；1 = 不一致 / 用法错误。
 */

'use strict'

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO_ROOT = path.resolve(__dirname, '..')
const STATE_FILE = path.join(REPO_ROOT, '.vitest_cache', 'workspace-frozen-state.json')

/**
 * 后端仓库候选落点 —— 与 `verify-staging.js::backendRepoCandidates()` **保持一致**。
 *
 * ⚠️ 刻意重复而不是 require 过来：两道闸门要能**独立运行**（其中一道被临时摘掉
 * 或改名时，另一道不得跟着崩）。重复的代价是「两处要同时改」，
 * 用 tests/tools/verify-workspace-frozen.test.ts 里的「候选列表一致性」用例绑死。
 */
function backendRepoCandidates() {
  return [
    process.env.SCADA_BACKEND_REPO,
    path.join(REPO_ROOT, '..', 'industrial_scada'),
    path.join(REPO_ROOT, '..', 'WorkBuddy', 'Claw', 'industrial_scada'),
    path.join(REPO_ROOT, 'backend-src'),
    path.join(REPO_ROOT, '..', 'scada'),
  ].filter(Boolean)
}

/** 探测到的后端仓库绝对路径（找不到返回 null）。 */
function findBackendRepo() {
  for (const cand of backendRepoCandidates()) {
    try {
      if (fs.existsSync(path.join(cand, '.git'))) return path.resolve(cand)
    } catch {
      /* 权限/不存在都当没探测到 */
    }
  }
  return null
}

/**
 * git 单次调用的硬超时（毫秒）。
 *
 * 为什么必须有（2026-10-12）：
 *   这三处 `execFileSync('git', ...)` 都包在 `catch` 里 → **命令失败**能得到处理；
 *   但 **`catch` 只接得住"抛错"，接不住"永久挂起"**。
 *   git 在 index.lock 竞争、网络文件系统、杀软实时扫描（本机实测有 IndexProtect
 *   驱动拦 IO）等场景下可能长时间不返回 → 无 timeout 时**整个构建链卡死**，
 *   只能等 CI job 级超时（数小时）才被砍。
 *   **"失败可恢复（有 catch）" ≠ "挂起可恢复（有 timeout）"**，两者正交。
 *
 * ⚠️ 超时**不得降级**：本仓库已经因"探测返回 null → 新鲜度判据静默降级 →
 *   本该红的一条变绿"吃过一次事故（见 verify-staging.js 头注）。若这里把超时
 *   也吞成 `null`，等于**亲手复刻那个失效模式**。故超时**原样抛出**，
 *   由调用方 `tryGit` 转成 `TIMEOUT` 标记，最终 fail-closed。
 */
const GIT_TIMEOUT_DEFAULT_MS = 30_000

/**
 * 当前生效的 git 超时（毫秒）。
 *
 * ⚠️ **每次调用时读取**（不是模块顶层算好一次）：测试需要注入小值来**真触发**超时，
 *    而模块被 `require` 缓存的时机早于测试设置 env —— 顶层求值会让注入失效
 *    （实测：顶层版注入 `SCADA_GIT_TIMEOUT_MS=400` 完全不生效）。
 *    与同文件既有 `SCADA_FROZEN_MAX_AGE_MS` 的"用时读"约定一致。
 */
function gitTimeoutMs() {
  const n = Number(process.env.SCADA_GIT_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : GIT_TIMEOUT_DEFAULT_MS
}

/**
 * git 可执行名（可用 `SCADA_GIT_BIN` 覆盖，默认 `git`）。
 * 用途：① 极端环境下 git 不在 PATH 时显式指定；② **测试**里指向假的慢 git 以真触发超时
 * （Windows 上 `execFileSync('git')` 不认 `.cmd`，必须带扩展名显式指到 shim）。
 */
function gitBin() {
  return process.env.SCADA_GIT_BIN || 'git'
}

/**
 * 把 `execFileSync` 抛出的错误分类。
 *
 * 这是本文件"防挂起"逻辑的**判别核心**，抽成纯函数以便独立单测
 * （端到端触发超时在 Windows 上曾因 `.cmd` shim 不可行而受限；
 *   现改用"压到 1ms"的跨平台触发法，见测试）。
 *
 * **为什么要把 `EBUSY` 也算超时**（2026-10-12 实测发现）：
 *   `execFileSync` 在**超时杀进程**时，错误码不总是 `ETIMEDOUT` ——
 *   实测 `rev-parse HEAD` 在 1ms 超时下报的是 **`EBUSY`**（进程还没真正起来
 *   就被杀）。若只认 `ETIMEDOUT`，这种"快进程 + 极短超时"的挂起会被误判成
 *   `unavailable` → **降级** → 正是本文件要防的事故。故把 `EBUSY` 一并纳入。
 *
 * ⚠️ `EBUSY` 也可能来自"目标文件被占用"（非超时）。这里**只在调用方确实配了
 *    timeout 时**才由调用方走 timeout 分支 —— 本函数本身不做此判断，
 *    因为它只负责"错误形态 → 语义"，配置上下文由调用点保证（三处调用点全部配了 timeout）。
 *
 * @returns {'timeout' | 'unavailable'} —— 前者**不得降级**，后者才允许降级。
 */
function classifyGitError(e) {
  if (
    e &&
    (e.code === 'ETIMEDOUT' ||
      e.code === 'EBUSY' ||
      e.signal === 'SIGTERM' ||
      e.killed === true)
  ) {
    return 'timeout'
  }
  return 'unavailable'
}

function git(repo, args) {
  return execFileSync(gitBin(), args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
    timeout: gitTimeoutMs(),
  })
}

/** 超时哨兵：调用方据此把"挂起"与"命令失败"分开，**不允许**当降级处理。 */
const GIT_TIMEOUT = Symbol('git-timeout')

function tryGit(repo, args) {
  try {
    return git(repo, args)
  } catch (e) {
    // ⚠️ 超时**不是**"git 不可用"，不能返回 null（那会被上层当降级）。
    //    返回哨兵，让调用方言明其意 —— 当前语义 = 闸门 fail-closed。
    if (classifyGitError(e) === 'timeout') return GIT_TIMEOUT
    return null
  }
}

/**
 * 闸门自己产生的副产物 —— 从 porcelain 里剔除，避免**自指污染**。
 *
 * 为什么必须显式剔除（实测踩到，2026-10-11 自测阶段）：
 *   `--pre` 写基线的那一刻，`<repo>/.vitest_cache/` 才被创建（之前如果有）；
 *   于是 `--post` 的 porcelain 里凭空多出一行 `?? .vitest_cache/` ——
 *   闸门把**自己写的基线文件**当成了「构建窗口内有人落盘」，**自己把自己判负**。
 *
 * 本仓库靠 `.gitignore` 恰好盖住了它，所以真实场景没暴露；但那只是运气：
 *   * 两个仓库的 `.gitignore` 各写各的，后端仓库漏一条就假红；
 *   * 一个「只在被 ignore 时才正确」的闸门，等于把正确性外包给了别人的配置文件。
 *   → 这里在**源头**剔除（对两个仓库一视同仁），不依赖任何 `.gitignore`。
 *
 * 剔除规则：porcelain 行的路径部分以 `.vitest_cache/` 开头（或正好是它）。
 * 注意要**保留**其它未跟踪文件 —— 那正是要抓的污染。
 */
function isGateOwnArtifact(porcelainLine) {
  // porcelain 格式：`XY <path>`（XY 两列，第 3 列起是路径）；
  // 未跟踪是 `?? <path>`；重命名是 `R  old -> new`。
  const p = porcelainLine.slice(3).trim()
  const paths = p.includes(' -> ') ? p.split(' -> ') : [p]
  return paths.every((one) => {
    const norm = one.replace(/^"|"$/g, '').replace(/\\/g, '/')
    return norm === '.vitest_cache' || norm.startsWith('.vitest_cache/')
  })
}

/** 过滤掉闸门自产物的 porcelain 文本（保持行序与空行结构）。 */
function stripGateArtifacts(statusText) {
  if (statusText == null) return null
  return statusText
    .split('\n')
    .filter((line) => !(line.trim() && isGateOwnArtifact(line)))
    .join('\n')
}

/**
 * 单个仓库的指纹。
 *
 * @param {string} repo
 * @returns {{repo: string, head: string|null, status: string|null,
 *            trackedDiffSha: string|null, error: string|null}}
 */
function repoFingerprint(repo) {
  const head = tryGit(repo, ['rev-parse', 'HEAD'])
  const rawStatus = tryGit(repo, ['status', '--porcelain'])
  // 已跟踪文件的**精确内容**指纹：`git diff HEAD` 的二进制输出再哈希。
  // 比逐个文件算 sha 快得多，且天然覆盖「改了几行又改回来」→ 输出相同 → 判为未污染（正确）。
  // ⚠️ 与 `git()` 同源：也走 gitTimeoutMs()，且超时同样**不降级**（见上）。
  const diff = (() => {
    try {
      return execFileSync(gitBin(), ['diff', 'HEAD'], {
        cwd: repo,
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 256 * 1024 * 1024,
        timeout: gitTimeoutMs(),
      })
    } catch (e) {
      if (classifyGitError(e) === 'timeout') return GIT_TIMEOUT
      return null
    }
  })()

  // ---- 超时哨兵：任一 git 调用挂起 → 该仓库指纹**不可信** ----
  //
  // ⚠️ 必须与"git 不可用"（error 字段、走降级）**分开**。
  //    把挂起当降级 = 复刻 verify-staging 那次「静默降级 → 本该红变绿」的事故。
  //    这里给一个**独立的 timedOut 标记**，由 diffSnapshots 判成 problem（fail-closed）。
  const timedOut = head === GIT_TIMEOUT || rawStatus === GIT_TIMEOUT || diff === GIT_TIMEOUT

  // ⚠️ 先剔除闸门自产物，否则 --pre 刚写的基线文件会在 --post 时被当成污染（自指）。
  const status =
    rawStatus === GIT_TIMEOUT || rawStatus == null
      ? null
      : stripGateArtifacts(rawStatus.replace(/\r\n/g, '\n'))

  return {
    repo,
    head: head === GIT_TIMEOUT || head == null ? null : head.trim(),
    status: status == null ? null : status.replace(/\r\n/g, '\n'),
    trackedDiffSha:
      diff === GIT_TIMEOUT || diff == null
        ? null
        : crypto.createHash('sha256').update(diff).digest('hex'),
    timedOut,
    error: timedOut
      ? `git 调用超过 ${gitTimeoutMs()}ms 未返回（挂起）`
      : head == null
        ? '不是 git 仓库或 git 不可用'
        : null,
  }
}

/** 全部目标仓库的指纹快照。 */
function workspaceSnapshot() {
  const repos = [REPO_ROOT]
  const backend = findBackendRepo()
  if (backend && backend !== REPO_ROOT) repos.push(backend)

  return {
    capturedAt: new Date().toISOString(),
    backendFound: backend != null,
    backendRepo: backend,
    repos: repos.map(repoFingerprint),
  }
}

/** 人类可读的差异报告（空数组 = 一致）。 */
function diffSnapshots(pre, post) {
  const problems = []

  // ---- git 调用挂起（超时）→ 指纹不可信，**fail-closed** ----
  //
  // ⚠️ 必须放在最前：一旦某次 git 挂起，那一次的 head/status/diff 都拿不到，
  //    后续所有"值相同/值不同"的比较都是拿**残缺数据**在比 —— 得出"一致"是假绿。
  //    故先报出来、让闸门直接 fail，而不是继续比。
  for (const [side, snap] of [
    ['构建前', pre],
    ['构建后', post],
  ]) {
    for (const r of snap.repos || []) {
      if (r.timedOut) {
        problems.push(
          `${side}的 git 调用挂起（超过 ${gitTimeoutMs()}ms 未返回）：${r.repo}\n` +
            '      **这不是"git 不可用"**（那种情况会走降级）——是命令真的卡住了。\n' +
            '      常见原因：index.lock 被别的 git 进程占用 / 网络文件系统卡 IO /\n' +
            '      杀软实时扫描拦截（本机实测有 IndexProtect 驱动拦 IO）。\n' +
            '      处理：排查占用后**重跑一对 --pre/--post**；本次快照不可信，不得当"一致"。',
        )
      }
    }
  }

  // ---- 后端仓库「是哪个」变了 ----
  //
  // ⚠️ 两种情况都要覆盖，别只看布尔值：
  //   (a) 一边探测到、另一边没探测到（`backendFound` 翻转）
  //   (b) 两边都探测到，但**指向了不同的仓库**（换了落点）
  //
  // 实测（自测阶段）：旧版只判 (a)，于是 (b) 走到了下面「仓库在构建后消失了」
  // 那条分支，报因变成"仓库消失了"——而真相是"**换成了另一个**"。
  // 另外 (a) 的旧措辞是「构建窗口内仓库被移走/新建了？」，
  // 它把最常见的真实原因（环境变量没设 / CI 没 checkout 到 backend-src）
  // 说成了"有人动了仓库"—— 又是"错误报因比没有报因更贵"那类毛病。
  if (!pre.backendFound || !post.backendFound) {
    if (pre.backendFound !== post.backendFound) {
      const was = pre.backendFound ? pre.backendRepo : '未探测到'
      const now = post.backendFound ? post.backendRepo : '未探测到'
      problems.push(
        `后端仓库探测结果变了：构建前=${was}，构建后=${now}。\n` +
        '      常见原因是**环境问题**（不是"有人动了仓库"）：\n' +
        '        · 某一侧没设 SCADA_BACKEND_REPO（或设成了不存在的路径）\n' +
        '        · CI 里 backend-src 没 checkout 出来 / checkout 到了别处\n' +
        '        · 本机候选列表里的目录被改名/移动\n' +
        '      若确实是环境问题：修好环境后**重新跑一对 --pre/--post**，\n' +
        '      并注意"只校验了前端"的那一次**没有覆盖后端仓库**——防护是打折的。',
      )
    }
  } else if (pre.backendRepo !== post.backendRepo) {
    // 两边都探测到，但不是同一个仓库 —— 比"消失"更隐蔽：两次指纹都算得出，
    // 只是各算各的，于是任何真实改动都会被"换了仓库"这件事掩盖。
    problems.push(
      `后端仓库**换了落点**：构建前=${pre.backendRepo}，构建后=${post.backendRepo}。\n` +
      '      这意味着两次指纹根本不是同一个仓库的 —— 比对结果无意义。\n' +
      '      常见原因：SCADA_BACKEND_REPO 前后不一致，或候选列表顺序因目录存在性变化而改选。',
    )
  }

  const byRepo = (snap) => new Map(snap.repos.map((r) => [r.repo, r]))

  const preMap = byRepo(pre)
  const postMap = byRepo(post)

  for (const [repo, p] of preMap) {
    const q = postMap.get(repo)
    if (!q) {
      // 走到这里说明「同一次运行里这个仓库没了」（不是换仓库 —— 那已被上面拦下）
      problems.push(`仓库在构建后不见了：${repo} —— 被删除/改名/挂载点丢了？`)
      continue
    }
    const label = repo === REPO_ROOT ? '前端' : '后端'

    if (p.head !== q.head) {
      problems.push(
        `${label}仓库 HEAD 变了（${repo}）：${p.head} → ${q.head} —— ` +
        '构建窗口内有人提交/切换了分支',
      )
    }

    // ---- 判据 A：porcelain 清单（覆盖**未跟踪**新文件 / 新增删除 / 重命名）----
    //
    // ⚠️ 必须单独有一条，不能只依赖下面的内容哈希 ——
    //    `git diff HEAD` **只看已跟踪文件**，未跟踪的 `??` 完全不出现。
    //    实测（本闸门自测）：构建前 `git status` 干净，构建中 `echo x > new.py`
    //    → porcelain 多一行 `?? new.py`，而 `git diff HEAD` **一个字节都没变**
    //    → 只比哈希会**放行**。而 PyInstaller 恰恰会把这个新 .py 收进产物。
    if (p.status !== q.status) {
      const before = p.status ? p.status.split('\n').filter(Boolean) : []
      const after = q.status ? q.status.split('\n').filter(Boolean) : []
      const beforeSet = new Set(before)
      const afterSet = new Set(after)
      const appeared = after.filter((l) => !beforeSet.has(l))
      const vanished = before.filter((l) => !afterSet.has(l))

      let detail = ''
      if (appeared.length) detail += `\n      新增/变化: ${appeared.slice(0, 8).join(' | ')}`
      if (vanished.length) detail += `\n      消失: ${vanished.slice(0, 8).join(' | ')}`
      problems.push(`${label}仓库文件清单在构建窗口内变了（${repo}）：${detail}`)
    } else if (p.trackedDiffSha !== q.trackedDiffSha) {
      // ---- 判据 B：已跟踪文件的**正文**哈希 ----
      //
      // porcelain 行完全相同（都是 ` M`，文件名也没变），只有**内容**被改 ——
      // 这是本次事故的精确形态（二号机改动一个已修改文件的正文）。
      // porcelain 比对看不见它，只有哈希能。
      problems.push(
        `${label}仓库工作区在构建窗口内被改动（${repo}）：` +
        '\n      （porcelain 清单相同但文件内容哈希不同 —— 有人改了已修改文件的正文）',
      )
    }
  }

  return problems
}

function main(argv = process.argv.slice(2)) {
  const isPre = argv.includes('--pre')
  const isPost = argv.includes('--post')

  if (isPre === isPost) {
    console.error(
      '用法：node tools/verify-workspace-frozen.js --pre | --post\n' +
      '  --pre   构建前：写基线快照\n' +
      '  --post  构建后：与基线比对，不一致则 exit 1',
    )
    return 1
  }

  const snap = workspaceSnapshot()

  if (isPre) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    fs.writeFileSync(STATE_FILE, JSON.stringify(snap, null, 2) + '\n', 'utf8')
    const names = snap.repos.map((r) => (r.repo === REPO_ROOT ? '前端' : '后端')).join(' + ')
    console.log(
      `[frozen] 基线已记录（${names}）：` +
      `HEAD=${snap.repos.map((r) => (r.head || '?').slice(0, 8)).join(' / ')}` +
      (snap.backendFound ? '' : ' ⚠️ 未探测到后端仓库 —— 构建后只校验前端'),
    )
    return 0
  }

  if (!fs.existsSync(STATE_FILE)) {
    console.error(
      `[frozen] 找不到基线 ${STATE_FILE} ——\n` +
      '  构建前必须先跑 `--pre`。直接跑 `--post` 无法判断有没有被污染，\n' +
      '  这里**不降级放行**（fail-closed）。',
    )
    return 1
  }

  let pre
  try {
    pre = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch (e) {
    console.error(`[frozen] 基线文件损坏：${e && e.message} —— 请重跑 --pre`)
    return 1
  }

  const problems = diffSnapshots(pre, snap)

  // ---- 时效检查（2026-10-11 补）----
  //
  // 为什么需要：`--pre` 与 `--post` 之间本该只隔一次构建（几分钟）。
  // 若基线是几小时/几天前的，说明那次构建**没跑成**（崩了/被中断/忘了配对），
  // 而现在的 `--post` 是在拿一个**过期的参照物**比对。
  //
  // 实测（自测阶段）：`--pre` 后有人提交了一个合理的新 commit，
  // `--post` 报的是「**构建窗口内**有人提交/切换了分支」——
  // 措辞把人引向"构建时被污染"，而真实原因是"基线是上一次的"。
  // **错误的报因比没有报因更贵**：它会让人去查一个不存在的问题。
  //
  // 处置：一旦基线过旧，**结论本身不可信** → 明确区分两种情况，
  // 不让「窗口内污染」的判词在过期基线上冒充结论。
  const MAX_AGE_MS = (() => {
    const n = Number(process.env.SCADA_FROZEN_MAX_AGE_MS)
    return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000 // 默认 30 分钟
  })()
  const ageMs = Date.now() - Date.parse(pre.capturedAt || 0)
  const stale = Number.isFinite(ageMs) && ageMs > MAX_AGE_MS

  if (stale && problems.length) {
    const mins = Math.round(ageMs / 60000)
    console.error(
      `[frozen] ❌ 基线**已过期**（${mins} 分钟前，阈值 ${Math.round(MAX_AGE_MS / 60000)} 分钟）——` +
      '本次比对**结论不可信**：\n' +
      '\n  这意味着：`--pre` 与 `--post` 之间不止隔了一次构建。' +
      '\n  多半是上一次构建崩溃/被中断，或者忘了配对就重跑了。' +
      '\n' +
      `\n  基线时间：${pre.capturedAt}\n` +
      `  当前时间：${snap.capturedAt}\n` +
      '\n  本次检测到的差异（**可能只是"工作区自然演进了"，不一定是构建期污染**）：\n' +
      problems.map((p) => `    · ${p}`).join('\n') +
      '\n' +
      '\n  处置：**重新跑一次 `--pre`**（紧接着构建），不要凭这次的结论判断产物。' +
      '\n  若确实要放宽时效（例如构建本身就很慢），设 SCADA_FROZEN_MAX_AGE_MS 覆盖，' +
      '\n  但请先想清楚"这段时间里工作区会不会被别的进程改"。',
    )
    return 1
  }

  if (stale && !problems.length) {
    // 过旧但两边恰好一致 —— 不判负（没有污染证据），但**必须留痕**：
    // 一个"过期参照物 + 恰好一致"的通过，可信度远低于新鲜基线。
    const mins = Math.round(ageMs / 60000)
    console.log(
      `[frozen] OK（⚠️ 基线较旧：${mins} 分钟前，阈值 ${Math.round(MAX_AGE_MS / 60000)} 分钟）` +
      '：构建窗口内工作区未变动；' +
      '\n         但参照物已不新鲜，「未变动」的保证弱于新鲜基线 —— ' +
      '若这次是长时间构建，建议核对 --pre 与 --post 确实配成一对。',
    )
    return 0
  }

  if (problems.length) {
    console.error(
      '[frozen] ❌ 构建窗口内工作区被改动 —— 产物不可信：\n' +
      problems.map((p) => `  · ${p}`).join('\n') +
      '\n' +
      '\n  为什么这很危险：PyInstaller / electron-builder 收的是**工作区快照**，' +
      '不是 git HEAD。\n' +
      '  构建中途另一方落盘 ⇒ 「改了一半的源码」被冻结进产物，' +
      '而七道闸门全绿（它们只管产物内部一致性）。\n' +
      `  构建前快照时间：${pre.capturedAt}\n` +
      `  构建后快照时间：${snap.capturedAt}\n` +
      '  处置：两个仓库都冻结到干净状态后，**重新构建**（不要复用这次产物）。',
    )
    return 1
  }

  console.log(
    `[frozen] OK：构建窗口内工作区未变动（${snap.repos.length} 个仓库，` +
    `HEAD=${snap.repos.map((r) => (r.head || '?').slice(0, 8)).join(' / ')}）` +
    (snap.backendFound ? '' : '；⚠️ 仅校验了前端（后端仓库未探测到）'),
  )
  return 0
}

module.exports = {
  backendRepoCandidates,
  findBackendRepo,
  repoFingerprint,
  workspaceSnapshot,
  diffSnapshots,
  isGateOwnArtifact,
  stripGateArtifacts,
  classifyGitError,
  gitTimeoutMs,
  gitBin,
  GIT_TIMEOUT_DEFAULT_MS,
  REPO_ROOT,
  STATE_FILE,
}

if (require.main === module) {
  process.exit(main())
}
