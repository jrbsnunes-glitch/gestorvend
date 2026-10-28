; Remove atalhos extras na área de trabalho ao (re)instalar.
; Causa típica: Setup antigo em "só este usuário" + Setup novo em "todos os usuários"
; (Desktop do perfil + Desktop público aparecem juntos na área de trabalho).

!macro GvDeleteLnkIfNotKept keepPath candidate
  ${If} `${candidate}` != `${keepPath}`
    IfFileExists `${candidate}` 0 +2
      Delete `${candidate}`
  ${EndIf}
!macroend

!macro GvPurgeDesktopCopies keepPath
  !insertmacro GvDeleteLnkIfNotKept `${keepPath}` `$DESKTOP\GestorVend.lnk`
  !insertmacro GvDeleteLnkIfNotKept `${keepPath}` `$DESKTOP\${SHORTCUT_NAME}.lnk`
  !insertmacro GvDeleteLnkIfNotKept `${keepPath}` `$DESKTOP\${PRODUCT_FILENAME}.lnk`
  !insertmacro GvDeleteLnkIfNotKept `${keepPath}` `$PROFILE\Desktop\GestorVend.lnk`
  !insertmacro GvDeleteLnkIfNotKept `${keepPath}` `$PROFILE\Desktop\${SHORTCUT_NAME}.lnk`
  !insertmacro GvDeleteLnkIfNotKept `${keepPath}` `$PROFILE\OneDrive\Desktop\GestorVend.lnk`
  !insertmacro GvDeleteLnkIfNotKept `${keepPath}` `$PROFILE\OneDrive\Desktop\${SHORTCUT_NAME}.lnk`
  !insertmacro GvDeleteLnkIfNotKept `${keepPath}` `$PROFILE\OneDrive\Área de Trabalho\GestorVend.lnk`
  !insertmacro GvDeleteLnkIfNotKept `${keepPath}` `$PROFILE\OneDrive\Área de Trabalho\${SHORTCUT_NAME}.lnk`
!macroend

!macro customInstall
  SetShellVarContext current
  !insertmacro GvPurgeDesktopCopies `$newDesktopLink`

  SetShellVarContext all
  !insertmacro GvPurgeDesktopCopies `$newDesktopLink`

  ${If} $installMode == "all"
    SetShellVarContext all
  ${Else}
    SetShellVarContext current
  ${EndIf}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    SetShellVarContext current
    Delete "$DESKTOP\GestorVend.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
    SetShellVarContext all
    Delete "$DESKTOP\GestorVend.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${PRODUCT_FILENAME}.lnk"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend
