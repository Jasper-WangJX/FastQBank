; Custom NSIS configuration for FastQBank.
;
; Phase 10 polish — three behaviors layered on top of electron-builder's
; default NSIS wizard:
;   1. Auto-nest the install under \FastQBank (avoid dumping into a
;      generic parent like D:\Apps).
;   2. Ask the user (per shortcut) whether to create it.
;   3. On uninstall, also delete %APPDATA%\FastQBank so login state
;      doesn't survive across reinstall.

!include "FileFunc.nsh"
!include "LogicLib.nsh"

; ---------------------------------------------------------------
; Goal 1: ensure $INSTDIR ends with \FastQBank.
;
; .onVerifyInstDir is called by NSIS to validate the install path.
; If the leaf isn't FastQBank, append it. The check guards against
; re-appending if the user already typed it.
; ---------------------------------------------------------------
Function .onVerifyInstDir
  Push $0
  ${GetFileName} $INSTDIR $0
  ${If} $0 != "FastQBank"
    StrCpy $INSTDIR "$INSTDIR\FastQBank"
  ${EndIf}
  Pop $0
FunctionEnd

; ---------------------------------------------------------------
; Goal 2: shortcut choice via MessageBox during install.
;
; electron-builder's template normally calls CreateShortCut based on
; createDesktopShortcut / createStartMenuShortcut in package.json.
; We have set both to false there, and re-implement here so each is
; user-controllable.
;
; /SD IDYES = silent install (auto-install) picks Yes.
; ---------------------------------------------------------------
!macro customInstall
  ; Desktop shortcut
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Create a Desktop shortcut for FastQBank?" \
    /SD IDYES IDNO skipDesktop
    CreateShortCut "$DESKTOP\FastQBank.lnk" "$INSTDIR\FastQBank.exe"
  skipDesktop:

  ; Start Menu shortcut
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Create a Start Menu shortcut for FastQBank?" \
    /SD IDYES IDNO skipStartMenu
    CreateDirectory "$SMPROGRAMS\FastQBank"
    CreateShortCut "$SMPROGRAMS\FastQBank\FastQBank.lnk" "$INSTDIR\FastQBank.exe"
  skipStartMenu:
!macroend

; ---------------------------------------------------------------
; Goal 3: wipe user data on uninstall.
;
; Electron stores localStorage / IndexedDB under %APPDATA%\FastQBank.
; (And %LOCALAPPDATA%\FastQBank for some caches.) Removing both makes
; "uninstall then reinstall" return the user to a clean, logged-out
; first launch.
; ---------------------------------------------------------------
!macro customUnInstall
  RMDir /r "$APPDATA\FastQBank"
  RMDir /r "$LOCALAPPDATA\FastQBank"

  ; Also remove the Start Menu folder if we created one.
  Delete "$SMPROGRAMS\FastQBank\FastQBank.lnk"
  RMDir "$SMPROGRAMS\FastQBank"
  Delete "$DESKTOP\FastQBank.lnk"
!macroend
