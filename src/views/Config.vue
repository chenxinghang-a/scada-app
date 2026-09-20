<template>
  <div class="config-page">
    <section class="panel">
      <div class="panel__header">
        <span>系统配置</span>
        <span class="panel__meta">按分区保存，保存后立即写入后端配置文件</span>
      </div>
      <div class="panel__body">
        <el-tabs v-model="activeTab">
          <!-- 系统设置 -->
          <el-tab-pane label="系统设置" name="system">
            <section class="panel section">
              <div class="panel__header">
                <span>基础信息</span>
                <span class="panel__meta">系统名称用于标题栏与登录页</span>
              </div>
              <div class="panel__body">
                <el-form label-width="140px" class="config-form config-form--narrow">
                  <el-form-item label="系统名称"><el-input v-model="config.system.name" /></el-form-item>
                  <el-form-item label="版本"><el-input :value="appVersion" disabled /></el-form-item>
                  <el-form-item label="Web端口">
                    <el-input-number v-model="config.system.port" :min="1" :max="65535" />
                    <span class="field-hint">1-65535，修改后需重启后端服务</span>
                  </el-form-item>
                  <el-form-item label="Web地址"><el-input v-model="config.system.host" /></el-form-item>
                  <el-form-item label="调试模式">
                    <el-switch v-model="config.system.debug" />
                    <span class="field-hint">生产环境请保持关闭</span>
                  </el-form-item>
                </el-form>
              </div>
              <div class="section__foot">
                <el-button type="primary" :loading="savingSection === 'system'" @click="saveConfig('system')">保存</el-button>
                <el-button @click="exportConfig">导出配置</el-button>
                <el-button @click="importConfig">导入配置</el-button>
                <span class="save-state" :class="`save-state--${saveStateOf('system', config.system)}`">
                  {{ saveStateLabel('system', config.system) }}
                </span>
              </div>
            </section>
          </el-tab-pane>

          <!-- 采集设置 -->
          <el-tab-pane label="采集设置" name="collection">
            <section class="panel section">
              <div class="panel__header">
                <span>采集与重试</span>
                <span class="panel__meta">影响所有设备的数据采集节奏</span>
              </div>
              <div class="panel__body">
                <el-form label-width="140px" class="config-form config-form--narrow">
                  <el-form-item label="默认采集间隔(秒)">
                    <el-input-number v-model="config.collection.interval" :min="1" />
                    <span class="field-hint">单设备可在设备管理中覆盖</span>
                  </el-form-item>
                  <el-form-item label="连接超时(秒)"><el-input-number v-model="config.collection.timeout" :min="1" /></el-form-item>
                  <el-form-item label="重试次数"><el-input-number v-model="config.collection.retries" :min="0" /></el-form-item>
                  <el-form-item label="重试间隔(秒)"><el-input-number v-model="config.collection.retry_interval" :min="1" /></el-form-item>
                </el-form>
              </div>
              <div class="section__foot">
                <el-button type="primary" :loading="savingSection === 'collection'" @click="saveConfig('collection')">保存</el-button>
                <span class="save-state" :class="`save-state--${saveStateOf('collection', config.collection)}`">
                  {{ saveStateLabel('collection', config.collection) }}
                </span>
              </div>
            </section>
          </el-tab-pane>

          <!-- 数据库设置 -->
          <el-tab-pane label="数据库设置" name="database">
            <section class="panel section">
              <div class="panel__header">
                <span>数据保留与压缩</span>
                <span class="panel__meta">超出保留期限的原始数据会被清理</span>
              </div>
              <div class="panel__body">
                <el-form label-width="160px" class="config-form config-form--narrow">
                  <el-form-item label="原始数据保留(天)"><el-input-number v-model="config.database.retention_days" :min="1" /></el-form-item>
                  <el-form-item label="数据压缩">
                    <el-switch v-model="config.database.compression" />
                    <span class="field-hint">压缩可显著降低磁盘占用</span>
                  </el-form-item>
                  <el-form-item label="压缩间隔(小时)"><el-input-number v-model="config.database.compression_interval" :min="1" /></el-form-item>
                </el-form>
              </div>
              <div class="section__foot">
                <el-button type="primary" :loading="savingSection === 'database'" @click="saveConfig('database')">保存</el-button>
                <span class="save-state" :class="`save-state--${saveStateOf('database', config.database)}`">
                  {{ saveStateLabel('database', config.database) }}
                </span>
              </div>
            </section>
          </el-tab-pane>

          <!-- 报警规则 -->
          <el-tab-pane label="报警规则" name="alarms">
            <section class="panel section">
              <div class="panel__header">
                <span>报警规则</span>
                <span class="panel__meta">共 {{ alarmRules.length }} 条</span>
              </div>
              <div class="panel__body">
                <el-button type="primary" size="small" class="section__action" @click="showRuleDialog">添加规则</el-button>
                <el-table :data="alarmRules" stripe size="small" class="data-table">
                  <el-table-column prop="id" label="ID" width="110">
                    <template v-slot:default="{ row }"><span class="mono">{{ row.id }}</span></template>
                  </el-table-column>
                  <el-table-column prop="name" label="名称" min-width="140" />
                  <el-table-column prop="device_id" label="设备" width="150">
                    <template v-slot:default="{ row }"><span class="mono">{{ row.device_id }}</span></template>
                  </el-table-column>
                  <el-table-column prop="condition" label="条件" width="80" align="center" />
                  <el-table-column prop="threshold" label="阈值" width="90" align="right">
                    <template v-slot:default="{ row }"><span class="mono">{{ row.threshold }}</span></template>
                  </el-table-column>
                  <el-table-column prop="level" label="等级" width="100">
                    <template v-slot:default="{ row }">
                      <span class="tag" :class="levelTag(row.level)">{{ levelLabel(row.level) }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="enabled" label="启用" width="70">
                    <template v-slot:default="{ row }"><el-switch v-model="row.enabled" size="small" @change="toggleRule(row)" /></template>
                  </el-table-column>
                  <el-table-column label="操作" width="130" align="right">
                    <template v-slot:default="{ row }">
                      <div class="row-actions">
                        <el-button type="primary" link size="small" @click="editRule(row)">编辑</el-button>
                        <span class="row-actions__sep" aria-hidden="true"></span>
                        <el-popconfirm
                          title="删除后不可恢复，确定删除该规则？"
                          confirm-button-text="删除"
                          cancel-button-text="取消"
                          confirm-button-type="danger"
                          width="220"
                          @confirm="deleteRule(row.id)"
                        >
                          <template v-slot:reference>
                            <el-button link size="small" class="btn-danger-link">删除</el-button>
                          </template>
                        </el-popconfirm>
                      </div>
                    </template>
                  </el-table-column>
                  <template v-slot:empty>
                    <el-empty description="暂无报警规则" :image-size="80">
                      <el-button type="primary" @click="showRuleDialog">添加规则</el-button>
                    </el-empty>
                  </template>
                </el-table>
              </div>
            </section>
          </el-tab-pane>

          <!-- 能源费率 -->
          <el-tab-pane label="能源费率" name="energy">
            <section class="panel section">
              <div class="panel__header">
                <span>电价与碳排放</span>
                <span class="panel__meta">用于能耗成本与碳排核算</span>
              </div>
              <div class="panel__body">
                <el-form label-width="160px" class="config-form config-form--narrow">
                  <el-form-item label="峰时电价(元/kWh)"><el-input-number v-model="config.energy.peak_price" :min="0" :step="0.01" /></el-form-item>
                  <el-form-item label="平时电价(元/kWh)"><el-input-number v-model="config.energy.flat_price" :min="0" :step="0.01" /></el-form-item>
                  <el-form-item label="谷时电价(元/kWh)"><el-input-number v-model="config.energy.valley_price" :min="0" :step="0.01" /></el-form-item>
                  <el-form-item label="碳排放因子"><el-input-number v-model="config.energy.carbon_factor" :min="0" :step="0.01" /></el-form-item>
                </el-form>
              </div>
              <div class="section__foot">
                <el-button type="primary" :loading="savingSection === 'energy'" @click="saveConfig('energy')">保存</el-button>
                <span class="save-state" :class="`save-state--${saveStateOf('energy', config.energy)}`">
                  {{ saveStateLabel('energy', config.energy) }}
                </span>
              </div>
            </section>

            <section class="panel section">
              <div class="panel__header"><span>费率预览</span></div>
              <div class="panel__body">
                <div class="rate-grid">
                  <div class="rate-cell">
                    <div class="metric-label">峰时</div>
                    <div class="rate-value">{{ config.energy.peak_price }}<span class="metric-unit">元/kWh</span></div>
                  </div>
                  <div class="rate-cell">
                    <div class="metric-label">平时</div>
                    <div class="rate-value">{{ config.energy.flat_price }}<span class="metric-unit">元/kWh</span></div>
                  </div>
                  <div class="rate-cell">
                    <div class="metric-label">谷时</div>
                    <div class="rate-value">{{ config.energy.valley_price }}<span class="metric-unit">元/kWh</span></div>
                  </div>
                  <div class="rate-cell">
                    <div class="metric-label">碳排放因子</div>
                    <div class="rate-value">{{ config.energy.carbon_factor }}<span class="metric-unit">kg/kWh</span></div>
                  </div>
                </div>
              </div>
            </section>
          </el-tab-pane>

          <!-- 系统状态 -->
          <el-tab-pane label="系统状态" name="status">
            <section class="panel section">
              <div class="panel__header">
                <span>运行状态</span>
                <span class="panel__meta">来自后端实时状态接口</span>
              </div>
              <div class="panel__body">
                <el-descriptions :column="2" border>
                  <el-descriptions-item label="运行模式">
                    <span class="tag" :class="systemStatus?.simulation_mode ? 'tag--warning' : 'tag--success'">
                      {{ systemStatus?.simulation_mode ? '模拟模式' : '实时模式' }}
                    </span>
                  </el-descriptions-item>
                  <el-descriptions-item label="设备总数">{{ devicesTotal }}</el-descriptions-item>
                  <el-descriptions-item label="在线设备">{{ devicesConnected }}</el-descriptions-item>
                  <el-descriptions-item label="活跃报警">{{ alarmsActive }}</el-descriptions-item>
                  <el-descriptions-item label="数据采集器">
                    <span class="tag" :class="collectorRunning ? 'tag--success' : 'tag--danger'">
                      {{ collectorRunning ? '运行中' : '已停止' }}
                    </span>
                  </el-descriptions-item>
                </el-descriptions>
              </div>
            </section>

            <section class="panel section">
              <div class="panel__header"><span>数据库信息</span></div>
              <div class="panel__body">
                <el-table :data="dbTables" stripe size="small" class="data-table">
                  <el-table-column prop="name" label="表名">
                    <template v-slot:default="{ row }"><span class="mono">{{ row.name }}</span></template>
                  </el-table-column>
                  <el-table-column prop="rows" label="记录数" width="140" align="right">
                    <template v-slot:default="{ row }"><span class="mono">{{ row.rows }}</span></template>
                  </el-table-column>
                  <el-table-column prop="size" label="大小" width="120" align="right" />
                  <template v-slot:empty>
                    <el-empty description="暂无数据库信息" :image-size="80" />
                  </template>
                </el-table>
              </div>
            </section>
          </el-tab-pane>

          <!-- 报警输出硬件配置 -->
          <el-tab-pane label="报警输出硬件" name="alarm-hardware">
            <div class="split-grid">
              <section class="panel section">
                <div class="panel__header">
                  <span>Patlite LR7 光柱 (Modbus)</span>
                  <span class="panel__meta">DO 线圈映射</span>
                </div>
                <div class="panel__body">
                  <el-form label-width="140px" class="config-form">
                    <el-form-item label="启用声光报警器"><el-switch v-model="signalTower.enabled" /></el-form-item>
                    <el-form-item label="Modbus IP"><el-input v-model="signalTower.host" placeholder="192.168.1.70" /></el-form-item>
                    <el-form-item label="端口"><el-input-number v-model="signalTower.port" :min="1" :max="65535" /></el-form-item>
                    <el-form-item label="从站ID"><el-input-number v-model="signalTower.slave_id" :min="1" :max="247" /></el-form-item>
                    <div class="form-section-title">DO 线圈映射</div>
                    <el-form-item label="红灯 DO"><el-input-number v-model="signalTower.do_mapping.red_light" :min="0" /></el-form-item>
                    <el-form-item label="黄灯 DO"><el-input-number v-model="signalTower.do_mapping.yellow_light" :min="0" /></el-form-item>
                    <el-form-item label="绿灯 DO"><el-input-number v-model="signalTower.do_mapping.green_light" :min="0" /></el-form-item>
                    <el-form-item label="蜂鸣器 DO"><el-input-number v-model="signalTower.do_mapping.buzzer" :min="0" /></el-form-item>
                  </el-form>
                </div>
                <div class="section__foot">
                  <el-button type="primary" :loading="savingSection === 'signalTower'" @click="saveSignalTower">保存</el-button>
                  <span class="save-state" :class="`save-state--${saveStateOf('signalTower', signalTower)}`">
                    {{ saveStateLabel('signalTower', signalTower) }}
                  </span>
                </div>
              </section>

              <section class="panel section">
                <div class="panel__header">
                  <span>广播系统 (MQTT)</span>
                  <span class="panel__meta">报警语音播报通道</span>
                </div>
                <div class="panel__body">
                  <el-form label-width="140px" class="config-form">
                    <el-form-item label="启用广播系统"><el-switch v-model="broadcastConfig.enabled" /></el-form-item>
                    <el-form-item label="MQTT Broker"><el-input v-model="broadcastConfig.mqtt.broker" placeholder="192.168.1.200" /></el-form-item>
                    <el-form-item label="端口"><el-input-number v-model="broadcastConfig.mqtt.port" :min="1" :max="65535" /></el-form-item>
                    <el-form-item label="主题前缀"><el-input v-model="broadcastConfig.mqtt.topic_prefix" placeholder="pa/" /></el-form-item>
                    <el-form-item label="用户名"><el-input v-model="broadcastConfig.mqtt.username" placeholder="可选" /></el-form-item>
                    <el-form-item label="密码"><el-input v-model="broadcastConfig.mqtt.password" type="password" placeholder="可选" show-password /></el-form-item>
                    <el-form-item label="广播区域">
                      <el-input v-model="broadcastAreasStr" placeholder="车间A,车间B,仓库,办公楼" />
                      <span class="field-hint">多个区域用英文逗号分隔</span>
                    </el-form-item>
                  </el-form>
                </div>
                <div class="section__foot">
                  <el-button type="primary" :loading="savingSection === 'broadcast'" @click="saveBroadcastHardware">保存</el-button>
                  <span class="save-state" :class="`save-state--${saveStateOf('broadcast', broadcastSnapshot)}`">
                    {{ saveStateLabel('broadcast', broadcastSnapshot) }}
                  </span>
                </div>
              </section>
            </div>
          </el-tab-pane>

          <!-- 日志设置 -->
          <el-tab-pane label="日志设置" name="logging">
            <section class="panel section">
              <div class="panel__header">
                <span>日志与滚动策略</span>
                <span class="panel__meta">DEBUG 级别会产生大量日志</span>
              </div>
              <div class="panel__body">
                <el-form label-width="160px" class="config-form config-form--narrow">
                  <el-form-item label="日志级别">
                    <el-select v-model="loggingConfig.level" style="width:100%">
                      <el-option label="DEBUG" value="DEBUG" />
                      <el-option label="INFO" value="INFO" />
                      <el-option label="WARNING" value="WARNING" />
                      <el-option label="ERROR" value="ERROR" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="日志文件最大(MB)"><el-input-number v-model="loggingConfig.file.max_size_mb" :min="1" /></el-form-item>
                  <el-form-item label="日志备份数"><el-input-number v-model="loggingConfig.file.backup_count" :min="0" /></el-form-item>
                </el-form>
              </div>
              <div class="section__foot">
                <el-button type="primary" :loading="savingSection === 'logging'" @click="saveLoggingConfig">保存</el-button>
                <span class="save-state" :class="`save-state--${saveStateOf('logging', loggingConfig)}`">
                  {{ saveStateLabel('logging', loggingConfig) }}
                </span>
              </div>
            </section>
          </el-tab-pane>

          <!-- 运维管理 -->
          <el-tab-pane label="运维管理" name="ops">
            <div class="split-grid">
              <section class="panel section">
                <div class="panel__header">
                  <span>运行模式</span>
                  <span class="panel__meta">影响采集数据来源</span>
                </div>
                <div class="panel__body">
                  <el-form label-width="110px" class="config-form">
                    <el-form-item label="当前模式">
                      <span class="tag" :class="simulationMode ? 'tag--warning' : 'tag--success'">
                        {{ simulationMode ? '模拟模式' : '实时模式' }}
                      </span>
                    </el-form-item>
                    <el-form-item label="切换模式">
                      <el-switch v-model="simulationMode" active-text="模拟" inactive-text="实时" @change="toggleSimulationMode" />
                      <span class="field-hint">切换会中断当前采集，需二次确认</span>
                    </el-form-item>
                  </el-form>
                </div>
              </section>

              <section class="panel section">
                <div class="panel__header">
                  <span>系统健康</span>
                  <el-button size="small" @click="loadHealthStatus">刷新</el-button>
                </div>
                <div class="panel__body">
                  <div v-if="healthStatus" class="health-list">
                    <div v-for="([key, val]) in healthCheckEntries" :key="key" class="health-row">
                      <span class="health-key mono">{{ key }}</span>
                      <span class="tag" :class="val ? 'tag--success' : 'tag--danger'">{{ val ? '正常' : '异常' }}</span>
                    </div>
                  </div>
                  <el-empty v-else description="加载中..." :image-size="70" />
                </div>
              </section>
            </div>

            <div class="split-grid">
              <section class="panel section">
                <div class="panel__header"><span>报警输出配置</span></div>
                <div class="panel__body">
                  <el-form label-width="140px" class="config-form">
                    <el-form-item label="灯塔模式">
                      <el-select v-model="alarmOutputConfig.mode" style="width:100%">
                        <el-option label="自动模式" value="auto" />
                        <el-option label="手动模式" value="manual" />
                        <el-option label="禁用" value="disabled" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="蜂鸣器启用"><el-switch v-model="alarmOutputConfig.buzzer_enabled" /></el-form-item>
                    <el-form-item label="自动消音(秒)"><el-input-number v-model="alarmOutputConfig.auto_silence_seconds" :min="0" /></el-form-item>
                  </el-form>
                </div>
                <div class="section__foot">
                  <el-button type="primary" :loading="savingSection === 'alarmOutput'" @click="saveAlarmOutputConfig">保存</el-button>
                  <span class="save-state" :class="`save-state--${saveStateOf('alarmOutput', alarmOutputConfig)}`">
                    {{ saveStateLabel('alarmOutput', alarmOutputConfig) }}
                  </span>
                </div>
              </section>

              <section class="panel section">
                <div class="panel__header"><span>报警升级配置</span></div>
                <div class="panel__body">
                  <el-form label-width="150px" class="config-form">
                    <el-form-item label="启用报警升级"><el-switch v-model="alarmEscalation.enabled" /></el-form-item>
                    <el-form-item label="升级阈值(分钟)"><el-input-number v-model="alarmEscalation.timeout_minutes" :min="1" /></el-form-item>
                    <el-form-item label="升级目标等级">
                      <el-select v-model="alarmEscalation.escalate_to" style="width:100%">
                        <el-option label="严重 (critical)" value="critical" />
                        <el-option label="警告 (warning)" value="warning" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="通知方式">
                      <el-checkbox-group v-model="alarmEscalation.notify_methods">
                        <el-checkbox label="sound">声光报警</el-checkbox>
                        <el-checkbox label="broadcast">广播通知</el-checkbox>
                      </el-checkbox-group>
                    </el-form-item>
                  </el-form>
                </div>
                <div class="section__foot">
                  <el-button type="primary" :loading="savingSection === 'alarmEscalation'" @click="saveAlarmEscalation">保存</el-button>
                  <span class="save-state" :class="`save-state--${saveStateOf('alarmEscalation', alarmEscalation)}`">
                    {{ saveStateLabel('alarmEscalation', alarmEscalation) }}
                  </span>
                </div>
              </section>
            </div>

            <section class="panel section">
              <div class="panel__header">
                <span>数据归档管理</span>
                <span class="panel__meta">归档后历史数据会迁移到归档表</span>
              </div>
              <div class="panel__body">
                <div class="split-grid split-grid--tight">
                  <el-form label-width="150px" class="config-form">
                    <el-form-item label="自动归档"><el-switch v-model="archiveConfig.auto_archive" /></el-form-item>
                    <el-form-item label="归档周期(天)"><el-input-number v-model="archiveConfig.archive_interval_days" :min="1" /></el-form-item>
                    <el-form-item label="数据保留(天)"><el-input-number v-model="archiveConfig.retention_days" :min="1" /></el-form-item>
                    <el-form-item label="压缩已归档数据"><el-switch v-model="archiveConfig.compress_archived" /></el-form-item>
                  </el-form>
                  <div class="archive-stats">
                    <div class="archive-stat">
                      <div class="metric-label">历史数据总量</div>
                      <div class="archive-stat__value mono">{{ dbTables.reduce((s, t) => t.name === 'history_data' ? s + t.rows : s, 0) }}<span class="metric-unit">条</span></div>
                    </div>
                    <div class="archive-stat">
                      <div class="metric-label">归档数据总量</div>
                      <div class="archive-stat__value mono">{{ dbTables.reduce((s, t) => t.name === 'history_archive' ? s + t.rows : s, 0) }}<span class="metric-unit">条</span></div>
                    </div>
                    <div class="archive-stat">
                      <div class="metric-label">数据库大小</div>
                      <div class="archive-stat__value mono">{{ dbInfo?.database_size_mb?.toFixed(2) || '-' }}<span class="metric-unit">MB</span></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="section__foot">
                <el-button type="primary" :loading="savingSection === 'archive'" @click="saveArchiveConfig">保存归档策略</el-button>
                <el-button @click="triggerArchive" :loading="archiveLoading">立即归档</el-button>
                <span class="save-state" :class="`save-state--${saveStateOf('archive', archiveConfig)}`">
                  {{ saveStateLabel('archive', archiveConfig) }}
                </span>
              </div>
            </section>
          </el-tab-pane>
        </el-tabs>
      </div>
    </section>

    <!-- 报警规则弹窗 -->
    <el-dialog v-model="ruleDialogVisible" :title="isEditRule ? '编辑规则' : '添加规则'" width="520px">
      <el-form :model="ruleForm" label-width="90px" class="config-form">
        <el-form-item label="名称"><el-input v-model="ruleForm.name" /></el-form-item>
        <el-form-item label="设备">
          <el-select v-model="ruleForm.device_id" style="width:100%">
            <el-option v-for="d in devices" :key="d.device_id" :label="d.name || d.device_name || d.device_id" :value="d.device_id" />
          </el-select>
        </el-form-item>
        <el-form-item label="寄存器">
          <el-input v-model="ruleForm.register_name" placeholder="如 temperature、pressure" />
        </el-form-item>
        <el-form-item label="条件">
          <el-select v-model="ruleForm.condition" style="width:100%">
            <el-option label="大于 (>)" value=">" />
            <el-option label="小于 (<)" value="<" />
            <el-option label="大于等于 (>=)" value=">=" />
            <el-option label="小于等于 (<=)" value="<=" />
            <el-option label="等于 (=)" value="=" />
          </el-select>
        </el-form-item>
        <el-form-item label="阈值"><el-input-number v-model="ruleForm.threshold" style="width:100%" /></el-form-item>
        <el-form-item label="等级">
          <el-select v-model="ruleForm.level" style="width:100%">
            <el-option label="严重" value="critical" />
            <el-option label="警告" value="warning" />
            <el-option label="信息" value="info" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用"><el-switch v-model="ruleForm.enabled" /></el-form-item>
      </el-form>
      <template v-slot:footer>
        <el-button @click="ruleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  systemApi,
  devicesApi,
  alarmsApi,
  industry40Api,
  type Device,
  type AlarmRule,
  type DatabaseInfo,
  type SystemConfigFile,
  type SystemStatus,
  type AlarmEscalationConfig,
  type BroadcastConfig,
  type ModbusOutputDevice,
} from '@/api'
import { showActionError, errorMessage } from '@/utils/error'

// 从 package.json 读取版本号
const appVersion = __APP_VERSION__ || 'v1.0.0'

const activeTab = ref('system')
const devices = ref<Device[]>([])
const alarmRules = ref<AlarmRule[]>([])
const systemStatus = ref<SystemStatus | null>(null)
const dbInfo = ref<DatabaseInfo | null>(null)
const ruleDialogVisible = ref(false)
const isEditRule = ref(false)
const simulationMode = ref(false)
// /health/status 的 checks 段（键=检查项名，值=是否通过）；后端无 checks 时退化为整个响应体
const healthStatus = ref<Record<string, unknown> | null>(null)
// 报警输出配置：界面表单模型。
// 注意：后端 alarm_output 段并无 mode/buzzer_enabled/auto_silence_seconds 三个键
// （真实键为 enabled / relay_output / signal_tower / station_output），
// 这里保留既有字段名以维持界面行为不变，映射缺口见报告。
const alarmOutputConfig = reactive({ mode: 'auto', buzzer_enabled: true, auto_silence_seconds: 60 })
// 报警升级配置：后端 alarms.yaml 无对应持久化段，为前端表单模型
const alarmEscalation = reactive<AlarmEscalationConfig>({ enabled: false, timeout_minutes: 30, escalate_to: 'critical', notify_methods: ['sound'] as string[] })
const archiveConfig = reactive({ auto_archive: true, archive_interval_days: 7, retention_days: 90, compress_archived: true })
const archiveLoading = ref(false)

// 报警输出硬件配置 (Patlite LR7 Modbus)：对应 alarm_output.signal_tower
const signalTower = reactive({
  enabled: true,
  host: '192.168.1.70',
  port: 502,
  slave_id: 1,
  do_mapping: { red_light: 0, yellow_light: 1, green_light: 2, buzzer: 5 } as Record<string, number>,
})

// 广播系统配置 (MQTT)：对应 alarms.yaml 的 broadcast 段
const broadcastConfig = reactive({
  enabled: true,
  mqtt: { broker: '192.168.1.200', port: 1883, topic_prefix: 'pa/', username: '', password: '' },
  areas: [] as string[],
})
const broadcastAreasStr = ref('车间A,车间B,仓库,办公楼')

// 日志设置
const loggingConfig = reactive({
  level: 'INFO',
  file: { enabled: true, path: 'logs/scada.log', max_size_mb: 50, backup_count: 5 },
})

const config = reactive({
  system: { name: 'SmartSCADA', port: 5000, host: '127.0.0.1', debug: false },
  collection: { interval: 5, timeout: 10, retries: 3, retry_interval: 5 },
  database: { retention_days: 30, compression: true, compression_interval: 24 },
  energy: { peak_price: 1.2, flat_price: 0.8, valley_price: 0.4, carbon_factor: 0.5 },
})

