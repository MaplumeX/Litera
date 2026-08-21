; Litera NSIS installer hooks for the Windows thumbnail provider DLL.
;
; The DLL is bundled via tauri.conf.json `bundle.resources` and lands at
; `$INSTDIR\windows_thumbnail.dll`.  These hooks register/unregister it
; automatically so the user does not need to run regsvr32 manually.

!macro NSIS_HOOK_POSTINSTALL
  ; Register thumbnail provider DLL
  ExecWait 'regsvr32 /s "$INSTDIR\windows_thumbnail.dll"' $0
  ${If} $0 != 0
    DetailPrint "Thumbnail provider registration failed (code: $0)"
  ${Else}
    DetailPrint "Thumbnail provider registered"
    ; Refresh Explorer thumbnails
    ExecWait 'ie4uinit.exe -show' $0
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Unregister thumbnail provider DLL
  ExecWait 'regsvr32 /s /u "$INSTDIR\windows_thumbnail.dll"' $0
!macroend