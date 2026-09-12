; Второй ярлык — сразу режим Vanilla и зелёная иконка-небула.
; Основной ярлык (фиолетовый) electron-builder создаёт сам из nsis.shortcutName,
; а этот режим задаётся аргументом --mode=vanilla, который main.js превращает
; в ?mode=vanilla для интерфейса.
;
; Иконки лежат в resources/app, потому что сборка идёт с asar: false.

!macro customInstall
  CreateShortCut "$DESKTOP\vulkan launcher (Vanilla).lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--mode=vanilla" "$INSTDIR\resources\app\icon-vanilla.ico" 0
  CreateShortCut "$SMPROGRAMS\vulkan launcher (Vanilla).lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--mode=vanilla" "$INSTDIR\resources\app\icon-vanilla.ico" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\vulkan launcher (Vanilla).lnk"
  Delete "$SMPROGRAMS\vulkan launcher (Vanilla).lnk"
!macroend