const ruleForm = reactive({ id: '', name: '', device_id: '', register_name: '', condition: '>', threshold: 0, level: 'warning', enabled: true })

// 最近一次 GET /config 的原始内容：保存时用于保留界面上未暴露的嵌套字段
const rawConfig = ref<SystemConfigFile>({})

// ===== 保存状态：对比"已落盘快照"与当前表单，避免改完未保存却看起来已保存 =====
const baseline = ref<Record<string, string>>({})
const savingSection = ref('')

function markBaseline(key: string, snapshot: unknown) {
  baseline.value = { ...baseline.value, [key]: JSON.stringify(snapshot) }
}

function saveStateOf(key: string, snapshot: unknown): 'saved' | 'dirty' | 'unknown' {
  const base = baseline.value[key]
  if (base === undefined) return 'unknown'
  return base === JSON.stringify(snapshot) ? 'saved' : 'dirty'
}

function saveStateLabel(key: string, snapshot: unknown) {
  const state = saveStateOf(key, snapshot)
  if (state === 'unknown') return '未加载'
  return state === 'dirty' ? '有未保存修改' : '已保存'
}

// 广播配置的待保存内容含 MQTT 子对象与区域字符串，单独组一个快照
const broadcastSnapshot = computed(() => ({ ...broadcastConfig, areas: broadcastAreasStr.value }))

