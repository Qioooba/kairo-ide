!define PRODUCT_NAME "Kairo IDE"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "Kairo Team"
!define PRODUCT_WEB_SITE "https://kairo-ide.dev"
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\KairoIDE.exe"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

SetCompressor lzma

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "KairoIDE-Setup-${PRODUCT_VERSION}.exe"
InstallDir "$PROGRAMFILES\Kairo IDE"
InstallDirRegKey HKLM "${PRODUCT_DIR_REGKEY}" ""
RequestExecutionLevel admin

Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  SetOverwrite on
  
  File /r "dist\win\*.*"
  
  CreateDirectory "$SMPROGRAMS\Kairo IDE"
  CreateShortCut "$SMPROGRAMS\Kairo IDE\Kairo IDE.lnk" "$INSTDIR\KairoIDE.exe"
  CreateShortCut "$DESKTOP\Kairo IDE.lnk" "$INSTDIR\KairoIDE.exe"
  
  WriteRegStr HKLM "${PRODUCT_DIR_REGKEY}" "" "$INSTDIR\KairoIDE.exe"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayName" "$(^Name)"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninst.exe"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  
  WriteUninstaller "$INSTDIR\uninst.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\*.*"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\Kairo IDE\Kairo IDE.lnk"
  Delete "$DESKTOP\Kairo IDE.lnk"
  RMDir "$SMPROGRAMS\Kairo IDE"
  DeleteRegKey HKLM "${PRODUCT_UNINST_KEY}"
  DeleteRegKey HKLM "${PRODUCT_DIR_REGKEY}"
SectionEnd