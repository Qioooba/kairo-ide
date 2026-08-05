!define PRODUCT_NAME "Kairo IDE"
!define PRODUCT_VERSION "0.1.0"
!define PRODUCT_PUBLISHER "Kairo Team"
; OFFLINE / AIR-GAPPED: Kairo IDE is designed for fully intranet deployment.
; Do not register a public website URL in the Windows uninstall entry;
; instead point URLInfoAbout at the offline help / local docs shipped
; inside the install root, so the "Support link" button in Programs &
; Features opens something that does not require internet access.
!define PRODUCT_WEB_SITE "file:///$INSTDIR/docs/index.html"
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
  ; Prefer explicit deletes over RMDir /r on $INSTDIR (DK-P2-6): a wrong
  ; InstallDir would otherwise recursively wipe an unintended tree.
  Delete "$INSTDIR\uninst.exe"
  Delete "$INSTDIR\KairoIDE.exe"
  Delete "$INSTDIR\*.exe"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\LICENSE*"
  Delete "$INSTDIR\version"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\docs"
  ; Remove install root only if empty after the deletes above.
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Kairo IDE\Kairo IDE.lnk"
  Delete "$DESKTOP\Kairo IDE.lnk"
  RMDir "$SMPROGRAMS\Kairo IDE"
  DeleteRegKey HKLM "${PRODUCT_UNINST_KEY}"
  DeleteRegKey HKLM "${PRODUCT_DIR_REGKEY}"
SectionEnd