// ===== 系统概览面板：从 /system/status 的真实字段派生 =====
// 说明：界面原先直接读 systemStatus.devices_total / devices_connected /
// alarms_active / data_collector_running，但后端 /system/status 根本不返回这四个键
// （真实结构见 展示层/api/api_system.py:38，设备在 devices、报警在 alarms.total_active_alarms、
//  采集器在 collector.running），导致面板恒显示 0 / "已停止"。此处改为读真实字段。
function deviceStatusList(): Array<Partial<{ connected: boolean }>> {
  const d = systemStatus.value?.devices
  if (!d) return []
  return Array.isArray(d) ? d : Object.values(d)
}
const devicesTotal = computed(() => deviceStatusList().length)
const devicesConnected = computed(() => deviceStatusList().filter(x => x?.connected).length)
const alarmsActive = computed(() => systemStatus.value?.alarms?.total_active_alarms ?? 0)
const collectorRunning = computed(() => !!systemStatus.value?.collector?.running)

// /health/status 的 checks 段：键=检查项名，值=是否通过（用 computed 保证模板拿到的是数组）
const healthCheckEntries = computed<Array<[string, unknown]>>(() => Object.entries(healthStatus.value ?? {}))

const dbTables = computed(() => {
  const info = dbInfo.value
  if (!info) return []
  // 后端返回扁平结构，转换为表格数据
  return [
    { name: 'realtime_data', rows: info.realtime_records || 0, size: '-' },
    { name: 'history_data', rows: info.history_records || 0, size: '-' },
    { name: 'alarm_records', rows: info.alarm_records || 0, size: '-' },
    { name: 'history_archive', rows: info.archive_records || 0, size: '-' },
  ]
})

// 等级 → 标签样式/显示名（不改变后端 alarm_level 取值）
const LEVEL_MAP: Record<string, { label: string; tag: string }> = {
  critical: { label: '严重', tag: 'tag--danger' },
  warning: { label: '警告', tag: 'tag--warning' },
  info: { label: '信息', tag: 'tag--info' },
}
function levelTag(level: string) { return LEVEL_MAP[level]?.tag || 'tag--offline' }
function levelLabel(level: string) { return LEVEL_MAP[level]?.label || level }

/**
 * 只把 source 中与 target **同名**的键回填到 target。
 * 避免两种历史问题：把响应外壳（success/config 等）写进表单模型，
 * 以及把结构不同的后端段整体 Object.assign 后又被原样 PUT 回写。
 */
function assignKnownKeys(target: Record<string, unknown>, source: unknown): void {
  if (!source || typeof source !== 'object') return
  const src = source as Record<string, unknown>
  for (const key of Object.keys(target)) {
    const v = src[key]
    if (v !== undefined) target[key] = v
  }
}

/** 把 unknown 收敛成可遍历的对象；非对象一律返回空对象（不抛错） */
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

onMounted(async () => {
  try { const data = await devicesApi.getAll(); devices.value = data.devices || [] } catch (e) { console.warn('[Config] 加载设备列表失败:', errorMessage(e)) }
  loadConfig()
  loadEnergyConfig()
  loadSystemStatus()
  loadAlarmRules()
  loadSimulationMode()
  loadHealthStatus()
  loadAlarmOutputConfig()
  loadAlarmEscalation()
  loadArchiveConfig()
  loadSignalTowerConfig()
  loadBroadcastHardwareConfig()
  loadLoggingConfig()
})

