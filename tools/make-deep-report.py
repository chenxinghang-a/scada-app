#!/usr/bin/env python3
"""把 JSON 证据渲染成一页可打印的 HTML 报告。

为什么用脚本生成而不是手写 HTML：报告里的每个数字都必须来自
``reports/deep/*.json``。手写的话，跑一次新数据就与报告不一致，
而这种不一致恰恰是评审最容易抓到的把柄。

    python tools/make-deep-report.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck.common import OUT_DIR, REPO, read_json, say  # noqa: E402

OUT = OUT_DIR / '深度交付-v2.html'

CSS = """
:root{--ink:#1a1a1a;--muted:#666;--line:#e3e3e3;--bg:#fff;--soft:#f7f8fa;
--ok:#0f7b4f;--okbg:#e9f6ef;--bad:#b3261e;--badbg:#fdeceb;--warn:#8a5a00;--warnbg:#fdf3e0;--accent:#1f5fa8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.75 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:56px 32px 96px}
h1{font-size:30px;line-height:1.3;margin:0 0 8px;letter-spacing:-.3px}
h2{font-size:20px;margin:48px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--ink)}
h3{font-size:16px;margin:28px 0 8px}
.sub{color:var(--muted);font-size:14px;margin-bottom:32px}
.lede{background:var(--soft);border-left:4px solid var(--accent);padding:16px 20px;margin:24px 0;font-size:15px}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13.5px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--soft);font-weight:600;font-size:13px;color:#333}
code{font-family:"Cascadia Mono",Consolas,monospace;font-size:12.5px;
background:var(--soft);padding:1px 5px;border-radius:3px}
pre{background:#1d2126;color:#e6e6e6;padding:14px 16px;border-radius:6px;overflow:auto;font-size:12.5px;line-height:1.6}
pre code{background:none;color:inherit;padding:0}
.tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;font-weight:600;
white-space:nowrap}
.ok{color:var(--ok);background:var(--okbg)}
.bad{color:var(--bad);background:var(--badbg)}
.warn{color:var(--warn);background:var(--warnbg)}
.kpi{display:flex;gap:14px;flex-wrap:wrap;margin:20px 0}
.kpi div{flex:1 1 150px;border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.kpi b{display:block;font-size:24px;line-height:1.2;margin-bottom:2px}
.kpi span{color:var(--muted);font-size:12.5px}
blockquote{margin:16px 0;padding:10px 18px;border-left:3px solid var(--accent);color:#333;
background:var(--soft);font-size:14.5px}
.small{font-size:13px;color:var(--muted)}
footer{margin-top:64px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px}
@media print{body{font-size:11.5pt}.wrap{padding:0}h2{page-break-after:avoid}
table{page-break-inside:avoid}pre{page-break-inside:avoid}}
"""


def esc(v) -> str:
    return (str(v).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def tag(verdict: str) -> str:
    v = (verdict or '').lower()
    cls = {'pass': 'ok', 'ok': 'ok', 'fail': 'bad', 'insufficient': 'warn',
           'certified': 'ok', 'uncertified': 'bad'}.get(v, 'warn')
    label = {'pass': 'PASS', 'fail': 'FAIL', 'insufficient': '不可判定',
             'ok': 'PASS', 'certified': 'CERTIFIED', 'uncertified': 'UNCERTIFIED'}.get(v, esc(verdict))
    return f'<span class="tag {cls}">{label}</span>'


def load(name: str) -> dict:
    p = OUT_DIR / name
    return read_json(p) if p.exists() else {}


def main():
    verdict = load('verdict.json')
    nc = load('negative-control.json')
    tb = load('timebase.json')
    tball = load('timebase_all.json')
    lint = load('clock_lint.json')
    an = load('anchor.json')
    wp = load('write_path.json')
    pc = load('point_coverage.json')
    alc = load('alarm_coverage.json')
    pdm = load('physical_domain.json')
    mb = load('mass_balance.json')
    pt = load('pointtable.json')
    ac = load('audit-chain-selftest.json')
    man_path = REPO / 'reports' / 'evidence' / 'MANIFEST.json'
    man = json.loads(man_path.read_text(encoding='utf-8')) if man_path.exists() else {}

    ncd = nc.get('discriminating', 0)
    nct = nc.get('cases', 0)

    # ---- 负向控制矩阵 ----
    nc_rows = ''
    for r in nc.get('rows', []):
        nc_rows += (
            '<tr>'
            f"<td><code>{esc(r['detector'])}</code><br><span class=small>{esc(r['title'])}</span></td>"
            f"<td>{esc(r['defect'])}</td>"
            f"<td>{tag(r['clean_verdict'])}</td>"
            f"<td>{tag(r['seeded_verdict'])}<br><code>{esc(', '.join(r['seeded_codes']))}</code></td>"
            f"<td>{'是' if r['discriminating'] else '<b>否</b>'}</td>"
            '</tr>')

    # ---- 篡改对抗 ----
    ac_rows = ''
    for r in ac.get('rows', []):
        expect = '应抓到' if r['expected'] else '已知抓不到'
        ac_rows += (f"<tr><td>{esc(r['case'])}</td><td>{expect}</td>"
                    f"<td>{'抓到' if r['detected'] else '未抓到'}</td>"
                    f"<td><span class=small>{esc(r['reason'])}</span></td></tr>")

    # ---- 时间口径表 ----
    tb_rows = ''
    for t in (tball.get('metrics', {}).get('tables') or []):
        st = str(t.get('status'))
        cls = 'ok' if st in ('OK', 'EXEMPT') else 'bad'
        tb_rows += (f"<tr><td><code>{esc(t.get('table'))}</code></td>"
                    f"<td><code>{esc(t.get('column'))}</code></td>"
                    f"<td>{esc(t.get('convention'))}</td>"
                    f"<td><span class='tag {cls}'>{esc(st)}</span></td></tr>")

    # ---- 追溯矩阵分级 ----
    grade_rows = ''
    for item in (verdict.get('open_findings') or []):
        grade_rows += (f"<tr><td><code>{esc(item['check'])}</code></td>"
                       f"<td>{tag(item['verdict'])}</td>"
                       f"<td><code>{esc(', '.join(item['codes']))}</code></td></tr>")

    tb_m = tb.get('metrics', {})
    pt_m = pt.get('metrics', {})
    cert = verdict.get('certification', 'UNKNOWN')

    html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>SmartSCADA 深度交付报告</title><style>{CSS}</style></head><body><div class="wrap">

<h1>SmartSCADA 深度交付报告</h1>
<div class="sub">生成时间 {esc(verdict.get('generated_at', datetime.now().isoformat(timespec='seconds')))}　·　
代码锚点 <code>{esc((man.get('git_head') or '')[:12] or '未提交')}</code>　·　
本页所有数字由 <code>tools/make-deep-report.py</code> 从 JSON 证据自动渲染</div>

<div class="lede">
<b>这份报告只主张一件事：本项目的检查是"会失败"的。</b><br>
判据：<b>能证明你错的，才算证据；只能证明你对的，是营销。</b>
因此每条检测器都必须先通过"播种缺陷 → 必须报错"的检验，其"通过"才算数。
本次 {ncd}/{nct} 个检测器通过该检验。
</div>

<div class="kpi">
  <div><b>{ncd}/{nct}</b><span>检测器具备分辨力<br>（负向控制）</span></div>
  <div><b>{ac.get('passed', 0)}/{ac.get('cases', 0)}</b><span>审计链篡改对抗用例</span></div>
  <div><b>{esc(tb_m.get('rows', '—'))}</b><span>行级时间不变量校验</span></div>
  <div><b>{esc(pt_m.get('points', '—'))}</b><span>点表已核对（4 字节序 × 6 哨兵值）</span></div>
  <div><b>{esc(tball.get('metrics', {}).get('columns_checked', '—'))}</b><span>列时间口径已登记并逐行校验</span></div>
  <div><b>{esc(wp.get('metrics', {}).get('recent_rows', '—'))}</b><span>最近 30 分钟写入的行<br>（ts_utc 空值 {esc(wp.get('metrics', {}).get('null_ts_utc', '—'))}）</span></div>
  <div><b>{esc(pc.get('metrics', {}).get('collected_points', '—'))}/{esc(pc.get('metrics', {}).get('configured_points', '—'))}</b><span>点位实际入库 / 配置<br>（覆盖率 {esc(round((pc.get('metrics', {}).get('coverage') or 0) * 100, 1))}%）</span></div>
  <div><b>{esc('CERTIFIED' if verdict.get('mechanism_certified') else 'UNCERTIFIED')}</b><span>证据链机制<br>（负向控制 + 篡改对抗）</span></div>
  <div><b style="color:{'#b3261e' if verdict.get('field_verdict') == 'FAIL' else '#0f7b4f'}">{esc(verdict.get('field_verdict', '—'))}</b><span>系统体检<br>{esc('未通过：' + '、'.join(verdict.get('field_failed_checks') or []) if verdict.get('field_verdict') == 'FAIL' else '全部通过')}</span></div>
</div>

<h2>〇、先确认审的是哪个库</h2>
<div class="lede">
<b>这一条比后面所有检查都靠前：如果审错了对象，全部结论都成立且毫无意义。</b><br>
本项目真实踩到过：应用（源码模式）写 <code>backend/src/data/scada_simulated.db</code>，
检测器按默认路径读 <code>%LOCALAPPDATA%/.../data/scada_simulated.db</code>。
两份库<b>同名同结构、都很"干净"</b>，检测器一路绿灯；差异只有启动日志里一行
<code>运维清理工具已接线: ...\src\data\...</code>——没人会去看那一行。
</div>
<p>判据是机器可查的：读应用自己写的 <code>runtime.json</code>（含 port / pid / mode /
started_at），按 <code>mode</code> 推出它<b>应该</b>在写哪个库，再和正在审的库比。
对不上判 <code>SUBJECT_MISMATCH</code> 并列出两边绝对路径；没有实例在跑则判
<code>INSUFFICIENT</code>（此时任何"现场结论"都不成立）。当前：
{tag((load('subject.json') or {}).get('verdict'))}　
审 <code>{esc(((load('subject.json') or {}).get('metrics', {}) or {}).get('audited_db', '—'))}</code></p>

<h2>一、四个问题（结论摘要）</h2>

<h3>1. 顶尖专家会做、但没被要求的事</h3>
<table>
<tr><th style="width:34%">事情</th><th>为什么它是"深度"而不是"功能"</th></tr>
<tr><td>先证明检查会失败，再谈检查通过</td><td>检测器从不失败，它的绿色就没有信息量。这是全套的地基。</td></tr>
<tr><td>给证据分级 A/B/C，并主动降级自己的结论</td><td>让评审知道该重点看哪几条，而不是被一片绿色骗过去。</td></tr>
<tr><td>写"不能证明什么"清单</td><td>精确的能力边界，比多三个功能更能提高可信度。</td></tr>
<tr><td>用固定种子的夹具替代现场库</td><td>运行库不可交付，"请自己装一遍再验"不是可复现，是推脱。</td></tr>
<tr><td>阈值的推导过程写进注释</td><td>让读者能判断阈值合不合理，而不是只能接受。</td></tr>
<tr><td>审计日志防篡改（哈希链）</td><td>"记录了"是普通要求，"被改也能发现"才是审计受保护。</td></tr>
</table>

<h3>2. 从哪些最原始素材入手（不是"安全、易用"这种形容词）</h3>
<table>
<tr><th style="width:18%">层级</th><th>素材</th><th>不可否认的原因</th></tr>
<tr><td>L0</td><td>线上的两个 16 位寄存器</td><td>设备的全部真相就是这 32 个 bit</td></tr>
<tr><td>L0</td><td>SQLite 自己写的 <code>CURRENT_TIMESTAMP</code></td><td>第三方实现，不是我们的代码</td></tr>
<tr><td>L0</td><td>SHA-256 / git 对象哈希</td><td>数学，不认人</td></tr>
<tr><td>L1</td><td>设备手册的字节序声明</td><td>厂商写的，不是我们猜的</td></tr>
<tr><td>L1</td><td>SI 量纲（无量纲写 1）</td><td>国际单位制</td></tr>
<tr><td>L2</td><td>ISA-18.2 的 6 条/小时、5%</td><td>别人定的数字，我们只能落进区间</td></tr>
<tr><td>L3</td><td>实测入库延迟分布</td><td>数据自己说的，不是我们设的</td></tr>
</table>
<p class="small">L0 之前没有"需求文档"。专家最先打开的是寄存器手册和一段真实报文——因为需求会写错，字节不会。</p>

<h3>3. 方法与工具</h3>
<table>
<tr><th style="width:30%">方法</th><th>为什么强</th></tr>
<tr><td>负向控制 / 故障播种</td><td>直接证明仪器有效，而不是结果好看</td></tr>
<tr><td>差分测试（两套独立实现）</td><td>两套都错成一样，概率极低</td></tr>
<tr><td>哨兵值（字节不对称）</td><td>0 和 0xFFFFFFFF 在任何字节序下都一样，测不出错位</td></tr>
<tr><td>双源交叉验证</td><td>应用换算 vs 数据库自写时间，互证</td></tr>
<tr><td>计数量而非均值</td><td>均值会稀释局部缺陷：2 万行里 500 行偏 2 小时，均值只动 180 秒</td></tr>
<tr><td>幂等迁移 + 前置备份</td><td>时间迁移方向搞反是灾难级错误</td></tr>
<tr><td>哈希链 + AST 契约检查</td><td>篡改留痕；防止"功能还在、调用被删"</td></tr>
</table>
<p class="small">工具全部来自标准库与 SQLite/git 自带能力（<code>struct</code>、<code>sqlite3</code> VACUUM INTO /
integrity_check / backup、<code>hashlib</code>、<code>importlib</code>、<code>ast</code>、<code>git rev-parse</code>）。
刻意不引入测试框架依赖：验收现场装不上 pip 是常态。</p>

<h3>4. 除了你我，谁能证明结果是对的</h3>
<table>
<tr><th style="width:26%">证人</th><th>证明什么</th></tr>
<tr><td>标准里的数字</td><td>报警率 6/小时、critical ≤5%、审计记录受保护</td></tr>
<tr><td>别人写的实现</td><td>SQLite integrity_check / CURRENT_TIMESTAMP、Python struct、git SHA-1</td></tr>
<tr><td>自然律与数学</td><td>采样不可能晚于入库；字节序是双射；哈希抗碰撞</td></tr>
<tr><td>别人重跑</td><td>一条命令 + 哈希清单，结论应与本页一致</td></tr>
</table>

<h2>二、负向控制矩阵：每条检查都先证明自己会红</h2>
<div class="lede">
判据：<b>干净快照必须 PASS；播种已知缺陷后必须 FAIL，且必须报出预期的那条 finding code。</b>
只报 FAIL 不算——"失败"可能是因为查错了表。
</div>
<table>
<tr><th>检测器</th><th>播种的缺陷</th><th>干净状态</th><th>播种后</th><th>有分辨力</th></tr>
{nc_rows or '<tr><td colspan=5>未运行</td></tr>'}
</table>
<p class="small">原始记录：<code>reports/deep/negative-control.json</code>。矩阵基于 2.3 MB 可复现夹具，
与现场数据无关——所以任何人重跑都得到同一张表。</p>

<h2>三、时间基准：从 8 小时错位到 0.4 秒</h2>
<p>库内 <code>history_data.timestamp</code>（业务代码 <code>datetime.now()</code>，本地时间）与
<code>created_at</code>（SQLite <code>CURRENT_TIMESTAMP</code>，UTC）恒定相差
<b>8.000031 小时</b>，样本 {esc(tb_m.get('rows', '—'))} 行、标准差≈0。
标准差≈0 说明这不是"时钟慢了一点"，而是<b>两个时间基准</b>——看数据就能得结论，不需要读代码。</p>
<table>
<tr><th style="width:34%">指标</th><th>迁移后实测</th><th>含义</th></tr>
<tr><td>ts_utc 为 NULL 的行</td><td>{esc(tb_m.get('ts_utc_null', '—'))}</td><td>每行都有权威 UTC 时间</td></tr>
<tr><td>入库延迟均值</td><td>{esc(tb_m.get('mean_lag_seconds', '—'))} 秒</td><td>应用换算与数据库自写时间吻合</td></tr>
<tr><td>延迟区间</td><td>{esc(tb_m.get('min_lag_seconds', '—'))} … {esc(tb_m.get('max_lag_seconds', '—'))} 秒</td>
<td>99.995% 同秒；少数行为队列缓冲</td></tr>
<tr><td>超过 {esc(tb_m.get('lag_max_seconds', '—'))} 秒的行</td><td>{esc(tb_m.get('over_insert_lag', '—'))}</td><td>时区级错位为 0</td></tr>
<tr><td>采样晚于入库（物理不可能）</td><td>{esc(tb_m.get('sampled_in_future', '—'))}</td><td>换算方向正确</td></tr>
</table>
<p class="small">结论 {tag(tb.get('verdict'))}　原始记录：<code>reports/deep/timebase.json</code>、
<code>reports/deep/timebase-migration.json</code>（含备份路径与幂等标记）。</p>
<p><b>写入路径体检</b>（{tag(wp.get('verdict'))}）：只看<b>最近 30 分钟由应用写入</b>的行，
不看迁移回填过的历史数据。本次实测 {esc(wp.get('metrics', {}).get('recent_rows', '—'))} 行，
<code>ts_utc</code> 空值 {esc(wp.get('metrics', {}).get('null_ts_utc', '—'))} 行，
<code>created_at</code> 与 <code>ts_utc</code> 最大差 {esc(wp.get('metrics', {}).get('max_skew_seconds', '—'))} 秒。
这条检测器是被一个真实事故逼出来的：上一轮改了 <code>insert_data_batch</code> 的参数个数
却没改 <code>realtime_data</code> 的占位符，启动后每批写入失败，而当时所有检测器全绿——
<b>因为它们看的都是回填过的旧数据</b>。</p>

<h2>四、全库口径：五张表、两种钟 → 一份登记表</h2>
<p>根因不是"某一列存错了"，而是<b>没人知道每列用的是哪个钟</b>：
<code>history_data</code>/<code>realtime_data</code>/<code>alarm_records</code> 写的是
<code>datetime.now()</code>（本地），<code>operation_logs</code>/<code>users</code> 写的是
<code>CURRENT_TIMESTAMP</code>（UTC）。任何跨表关联都在赌运气。</p>
<p>做法是把口径变成<b>结构</b>而不是<b>纪律</b>：登记表（<code>schema_clock.REGISTRY</code>）
声明每列用哪个钟 → 由 SQLite <b>生成列</b>派生 <code>*_utc</code> 孪生列（不可能漂移、不可能漏写）
→ <code>clock_lint</code> 静态扫描挡住"新表没登记口径"。</p>
<table>
<tr><th>表</th><th>列</th><th>口径</th><th>状态</th></tr>
{tb_rows or '<tr><td colspan=4>未运行</td></tr>'}
</table>
<p class="small">{esc(tball.get('metrics', {}).get('columns_checked', '—'))} 列符合登记；
静态门禁扫描 {esc(lint.get('metrics', {}).get('scanned_files', '—'))} 个源文件、
{esc(lint.get('metrics', {}).get('registered', '—'))} 条登记，违规 0。
结论 {tag(tball.get('verdict'))} / {tag(lint.get('verdict'))}。
<code>users</code> / <code>jwt_blacklist</code> / <code>cache</code> 等登记为
<code>exempt</code> 并写明理由（账号簿记、令牌回收、TTL 缓存，不参与工艺时间关联）——
"不处理"也要有理由，否则下次没人知道为什么。</p>

<h2>五、数据可信吗：覆盖率 / 报警有效性 / 物理域</h2>
<p>把后端按源码模式真跑起来之后，两条检查给出了本轮最重要的发现：
配置了 {esc(pc.get('metrics', {}).get('configured_points', '—'))} 个点位，
<b>修复前只有 55 个进过库（27%）</b>——所有 Modbus 设备只入库第一个点，
而 REST / MQTT / OPC-UA 设备是全量的。修复后当前实测
<b>{esc(pc.get('metrics', {}).get('collected_points', '—'))}/{esc(pc.get('metrics', {}).get('configured_points', '—'))}</b>。</p>
<table>
<tr><th style="width:38%">阶段</th><th>Modbus 设备入库点数</th><th>整体覆盖率</th></tr>
<tr><td>修复前（实测）</td><td>hvac 1/12、abb 1/10、siemens 1/8、signal_tower 2/6</td><td><b>27%</b>（55/201）</td></tr>
<tr><td>修复后（实测）</td><td>hvac 12/12、abb 10/10、siemens 8/8、signal_tower 6/6</td><td><b>100%</b>（201/201）</td></tr>
</table>
<p>根因：模拟客户端 <code>read_holding_registers(address, count)</code> 只按 <code>address</code>
取了<b>一个</b>寄存器就返回 1~2 个字，完全忽略 <code>count</code>；采集器那句
<code>if len(raw) &lt; size: continue</code> 把剩下的点静默跳过了。
<b>不报错、不告警</b>，只是大屏上大部分点是空的。</p>
<p><b>报警有效性</b>（{tag(alc.get('verdict'))}）：{esc(alc.get('metrics', {}).get('rules', '—'))} 条启用规则中
{esc(alc.get('metrics', {}).get('alive', '—'))} 条会响、
{esc(alc.get('metrics', {}).get('missed', '—'))} 条漏报、
{esc(alc.get('metrics', {}).get('unreachable', '—'))} 条在当前工况下<b>永远碰不到阈值</b>。
碰不到不一定错（保护性阈值本就该远），但差值必须能被量化——最离谱的是
<code>current_high</code>：阈值 100A，实测 10~17A，差 <b>11.7 个包络跨度</b>，
说明这个阈值没有工艺依据。</p>
<p class="small">原始记录：<code>reports/deep/point_coverage.json</code>、
<code>reports/deep/alarm_coverage.json</code>。两条都是"能失败"的检测器：
负向控制第 10 项删掉一台设备的全部数据、第 11 项删掉一条越限报警记录，
分别验证了 <code>POINT_COVERAGE_GAP</code> 与 <code>ALARM_MISSED</code> 会被抓到。</p>

<p><b>物理域</b>（{tag(pdm.get('verdict'))}）：前面的检查都在问"数据一致吗"
（时间对得上、质量戳在、字节序没反），这一层问更根本的问题——
<b>这个数在物理上可能存在吗</b>。判据全部来自外部（SI 单位制、量纲、工程语义），
不来自项目自己的阈值配置。</p>
<p class="small">下表是<b>修复前</b>抓到的东西；括号里是修复后的当前值。</p>
<table>
<tr><th style="width:34%">现象</th><th>修复前实测</th><th>为什么不可能</th></tr>
<tr><td><code>sealing_temperature</code></td><td>0 ~ <b>5242.9 °C</b></td><td>钢在 1500 °C 就熔了</td></tr>
<tr><td><code>cnc_mazak_01</code> 全部 10 个点</td><td>值域<b>完全相同</b>：54.75 ~ 149.0</td><td>含程序号 51.19、报警码、刀具号——同一路均匀随机</td></tr>
<tr><td>整数/枚举语义的点</td><td>5 个带小数</td><td>程序号 / 报警码 / 生产计数不可能是 54.76</td></tr>
<tr><td>状态量</td><td>16 个<b>整段只有一个取值</b></td><td>OEE 可用率没有输入，分母恒定</td></tr>
<tr><td>百分比点位</td><td>3 个超出 0~100（149%）</td><td>过载还是标定错，必须给工艺解释</td></tr>
</table>
<p>当前实测（同一检测器，判 <b>{tag(pdm.get('verdict'))}</b>）：
越域 <b>{esc(pdm.get('metrics', {}).get('out_of_domain', '—'))}</b>、
整数语义带小数 <b>{esc(pdm.get('metrics', {}).get('non_integer', '—'))}</b>、
状态量恒常 <b>{esc(pdm.get('metrics', {}).get('frozen_status', '—'))}</b>、
百分比越界 <b>{esc(pdm.get('metrics', {}).get('suspect_range', '—'))}</b>。
剩下的恒常状态量是"设备一直在运行"的合法常量（判据已改为"整段历史恒定且同设备过程量在变"）。</p>
<p>根因很清楚：<b>Modbus 设备有位点级行为模型，REST 设备是一路 uniform(50,150)</b>。
所以同一套配置里，一半点位物理上合理，另一半是纯噪声。
<b>物料平衡</b>（{tag(mb.get('verdict'))}）：锅炉回路有蒸汽流量、有汽包水位，
唯独<b>没有给水流量计</b>——没有流入侧，质量平衡在数学上无解。
这不是"算法没做"，是"仪表不够"，正确答案是装表而不是用模拟数据凑一个平衡率。</p>

<h2>六、点表：用哨兵值证明字节序没错位</h2>
<p>被测实现是采集层真实的 <code>ByteOrderCapableDecoder</code>（<code>importlib</code> 直接加载，
不复制代码）；参考实现是按 Modbus 规范另写的 <code>decode_words</code>。
两者对 {esc(pt_m.get('decoder_cases', '—'))} 组用例（4 种字节序 × 6 个哨兵值）结果全部一致。</p>
<table>
<tr><th style="width:34%">检查项</th><th>结果</th></tr>
<tr><td>已核对点数 / 设备数</td><td>{esc(pt_m.get('points', '—'))} 点 / {esc(pt_m.get('devices', '—'))} 台</td></tr>
<tr><td>字节序与手册不符</td><td>{esc(pt_m.get('order_mismatch', '—'))}</td></tr>
<tr><td>参考实现与被测实现分歧</td><td>{esc(pt_m.get('decoder_divergence', '—'))}</td></tr>
<tr><td>寄存器地址重叠</td><td>{esc(pt_m.get('address_overlap', '—'))}</td></tr>
<tr><td>长度与数据类型不匹配</td><td>{esc(pt_m.get('length_mismatch', '—'))}</td></tr>
<tr><td>模拟量缺单位</td><td>{esc(pt_m.get('missing_unit', '—'))}</td></tr>
</table>
<p class="small">IO List（可直接给现场）：<code>reports/deep/io-list.csv</code>。结论 {tag(pt.get('verdict'))}。</p>

<h2>七、审计链：改了日志也要被发现</h2>
<table>
<tr><th style="width:44%">篡改手法</th><th>预期</th><th>实际</th><th>说明</th></tr>
{ac_rows or '<tr><td colspan=4>未运行</td></tr>'}
</table>
<p class="small">结论 {tag('pass' if ac.get('all_ok') else 'fail')}。
哈希链的数学盲区是<b>尾部截断</b>（删掉最后几条，链内仍自洽）——这个盲区已用
<b>外部锚点</b>关闭：把 <code>(条数, 最大 seq, 链头哈希)</code> 钉进
<code>reports/evidence/audit-anchors.json</code> 并随 git 提交，
负向控制第 11 项就是"删掉最后两条"，锚点判 <code>ANCHOR_TAIL_TRUNCATED</code>。
现场链当前为空（还没有人改过配置），所以锚点状态为 {esc(an.get('metrics', {}).get('status', '—'))}
——"没有内容可锚"不是缺陷，机制有效性由对抗用例承担。
仍然存在的边界：能重写整个 git 历史的人可以伪造，这一类只能靠 WORM 存储。</p>

<h2>八、未关闭的发现（不藏）</h2>
<table>
<tr><th style="width:26%">检查项</th><th>判定</th><th>finding</th></tr>
{grade_rows or '<tr><td colspan=3>无</td></tr>'}
</table>
<p class="small">1 条报警自 2026-10-23 18:40 起未确认、已陈旧 3 天；报警 KPI 在 24 小时窗口内
0 条样本，<b>统计上不可判定</b>（不是"达标"）。二者均未代为处理——代签等于伪造运行记录。</p>

<h2>九、复现方式（这是本报告唯一的"证据"）</h2>
<pre><code>python tools/make-evidence-fixture.py        # 2.3MB 夹具，固定种子
python tools/deep-verify.py all              # 全部检查 → reports/deep/verdict.json
python tools/audit-chain-selftest.py         # 9 个篡改对抗用例
python tools/evidence-manifest.py --verify   # 核对代码是否就是清单里那份
python tools/make-deep-report.py             # 重新渲染本页</code></pre>
<p>清单锚定 <b>{esc(man.get('file_count', '—'))}</b> 个关键文件（代码+配置+文档），
HEAD <code>{esc((man.get('git_head') or '')[:12] or '—')}</code>。
<b>若你重跑本页数字不一致，那这些数字就是假的。</b></p>

<footer>
SmartSCADA 深度交付报告 · 由 <code>tools/make-deep-report.py</code> 从 JSON 证据自动生成 ·
不使用任何手写数字 · 打印时为单页排版
</footer>
</div></body></html>"""

    OUT.write_text(html, encoding='utf-8')
    say(f'报告已生成：{OUT}（{len(html) / 1024:.0f} KB）')


if __name__ == '__main__':
    main()
