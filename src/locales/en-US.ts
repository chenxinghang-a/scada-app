export default {
  // Common
  common: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    search: 'Search',
    reset: 'Reset',
    loading: 'Loading...',
    noData: 'No Data',
    success: 'Success',
    failed: 'Failed',
    warning: 'Warning',
    error: 'Error',
    yes: 'Yes',
    no: 'No',
  },

  // Navigation
  nav: {
    dashboard: 'Dashboard',
    devices: 'Devices',
    control: 'Control',
    history: 'History',
    alarms: 'Alarms',
    alarmOutput: 'Alarm Output',
    industry40: 'Industry 4.0',
    config: 'Configuration',
    users: 'Users',
    screen: 'Data Screen',
  },

  // Login
  login: {
    title: 'SmartSCADA',
    subtitle: 'Industrial Data Acquisition & Monitoring System',
    username: 'Username',
    password: 'Password',
    login: 'Sign In',
    loggingIn: 'Signing in...',
    rememberMe: 'Remember me',
    forgotPassword: 'Forgot password?',
    defaultAccount: 'Default account',
  },

  // Dashboard
  dashboard: {
    onlineDevices: 'Online Devices',
    offlineDevices: 'Offline Devices',
    activeAlarms: 'Active Alarms',
    dataCollection: 'Data Collection',
    systemStatus: 'System Status',
    realtimeData: 'Realtime Data',
    trendChart: 'Trend Chart',
    deviceGrid: 'Device Grid',
  },

  // Devices
  devices: {
    deviceId: 'Device ID',
    deviceName: 'Device Name',
    protocol: 'Protocol',
    address: 'Address',
    status: 'Status',
    dataPoints: 'Data Points',
    online: 'Online',
    offline: 'Offline',
    addDevice: 'Add Device',
    editDevice: 'Edit Device',
    deleteDevice: 'Delete Device',
    testConnection: 'Test Connection',
    viewData: 'View Data',
    presets: 'Presets',
    addAllPresets: 'Add All Presets',
  },

  // Control
  control: {
    writeRegister: 'Write Register',
    writeCoil: 'Write Coil',
    emergencyStop: 'Emergency Stop',
    resetEStop: 'Reset E-Stop',
    batchControl: 'Batch Control',
    startAll: 'Start All',
    stopAll: 'Stop All',
    resetAll: 'Reset All',
    interlocks: 'Interlocks',
    bypass: 'Bypass',
    restore: 'Restore',
  },

  // History
  history: {
    query: 'Query',
    export: 'Export',
    timeRange: 'Time Range',
    register: 'Register',
    interval: 'Interval',
    rawData: 'Raw',
    lastHour: '1 Hour',
    lastDay: '24 Hours',
    lastWeek: '7 Days',
  },

  // Alarms
  alarms: {
    alarmId: 'Alarm ID',
    device: 'Device',
    level: 'Level',
    message: 'Message',
    threshold: 'Threshold',
    actualValue: 'Actual Value',
    status: 'Status',
    acknowledge: 'Acknowledge',
    acknowledged: 'Acknowledged',
    unacknowledged: 'Unacknowledged',
    critical: 'Critical',
    warning: 'Warning',
    info: 'Info',
  },

  // Config
  config: {
    system: 'System',
    collection: 'Collection',
    database: 'Database',
    alarms: 'Alarm Rules',
    energy: 'Energy',
    status: 'System Status',
    alarmHardware: 'Alarm Hardware',
    logging: 'Logging',
    ops: 'Operations',
  },

  // Users
  users: {
    username: 'Username',
    displayName: 'Display Name',
    role: 'Role',
    admin: 'Admin',
    engineer: 'Engineer',
    operator: 'Operator',
    viewer: 'Viewer',
    addUser: 'Add User',
    editUser: 'Edit User',
    deleteUser: 'Delete User',
    resetPassword: 'Reset Password',
    operationLogs: 'Operation Logs',
  },

  // Industry 4.0
  industry40: {
    predictiveMaintenance: 'Predictive Maintenance',
    oee: 'OEE',
    spc: 'SPC',
    energy: 'Energy Management',
    edgeDecision: 'Edge Decision',
    vibration: 'Vibration Analysis',
    healthScore: 'Health Score',
    availability: 'Availability',
    performance: 'Performance',
    quality: 'Quality',
  },

  // Errors
  errors: {
    networkError: 'Network connection failed, please check if backend is running',
    unauthorized: 'Session expired, please login again',
    forbidden: 'Permission denied',
    notFound: 'Resource not found',
    serverError: 'Internal server error',
    timeout: 'Request timeout',
    unknown: 'Unknown error',
  },
}