async function loadConfig() {
  try {
    const data = await systemApi.getConfig()
    if (data?.config) {
      const c = data.config
      rawConfig.value = c
      if (c.system?.name) config.system.name = c.system.name
      // Web 端口/地址/调试模式在 system.yaml 的 web 段，不在 system 段
      if (c.web) {
        if (c.web.port != null) config.system.port = c.web.port
        if (c.web.host) config.system.host = c.web.host
        if (c.web.debug != null) config.system.debug = !!c.web.debug
      }
      // 采集设置：后端键名是 default_interval / retry.max_attempts / retry.interval_seconds
      if (c.collection) {
        if (c.collection.default_interval != null) config.collection.interval = c.collection.default_interval
        if (c.collection.timeout != null) config.collection.timeout = c.collection.timeout
        if (c.collection.retry?.max_attempts != null) config.collection.retries = c.collection.retry.max_attempts
        if (c.collection.retry?.interval_seconds != null) config.collection.retry_interval = c.collection.retry.interval_seconds
      }
      // 数据库设置：后端键名是 retention.raw_data_days / compression.enabled / compression.interval_hours
      if (c.database) {
        if (c.database.retention?.raw_data_days != null) config.database.retention_days = c.database.retention.raw_data_days
        if (c.database.compression?.enabled != null) config.database.compression = !!c.database.compression.enabled
        if (c.database.compression?.interval_hours != null) config.database.compression_interval = c.database.compression.interval_hours
      }
      // 仅在成功读到后端配置时记录基线，否则加载失败会误显示"已保存"
      markBaseline('system', config.system)
      markBaseline('collection', config.collection)
      markBaseline('database', config.database)
    }
  } catch (e) { console.warn('[Config] 加载系统配置失败:', errorMessage(e)) }
}

// 电价/碳排因子存在 energy.yaml，由 /industry40/energy/tariff 读写（system.yaml 无 energy 段）
async function loadEnergyConfig() {
  try {
    // 拦截器已解开 {success, data} 信封，此处直接拿到 {tariff, tariff_periods, carbon_factor}
    const data = await industry40Api.getEnergyTariff()
    const t = data?.tariff
    if (t) {
      if (t.peak != null) config.energy.peak_price = t.peak
      if (t.flat != null) config.energy.flat_price = t.flat
      if (t.valley != null) config.energy.valley_price = t.valley
    }
    if (data?.carbon_factor != null) config.energy.carbon_factor = data.carbon_factor
    markBaseline('energy', config.energy)
  } catch (e) { console.warn('[Config] 加载电价配置失败:', errorMessage(e)) }
}

async function loadSystemStatus() {
  try {
    const [s, d] = await Promise.all([systemApi.getStatus(), systemApi.getDatabase()])
    systemStatus.value = s
    dbInfo.value = d
  } catch (e) { console.warn('[Config] 加载系统状态失败:', errorMessage(e)) }
}

async function loadAlarmRules() {
  try { const data = await alarmsApi.getRules(); alarmRules.value = data.rules || [] } catch (e) { console.warn('[Config] 加载报警规则失败:', errorMessage(e)) }
}

// 界面「按段保存」用的配置段名 → 表单模型查表。
// 显式分支而非 `(config as any)[section]`：让段名与模型字段在类型层对齐，
// 段名写错时编译期即可发现。
const CONFIG_SECTIONS = ['system', 'collection', 'database', 'energy'] as const
type ConfigSectionName = typeof CONFIG_SECTIONS[number]

function configSectionOf(name: string): Record<string, unknown> | undefined {
  switch (name as ConfigSectionName) {
    case 'system': return config.system
    case 'collection': return config.collection
    case 'database': return config.database
    case 'energy': return config.energy
    default: return undefined
  }
}

// 按后端实际 YAML 结构组装配置段（键名对齐 system.yaml，避免写入无效键甚至把 dict 覆盖成 bool）
function buildPayload(section: string): Record<string, unknown> {
  if (section === 'collection') {
    return {
      default_interval: config.collection.interval,
      timeout: config.collection.timeout,
      retry: {
        ...(rawConfig.value?.collection?.retry || {}),
        max_attempts: config.collection.retries,
        interval_seconds: config.collection.retry_interval,
      },
    }
  }
  if (section === 'database') {
    return {
      retention: { ...(rawConfig.value?.database?.retention || {}), raw_data_days: config.database.retention_days },
      compression: {
        ...(rawConfig.value?.database?.compression || {}),
        enabled: config.database.compression,
        interval_hours: config.database.compression_interval,
      },
    }
  }
  return { ...(configSectionOf(section) || {}) }
}

// 只负责发请求，失败向上抛，由调用方决定提示方式
async function persistSection(section: string) {
  if (section === 'energy') {
    await industry40Api.setEnergyTariff({
      tariff: {
        peak: config.energy.peak_price,
        flat: config.energy.flat_price,
        valley: config.energy.valley_price,
      },
      carbon_factor: config.energy.carbon_factor,
    })
    return
  }
  if (section === 'system') {
    // 名称在 system 段，Web 端口/地址/调试在 web 段，不能混写
    await systemApi.saveConfig('system', { name: config.system.name })
    await systemApi.saveConfig('web', { port: config.system.port, host: config.system.host, debug: config.system.debug })
    return
  }
  await systemApi.saveConfig(section, buildPayload(section))
}

async function saveConfig(section: string) {
  savingSection.value = section
  try {
    await persistSection(section)
    markBaseline(section, configSectionOf(section))
    ElMessage.success('配置已保存')
  } catch (e) { showActionError('保存配置', e) }
  finally { savingSection.value = '' }
}

function showRuleDialog() {
  isEditRule.value = false
  Object.assign(ruleForm, { id: '', name: '', device_id: '', register_name: '', condition: '>', threshold: 0, level: 'warning', enabled: true })
  ruleDialogVisible.value = true
}

function editRule(rule: AlarmRule) {
  isEditRule.value = true
  Object.assign(ruleForm, rule)
  ruleDialogVisible.value = true
}

async function saveRule() {
  try {
    if (isEditRule.value) {
      await alarmsApi.updateRule(ruleForm.id, ruleForm)
    } else {
      await alarmsApi.createRule(ruleForm)
    }
    ElMessage.success('规则已保存')
    ruleDialogVisible.value = false
    loadAlarmRules()
  } catch (e) { showActionError('保存规则', e) }
}

async function deleteRule(id: string) {
  try { await alarmsApi.deleteRule(id); ElMessage.success('规则已删除'); loadAlarmRules() } catch (e) { showActionError('删除规则', e) }
}

async function toggleRule(rule: AlarmRule) {
  try {
    await alarmsApi.updateRule(rule.id, { enabled: rule.enabled })
    ElMessage.success(rule.enabled ? '规则已启用' : '规则已禁用')
  } catch (e) {
    rule.enabled = !rule.enabled
    showActionError('切换规则', e)
  }
}

async function loadSimulationMode() {
  try {
    const data = await systemApi.getSimulationMode()
    simulationMode.value = data.simulation_mode
  } catch (e) { console.warn('[Config] 加载模拟模式失败:', errorMessage(e)) }
}

