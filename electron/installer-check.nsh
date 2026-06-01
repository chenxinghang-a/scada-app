; SmartSCADA NSIS 安装前环境检查脚本
; 检查 Windows 版本、磁盘空间、已有进程

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

  ; 检查 SmartSCADA 是否正在运行
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq SmartSCADA.exe" /NH'
  Pop $0
  Pop $1
  ${If} $0 == 0
    ; 找到进程，尝试关闭
    MessageBox MB_YESNO|MB_ICONQUESTION "检测到 SmartSCADA 正在运行。$\n$\n安装需要先关闭 SmartSCADA。$\n是否自动关闭并继续安装？" IDYES killApp IDNO abortInstall
    killApp:
      ; 先尝试优雅关闭（taskkill 不带 /F）
      nsExec::ExecToStack 'cmd /c taskkill /IM SmartSCADA.exe'
      Pop $0
      Sleep 2000
      ; 检查是否还在运行
      nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq SmartSCADA.exe" /NH'
      Pop $0
      Pop $1
      ${If} $0 == 0
        ; 还在运行，强制关闭
        nsExec::ExecToStack 'cmd /c taskkill /IM SmartSCADA.exe /F'
        Pop $0
        Sleep 1000
      ${EndIf}
      ; 同时关闭后端进程
      nsExec::ExecToStack 'cmd /c taskkill /IM scada-backend.exe /F'
      Pop $0
      Sleep 500
      Goto continueInstall
    abortInstall:
      Abort
    continueInstall:
  ${EndIf}

  ; 检查后端进程
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq scada-backend.exe" /NH'
  Pop $0
  Pop $1
  ${If} $0 == 0
    nsExec::ExecToStack 'cmd /c taskkill /IM scada-backend.exe /F'
    Pop $0
    Sleep 500
  ${EndIf}
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 SmartSCADA"
  !define MUI_WELCOMEPAGE_TEXT "SmartSCADA - 工业数据采集与监控系统。$\n$\n支持 Modbus/OPC UA/MQTT/三菱MC/欧姆龙FINS 等多协议。$\n$\n安装前请确保：$\n  - Windows 10 或更高版本$\n  - 至少 500MB 可用磁盘空间$\n$\n点击下一步继续安装。"
!macroend
