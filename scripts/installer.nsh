!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customCheckAppRunning
  InitPluginsDir
  File /oname=$PLUGINSDIR\prepare-install.ps1 "${PROJECT_DIR}\scripts\prepare-install.ps1"
  nsExec::ExecToStack '"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\prepare-install.ps1" -Action Detect -InstallDirectory "$INSTDIR" -PreviousDirectory "$perUserInstallationFolder"'
  Pop $0
  Pop $1
  ${If} $0 == 10
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Portal Desktop / Portal is running. Close it safely and continue installation? / 客户端或 Portal 正在运行，是否关闭后继续安装？" /SD IDOK IDOK +3
      SetErrorLevel 1
      Quit
    DetailPrint "Closing Portal Desktop and Portal..."
    nsExec::ExecToStack '"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\prepare-install.ps1" -Action Stop -InstallDirectory "$INSTDIR" -PreviousDirectory "$perUserInstallationFolder" -TargetVersion "${VERSION}"'
    Pop $0
    Pop $1
  ${EndIf}
  !ifndef BUILD_UNINSTALLER
    ${If} $0 == 0
      DetailPrint "Migrating previous installation..."
      nsExec::ExecToStack '"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\prepare-install.ps1" -Action Migrate -InstallDirectory "$INSTDIR"'
      Pop $0
      Pop $1
    ${EndIf}
  !endif
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Unable to close the previous client or Portal. Please exit them and retry. / 旧客户端或 Portal 未退出，请退出后重新安装。$\r$\n$1" /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend
