<template>
  <div class="industry40">
    <el-tabs v-model="activeTab" @tab-change="onTabChange" type="border-card">
      <!-- 总览 -->
      <el-tab-pane label="总览" name="overview">
        <el-row :gutter="12" class="metric-row">
          <el-col :span="6">
            <div class="panel metric-box">
              <div class="metric-label">平均健康评分</div>
              <div class="metric-value" :style="{ color: healthVar(overview.health) }">{{ overview.health }}<span class="metric-unit">%</span></div>
              <div class="band-bar" v-if="overview.health > 0" role="img" aria-label="健康分档位">
                <span v-for="(b, i) in HEALTH_BANDS" :key="b.label" class="band-bar__seg"
                  :style="{ background: 'var(' + b.token + ')', opacity: isBandOn(HEALTH_BANDS, overview.health, i) ? 1 : 0.2 }" />
              </div>
              <div class="metric-label">{{ overview.health > 0 ? bandLabelOf(HEALTH_BANDS, overview.health) : '暂无数据' }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="panel metric-box">
              <div class="metric-label">平均 OEE</div>
              <div class="metric-value" :style="{ color: oeeVar(overview.oee) }">{{ overview.oee }}<span class="metric-unit">%</span></div>
              <div class="band-bar" v-if="overview.oee > 0" role="img" aria-label="OEE 档位">
                <span v-for="(b, i) in OEE_BANDS" :key="b.label" class="band-bar__seg"
                  :style="{ background: 'var(' + b.token + ')', opacity: isBandOn(OEE_BANDS, overview.oee, i) ? 1 : 0.2 }" />
              </div>
              <div class="metric-label">{{ overview.oee > 0 ? bandLabelOf(OEE_BANDS, overview.oee) : '暂无数据' }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="panel metric-box">
              <div class="metric-label">总功率</div>
              <div class="metric-value">{{ overview.power }}<span class="metric-unit">kW</span></div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="panel metric-box">
              <div class="metric-label">碳排放</div>
              <div class="metric-value">{{ overview.carbon }}<span class="metric-unit">kg</span></div>
            </div>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="16">
            <div class="panel">
              <div class="panel__header">
                <span>产线设备拓扑</span>
                <span class="panel__hint">节点色=该设备 OEE 档位</span>
              </div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.overview">
                  <div ref="processFlowRef" class="process-flow"></div>
                  <el-empty v-if="!overviewNodes.length" class="chart-empty" description="暂无设备状态数据" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header"><span>维护建议</span></div>
              <div class="panel__body">
                <div class="alert-list">
                  <div v-for="(a,i) in overview.alerts" :key="i" class="alert-item" :class="'sev-'+a.severity">
                    <span class="level-bar" :class="levelBarClass(a.severity)" />
                    <span class="alert-sev">{{ a.severity }}</span>
                    <span class="alert-msg">{{ a.message || a.device_id }}</span>
                  </div>
                  <el-empty v-if="!overview.alerts.length" description="暂无建议" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- 预测性维护 -->
      <el-tab-pane label="预测维护" name="predictive">
        <el-row :gutter="12">
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header">
                <span>平均健康分</span>
                <span class="panel__hint">0–100 五档</span>
              </div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.predictive">
                  <div ref="healthRingRef" class="chart-box chart-box--sm"></div>
                  <el-empty v-if="!hasHealth" class="chart-empty" description="暂无健康评分" :image-size="60" />
                </div>
                <div class="band-legend">
                  <span v-for="b in HEALTH_BANDS" :key="b.label" class="band-legend__item">
                    <span class="band-dot" :style="{ background: 'var(' + b.token + ')' }" />
                    <span class="band-legend__text">{{ b.label }}</span>
                  </span>
                </div>
              </div>
            </div>
          </el-col>
          <el-col :span="16">
            <div class="panel">
              <div class="panel__header">
                <span>按设备健康分排序（最差在前）</span>
                <span class="panel__hint">柱尾红点 = 该设备存在异常点</span>
              </div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.predictive">
                  <div ref="healthRankRef" class="chart-box chart-box--tall"></div>
                  <el-empty v-if="!hasHealth" class="chart-empty" description="暂无健康评分" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
        <el-row :gutter="12" style="margin-top:12px">
          <el-col :span="16">
            <div class="panel">
              <div class="panel__header"><span>健康评分明细</span></div>
              <div class="panel__body">
                <el-table :data="healthScores" stripe size="small" max-height="460">
                  <el-table-column prop="device_id" label="设备" width="170" show-overflow-tooltip />
                  <el-table-column prop="register_name" label="寄存器" width="140" show-overflow-tooltip />
                  <el-table-column label="健康评分" width="170">
                    <template #="{row}">
                      <div class="health-cell">
                        <span class="health-cell__val" :style="{ color: healthVar(row.health_score) }">{{ row.health_score }}%</span>
                        <span class="band-bar band-bar--mini">
                          <span v-for="(b, i) in HEALTH_BANDS" :key="b.label" class="band-bar__seg"
                            :style="{ background: 'var(' + b.token + ')', opacity: isBandOn(HEALTH_BANDS, row.health_score, i) ? 1 : 0.2 }" />
                        </span>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="趋势" width="70">
                    <template #="{row}"><span :class="'trend trend--' + (row.trend || 'stable')">{{ trendArrow(row.trend) }}</span></template>
                  </el-table-column>
                  <el-table-column label="异常数" width="80">
                    <template #="{row}">
                      <span :class="Number(row.anomaly_count) > 0 ? 'text-danger' : 'text-muted'">{{ row.anomaly_count }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="故障预测" width="100">
                    <template #="{row}">{{ row.failure_prediction?.days_to_limit != null ? row.failure_prediction.days_to_limit+'天' : '-' }}</template>
                  </el-table-column>
                  <el-table-column prop="updated_at" label="更新时间" />
                </el-table>
                <el-empty v-if="!hasHealth" description="暂无数据" :image-size="60" />
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header"><span>维护建议</span></div>
              <div class="panel__body">
                <div class="alert-list">
                  <div v-for="(a,i) in maintenanceAlerts" :key="i" class="alert-item" :class="'sev-'+a.severity">
                    <span class="level-bar" :class="levelBarClass(a.severity)" />
                    <span class="alert-sev">{{ a.severity }}</span>
                    <span class="alert-msg">{{ a.message || a.device_id }}</span>
                  </div>
                  <el-empty v-if="!maintenanceAlerts.length" description="暂无建议" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- OEE -->
      <el-tab-pane label="OEE效率" name="oee">
        <el-row :gutter="12">
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header">
                <span>综合 OEE</span>
                <span class="tag tag--info">世界级目标 {{ OEE_TARGET }}%</span>
              </div>
              <div class="panel__body">
                <div class="oee-hero">
                  <div class="metric-value metric-value--lg" :style="{ color: oeeVar(avgOEE) }">{{ avgOEE }}<span class="metric-unit">%</span></div>
                  <span class="tag" :class="oeeTagClass(avgOEE)">{{ bandLabelOf(OEE_BANDS, avgOEE) }}</span>
                </div>
                <div class="chart-wrap" v-loading="loading.oee">
                  <div ref="oeeRingRef" class="chart-box chart-box--sm"></div>
                  <el-empty v-if="!hasOEE" class="chart-empty" description="暂无 OEE 数据" :image-size="60" />
                </div>
                <div class="band-legend">
                  <span v-for="b in OEE_BANDS" :key="b.label" class="band-legend__item">
                    <span class="band-dot" :style="{ background: 'var(' + b.token + ')' }" />
                    <span class="band-legend__text">{{ b.label }}</span>
                  </span>
                </div>
              </div>
            </div>
          </el-col>
          <el-col :span="16">
            <div class="panel">
              <div class="panel__header">
                <span>按设备 OEE 排序（最差在前）</span>
                <span class="panel__hint">虚线 = 世界级目标 {{ OEE_TARGET }}%</span>
              </div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.oee">
                  <div ref="oeeRankRef" class="chart-box chart-box--tall"></div>
                  <el-empty v-if="!hasOEE" class="chart-empty" description="暂无 OEE 数据" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
        <el-row :gutter="12" style="margin-top:12px">
          <el-col :span="10">
            <div class="panel">
              <div class="panel__header">
                <span>OEE 分项达成（平均）</span>
                <span class="panel__hint">三因子为乘性关系（OEE=A×P×Q），同标尺并列比较</span>
              </div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.oee">
                  <div ref="oeeFactorRef" class="chart-box chart-box--sm"></div>
                  <el-empty v-if="!hasOEE" class="chart-empty" description="暂无 OEE 数据" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
          <el-col :span="14">
            <div class="panel">
              <div class="panel__header"><span>OEE 明细</span></div>
              <div class="panel__body">
                <el-table :data="oeeRecords" stripe size="small" max-height="320">
                  <el-table-column prop="device_id" label="设备" width="160" show-overflow-tooltip />
                  <el-table-column label="可用率A" width="100">
                    <template #="{row}"><span :style="{ color: oeeVar(row.availability*100) }">{{ (row.availability*100).toFixed(1) }}%</span></template>
                  </el-table-column>
                  <el-table-column label="性能率P" width="100">
                    <template #="{row}"><span :style="{ color: oeeVar(row.performance*100) }">{{ (row.performance*100).toFixed(1) }}%</span></template>
                  </el-table-column>
                  <el-table-column label="质量率Q" width="100">
                    <template #="{row}"><span :style="{ color: oeeVar(row.quality*100) }">{{ (row.quality*100).toFixed(1) }}%</span></template>
                  </el-table-column>
                  <el-table-column label="OEE" width="90">
                    <template #="{row}"><span :style="{ color: oeeVar(row.oee_percent), fontWeight: 600 }">{{ row.oee_percent }}%</span></template>
                  </el-table-column>
                  <el-table-column prop="grade" label="等级" width="90" />
                  <el-table-column prop="total_production" label="总产量" width="90" />
                  <el-table-column prop="good_production" label="合格品" width="90" />
                </el-table>
                <el-empty v-if="!hasOEE" description="暂无数据" :image-size="60" />
              </div>
            </div>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- SPC -->
      <el-tab-pane label="SPC过程控制" name="spc">
        <div class="panel">
          <div class="panel__header">
            <span>控制图</span>
            <span class="panel__hint">UCL/CL/LCL 来自后端 control_chart，越界点红色高亮</span>
          </div>
          <div class="panel__body">
            <div class="filter-bar">
              <el-select v-model="spc.deviceId" placeholder="选择设备" size="small" class="filter-bar__select" @change="onSpcDeviceChange">
                <el-option v-for="d in deviceList" :key="d.device_id" :label="d.name||d.device_id" :value="d.device_id" />
              </el-select>
              <el-select v-model="spc.registerName" placeholder="选择寄存器" size="small" class="filter-bar__select filter-bar__select--sm">
                <el-option v-for="r in spc.registers" :key="r" :label="r" :value="r" />
              </el-select>
              <el-button type="primary" size="small" @click="loadSPC" :disabled="!spc.deviceId||!spc.registerName">查看</el-button>
            </div>
            <el-row :gutter="12">
              <el-col :span="12">
                <div class="chart-wrap" v-loading="loading.spc">
                  <div ref="spcXbarRef" class="chart-box"></div>
                  <el-empty v-if="!hasSpcXbar" class="chart-empty" description="请选择设备与寄存器" :image-size="60" />
                </div>
              </el-col>
              <el-col :span="12">
                <div class="chart-wrap" v-loading="loading.spc">
                  <div ref="spcRRef" class="chart-box"></div>
                  <el-empty v-if="!hasSpcR" class="chart-empty" description="请选择设备与寄存器" :image-size="60" />
                </div>
              </el-col>
            </el-row>
          </div>
        </div>
        <el-row :gutter="12" style="margin-top:12px">
          <el-col :span="12">
            <div class="panel">
              <div class="panel__header">
                <span>过程能力指数</span>
                <span class="panel__hint">≥1.33 充足 · 1.0–1.33 勉强 · &lt;1.0 不足</span>
              </div>
              <div class="panel__body">
                <div class="cap-grid" v-if="spc.capability">
                  <div v-for="k in CAP_KEYS" :key="k.key" class="cap-item">
                    <span class="cap-label">{{ k.label }}</span>
                    <span class="cap-val" :style="{ color: capVar(spc.capability[k.key]) }">{{ spc.capability[k.key] }}</span>
                    <span class="tag" :class="capTagClass(spc.capability[k.key])">{{ bandLabelOf(CAP_BANDS, Number(spc.capability[k.key])) }}</span>
                  </div>
                </div>
                <el-empty v-else description="请选择设备和寄存器" :image-size="60" />
                <div v-if="spc.capability" class="cap-meta">
                  <span>规格上限 USL {{ spc.capability.usl ?? '-' }}</span>
                  <span>规格下限 LSL {{ spc.capability.lsl ?? '-' }}</span>
                  <span>均值 {{ spc.capability.mean ?? '-' }}</span>
                  <span>等级 {{ spc.capability.capability_grade ?? '-' }}</span>
                </div>
              </div>
            </div>
          </el-col>
          <el-col :span="12">
            <div class="panel">
              <div class="panel__header"><span>判异规则检测</span></div>
              <div class="panel__body">
                <div class="violation-list">
                  <div v-for="(v,i) in spc.violations" :key="i" class="violation-item">
                    <span class="level-bar level-bar--critical" />
                    <span class="v-rule">规则 {{ v.rule }}</span>
                    <span class="v-dev">{{ v.device_id }}</span>
                    <span class="v-time">{{ fmtTime(v.timestamp) }}</span>
                  </div>
                  <el-empty v-if="!spc.violations.length" description="无判异" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- 能源 -->
      <el-tab-pane label="能源管理" name="energy">
        <el-row :gutter="12" class="metric-row">
          <el-col :span="6"><div class="panel metric-box"><div class="metric-label">总用电</div><div class="metric-value">{{ energy.total_kwh }}<span class="metric-unit">kWh</span></div></div></el-col>
          <el-col :span="6"><div class="panel metric-box"><div class="metric-label">电费</div><div class="metric-value">¥{{ energy.total_cost }}</div></div></el-col>
          <el-col :span="6"><div class="panel metric-box"><div class="metric-label">碳排放</div><div class="metric-value">{{ energy.carbon_kg }}<span class="metric-unit">kg</span></div></div></el-col>
          <el-col :span="6"><div class="panel metric-box"><div class="metric-label">等效树木</div><div class="metric-value">{{ energy.equivalent_trees }}<span class="metric-unit">棵</span></div></div></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header"><span>峰谷用电占比</span></div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.energy">
                  <div ref="energyPieRef" class="chart-box chart-box--sm"></div>
                  <el-empty v-if="!hasTou" class="chart-empty" description="暂无分时电量" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header"><span>峰平谷电量堆叠</span></div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.energy">
                  <div ref="powerBarRef" class="chart-box chart-box--sm"></div>
                  <el-empty v-if="!hasTou" class="chart-empty" description="暂无分时电量" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header"><span>电费分时占比</span></div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.energy">
                  <div ref="energyCostRef" class="chart-box chart-box--sm"></div>
                  <el-empty v-if="!hasCost" class="chart-empty" description="暂无电费明细" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
        <el-row :gutter="12" style="margin-top:12px">
          <el-col :span="24">
            <div class="panel">
              <div class="panel__header">
                <span>各设备实时功率</span>
                <span class="panel__hint">按功率降序</span>
              </div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.energy">
                  <div ref="energyPowerRef" class="chart-box chart-box--sm"></div>
                  <el-empty v-if="!energyDevices.length" class="chart-empty" description="暂无实时功率" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- 边缘决策 -->
      <el-tab-pane label="边缘决策" name="edge">
        <el-row :gutter="12" class="metric-row">
          <el-col :span="8"><div class="panel metric-box"><div class="metric-label">决策规则</div><div class="metric-value">{{ edgeStatus.rules_count }}</div></div></el-col>
          <el-col :span="8"><div class="panel metric-box"><div class="metric-label">安全联锁</div><div class="metric-value">{{ edgeStatus.interlocks_count }}</div></div></el-col>
          <el-col :span="8"><div class="panel metric-box"><div class="metric-label">PID控制器</div><div class="metric-value">{{ edgeStatus.pid_controllers_count }}</div></div></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="14">
            <div class="panel">
              <div class="panel__header"><span>规则列表</span></div>
              <div class="panel__body">
                <el-table :data="edgeRules" stripe size="small" max-height="420">
                  <el-table-column prop="rule_id" label="规则ID" width="150" show-overflow-tooltip />
                  <el-table-column prop="name" label="名称" show-overflow-tooltip />
                  <el-table-column prop="type" label="类型" width="80" />
                  <el-table-column prop="trigger_count" label="触发次数" width="90" />
                  <el-table-column label="状态" width="90">
                    <template #="{row}"><el-tag :type="row.enabled?'success':'danger'" size="small">{{ row.enabled?'启用':'禁用' }}</el-tag></template>
                  </el-table-column>
                </el-table>
                <el-empty v-if="!edgeRules.length" description="暂无规则" :image-size="60" />
              </div>
            </div>
          </el-col>
          <el-col :span="10">
            <div class="panel">
              <div class="panel__header">
                <span>决策日志</span>
                <span class="panel__hint">色条：红=安全联锁 · 青=规则触发</span>
              </div>
              <div class="panel__body">
                <div class="log-list" v-loading="loading.edge">
                  <el-timeline v-if="edgeLog.length">
                    <el-timeline-item v-for="(l,i) in edgeLog" :key="i" :timestamp="fmtTime(l.timestamp)" placement="top" size="normal">
                      <div class="log-card">
                        <span class="level-bar" :class="edgeLevelBarClass(l.rule_type)" />
                        <div class="log-card__body">
                          <div class="log-card__head">
                            <span class="tag" :class="edgeLevelTagClass(l.rule_type)">{{ l.rule_type === 'interlock' ? '安全联锁' : '规则触发' }}</span>
                            <span class="log-rule">{{ l.rule_id }}</span>
                            <span class="log-action">{{ l.action_type }}</span>
                          </div>
                          <div class="log-result">{{ l.result || l.action_type || '-' }}</div>
                          <div v-if="l.snapshot_keys?.length" class="log-snapshot">快照：{{ l.snapshot_keys.join('、') }}</div>
                        </div>
                      </div>
                    </el-timeline-item>
                  </el-timeline>
                  <el-empty v-else description="暂无日志" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- 数字孪生 -->
      <el-tab-pane label="数字孪生" name="twin">
        <el-row :gutter="12" class="metric-row">
          <el-col :span="6"><div class="panel metric-box"><div class="metric-label">设备总数</div><div class="metric-value">{{ twinDevices.length }}</div></div></el-col>
          <el-col :span="6"><div class="panel metric-box"><div class="metric-label">运行中</div><div class="metric-value text-success">{{ twinDevices.filter(d=>d.status==='running').length }}</div></div></el-col>
          <el-col :span="6"><div class="panel metric-box"><div class="metric-label">故障设备</div><div class="metric-value text-danger">{{ twinDevices.filter(d=>d.status==='fault').length }}</div></div></el-col>
          <el-col :span="6"><div class="panel metric-box"><div class="metric-label">平均健康分</div><div class="metric-value">{{ twinAvgHealth }}</div></div></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="16">
            <div class="panel">
              <div class="panel__header">
                <span>产线孪生布局</span>
                <span class="panel__hint">点击节点查看设备详情</span>
              </div>
              <div class="panel__body">
                <div class="twin-floor" v-loading="loading.twin">
                  <svg class="twin-links" v-if="twinDevices.length">
                    <line v-for="(c,i) in twinConnections" :key="i"
                      class="twin-link"
                      :x1="c.x1" :y1="c.y1" :x2="c.x2" :y2="c.y2" />
                  </svg>
                  <div v-for="d in twinDevices" :key="d.device_id"
                    class="twin-node" :class="'status-'+(d.status||'offline')"
                    :style="{left:d.x+'px',top:d.y+'px'}"
                    @click="selectTwinDevice(d)">
                    <div class="node-icon">{{ d.icon }}</div>
                    <div class="node-name">{{ d.name }}</div>
                  </div>
                  <el-empty v-if="!twinDevices.length" description="暂无设备状态" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header"><span>设备详情</span></div>
              <div class="panel__body">
                <div v-if="twinSelected" class="twin-detail">
                  <div class="detail-name">{{ twinSelected.name }}</div>
                  <div class="detail-row"><span>工艺类型</span><span>{{ twinSelected.process_type || '-' }}</span></div>
                  <div class="detail-row"><span>健康评分</span><span :style="{color: healthVar(twinSelected.health_score)}">{{ twinSelected.health_score }}%</span></div>
                  <div class="detail-row"><span>OEE</span><span :style="{color: oeeVar(twinSelected.oee)}">{{ twinSelected.oee }}%</span></div>
                  <div class="detail-row"><span>功率</span><span>{{ twinSelected.power }} kW</span></div>
                </div>
                <el-empty v-else description="点击设备查看详情" :image-size="60" />
              </div>
            </div>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- 振动分析 -->
      <el-tab-pane label="振动分析" name="vibration">
        <el-row :gutter="12">
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header"><span>设备振动数据</span></div>
              <div class="panel__body">
                <el-table :data="vibrationData" stripe size="small" max-height="460" @row-click="onVibrationDeviceClick">
                  <el-table-column prop="device_id" label="设备" width="150" show-overflow-tooltip />
                  <el-table-column label="振动值" width="110">
                    <template #="{row}">
                      <span :style="{ color: zoneVar(row.iso_grade) }">{{ row.vibration_value?.toFixed(2) ?? '-' }} mm/s</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="ISO等级" width="90">
                    <template #="{row}">
                      <el-tag :type="isoGradeType(row.iso_grade)" size="small">{{ row.iso_grade || '-' }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="轴承状态" width="90">
                    <template #="{row}">
                      <el-tag :type="row.bearing_status === 'normal' ? 'success' : 'danger'" size="small">{{ row.bearing_status || '-' }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="updated_at" label="更新时间" />
                </el-table>
                <el-empty v-if="!hasVibration" description="暂无振动数据" :image-size="60" />
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header">
                <span>频谱分析</span>
                <span class="panel__hint">频率对数轴 · 竖线=轴承特征频率</span>
              </div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.spectrum">
                  <div ref="vibrationSpectrumRef" class="chart-box"></div>
                  <el-empty v-if="!hasSpectrum" class="chart-empty" description="选择设备查看频谱" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="panel">
              <div class="panel__header"><span>轴承分析</span></div>
              <div class="panel__body" v-loading="loading.bearing">
                <div v-if="vibrationBearing">
                  <div class="detail-row"><span>设备</span><span>{{ vibrationSelectedDevice }}</span></div>
                  <div class="detail-row"><span>轴承型号</span><span>{{ vibrationBearing.bearing_type || '-' }}</span></div>
                  <div class="detail-row"><span>BPFO</span><span>{{ vibrationBearing.bpfo?.toFixed(2) || '-' }} Hz</span></div>
                  <div class="detail-row"><span>BPFI</span><span>{{ vibrationBearing.bpfi?.toFixed(2) || '-' }} Hz</span></div>
                  <div class="detail-row"><span>BSF</span><span>{{ vibrationBearing.bsf?.toFixed(2) || '-' }} Hz</span></div>
                  <div class="detail-row"><span>FTF</span><span>{{ vibrationBearing.ftf?.toFixed(2) || '-' }} Hz</span></div>
                  <div class="detail-row"><span>健康状态</span><el-tag :type="vibrationBearing.status === 'normal' ? 'success' : 'danger'" size="small">{{ vibrationBearing.status || '-' }}</el-tag></div>
                  <div class="detail-row"><span>特征频率命中</span><span>{{ vibrationBearing.fault_count ?? 0 }} 项</span></div>
                </div>
                <el-empty v-else description="选择设备查看轴承数据" :image-size="60" />
              </div>
            </div>
          </el-col>
        </el-row>
        <el-row :gutter="12" style="margin-top:12px">
          <el-col :span="24">
            <div class="panel">
              <div class="panel__header">
                <span>各设备 RMS 与 ISO 10816 分区</span>
                <span class="panel__hint">A/B/C/D 边界取后端 VIBRATION_ZONES 的 0.71 / 1.8 / 4.5</span>
              </div>
              <div class="panel__body">
                <div class="chart-wrap" v-loading="loading.vibration">
                  <div ref="vibrationRmsRef" class="chart-box chart-box--sm"></div>
                  <el-empty v-if="!hasVibration" class="chart-empty" description="暂无振动数据" :image-size="60" />
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { industry40Api, devicesApi } from '@/api'
import type {
  Device, HealthScore, OEERecord, Industry40Overview, MaintenanceAlert, SPCCapability,
  SPCChart, SPCViolation, EdgeStatus, EdgeRule, EdgeLogEntry, DeviceState, VibrationRecord,
  VibrationSpectrum, BearingDiagnosis, EnergySummary, EnergyCostBreakdown, RealtimePower,
  CarbonEmission,
} from '@/api'
import { errorMessage } from '@/utils/error'
import { registerScadaTheme, scadaThemeName } from '@/utils/echartsTheme'

// 统一图表主题（幂等注册），图表一律用 scadaThemeName() 初始化
registerScadaTheme(echarts)

// ========== 档位带（0–100 分段色标） ==========
// OEE 档位边界取自后端 oee_calculator._oee_grade：85 世界级 / 75 优秀 / 65 良好 / 50 一般
// 健康分 5 档与 ISO/振动分区同理，全部用设计令牌表达，不在页面内写字面量颜色
interface Band { label: string; token: string; min: number; max: number }

// ========== 页面内数据模型 ==========
/** ECharts tooltip.formatter 回调参数：axis/item 触发时字段不同，只声明实际读取的键 */
interface TooltipParam {
  dataIndex?: number
  /** 类目轴触发时由 ECharts 注入 */
  axisValue?: string | number
  data?: unknown
  name?: string
}

/** ECharts markPoint / markLine 标注项（各图表字段不同，收敛到实际使用的键） */
interface ChartMark {
  coord?: [number | string, number | string]
  xAxis?: number
  yAxis?: number
  value?: number | string
  symbol?: string
  symbolSize?: number
  itemStyle?: Record<string, unknown>
  label?: Record<string, unknown>
  lineStyle?: Record<string, unknown>
}

/** 总览原始响应。后端只返回 predictive_maintenance/oee/energy/edge_decision，
 *  device_statuses、devices 是旧字段名，保留为可选以维持既有回退链（实际命中 oee.devices）。 */
type OverviewRaw = Industry40Overview & {
  device_statuses?: unknown
  devices?: unknown
}

/** 产线拓扑节点（renderProcessFlow 组装的 ECharts graph 数据源） */
interface OverviewNode {
  device_id: string
  name?: string
  oee_percent?: number
  connected?: boolean
}

/** 能耗汇总的展示读取视图：主字段是后端真实名，其余是历史别名，
 *  保留既有回退链（读不到时退化为 0）。 */
type EnergySummaryView = Partial<EnergySummary> & {
  total_kwh?: number
  total_cost?: number
  carbon_kg?: number
}

/** 数字孪生节点布局表（工艺布局是前端静态约定，非后端数据） */
interface TwinMapEntry { x: number; y: number; icon: string; name: string; process_type: string }

/** 数字孪生节点 = 后端设备状态 + TWIN_MAP 布局 + 健康分/OEE/功率 */
interface TwinDevice extends DeviceState {
  device_id: string
  x: number
  y: number
  icon: string
  name: string
  process_type: string
  health_score: number
  oee: number
  /** 展示用：已 toFixed(1) 的字符串 */
  power: string
}

/** 边缘决策规则表行（get_rules 的 {rules, interlocks} 字典 + 补 rule_id/type） */
interface EdgeRuleRow extends EdgeRule { rule_id: string; type: string }

/** /industry40/devices/status 的行：后端只返回 {status, since}；
 *  name 属兼容读取（当前恒为 undefined，会退回 device_id）。 */
type DeviceStateRow = DeviceState & { name?: string }

/** 振动表格行（/industry40/vibration 的 {rms, zone, ...} 映射为展示字段） */
interface VibrationRow {
  device_id: string
  vibration_value?: number
  iso_grade?: string
  zone_description?: string
  bearing_status?: string
  updated_at?: string
}

/** /industry40/vibration 的行：后端字段为 rms/zone/zone_description/...；
 *  vibration_value、iso_grade、bearing_status 是兼容读取（当前后端不返回，
 *  分别退回 rms / zone / '-'）。 */
type VibrationSourceRow = VibrationRecord & {
  vibration_value?: number
  iso_grade?: string
  bearing_status?: string
}

/** 轴承特征频率（前端由 bearing_faults 整理出的标注项） */
interface BearingCharacteristic { key: string; freq: number; fault: boolean; name: string }

/** 轴承面板数据 = 后端诊断 + 补齐的展示字段 */
interface BearingView extends BearingDiagnosis {
  bearing_type?: string
  status?: string
  bpfo?: number
  bpfi?: number
  bsf?: number
  ftf?: number
  characteristic?: BearingCharacteristic[]
}


const HEALTH_BANDS: Band[] = [
  { label: '差', token: '--color-offline', min: -Infinity, max: 20 },
  { label: '较差', token: '--color-danger', min: 20, max: 40 },
  { label: '一般', token: '--color-warning', min: 40, max: 60 },
  { label: '良好', token: '--chart-7', min: 60, max: 80 },
  { label: '优秀', token: '--color-success', min: 80, max: Infinity },
]

const OEE_BANDS: Band[] = [
  { label: '需改进', token: '--color-danger', min: -Infinity, max: 50 },
  { label: '一般', token: '--color-warning', min: 50, max: 65 },
  { label: '良好', token: '--color-info', min: 65, max: 75 },
  { label: '优秀', token: '--chart-7', min: 75, max: 85 },
  { label: '世界级', token: '--color-success', min: 85, max: Infinity },
]

const CAP_BANDS: Band[] = [
  { label: '不足', token: '--color-danger', min: -Infinity, max: 1.0 },
  { label: '勉强', token: '--color-warning', min: 1.0, max: 1.33 },
  { label: '充足', token: '--color-success', min: 1.33, max: Infinity },
]

/** 过程能力四指标：key 限定为 SPCCapability 的数值字段，模板里按 key 取数才有类型 */
const CAP_KEYS: { key: 'cp' | 'cpk' | 'pp' | 'ppk'; label: string }[] = [
  { key: 'cp', label: 'Cp' },
  { key: 'cpk', label: 'Cpk' },
  { key: 'pp', label: 'Pp' },
  { key: 'ppk', label: 'Ppk' },
]

/** OEE 世界级标准（后端 oee_calculator 定义为 ≥85%），用于排序图目标线 */
const OEE_TARGET = 85

function bandIndexOf(bands: Band[], v: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  const i = bands.findIndex(b => n >= b.min && n < b.max)
  return i === -1 ? bands.length - 1 : i
}
function bandLabelOf(bands: Band[], v: number): string { return bands[bandIndexOf(bands, v)].label }
function isBandOn(bands: Band[], v: number, i: number): boolean { return bandIndexOf(bands, v) >= i }

/** 模板用：返回 CSS 变量引用（自动跟随深浅主题） */
function bandVarOf(bands: Band[], v: number): string { return 'var(' + bands[bandIndexOf(bands, v)].token + ')' }
function healthVar(v: number) { return bandVarOf(HEALTH_BANDS, v) }
function oeeVar(v: number) { return bandVarOf(OEE_BANDS, v) }
function capVar(v: number | null | undefined) { return bandVarOf(CAP_BANDS, Number(v)) }
function zoneVar(zone?: string) { return 'var(' + (ZONE_TOKEN[zone ?? ''] || '--color-offline') + ')' }

function bandTagClass(bands: Band[], v: number): string {
  const t = bands[bandIndexOf(bands, v)].token
  if (t === '--color-success' || t === '--chart-7') return 'tag--success'
  if (t === '--color-danger') return 'tag--danger'
  if (t === '--color-warning') return 'tag--warning'
  return 'tag--info'
}
function oeeTagClass(v: number) { return bandTagClass(OEE_BANDS, v) }
function capTagClass(v: number | null | undefined) { return bandTagClass(CAP_BANDS, Number(v)) }

// ISO 10816 四个分区（边界取后端 VIBRATION_ZONES 的 max），用于振动值着色与分区参考线
const ZONE_A: Band = { label: 'A 良好', token: '--color-success', min: -Infinity, max: 0.71 }
const ZONE_B: Band = { label: 'B 可接受', token: '--chart-7', min: 0.71, max: 1.8 }
const ZONE_C: Band = { label: 'C 报警', token: '--color-warning', min: 1.8, max: 4.5 }
const ZONE_D: Band = { label: 'D 危险', token: '--color-danger', min: 4.5, max: Infinity }
const ZONE_TOKEN: Record<string, string> = { A: '--color-success', B: '--chart-7', C: '--color-warning', D: '--color-danger' }

/** 读取设计令牌（canvas 内无法使用 CSS 变量，取页面作用域下的实际值） */
function token(name: string): string {
  if (typeof document === 'undefined') return ''
  const el = document.querySelector('.industry40') || document.documentElement
  return getComputedStyle(el).getPropertyValue(name).trim()
}
/** 模板用：状态等级 → 设计基线里的色条 / 标签类 */
function levelBarClass(level: string): string {
  const k = level === 'critical' ? 'critical' : level === 'warning' ? 'warning' : 'info'
  return `level-bar--${k}`
}

/** 兼容读取：把 unknown 收敛为 string（取不到时用兜底值），语义等价于旧写法 `a || b` */
function asStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v ? v : fallback
}
/** 兼容读取：把 unknown 收敛为 number | undefined（非数值 → undefined） */
function asNum(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

// ========== 状态 ==========
const activeTab = ref('overview')
let refreshTimer: ReturnType<typeof setInterval>
let isUnmounted = false
let themeObserver: MutationObserver | null = null

const loading = reactive({
  overview: false, predictive: false, oee: false, spc: false,
  energy: false, edge: false, twin: false, vibration: false,
  spectrum: false, bearing: false,
})

// 总览
const overview = reactive({ health: 0, oee: 0, power: 0, carbon: 0, alerts: [] as MaintenanceAlert[] })
const overviewRaw = ref<OverviewRaw | null>(null)
const overviewNodes = ref<OverviewNode[]>([])

// 预测维护
const healthScores = ref<HealthScore[]>([])
const maintenanceAlerts = ref<MaintenanceAlert[]>([])
const hasHealth = computed(() => healthScores.value.length > 0)

// OEE
const oeeRecords = ref<OEERecord[]>([])
const hasOEE = computed(() => oeeRecords.value.length > 0)
const avgOEE = computed(() => {
  const rows = oeeRecords.value
  if (!rows.length) return 0
  return Number((rows.reduce((s, r) => s + Number(r.oee_percent || 0), 0) / rows.length).toFixed(1))
})
const avgFactors = computed(() => {
  const rows = oeeRecords.value
  if (!rows.length) return { availability: 0, performance: 0, quality: 0 }
  const mean = (pick: (r: OEERecord) => number) =>
    rows.reduce((s, r) => s + Number(pick(r) || 0), 0) / rows.length * 100
  return {
    availability: Number(mean(r => r.availability).toFixed(1)),
    performance: Number(mean(r => r.performance).toFixed(1)),
    quality: Number(mean(r => r.quality).toFixed(1)),
  }
})

// SPC
const spc = reactive({
  deviceId: '', registerName: '', registers: [] as string[],
  capability: null as SPCCapability | null,
  violations: [] as SPCViolation[],
})
const spcXbar = ref<SPCChart | null>(null)
const spcR = ref<SPCChart | null>(null)
const hasSpcXbar = computed(() => Array.isArray(spcXbar.value?.points) && spcXbar.value.points.length > 0)
const hasSpcR = computed(() => Array.isArray(spcR.value?.points) && spcR.value.points.length > 0)

// 能源
const energy = reactive({ total_kwh: 0 as number | string, total_cost: 0 as number | string, carbon_kg: 0 as number | string, equivalent_trees: 0 as number | string, peak_kwh: 0, flat_kwh: 0, valley_kwh: 0 })
// 电费分时明细（/industry40/energy/cost 返回 peak/flat/valley.cost）
const energyCost = reactive({ peak: 0, flat: 0, valley: 0, total: 0 })
// 各设备实时功率（/industry40/energy/power 的 devices 字段）
const energyDevices = ref<{ device_id: string; power_kw: number }[]>([])
const hasTou = computed(() => energy.peak_kwh + energy.flat_kwh + energy.valley_kwh > 0)
const hasCost = computed(() => energyCost.peak + energyCost.flat + energyCost.valley > 0)

// 边缘决策
const edgeStatus = reactive<EdgeStatus>({ rules_count: 0, interlocks_count: 0, pid_controllers_count: 0 })
const edgeRules = ref<EdgeRuleRow[]>([])
const edgeLog = ref<EdgeLogEntry[]>([])

// 数字孪生
const twinDevices = ref<TwinDevice[]>([])
const twinSelected = ref<TwinDevice | null>(null)
const twinAvgHealth = computed(() => {
  const scores = twinDevices.value.filter(d => d.health_score != null).map(d => d.health_score)
  return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '-'
})

// 设备列表
const deviceList = ref<Device[]>([])

// ECharts refs
const processFlowRef = ref<HTMLElement>()
const healthRingRef = ref<HTMLElement>()
const healthRankRef = ref<HTMLElement>()
const oeeRingRef = ref<HTMLElement>()
const oeeRankRef = ref<HTMLElement>()
const oeeFactorRef = ref<HTMLElement>()
const spcXbarRef = ref<HTMLElement>()
const spcRRef = ref<HTMLElement>()
const energyPieRef = ref<HTMLElement>()
const powerBarRef = ref<HTMLElement>()
const energyCostRef = ref<HTMLElement>()
const energyPowerRef = ref<HTMLElement>()
const vibrationSpectrumRef = ref<HTMLElement>()
const vibrationRmsRef = ref<HTMLElement>()

let charts: Record<string, echarts.ECharts> = {}

/** 统一初始化入口：所有图表都用同一套已注册主题 */
function ensureChart(name: string, el?: HTMLElement): echarts.ECharts | null {
  if (isUnmounted || !el) return null
  if (!charts[name]) charts[name] = echarts.init(el, scadaThemeName())
  return charts[name]
}

// 数字孪生设备映射（前端静态布局约定）
const TWIN_MAP: Record<string, TwinMapEntry> = {
  siemens_1500_01: { x: 100, y: 60, icon: '🔥', name: '锅炉产线', process_type: '热处理' },
  hollysys_lk_01: { x: 300, y: 60, icon: '⚗️', name: '化工车间', process_type: '化学反应' },
  mitsubishi_fx5u_01: { x: 500, y: 60, icon: '🏭', name: '注塑车间', process_type: '注塑成型' },
  delta_dvp_01: { x: 100, y: 220, icon: '📦', name: '包装线', process_type: '包装封装' },
  inovance_h5u_01: { x: 300, y: 220, icon: '🎨', name: '涂装车间', process_type: '喷涂烘干' },
  schneider_m340_01: { x: 500, y: 220, icon: '⚡', name: '配电系统', process_type: '电力分配' },
  abb_m4m_01: { x: 700, y: 140, icon: '📊', name: '电力监测', process_type: '电力监控' },
}

const twinConnections = computed(() => {
  const devs = twinDevices.value
  if (devs.length < 2) return []
  // 动态连线：相邻设备依次连接，形成产线拓扑
  const conns: {x1:number;y1:number;x2:number;y2:number}[] = []
  for (let i = 0; i < devs.length - 1; i++) {
    conns.push({ x1: devs[i].x + 40, y1: devs[i].y + 40, x2: devs[i+1].x + 40, y2: devs[i+1].y + 40 })
  }
  // 首尾相连形成环形拓扑（如果设备数 >= 3）
  if (devs.length >= 3) {
    const last = devs[devs.length - 1]
    conns.push({ x1: last.x + 40, y1: last.y + 40, x2: devs[0].x + 40, y2: devs[0].y + 40 })
  }
  return conns
})

// ========== 工具函数 ==========
function trendArrow(t: string) { return t === 'rising' ? '↑' : t === 'falling' ? '↓' : '→' }
function fmtTime(t?: string) {
  if (!t) return '-'
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? t : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
// 决策日志没有 level 字段：按 rule_type 区分安全联锁（critical 色）与普通规则触发（info 色）
function edgeLevelBarClass(ruleType?: string) { return ruleType === 'interlock' ? 'level-bar--critical' : 'level-bar--info' }
function edgeLevelTagClass(ruleType?: string) { return ruleType === 'interlock' ? 'tag--danger' : 'tag--info' }

// 后端多个接口返回以 device_id / "device:register" 为键的字典（axios 拦截器已解开 {success,data}），
// 统一转成数组后再交给表格/图表，避免字段名错配导致列表恒为空
function toList<T extends object>(v: unknown): Array<T & { device_id: string }> {
  if (Array.isArray(v)) return v as Array<T & { device_id: string }>
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, T>).map(([id, item]) => ({ device_id: id, ...item }))
  }
  return []
}

// ========== 数据加载 ==========
async function loadOverview() {
  loading.overview = true
  try {
    const data = await industry40Api.getOverview()
    overview.health = Number(data?.predictive_maintenance?.avg_health_score?.toFixed(1)) || 0
    overview.oee = Number(data?.oee?.avg_oee_percent?.toFixed(1)) || 0
    overview.power = Number(data?.energy?.total_power_kw?.toFixed(1)) || 0
    overview.carbon = Number(data?.energy?.carbon_emission_kg?.toFixed(1)) || 0
    // 修复字段误用：总览响应里没有顶层 alerts，维护建议在 predictive_maintenance.recent_alerts
    overview.alerts = data?.predictive_maintenance?.recent_alerts || []
    overviewRaw.value = data
    renderProcessFlow()
  } catch (e) { console.warn('[Industry40] 加载失败:', errorMessage(e)) }
  finally { loading.overview = false }
}

function renderProcessFlow() {
  const chart = ensureChart('processFlow', processFlowRef.value)
  if (!chart) return
  const data = overviewRaw.value
  // 总览响应中的设备来源：device_statuses / devices，若都缺则退回同一响应里的 oee.devices（不新增接口）
  const devices = toList<OverviewNode>(data?.device_statuses || data?.devices || data?.oee?.devices)
  overviewNodes.value = devices
  if (!devices.length) { chart.clear(); return }
  const nodes = devices.map((d, i) => {
    const oee = Number(d.oee_percent)
    const offline = d.connected === false
    return {
      name: d.device_id || d.name || `设备${i+1}`,
      x: (i % 4) * 160 + 80,
      y: Math.floor(i / 4) * 120 + 60,
      symbolSize: 50,
      // 颜色语义：离线灰 > OEE 档位色；无 OEE 字段时退化为成功色
      itemStyle: {
        color: offline
          ? token('--color-offline')
          : Number.isFinite(oee) ? token(OEE_BANDS[bandIndexOf(OEE_BANDS, oee)].token) : token('--color-success'),
      },
      label: {
        show: true, position: 'bottom', fontSize: 12, color: token('--text-secondary'),
        formatter: Number.isFinite(oee) ? `${d.device_id || d.name || `设备${i+1}`}\nOEE ${oee}%` : (d.device_id || d.name || `设备${i+1}`),
      },
    }
  })
  const links = nodes.slice(1).map((_, i) => ({ source: nodes[i].name, target: nodes[i+1].name }))
  chart.setOption({
    tooltip: { trigger: 'item' },
    series: [{
      type: 'graph', layout: 'none', roam: true,
      data: nodes, links,
      lineStyle: { color: token('--chart-1'), curveness: 0.1 },
      emphasis: { focus: 'adjacency' },
    }],
  }, true)
}

async function loadPredictive() {
  loading.predictive = true
  try {
    const [h, a] = await Promise.all([industry40Api.getHealthScores(), industry40Api.getMaintenanceAlerts()])
    // /industry40/health 返回 {device_id:register: {...}} 字典，/industry40/maintenance-alerts 返回数组
    healthScores.value = toList<HealthScore>(h)
    maintenanceAlerts.value = toList<MaintenanceAlert>(a)
    renderHealthCharts()
  } catch (e) { console.warn('[Industry40] 加载失败:', errorMessage(e)) }
  finally { loading.predictive = false }
}

/** 健康分：环形进度（0–100 五档色） + 按设备排序的横向条形（异常点高亮） */
function renderHealthCharts() {
  const rows = healthScores.value
  const avg = rows.length
    ? Number((rows.reduce((s, r) => s + Number(r.health_score || 0), 0) / rows.length).toFixed(1))
    : 0

  const ring = ensureChart('healthRing', healthRingRef.value)
  if (ring) {
    if (!rows.length) ring.clear()
    else ring.setOption(ringGaugeOption(avg, bandColorOf(HEALTH_BANDS, avg), '平均健康分', '%'), true)
  }

  const bar = ensureChart('healthRank', healthRankRef.value)
  if (!bar) return
  if (!rows.length) { bar.clear(); return }
  // 同一设备多个寄存器：按设备取均值展示，并汇总异常数
  const byDev = new Map<string, { sum: number; n: number; anomalies: number }>()
  rows.forEach(r => {
    const cur = byDev.get(r.device_id) || { sum: 0, n: 0, anomalies: 0 }
    cur.sum += Number(r.health_score || 0)
    cur.n += 1
    cur.anomalies += Number(r.anomaly_count || 0)
    byDev.set(r.device_id, cur)
  })
  // 最差在前：升序 + yAxis inverse，维护人员先看到风险设备
  const items = Array.from(byDev.entries())
    .map(([device_id, v]) => ({ device_id, score: Number((v.n ? v.sum / v.n : 0).toFixed(1)), anomalies: v.anomalies }))
    .sort((a, b) => a.score - b.score)

  const marks: ChartMark[] = []
  items.forEach((it) => {
    if (it.anomalies > 0) {
      marks.push({
        coord: [it.score, it.device_id], value: it.anomalies, symbol: 'circle', symbolSize: 8,
        itemStyle: { color: token('--color-danger') },
        label: { show: true, position: 'right', formatter: `异常 ${it.anomalies}`, color: token('--color-danger'), fontSize: 12 },
      })
    }
  })

  bar.setOption({
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (p: TooltipParam[]) => {
        const it = items[p[0]?.dataIndex ?? -1]
        if (!it) return ''
        return `${it.device_id}<br/>健康分 ${it.score}%<br/>档位 ${bandLabelOf(HEALTH_BANDS, it.score)}<br/>异常点 ${it.anomalies}`
      },
    },
    grid: { left: 12, right: 96, top: 24, bottom: 8, containLabel: true },
    xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', inverse: true, data: items.map(i => i.device_id) },
    series: [{
      type: 'bar', barMaxWidth: 14,
      data: items.map(i => ({
        value: i.score,
        itemStyle: { color: bandColorOf(HEALTH_BANDS, i.score), borderRadius: [0, 3, 3, 0] },
      })),
      label: { show: true, position: 'insideRight', formatter: '{c}%', fontSize: 12, color: token('--text-inverse') },
      markPoint: { silent: true, data: marks },
    }],
  }, true)
}

/** 环形进度（ECharts gauge progress 形态，指针/刻度全部关闭） */
function ringGaugeOption(value: number, color: string, name: string, unit: string) {
  return {
    series: [{
      type: 'gauge', startAngle: 90, endAngle: -270, min: 0, max: 100,
      radius: '92%', center: ['50%', '50%'],
      pointer: { show: false },
      progress: { show: true, width: 14, roundCap: true, itemStyle: { color } },
      axisLine: { lineStyle: { width: 14, color: [[1, token('--bg-sunken')]] } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, anchor: { show: false },
      detail: {
        valueAnimation: true, offsetCenter: [0, '0%'], fontSize: 26, fontWeight: 600,
        color: token('--text-primary'), formatter: (v: number) => `${v}${unit}`,
      },
      title: { offsetCenter: [0, '32%'], fontSize: 12, color: token('--text-muted') },
      data: [{ value, name }],
    }],
  }
}

function bandColorOf(bands: Band[], v: number): string { return token(bands[bandIndexOf(bands, v)].token) }

async function loadOEE() {
  loading.oee = true
  try {
    const data = await industry40Api.getOEE()
    // /industry40/oee 返回 {device_id: {oee_percent, availability, ...}} 字典
    oeeRecords.value = toList<OEERecord>(data)
    renderOEECharts()
  } catch (e) { console.warn('[Industry40] 加载失败:', errorMessage(e)) }
  finally { loading.oee = false }
}

function renderOEECharts() {
  const rows = oeeRecords.value
  const avg = avgOEE.value

  // 总值：环形进度
  const ring = ensureChart('oeeRing', oeeRingRef.value)
  if (ring) {
    if (!rows.length) ring.clear()
    else ring.setOption(ringGaugeOption(avg, bandColorOf(OEE_BANDS, avg), '平均 OEE', '%'), true)
  }

  // 按设备 OEE 横向条形排序 + 世界级目标线
  const rank = ensureChart('oeeRank', oeeRankRef.value)
  if (rank) {
    if (!rows.length) rank.clear()
    else {
      const items = rows
        .map(r => ({ device_id: r.device_id, value: Number(r.oee_percent) }))
        .sort((a, b) => a.value - b.value)
      rank.setOption({
        tooltip: {
          trigger: 'axis', axisPointer: { type: 'shadow' },
          formatter: (p: TooltipParam[]) => {
            const it = items[p[0]?.dataIndex ?? -1]
            return it ? `${it.device_id}<br/>OEE ${it.value}%<br/>档位 ${bandLabelOf(OEE_BANDS, it.value)}` : ''
          },
        },
        grid: { left: 12, right: 64, top: 28, bottom: 8, containLabel: true },
        xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
        yAxis: { type: 'category', inverse: true, data: items.map(i => i.device_id) },
        series: [{
          type: 'bar', barMaxWidth: 16,
          data: items.map(i => ({
            value: i.value,
            itemStyle: { color: bandColorOf(OEE_BANDS, i.value), borderRadius: [0, 3, 3, 0] },
          })),
          label: { show: true, position: 'right', formatter: '{c}%', fontSize: 12, color: token('--text-secondary') },
          markLine: {
            silent: true, symbol: 'none',
            data: [{
              xAxis: OEE_TARGET,
              lineStyle: { color: token('--color-brand'), type: 'dashed', width: 1 },
              label: { formatter: `世界级 ${OEE_TARGET}%`, color: token('--text-muted'), fontSize: 11, position: 'end' },
            }],
          },
        }],
      }, true)
    }
  }

  // 分项达成：A/P/Q 同标尺水平条 + 目标线（三因子为乘性关系，故不做堆叠）
  const factor = ensureChart('oeeFactors', oeeFactorRef.value)
  if (factor) {
    if (!rows.length) factor.clear()
    else {
      const f = avgFactors.value
      const labels = ['可用率 A', '性能率 P', '质量率 Q']
      const values = [f.availability, f.performance, f.quality]
      factor.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: '{b}<br/>{c}%' },
        grid: { left: 12, right: 56, top: 28, bottom: 8, containLabel: true },
        xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
        yAxis: { type: 'category', inverse: true, data: labels },
        series: [{
          type: 'bar', barMaxWidth: 18,
          data: values.map(v => ({ value: v, itemStyle: { color: bandColorOf(OEE_BANDS, v), borderRadius: [0, 3, 3, 0] } })),
          label: { show: true, position: 'right', formatter: '{c}%', fontSize: 12, color: token('--text-secondary') },
          markLine: {
            silent: true, symbol: 'none',
            data: [{
              xAxis: OEE_TARGET,
              lineStyle: { color: token('--color-brand'), type: 'dashed', width: 1 },
              label: { formatter: `目标 ${OEE_TARGET}%`, color: token('--text-muted'), fontSize: 11, position: 'end' },
            }],
          },
        }],
      }, true)
    }
  }
}

async function loadSPC() {
  if (!spc.deviceId || !spc.registerName) return
  loading.spc = true
  try {
    const [chart, v] = await Promise.all([
      industry40Api.getSPC(spc.deviceId, spc.registerName),
      industry40Api.getSPCViolations(spc.deviceId),
    ])
    // 后端返回 { control_chart: { xbar_chart, r_chart, ... }, capability: {...} }（无 chart_data 字段）
    const controlChart = chart?.control_chart
    spc.capability = chart?.capability || null
    spcXbar.value = controlChart?.xbar_chart || null
    spcR.value = controlChart?.r_chart || null
    // /industry40/spc/violations 返回数组，且判异记录本身不带 device_id
    const violations: SPCViolation[] = Array.isArray(v) ? v : []
    spc.violations = violations.map((item) => ({ ...item, device_id: item.device_id || spc.deviceId }))
    renderSPCCharts()
  } catch (e) { console.warn('[Industry40] 加载失败:', errorMessage(e)) }
  finally { loading.spc = false }
}

/** 控制图：折线 + 真实 UCL/CL/LCL 参考线 + 越界点高亮（markPoint）；无控制限则不画 */
function renderSPCCharts() {
  const render = (name: string, el: HTMLElement | undefined, title: string, cc: SPCChart | null, unit: string) => {
    const chart = ensureChart(name, el)
    if (!chart) return
    const points: number[] = cc && Array.isArray(cc.points) ? cc.points : []
    if (!points.length) { chart.clear(); return }
    const ucl = Number(cc?.ucl), cl = Number(cc?.cl), lcl = Number(cc?.lcl)
    const lines: ChartMark[] = []
    if (Number.isFinite(ucl)) {
      lines.push({ yAxis: ucl, lineStyle: { color: token('--color-danger'), type: 'dashed', width: 1 }, label: { formatter: `UCL ${ucl}`, color: token('--color-danger'), fontSize: 11 } })
    }
    if (Number.isFinite(cl)) {
      lines.push({ yAxis: cl, lineStyle: { color: token('--color-success'), type: 'solid', width: 1 }, label: { formatter: `CL ${cl}`, color: token('--color-success'), fontSize: 11 } })
    }
    if (Number.isFinite(lcl)) {
      lines.push({ yAxis: lcl, lineStyle: { color: token('--color-danger'), type: 'dashed', width: 1 }, label: { formatter: `LCL ${lcl}`, color: token('--color-danger'), fontSize: 11 } })
    }
    // 规格上下限（capability.usl/lsl，真实字段）作为附加参考线
    const usl = Number(spc.capability?.usl), lsl = Number(spc.capability?.lsl)
    if (Number.isFinite(usl)) lines.push({ yAxis: usl, lineStyle: { color: token('--chart-4'), type: 'dotted', width: 1 }, label: { formatter: `USL ${usl}`, color: token('--chart-4'), fontSize: 11 } })
    if (Number.isFinite(lsl)) lines.push({ yAxis: lsl, lineStyle: { color: token('--chart-4'), type: 'dotted', width: 1 }, label: { formatter: `LSL ${lsl}`, color: token('--chart-4'), fontSize: 11 } })

    // 越界点：由真实控制限判定，未拿到控制限时不做任何标记
    const marks: ChartMark[] = []
    if (Number.isFinite(ucl) || Number.isFinite(lcl)) {
      points.forEach((v, i) => {
        const over = (Number.isFinite(ucl) && v > ucl) || (Number.isFinite(lcl) && v < lcl)
        if (over) {
          marks.push({
            coord: [i, v], value: v, symbol: 'circle', symbolSize: 12,
            itemStyle: { color: token('--color-danger') },
            label: { show: true, position: 'top', formatter: '越界', color: token('--color-danger'), fontSize: 11 },
          })
        }
      })
    }

    chart.setOption({
      title: { text: title, left: 'center', textStyle: { fontSize: 13, fontWeight: 600, color: token('--text-primary') } },
      tooltip: {
        trigger: 'axis',
        formatter: (p: TooltipParam[]) => `样本 ${Number(p[0]?.axisValue) + 1}<br/>${title} ${p[0]?.data}${unit}`,
      },
      grid: { left: 12, right: 32, top: 44, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: points.map((_: number, i: number) => i + 1), boundaryGap: false },
      yAxis: { type: 'value', scale: true },
      series: [{
        type: 'line', data: points, symbol: 'circle', symbolSize: 4,
        lineStyle: { width: 2, color: token('--chart-1') },
        itemStyle: { color: token('--chart-1') },
        markLine: lines.length ? { silent: true, symbol: 'none', data: lines } : undefined,
        markPoint: marks.length ? { silent: true, data: marks } : undefined,
      }],
    }, true)
  }

  render('spcXbar', spcXbarRef.value, 'X̄ 控制图', spcXbar.value, '')
  render('spcR', spcRRef.value, 'R 控制图', spcR.value, '')
}

async function loadEnergy() {
  loading.energy = true
  try {
    const [e, c, p, carbon] = await Promise.all([
      industry40Api.getEnergy(), industry40Api.getEnergyCost(), industry40Api.getEnergyPower(),
      // 等效树木只在 /industry40/energy/carbon（CarbonEmission.equivalent_trees）里返回，
      // 总览能耗响应没有该字段（此前读 s.equivalent_trees 恒为 undefined → 该指标恒显示 '-'）
      industry40Api.getEnergyCarbon().catch(() => null),
    ])
    // /industry40/energy 返回扁平的能耗汇总（无 summary 外层），字段名为
    // total_energy_kwh / electricity_cost / carbon_emission_kg / peak_kwh / flat_kwh / valley_kwh
    const s: EnergySummaryView = e || {}
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    energy.total_kwh = num(s.total_energy_kwh ?? s.total_kwh).toFixed(1)
    energy.total_cost = num(s.electricity_cost ?? s.total_cost).toFixed(0)
    energy.carbon_kg = num(s.carbon_emission_kg ?? s.carbon_kg).toFixed(1)
    energy.equivalent_trees =
      carbon?.equivalent_trees != null ? num(carbon.equivalent_trees).toFixed(0) : '-'
    energy.peak_kwh = num(s.peak_kwh)
    energy.flat_kwh = num(s.flat_kwh)
    energy.valley_kwh = num(s.valley_kwh)
    // 电费分时明细（同一批响应，字段 peak/flat/valley.cost）
    const cost: Partial<EnergyCostBreakdown> = c || {}
    energyCost.peak = num(cost?.peak?.cost)
    energyCost.flat = num(cost?.flat?.cost)
    energyCost.valley = num(cost?.valley?.cost)
    energyCost.total = num(cost?.total_cost ?? s.electricity_cost)
    // 实时功率 devices 字典
    energyDevices.value = toList<RealtimePower>(p?.devices ?? p)
      .map((d) => ({ device_id: d.device_id, power_kw: num(d.power_kw ?? d.power) }))
      .sort((a, b) => b.power_kw - a.power_kw)
    renderEnergyCharts()
  } catch (e) { console.warn('[Industry40] 加载失败:', errorMessage(e)) }
  finally { loading.energy = false }
}

function renderEnergyCharts() {
  const tou = [
    { name: '峰时', value: energy.peak_kwh, token: '--color-danger' },
    { name: '平时', value: energy.flat_kwh, token: '--color-warning' },
    { name: '谷时', value: energy.valley_kwh, token: '--color-success' },
  ]
  const totalKwh = tou.reduce((s, d) => s + d.value, 0)

  // 峰谷占比：环图（中心显示总计）
  const pie = ensureChart('energyShare', energyPieRef.value)
  if (pie) {
    if (!hasTou.value) pie.clear()
    else pie.setOption({
      tooltip: { trigger: 'item', formatter: '{b}：{c} kWh（{d}%）' },
      legend: { bottom: 0, left: 'center' },
      title: {
        text: totalKwh.toFixed(1), subtext: 'kWh 合计',
        left: 'center', top: '40%', textAlign: 'center',
        textStyle: { fontSize: 18, fontWeight: 600, color: token('--text-primary') },
        subtextStyle: { fontSize: 12, color: token('--text-muted') },
      },
      series: [{
        type: 'pie', radius: ['52%', '74%'], center: ['50%', '48%'],
        label: { show: false }, labelLine: { show: false },
        data: tou.map(d => ({ name: d.name, value: d.value, itemStyle: { color: token(d.token) } })),
      }],
    }, true)
  }

  // 峰平谷构成：堆叠柱（单类别，三段堆叠）
  const stack = ensureChart('energyStack', powerBarRef.value)
  if (stack) {
    if (!hasTou.value) stack.clear()
    else stack.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${v} kWh` },
      legend: { top: 0, left: 'center' },
      grid: { left: 12, right: 16, top: 40, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: ['分时电量构成'] },
      yAxis: { type: 'value', name: 'kWh' },
      series: tou.map(d => ({
        name: d.name, type: 'bar', stack: 'tou', barMaxWidth: 56,
        itemStyle: { color: token(d.token) },
        data: [d.value],
        label: { show: d.value > 0, position: 'inside', formatter: '{c}', fontSize: 12, color: token('--text-inverse') },
      })),
    }, true)
  }

  // 电费分时占比：环图
  const costPie = ensureChart('energyCost', energyCostRef.value)
  if (costPie) {
    const costItems = [
      { name: '峰时电费', value: Number(energyCost.peak.toFixed(2)), token: '--color-danger' },
      { name: '平时电费', value: Number(energyCost.flat.toFixed(2)), token: '--color-warning' },
      { name: '谷时电费', value: Number(energyCost.valley.toFixed(2)), token: '--color-success' },
    ]
    const costTotal = costItems.reduce((s, d) => s + d.value, 0)
    if (!hasCost.value) costPie.clear()
    else costPie.setOption({
      tooltip: { trigger: 'item', formatter: '{b}：¥{c}（{d}%）' },
      legend: { bottom: 0, left: 'center' },
      title: {
        text: '¥' + costTotal.toFixed(2), subtext: '电费合计',
        left: 'center', top: '40%', textAlign: 'center',
        textStyle: { fontSize: 18, fontWeight: 600, color: token('--text-primary') },
        subtextStyle: { fontSize: 12, color: token('--text-muted') },
      },
      series: [{
        type: 'pie', radius: ['52%', '74%'], center: ['50%', '48%'],
        label: { show: false }, labelLine: { show: false },
        data: costItems.map(d => ({ name: d.name, value: d.value, itemStyle: { color: token(d.token) } })),
      }],
    }, true)
  }

  // 各设备实时功率：横向条形排序
  const power = ensureChart('energyPower', energyPowerRef.value)
  if (power) {
    const list = [...energyDevices.value].reverse()   // 最大值显示在顶部
    if (!list.length) power.clear()
    else power.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `${v} kW` },
      grid: { left: 12, right: 64, top: 24, bottom: 8, containLabel: true },
      xAxis: { type: 'value', name: 'kW' },
      yAxis: { type: 'category', data: list.map(d => d.device_id) },
      series: [{
        type: 'bar', barMaxWidth: 14,
        itemStyle: { color: token('--chart-1'), borderRadius: [0, 3, 3, 0] },
        data: list.map(d => Number(d.power_kw.toFixed(2))),
        label: { show: true, position: 'right', formatter: '{c} kW', fontSize: 12, color: token('--text-secondary') },
      }],
    }, true)
  }
}

async function loadEdge() {
  loading.edge = true
  try {
    const [s, r, l] = await Promise.all([
      industry40Api.getEdgeStatus(), industry40Api.getEdgeRules(), industry40Api.getEdgeLog(),
    ])
    // /industry40/edge/status 返回 pid_controllers_count（不是 pid_controllers）
    const st: Partial<EdgeStatus> = s || {}
    edgeStatus.rules_count = st.rules_count ?? 0
    edgeStatus.interlocks_count = st.interlocks_count ?? 0
    edgeStatus.pid_controllers_count = st.pid_controllers_count ?? 0
    const rules = r?.rules || {}
    const interlocks = r?.interlocks || {}
    edgeRules.value = [
      ...Object.entries(rules).map(([id, v]) => ({ ...v, rule_id: id, type: '规则' })),
      ...Object.entries(interlocks).map(([id, v]) => ({ ...v, rule_id: id, type: '联锁' })),
    ]
    // /industry40/edge/log 直接返回数组
    edgeLog.value = toList<EdgeLogEntry>(l)
  } catch (e) { console.warn('[Industry40] 加载失败:', errorMessage(e)) }
  finally { loading.edge = false }
}

async function loadTwin() {
  loading.twin = true
  try {
    const [devs, health, oee, energyPower] = await Promise.all([
      industry40Api.getDevicesStatus(), industry40Api.getHealthScores(), industry40Api.getOEE(),
      industry40Api.getEnergyPower().catch(() => null),
    ])
    // 以上接口都返回字典（devices 为 {device_id:{status,since}}，power 为 {device_id:{power_kw}}），
    // 之前直接当数组 forEach 会抛 “forEach is not a function”，整个孪生页空白
    const healthMap = new Map<string, number>()
    toList<HealthScore>(health).forEach((h) => healthMap.set(h.device_id, h.health_score))
    const oeeMap = new Map<string, number>()
    toList<OEERecord>(oee).forEach((o) => oeeMap.set(o.device_id, o.oee_percent))
    const powerMap = new Map<string, number>()
    toList<RealtimePower>(energyPower?.devices ?? energyPower)
      .forEach((p) => powerMap.set(p.device_id, Number(p.power_kw || p.power || 0)))

    // 动态生成设备布局：用 TWIN_MAP 匹配已知设备，未知设备自动排列
    let unknownIdx = 0
    twinDevices.value = toList<DeviceStateRow>(devs).map((d): TwinDevice => {
      const m = TWIN_MAP[d.device_id]
      if (m) {
        return {
          ...d, x: m.x, y: m.y, icon: m.icon,
          name: m.name || d.device_id, process_type: m.process_type || '',
          health_score: healthMap.get(d.device_id) || 0,
          oee: oeeMap.get(d.device_id) || 0,
          power: (powerMap.get(d.device_id) || 0).toFixed(1),
        }
      }
      // 未知设备自动排列
      const x = 100 + (unknownIdx % 4) * 180
      const y = 60 + Math.floor(unknownIdx / 4) * 160
      unknownIdx++
      return {
        ...d, x, y, icon: '⚙️',
        name: d.name || d.device_id, process_type: '',
        health_score: healthMap.get(d.device_id) || 0,
        oee: oeeMap.get(d.device_id) || 0,
        power: (powerMap.get(d.device_id) || 0).toFixed(1),
      }
    })
  } catch (e) { console.warn('[Industry40] 加载失败:', errorMessage(e)) }
  finally { loading.twin = false }
}

async function loadSPCTab() {
  // SPC tab 切换时，自动选择第一个设备的第一个寄存器并加载
  if (!spc.deviceId && deviceList.value.length) {
    const firstDev = deviceList.value[0]
    spc.deviceId = firstDev.device_id
    onSpcDeviceChange(firstDev.device_id)
    if (spc.registers.length) {
      spc.registerName = spc.registers[0]
      await loadSPC()
    }
  }
}

// ========== 振动分析 ==========
const vibrationData = ref<VibrationRow[]>([])
const vibrationSpectrum = ref<VibrationSpectrum | null>(null)
const vibrationSelectedDevice = ref('')
const vibrationBearing = ref<BearingView | null>(null)
const hasVibration = computed(() => vibrationData.value.length > 0)
const hasSpectrum = computed(() => {
  const s = vibrationSpectrum.value
  return !!s && Array.isArray(s.frequencies) && s.frequencies.length > 0 &&
    Array.isArray(s.amplitudes) && s.amplitudes.length > 0
})

async function loadVibration() {
  loading.vibration = true
  try {
    const data = await industry40Api.getVibrationAll()
    // /industry40/vibration 返回 {device_id: {rms, zone, health_score, ...}} 字典
    vibrationData.value = toList<VibrationSourceRow>(data).map((r) => ({
      device_id: r.device_id,
      vibration_value: r.rms ?? r.vibration_value,
      iso_grade: r.zone || r.iso_grade,
      zone_description: r.zone_description,
      bearing_status: r.bearing_status,
      updated_at: r.updated_at,
    }))
    renderVibrationRms()
  } catch (e) { console.warn('[Industry40] 加载失败:', errorMessage(e)) }
  finally { loading.vibration = false }
}

/** 各设备 RMS 横向条形 + ISO 10816 A/B/C/D 分区参考线（边界取后端 VIBRATION_ZONES） */
function renderVibrationRms() {
  const chart = ensureChart('vibrationRms', vibrationRmsRef.value)
  if (!chart) return
  const list = vibrationData.value
    .filter(d => Number.isFinite(Number(d.vibration_value)))
    .map(d => ({ device_id: d.device_id, rms: Number(d.vibration_value), zone: d.iso_grade || '' }))
    .sort((a, b) => b.rms - a.rms)
  if (!list.length) { chart.clear(); return }
  const bounds = [
    { v: ZONE_A.max, label: `A|B ${ZONE_A.max}` },
    { v: ZONE_B.max, label: `B|C ${ZONE_B.max}` },
    { v: ZONE_C.max, label: `C|D ${ZONE_C.max}` },
  ]
  chart.setOption({
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (p: TooltipParam[]) => {
        const it = list[p[0]?.dataIndex ?? -1]
        if (!it) return ''
        return `${it.device_id}<br/>RMS ${it.rms.toFixed(2)} mm/s<br/>ISO 分区 ${it.zone || '-'}`
      },
    },
    grid: { left: 12, right: 64, top: 32, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value', name: 'mm/s', min: 0,
      max: Math.max(5, Math.ceil(Math.max(...list.map(l => l.rms)) * 1.15)),
    },
    yAxis: { type: 'category', inverse: true, data: list.map(l => l.device_id) },
    series: [{
      type: 'bar', barMaxWidth: 14,
      data: list.map(l => ({
        value: Number(l.rms.toFixed(2)),
        itemStyle: { color: token(ZONE_TOKEN[l.zone] || '--color-offline'), borderRadius: [0, 3, 3, 0] },
      })),
      label: { show: true, position: 'right', formatter: '{c}', fontSize: 12, color: token('--text-secondary') },
      markLine: {
        silent: true, symbol: 'none',
        data: bounds.map(b => ({
          xAxis: b.v,
          lineStyle: { color: token('--border-strong'), type: 'dashed', width: 1 },
          label: { formatter: b.label, fontSize: 11, color: token('--text-muted'), position: 'insideEndTop' },
        })),
      },
    }],
  }, true)
}

// 快速连点不同设备时，慢响应会覆盖新数据，用请求序号丢弃过期响应
let vibrationReqId = 0

async function onVibrationDeviceClick(row: VibrationRow) {
  const reqId = ++vibrationReqId
  vibrationSelectedDevice.value = row.device_id
  vibrationSpectrum.value = null
  vibrationBearing.value = null
  // 加载频谱
  loading.spectrum = true
  try {
    const specData = await industry40Api.getVibrationSpectrum(row.device_id)
    if (reqId !== vibrationReqId) return
    vibrationSpectrum.value = specData?.spectrum || null
    renderVibrationSpectrum()
  } catch (e) { if (reqId === vibrationReqId) console.warn('[Industry40] 加载失败:', errorMessage(e)) }
  finally { if (reqId === vibrationReqId) loading.spectrum = false }
  // 加载轴承数据
  loading.bearing = true
  try {
    const bearingData = await industry40Api.getVibrationBearing(row.device_id)
    if (reqId !== vibrationReqId) return
    // 后端返回 {diagnosis, fault_count, bearing_faults:{BPFO:{expected_frequency_hz, detected_frequency_hz, has_fault_signature},...}}，
    // 补齐模板使用的 status/bearing_type/bpfo... 字段，否则面板全部显示 "-"
    const b = bearingData?.bearing || bearingData || null
    if (!b) { vibrationBearing.value = null; return }
    const faults = b.bearing_faults || {}
    // 轴承特征频率：优先用后端给出的理论频率 expected_frequency_hz（detected 在未命中时为 0，不能作为标注位置）
    const characteristic = ['BPFO', 'BPFI', 'BSF', 'FTF']
      .map(k => ({
        key: k,
        freq: Number(faults[k]?.expected_frequency_hz),
        fault: !!faults[k]?.has_fault_signature,
        name: faults[k]?.name || k,
      }))
      .filter(x => Number.isFinite(x.freq) && x.freq > 0)
    vibrationBearing.value = {
      ...b,
      bearing_type: asStr(b.bearing_type, b.diagnosis || ''),
      status: asStr(b.status, b.fault_count ? 'fault' : 'normal'),
      bpfo: asNum(b.bpfo) ?? faults.BPFO?.detected_frequency_hz,
      bpfi: asNum(b.bpfi) ?? faults.BPFI?.detected_frequency_hz,
      bsf: asNum(b.bsf) ?? faults.BSF?.detected_frequency_hz,
      ftf: asNum(b.ftf) ?? faults.FTF?.detected_frequency_hz,
      characteristic,
    }
    // 轴承数据先于频谱返回时，补画一次特征频率标注
    renderVibrationSpectrum()
  } catch (e) {
    if (reqId !== vibrationReqId) return
    console.warn('[Industry40] 加载失败:', errorMessage(e))
    vibrationBearing.value = null
  }
  finally { if (reqId === vibrationReqId) loading.bearing = false }
}

/**
 * 频谱：频率为 X 轴（对数轴）、幅值为 Y 轴的面积图；
 * 轴承特征频率（BPFO/BPFI/BSF/FTF，来自后端 expected_frequency_hz）用竖向 markLine 标注。
 */
function renderVibrationSpectrum() {
  const chart = ensureChart('vibrationSpectrum', vibrationSpectrumRef.value)
  if (!chart) return
  const spec = vibrationSpectrum.value
  const rawFreqs: number[] = spec?.frequencies || []
  const rawAmps: number[] = spec?.amplitudes || []
  // 对数轴不能包含 0，滤掉直流分量
  const pairs = rawFreqs
    .map((f, i) => ({ f: Number(f), a: Number(rawAmps[i]) }))
    .filter(p => Number.isFinite(p.f) && p.f > 0 && Number.isFinite(p.a))
  if (!pairs.length) { chart.clear(); return }
  const maxFreq = Math.max(...pairs.map(p => p.f))

  // 特征频率标注（仅画落在频谱范围内的线）
  const marks: ChartMark[] = []
  const characteristic = vibrationBearing.value?.characteristic || []
  characteristic.forEach((c) => {
    if (!(c.freq > 0) || c.freq > maxFreq) return
    marks.push({
      xAxis: c.freq,
      lineStyle: { color: token(c.fault ? '--color-danger' : '--chart-8'), type: 'dashed', width: 1 },
      label: {
        formatter: c.key, fontSize: 11, position: 'insideEndTop',
        color: token(c.fault ? '--color-danger' : '--text-muted'),
      },
    })
  })

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: (p: TooltipParam[]) => {
        const d = p[0]?.data
        const f = Array.isArray(d) ? d[0] : p[0]?.axisValue
        const a = Array.isArray(d) ? d[1] : d
        return `${Number(f).toFixed(1)} Hz<br/>幅值 ${a} g`
      },
    },
    grid: { left: 12, right: 24, top: 32, bottom: 8, containLabel: true },
    xAxis: {
      type: 'log', name: 'Hz', logBase: 10,
      axisLabel: { formatter: (v: number) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1)) },
    },
    yAxis: { type: 'value', name: 'g' },
    series: [{
      // 频谱用面积（对数频率轴上柱宽不可控，故不采用柱状）
      type: 'line', symbol: 'none',
      // 值轴上用 [频率, 幅值] 成对数据
      data: pairs.map(p => [p.f, Number(p.a.toFixed(4))]),
      lineStyle: { width: 1.5, color: token('--chart-1') },
      areaStyle: { color: token('--chart-1'), opacity: 0.18 },
      markLine: marks.length ? { silent: true, symbol: 'none', data: marks } : undefined,
    }],
  }, true)
}

function isoGradeType(grade: string) {
  if (!grade) return 'info'
  const map: Record<string, string> = { A: 'success', B: 'success', C: 'warning', D: 'danger' }
  return map[grade] || 'info'
}

function selectTwinDevice(d: TwinDevice) { twinSelected.value = d }

// ========== 设备列表 ==========
async function loadDeviceList() {
  try {
    const data = await devicesApi.getAll()
    deviceList.value = data?.devices || []
  } catch (e) { console.warn('[Industry40] 加载失败:', errorMessage(e)) }
}

function onSpcDeviceChange(deviceId: string) {
  const dev = deviceList.value.find((d) => d.device_id === deviceId)
  spc.registers = (dev?.registers || []).map((r) => r.name)
  spc.registerName = ''
}

// ========== Tab 切换 ==========
const loaders: Record<string, () => void | Promise<void>> = {
  overview: loadOverview,
  predictive: loadPredictive,
  oee: loadOEE,
  spc: loadSPCTab,
  energy: loadEnergy,
  edge: loadEdge,
  twin: loadTwin,
  vibration: loadVibration,
}

function onTabChange(tab: string) {
  loaders[tab]?.()
  // 刚从隐藏状态切回来时容器已有尺寸，补一次 resize（隐藏期间 resize 会把图表压成 0 尺寸）
  nextTick(() => resizeVisibleCharts())
}

/** 深浅主题切换：ECharts 不支持运行时换主题，需按新主题重建实例后按当前数据重绘 */
function reRenderAllCharts() {
  renderProcessFlow()
  renderHealthCharts()
  renderOEECharts()
  renderSPCCharts()
  renderEnergyCharts()
  renderVibrationSpectrum()
  renderVibrationRms()
}

function initThemeObserver() {
  themeObserver = new MutationObserver(() => {
    if (isUnmounted) return
    Object.values(charts).forEach(c => c.dispose())
    charts = {}
    reRenderAllCharts()
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

// ========== 生命周期 ==========
onMounted(async () => {
  await loadDeviceList()
  loadOverview()
  initThemeObserver()
  refreshTimer = setInterval(() => { loaders[activeTab.value]?.() }, 30000)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  isUnmounted = true
  clearInterval(refreshTimer)
  window.removeEventListener('resize', handleResize)
  themeObserver?.disconnect()
  themeObserver = null
  Object.values(charts).forEach(c => c.dispose())
  charts = {}
})

// 隐藏的 tab-pane 尺寸为 0，此时 resize 会让图表永久变成 0×0，必须跳过
function resizeVisibleCharts() {
  Object.values(charts).forEach(c => {
    const el = c.getDom()
    if (el && el.clientWidth > 0 && el.clientHeight > 0) c.resize()
  })
}

function handleResize() { resizeVisibleCharts() }
</script>

<style scoped>
.industry40 { padding: 0; }
.metric-row { margin-bottom: var(--space-3); }
.metric-box { padding: var(--space-4); text-align: center; }
.metric-box .metric-label { margin-bottom: var(--space-1); }
.metric-value .metric-unit { font-size: var(--font-sm); }

.panel__hint { font-size: var(--font-xs); font-weight: var(--weight-normal); color: var(--text-muted); }

.chart-box { height: 280px; }
.chart-box--sm { height: 220px; }
.chart-box--tall { height: 320px; }
.process-flow { height: 300px; }

/* 图表容器：始终保留真实尺寸，空数据态以覆盖层呈现（避免图表被压成 0×0） */
.chart-wrap { position: relative; }
.chart-empty {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-surface);
}

/* 档位分段色条：点亮到当前档位，其余淡显 */
.band-bar { display: flex; gap: 2px; width: 100%; margin: var(--space-2) 0 var(--space-1); }
.band-bar__seg { flex: 1; height: 6px; border-radius: var(--radius-pill); transition: opacity var(--duration-fast) var(--ease-out); }
.band-bar--mini { width: 84px; margin: 0; }
.band-legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); margin-top: var(--space-2); }
.band-legend__item { display: inline-flex; align-items: center; gap: var(--space-1); }
.band-legend__text { font-size: var(--font-xs); color: var(--text-secondary); }
.band-dot { width: 8px; height: 8px; border-radius: var(--radius-pill); flex: none; }

.oee-hero { display: flex; align-items: baseline; justify-content: center; gap: var(--space-2); }

.filter-bar { display: flex; gap: var(--space-2); margin-bottom: var(--space-3); flex-wrap: wrap; }
.filter-bar__select { width: 200px; }
.filter-bar__select--sm { width: 160px; }

.alert-list { max-height: 400px; overflow-y: auto; }
.alert-item { display: flex; gap: var(--space-2); align-items: center; padding: var(--space-2); border-bottom: 1px solid var(--border-subtle); }
.alert-sev { font-size: var(--font-xs); padding: 2px 6px; border-radius: var(--radius-sm); font-weight: var(--weight-semibold); flex: none; }
.sev-critical .alert-sev { background: var(--level-critical-soft); color: var(--level-critical); }
.sev-warning .alert-sev { background: var(--level-warning-soft); color: var(--level-warning); }
.sev-info .alert-sev { background: var(--level-info-soft); color: var(--level-info); }
.alert-msg { font-size: var(--font-sm); color: var(--text-secondary); }

.health-cell { display: flex; align-items: center; gap: var(--space-2); }
.health-cell__val { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: var(--weight-semibold); }
.text-danger { color: var(--color-danger); }
.text-success { color: var(--color-success); }
.text-muted { color: var(--text-muted); }
.trend { font-weight: var(--weight-semibold); }
.trend--rising { color: var(--color-danger); }
.trend--falling { color: var(--color-success); }
.trend--stable { color: var(--text-muted); }

.cap-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-2); }
.cap-item { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); padding: var(--space-3); background: var(--bg-sunken); border-radius: var(--radius-md); }
.cap-label { font-size: var(--font-xs); color: var(--text-muted); }
.cap-val { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--font-xl); font-weight: var(--weight-semibold); }
.cap-meta { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin-top: var(--space-3); font-size: var(--font-xs); color: var(--text-muted); }

.violation-list { max-height: 300px; overflow-y: auto; }
.violation-item { display: flex; align-items: center; gap: var(--space-2); padding: 6px var(--space-1); border-bottom: 1px solid var(--border-subtle); font-size: var(--font-sm); }
.v-rule { font-weight: var(--weight-semibold); color: var(--color-danger); }
.v-dev { color: var(--text-secondary); }
.v-time { color: var(--text-muted); margin-left: auto; }

.log-list { max-height: 420px; overflow-y: auto; }
.log-list :deep(.el-timeline) { padding-left: var(--space-2); }
.log-card { display: flex; gap: var(--space-2); padding: var(--space-2) var(--space-3); background: var(--bg-sunken); border-radius: var(--radius-md); }
.log-card__body { flex: 1; min-width: 0; }
.log-card__head { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.log-rule { font-size: var(--font-sm); font-weight: var(--weight-semibold); color: var(--text-primary); }
.log-action { font-size: var(--font-xs); color: var(--text-muted); margin-left: auto; }
.log-result { margin-top: var(--space-1); font-size: var(--font-sm); color: var(--text-secondary); }
.log-snapshot { margin-top: 2px; font-size: var(--font-xs); color: var(--text-muted); }

.twin-floor { position: relative; min-height: 350px; background: var(--bg-sunken); border: 1px solid var(--border-base); border-radius: var(--radius-md); overflow: auto; }
.twin-links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.twin-link { stroke: var(--chart-1); stroke-width: 2; stroke-dasharray: 6 4; opacity: 0.5; }
.twin-node {
  position: absolute; width: 80px; height: 80px; border-radius: 50%;
  background: var(--bg-surface); border: 3px solid var(--border-base);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  cursor: pointer; transition: transform var(--duration-fast) var(--ease-out);
}
.twin-node:hover { transform: scale(1.06); }
.twin-node.status-running { border-color: var(--color-success); }
.twin-node.status-fault { border-color: var(--color-danger); }
.twin-node.status-idle { border-color: var(--color-warning); }
.twin-node.status-stopped { border-color: var(--color-offline); }
.node-icon { font-size: var(--font-xl); }
.node-name { font-size: var(--font-xs); color: var(--text-secondary); text-align: center; margin-top: 2px; }

.twin-detail { font-size: var(--font-sm); }
.detail-name { font-size: var(--font-lg); font-weight: var(--weight-semibold); color: var(--text-primary); margin-bottom: var(--space-3); }
.detail-row { display: flex; justify-content: space-between; gap: var(--space-3); padding: 6px 0; border-bottom: 1px solid var(--border-subtle); font-size: var(--font-sm); color: var(--text-secondary); }
</style>
