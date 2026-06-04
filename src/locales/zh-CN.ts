export default {
  // 通用
  common: {
    confirm: '确认',
    cancel: '取消',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    add: '添加',
    search: '搜索',
    reset: '重置',
    loading: '加载中...',
    noData: '暂无数据',
    success: '操作成功',
    failed: '操作失败',
    warning: '警告',
    error: '错误',
    yes: '是',
    no: '否',
  },

  // 导航
  nav: {
    dashboard: '仪表盘',
    devices: '设备管理',
    control: '设备控制',
    history: '历史数据',
    alarms: '报警管理',
    alarmOutput: '报警输出',
    industry40: '工业4.0',
    config: '系统配置',
    users: '用户管理',
    screen: '数据大屏',
  },

  // 登录
  login: {
    title: 'SmartSCADA',
    subtitle: '工业数据采集与监控系统',
    username: '用户名',
    password: '密码',
    login: '登 录',
    loggingIn: '登录中...',
    rememberMe: '记住我',
    forgotPassword: '忘记密码?',
    defaultAccount: '默认账号',
  },

  // 仪表盘
  dashboard: {
    onlineDevices: '在线设备',
    offlineDevices: '离线设备',
    activeAlarms: '活跃报警',
    dataCollection: '数据采集',
    systemStatus: '系统状态',
    realtimeData: '实时数据',
    trendChart: '趋势图',
    deviceGrid: '设备网格',
  },

  // 设备管理
  devices: {
    deviceId: '设备ID',
    deviceName: '设备名称',
    protocol: '协议',
    address: '地址',
    status: '状态',
    dataPoints: '数据点',
    online: '在线',
    offline: '离线',
    addDevice: '添加设备',
    editDevice: '编辑设备',
    deleteDevice: '删除设备',
    testConnection: '测试连接',
    viewData: '查看数据',
    presets: '预设设备',
    addAllPresets: '一键添加全部',
  },

  // 设备控制
  control: {
    writeRegister: '写入寄存器',
    writeCoil: '写入线圈',
    emergencyStop: '紧急停机',
    resetEStop: '复位急停',
    batchControl: '批量控制',
    startAll: '启动全部',
    stopAll: '停止全部',
    resetAll: '重置全部',
    interlocks: '安全联锁',
    bypass: '旁路',
    restore: '恢复',
  },

  // 历史数据
  history: {
    query: '查询',
    export: '导出',
    timeRange: '时间范围',
    register: '参数',
    interval: '聚合',
    rawData: '原始',
    lastHour: '1小时',
    lastDay: '24小时',
    lastWeek: '7天',
  },

  // 报警管理
  alarms: {
    alarmId: '报警ID',
    device: '设备',
    level: '等级',
    message: '报警信息',
    threshold: '阈值',
    actualValue: '实际值',
    status: '状态',
    acknowledge: '确认',
    acknowledged: '已确认',
    unacknowledged: '未确认',
    critical: '严重',
    warning: '警告',
    info: '信息',
  },

  // 系统配置
  config: {
    system: '系统设置',
    collection: '采集设置',
    database: '数据库设置',
    alarms: '报警规则',
    energy: '能源费率',
    status: '系统状态',
    alarmHardware: '报警输出硬件',
    logging: '日志设置',
    ops: '运维管理',
  },

  // 用户管理
  users: {
    username: '用户名',
    displayName: '显示名',
    role: '角色',
    admin: '管理员',
    engineer: '工程师',
    operator: '操作员',
    viewer: '观察者',
    addUser: '添加用户',
    editUser: '编辑用户',
    deleteUser: '删除用户',
    resetPassword: '重置密码',
    operationLogs: '操作日志',
  },

  // 工业4.0
  industry40: {
    predictiveMaintenance: '预测性维护',
    oee: 'OEE',
    spc: 'SPC',
    energy: '能源管理',
    edgeDecision: '边缘决策',
    vibration: '振动分析',
    healthScore: '健康评分',
    availability: '可用性',
    performance: '性能',
    quality: '质量',
  },

  // 错误信息
  errors: {
    networkError: '网络连接失败，请检查后端服务是否启动',
    unauthorized: '登录已过期，请重新登录',
    forbidden: '权限不足',
    notFound: '资源不存在',
    serverError: '服务器内部错误',
    timeout: '请求超时',
    unknown: '未知错误',
  },
}