async function toggleSimulationMode(val: boolean) {
  try {
    const modeName = val ? '模拟模式' : '实时模式'
    await ElMessageBox.confirm(
      `确定切换到${modeName}？${val ? '切换后将停止真实设备数据采集。' : '切换后将开始与真实设备通信。'}`,
      '切换运行模式',
      { confirmButtonText: '确定切换', cancelButtonText: '取消', type: 'warning' }
    )
    await systemApi.setSimulationMode(val)
    ElMessage.success(`已切换为${modeName}`)
  } catch (e) {
    // ElMessageBox 取消时 reject 的是字符串 'cancel'（非 Error）
    if (e === 'cancel') { simulationMode.value = !val; return }
    console.error('[Config] 切换模式失败:', e)
    simulationMode.value = !val
    ElMessage.error('切换模式失败: ' + errorMessage(e))
  }
}

async function loadHealthStatus() {
  try {
    const data = await systemApi.getHealth()
    healthStatus.value = asRecord(data.checks || data)
  } catch (e) { console.warn('[Config] 健康状态加载失败:', errorMessage(e)) }
}

async function loadAlarmOutputConfig() {
  try {
    // 后端返回 {success, config}（api_alarms.py:328）。原实现把**整个响应**塞进表单模型，
    // 会让 success/config 两个键混进表单并随保存原样 PUT 回后端；这里改读 config 段并按同名键回填。
    const data = await alarmsApi.getAlarmOutputConfig()
    assignKnownKeys(alarmOutputConfig, data?.config)
    markBaseline('alarmOutput', alarmOutputConfig)
  } catch (e) { console.warn('[Config] 报警输出配置加载失败:', errorMessage(e)) }
}

async function saveAlarmOutputConfig() {
  savingSection.value = 'alarmOutput'
  try {
    await alarmsApi.setAlarmOutputConfig(alarmOutputConfig)
    markBaseline('alarmOutput', alarmOutputConfig)
    ElMessage.success('报警输出配置已保存')
  } catch (e) { showActionError('保存报警输出配置', e) }
  finally { savingSection.value = '' }
}

async function loadAlarmEscalation() {
  try {
    // 原实读 data.escalation：该接口响应是 {success, config}，escalation 在 config 段内。
    // 后端 alarm_output 段当前并不含 escalation，故实际仍为空——缺口见报告。
    const data = await alarmsApi.getAlarmOutputConfig()
    assignKnownKeys(alarmEscalation, data?.config?.escalation)
    markBaseline('alarmEscalation', alarmEscalation)
  } catch (e) { console.warn('[Config] 报警升级配置加载失败:', errorMessage(e)) }
}

async function saveAlarmEscalation() {
  savingSection.value = 'alarmEscalation'
  try {
    await systemApi.saveConfig('alarm_escalation', { ...alarmEscalation })
    markBaseline('alarmEscalation', alarmEscalation)
    ElMessage.success('报警升级配置已保存')
  } catch (e) { showActionError('保存报警升级配置', e) }
  finally { savingSection.value = '' }
}

function loadArchiveConfig() {
  // 归档配置在 loadConfig 中已统一拉取，此处从 config reactive 中读取
  // 如果 loadConfig 中没有 archive 段，尝试单独拉取
  // 注意：配置/system.yaml 当前**没有 archive 段**，后端 PUT /config 也会因
  // "配置段 archive 不存在" 返回 400（api_system.py:166），即该面板的读写均无后端支撑。
  // 这里只修正读取层级并保持原「读不到就保持默认值」的行为，缺口见报告。
  systemApi.getConfig().then(data => {
    assignKnownKeys(archiveConfig, data?.config?.archive)
    markBaseline('archive', archiveConfig)
  }).catch((e) => { console.warn('[Config] 归档配置加载失败:', errorMessage(e)) })
}

async function saveArchiveConfig() {
  savingSection.value = 'archive'
  try {
    await systemApi.saveConfig('archive', archiveConfig)
    markBaseline('archive', archiveConfig)
    ElMessage.success('归档策略已保存')
  } catch (e) { showActionError('保存归档策略', e) }
  finally { savingSection.value = '' }
}

async function triggerArchive() {
  archiveLoading.value = true
  try {
    await systemApi.saveConfig('archive_trigger', { action: 'archive_now' })
    ElMessage.success('归档任务已触发')
  } catch (e) { showActionError('触发归档', e) }
  finally { archiveLoading.value = false }
}

// ========== 报警输出硬件配置 ==========
async function loadSignalTowerConfig() {
  try {
    const data = await alarmsApi.getAlarmOutputConfig()
    const cfg = data?.config
    if (cfg) {
      // 有 signal_tower 段就用它，否则退化为整个 alarm_output 段（保留原实现语义）
      const st: ModbusOutputDevice & { enabled?: boolean } = cfg.signal_tower || cfg
      if (st.enabled !== undefined) signalTower.enabled = st.enabled
      if (st.host) signalTower.host = st.host
      if (st.port) signalTower.port = st.port
      if (st.slave_id) signalTower.slave_id = st.slave_id
      if (st.do_mapping) Object.assign(signalTower.do_mapping, st.do_mapping)
    }
    markBaseline('signalTower', signalTower)
  } catch (e) { console.warn('[Config] 光柱配置加载失败:', errorMessage(e)) }
}

async function saveSignalTower() {
  savingSection.value = 'signalTower'
  try {
    await alarmsApi.setAlarmOutputConfig({
      enabled: signalTower.enabled,
      signal_tower: { host: signalTower.host, port: signalTower.port, slave_id: signalTower.slave_id, do_mapping: { ...signalTower.do_mapping } },
    })
    markBaseline('signalTower', signalTower)
    ElMessage.success('报警输出硬件配置已保存')
  } catch (e) { showActionError('保存报警输出硬件配置', e) }
  finally { savingSection.value = '' }
}

// ========== 广播系统硬件配置 ==========
async function loadBroadcastHardwareConfig() {
  try {
    const data = await alarmsApi.getBroadcastConfig()
    const bc: BroadcastConfig | undefined = data?.config
    if (bc) {
      if (bc.enabled !== undefined) broadcastConfig.enabled = bc.enabled
      if (bc.mqtt) Object.assign(broadcastConfig.mqtt, bc.mqtt)
      if (bc.areas && Array.isArray(bc.areas)) {
        broadcastConfig.areas = bc.areas
        broadcastAreasStr.value = bc.areas.join(',')
      }
    }
    markBaseline('broadcast', broadcastSnapshot.value)
  } catch (e) { console.warn('[Config] 广播配置加载失败:', errorMessage(e)) }
}

