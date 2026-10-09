'use strict';
/**
 * gpu-policy.js — GPU / 沙箱「自愈降级阶梯」的**纯决策层**（可单测；无 electron/fs 依赖）。
 *
 * 为什么需要它（2026-10-09 实测记录）
 * ----------------------------------
 * 「双击打不开」的崩溃在受限环境里是**一整条谱系**，只关一层的旧方案修不完：
 *
 *   L0（默认）            GPU 进程的沙箱起不来 → GPU 连崩 9 次（0xC0000005）→
 *                         FATAL: "GPU process isn't usable. Goodbye." → 进程秒退。
 *   L1（disable-gpu-sandbox + 软渲染）
 *                         GPU 不崩了，但**渲染进程**的沙箱同样起不来 →
 *                         渲染进程崩（crashed）×2 → 窗口是**死的**（白窗）。
 *                         注意：主进程能活过 15 秒，「窗口建出来」也不代表能用！
 *   L2（再加 no-sandbox） 全链路 0 崩溃（实测）。
 *
 * 于是有三个设计要点：
 *   1. **级别要能升级**（0→1→2），「崩一级升一级」，直到某级能成功；
 *   2. **成功的判据不能只看主进程存活** —— 渲染进程死在启动阶段时，
 *      main.js 侧同样**不得**记为成功（见那里对 `rendererGoneEarly` 的处理）；
 *   3. **成功级别要粘性记住**（gpu-state.json）—— 受限环境里如果每次冷启动
 *      都从 L0 试起，用户就会经历「点一次崩、点一次白窗、点一次才好」的循环，
 *      体感就是「还是打不开」。记住上次成功的级别后，之后每次都能直接打开。
 *
 * 职责边界：本模块**只算级别**。「级别 → 命令行开关」的映射留在 main.js
 * （贴近 Electron 的部分不可单测，由源码结构守卫盯着）。
 */

/** 最高兜底级别。L2 = disable-gpu-sandbox + 软渲染 + no-sandbox。 */
const MAX_FALLBACK_LEVEL = 2;

/** 把任意输入归一化为 [0, MAX] 的整数级别。非法输入（缺字段 / null / NaN）→ 0。 */
function normalizeLevel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_FALLBACK_LEVEL, Math.floor(n)));
}

/**
 * 决定本次启动的兜底级别与原因。
 *
 * @param {{prevCrashed?: boolean, prevLevel?: *, goodLevel?: *, manualLevel?: *, manualReason?: string|null}} input
 *   - prevCrashed  上次启动没走完正常流程（launch-attempt.json 还在且新鲜）
 *   - prevLevel    上次启动用的级别（旧版标记没有此字段 → 按 0 处理）
 *   - goodLevel    gpu-state.json 里记住的「历史成功级别」（粘性）
 *   - manualLevel  手动开关级别（env SCADA_DISABLE_GPU=1 / disable-gpu.flag → 1）
 *   - manualReason 手动开关的名字（'env' / 'flag'，仅用于日志）
 * @returns {{level: number, reason: string|null}} level=0 ⇔ reason=null
 *
 * 规则：
 *   1. 上次崩了 → 在它用的级别上 +1（封顶 MAX）——「崩一级升一级」；
 *   2. 历史成功级别（粘性）→ 至少从它起；
 *   3. 手动开关 → 至少 L1（只抬不降）；
 *   4. 取三者最大。
 */
function decideLevel(input) {
  const { prevCrashed, prevLevel, goodLevel, manualLevel, manualReason } = input || {};

  const good = normalizeLevel(goodLevel);
  const manual = normalizeLevel(manualLevel);
  let auto = 0;
  if (prevCrashed) auto = Math.min(normalizeLevel(prevLevel) + 1, MAX_FALLBACK_LEVEL);

  const level = Math.max(auto, good, manual);
  if (level === 0) return { level: 0, reason: null };

  // reason 取「最高级别的来源」，仅用于日志与排查（不影响行为）。
  let reason;
  if (auto >= good && auto >= manual) reason = 'auto-retry';
  else if (good >= manual) reason = 'sticky';
  else reason = manualReason || 'manual';
  return { level, reason };
}

module.exports = { MAX_FALLBACK_LEVEL, normalizeLevel, decideLevel };
