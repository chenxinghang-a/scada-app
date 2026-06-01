; SmartSCADA NSIS 安装前环境检查脚本
; 检查 Windows 版本、磁盘空间、端口占用

!macro customInit
  ; 检查 Windows 版本（需要 Win10+）
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "SmartSCADA 需要 Windows 10 或更高版本。$\n$\n当前系统版本不支持，请升级后再安装。"
    Abort
  ${EndIf}

  ; 检查磁盘空间（至少 500MB）
  ${GetRoot} "$INSTDIR" $0
  ${DriveSpace} "$0\" "/D=F /S=M" $1
  ${If} $1 < 500
    MessageBox MB_OK|MB_ICONSTOP "磁盘空间不足。$\n$\nSmartSCADA 需要至少 500MB 可用空间，当前仅剩 $1MB。"
    Abort
  ${EndIf}

  ; 检查端口 5000 是否被占用
  nsExec::ExecToStack 'cmd /c netstat -ano | findstr ":5000 "'
  Pop $0
  Pop $1
  ${If} $0 == 0
    MessageBox MB_YESNO|MB_ICONQUESTION "检测到端口 5000 已被占用。$\n$\nSmartSCADA 后端服务需要使用此端口。$\n是否继续安装？（启动时会自动检测并提示）" IDYES continueInstall IDNO abortInstall
    abortInstall:
      Abort
    continueInstall:
  ${EndIf}
!macroend

!macro customInstallMode
  ; 默认选择当前用户安装
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customHeader
  ; 安装器头部文字
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 SmartSCADA"
  !define MUI_WELCOMEPAGE_TEXT "SmartSCADA 是一套工业级数据采集与监控系统。$\n$\n支持 Modbus/OPC UA/MQTT/三菱MC/欧姆龙FINS 等多协议。$\n$\n安装前请确保：$\n  - Windows 10 或更高版本$\n  - 至少 500MB 可用磁盘空间$\n  - 端口 5000 未被其他程序占用$\n$\n点击下一步继续安装。"
!macroend