async function saveBroadcastHardware() {
  savingSection.value = 'broadcast'
  try {
    const areas = broadcastAreasStr.value.split(',').map(s => s.trim()).filter(Boolean)
    await alarmsApi.setBroadcastConfig({ enabled: broadcastConfig.enabled, mqtt: { ...broadcastConfig.mqtt }, areas })
    markBaseline('broadcast', broadcastSnapshot.value)
    ElMessage.success('广播系统配置已保存')
  } catch (e) { showActionError('保存广播配置', e) }
  finally { savingSection.value = '' }
}

// ========== 日志设置 ==========
async function loadLoggingConfig() {
  try {
    const data = await systemApi.getConfig()
    const lc = data?.config?.logging
    if (lc) {
      if (lc.level) loggingConfig.level = lc.level
      if (lc.file) Object.assign(loggingConfig.file, lc.file)
    }
    markBaseline('logging', loggingConfig)
  } catch (e) { console.warn('[Config] 日志配置加载失败:', errorMessage(e)) }
}

async function saveLoggingConfig() {
  savingSection.value = 'logging'
  try {
    await systemApi.saveConfig('logging', { level: loggingConfig.level, file: { ...loggingConfig.file } })
    markBaseline('logging', loggingConfig)
    ElMessage.success('日志设置已保存')
  } catch (e) { showActionError('保存日志配置', e) }
  finally { savingSection.value = '' }
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `smartscada-config-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立即 revoke 有概率把尚未开始的下载取消掉，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  ElMessage.success('配置已导出')
}

function importConfig() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object') { ElMessage.warning('配置文件格式错误'); return }
      const imported = parsed as Record<string, unknown>
      // 安全校验：只接受已知配置段，防止原型链污染
      const matchedSections = CONFIG_SECTIONS.filter(s => {
        const v = imported[s]
        return !!v && typeof v === 'object' && v !== null
      })
      if (matchedSections.length === 0) { ElMessage.warning('配置文件中没有可识别的配置段'); return }
      // 确认对话框：显示将导入的配置段
      await ElMessageBox.confirm(
        `将导入以下配置段: ${matchedSections.join(', ')}\n这会覆盖当前配置，确定继续？`,
        '导入配置',
        { confirmButtonText: '确定导入', cancelButtonText: '取消', type: 'warning' }
      )
      for (const section of matchedSections) {
        const dst = configSectionOf(section)
        const rawSrc = imported[section]
        if (!dst || !rawSrc || typeof rawSrc !== 'object') continue
        const src = rawSrc as Record<string, unknown>
        // 只覆盖界面上已知的字段，忽略 __proto__ 等危险键和未知键
        for (const key of Object.keys(dst)) {
          if (Object.prototype.hasOwnProperty.call(src, key)) dst[key] = src[key]
        }
      }
      // 逐段保存，按后端真实结构落盘；汇总失败段，避免"看起来已保存"
      const failed: string[] = []
      for (const section of matchedSections) {
        try { await persistSection(section); markBaseline(section, configSectionOf(section)) } catch (err) {
          console.warn(`[Config] 导入段 ${section} 保存失败:`, errorMessage(err))
          failed.push(section)
        }
      }
      await loadConfig()
      if (failed.length) ElMessage.error(`配置已导入，但以下配置段保存失败: ${failed.join(', ')}`)
      else ElMessage.success('配置已导入并保存')
    } catch (e) {
      if (e === 'cancel' || e === 'close') return   // 用户取消导入不算错误
      console.error('[Config] 导入失败:', e)
      ElMessage.error('配置文件格式错误: ' + errorMessage(e))
    }
  }
  input.click()
}
</script>

<style scoped>
.config-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--bg-page);
  color: var(--text-primary);
}

.panel__meta {
  font-size: var(--font-xs);
  font-weight: var(--weight-normal);
  color: var(--text-muted);
}

/* 分区卡片：嵌套在外层 tab 容器内，去掉阴影避免层叠过重 */
.section {
  box-shadow: none;
  border-radius: var(--radius-md);
  margin-bottom: var(--space-4);
}

.section:last-child { margin-bottom: 0; }

.section__foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-base);
  background: var(--bg-sunken);
  border-radius: 0 0 var(--radius-md) var(--radius-md);
}

.section__action { margin-bottom: var(--space-3); }

/* ===== 保存状态指示 ===== */
.save-state {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
  margin-left: auto;
}

.save-state--saved {
  background: var(--color-success-soft);
  color: var(--color-success);
}

.save-state--dirty {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.save-state--unknown {
  background: var(--bg-hover);
  color: var(--text-muted);
}

/* ===== 表单 ===== */
.config-form :deep(.el-form-item__label) {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  line-height: var(--leading-base);
}

.config-form :deep(.el-form-item) {
  margin-bottom: var(--space-4);
  align-items: center;
}

.config-form :deep(.el-form-item__content) {
  font-size: var(--font-base);
  gap: var(--space-2);
}

.config-form--narrow { max-width: 660px; }

.field-hint {
  font-size: var(--font-xs);
  color: var(--text-muted);
  line-height: var(--leading-base);
}

.form-section-title {
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  margin: var(--space-2) 0 var(--space-3);
  padding-left: var(--space-2);
  border-left: 3px solid var(--color-brand);
}

/* ===== 栅格 ===== */
.split-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: var(--space-4);
}

.split-grid--tight { gap: var(--space-4); grid-template-columns: minmax(320px, 1fr) minmax(240px, 320px); }

@media (max-width: 1000px) {
  .split-grid--tight { grid-template-columns: 1fr; }
}

/* ===== 费率预览 ===== */
.rate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);
}

.rate-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
}

.rate-value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-xl);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

/* ===== 归档统计 ===== */
.archive-stats {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
}

.archive-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.archive-stat__value {
  font-size: var(--font-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

/* ===== 表格 ===== */
.data-table { width: 100%; }

.data-table :deep(.el-table__header th.el-table__cell) {
  background: var(--bg-sunken);
  color: var(--text-secondary);
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
}

.data-table :deep(.el-table__body td.el-table__cell) {
  font-size: var(--font-sm);
  color: var(--text-primary);
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

/* ===== 行操作 ===== */
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  white-space: nowrap;
}

.row-actions__sep {
  width: 1px;
  height: 14px;
  background: var(--border-base);
  flex: none;
}

.btn-danger-link { color: var(--color-danger); }

.btn-danger-link:hover {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

/* ===== 健康列表 ===== */
.health-list {
  display: flex;
  flex-direction: column;
}

.health-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-base);
}

.health-row:last-child { border-bottom: none; }

.health-key {
  font-size: var(--font-sm);
  color: var(--text-primary);
}
</style>
