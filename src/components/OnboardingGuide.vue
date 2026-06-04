<template>
  <el-dialog
    v-model="visible"
    title="欢迎使用 SmartSCADA"
    width="600px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
  >
    <div class="onboarding-content">
      <!-- 步骤指示器 -->
      <el-steps :active="currentStep" finish-status="success" align-center>
        <el-step title="欢迎" />
        <el-step title="设备管理" />
        <el-step title="数据监控" />
        <el-step title="报警管理" />
      </el-steps>

      <!-- 步骤内容 -->
      <div class="step-content">
        <!-- 步骤0: 欢迎 -->
        <div v-if="currentStep === 0" class="step-welcome">
          <h3>👋 欢迎使用 SmartSCADA</h3>
          <p>这是一个工业级数据采集与监控系统，帮助您：</p>
          <ul>
            <li>📊 实时监控设备状态和数据</li>
            <li>🔔 接收和管理报警通知</li>
            <li>📈 分析历史趋势和性能指标</li>
            <li>⚙️ 远程控制和配置设备</li>
          </ul>
        </div>

        <!-- 步骤1: 设备管理 -->
        <div v-if="currentStep === 1" class="step-devices">
          <h3>🔧 设备管理</h3>
          <p>在"设备管理"页面，您可以：</p>
          <ul>
            <li>添加新设备（支持Modbus、OPC UA、MQTT等协议）</li>
            <li>配置设备参数和寄存器</li>
            <li>测试设备连接状态</li>
            <li>查看设备实时数据</li>
          </ul>
          <el-alert type="info" :closable="false">
            提示：使用"预设设备"可以快速添加常见工业设备
          </el-alert>
        </div>

        <!-- 步骤2: 数据监控 -->
        <div v-if="currentStep === 2" class="step-monitoring">
          <h3>📊 数据监控</h3>
          <p>在"仪表盘"页面，您可以：</p>
          <ul>
            <li>查看所有设备的实时状态</li>
            <li>监控关键参数的趋势图</li>
            <li>导出历史数据进行分析</li>
            <li>查看系统运行状态</li>
          </ul>
          <el-alert type="info" :closable="false">
            提示：点击设备卡片可以查看详细数据
          </el-alert>
        </div>

        <!-- 步骤3: 报警管理 -->
        <div v-if="currentStep === 3" class="step-alarms">
          <h3>🔔 报警管理</h3>
          <p>在"报警管理"页面，您可以：</p>
          <ul>
            <li>查看所有报警记录</li>
            <li>确认和处理报警</li>
            <li>配置报警规则和阈值</li>
            <li>设置声光报警和广播通知</li>
          </ul>
          <el-alert type="warning" :closable="false">
            重要：及时处理报警可以避免设备损坏和安全事故
          </el-alert>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button v-if="currentStep > 0" @click="prevStep">上一步</el-button>
        <el-button v-if="currentStep < 3" type="primary" @click="nextStep">下一步</el-button>
        <el-button v-if="currentStep === 3" type="primary" @click="finish">
          开始使用
        </el-button>
        <el-button v-if="currentStep === 0" text @click="skip">跳过引导</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const visible = ref(false)
const currentStep = ref(0)

// 检查是否需要显示引导
onMounted(() => {
  const hasSeenGuide = localStorage.getItem('scada_onboarding_complete')
  if (!hasSeenGuide) {
    visible.value = true
  }
})

function nextStep() {
  if (currentStep.value < 3) {
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

function finish() {
  localStorage.setItem('scada_onboarding_complete', 'true')
  visible.value = false
}

function skip() {
  localStorage.setItem('scada_onboarding_complete', 'true')
  visible.value = false
}
</script>

<style scoped>
.onboarding-content {
  padding: 20px 0;
}

.step-content {
  margin-top: 30px;
  min-height: 200px;
}

.step-welcome h3,
.step-devices h3,
.step-monitoring h3,
.step-alarms h3 {
  font-size: 18px;
  margin-bottom: 16px;
  color: #303133;
}

.step-content ul {
  list-style: none;
  padding: 0;
}

.step-content li {
  padding: 8px 0;
  font-size: 14px;
  color: #606266;
}

.step-content li::before {
  content: '';
}

.dialog-footer {
  display: flex;
  justify-content: space-between;
}

.el-alert {
  margin-top: 16px;
}
</style>
