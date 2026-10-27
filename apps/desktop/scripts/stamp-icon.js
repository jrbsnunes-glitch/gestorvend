/**
 * Grava o .ico oficial no GestorVend.exe depois do pack, sem winCodeSign.
 * afterPack do electron-builder — o NSIS empacota o exe já com o ícone.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function findRcedit() {
  const names = process.arch === 'ia32' ? ['rcedit.exe', 'rcedit-x64.exe'] : ['rcedit-x64.exe', 'rcedit.exe'];
  const roots = [
    path.join(__dirname, '..', 'node_modules', 'rcedit', 'bin'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'rcedit', 'bin'),
  ];
  for (const root of roots) {
    for (const name of names) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

module.exports = async function stampIcon(context) {
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exe = path.join(context.appOutDir, exeName);
  const ico = path.join(context.packager.projectDir, 'resources', 'icon.ico');
  if (!fs.existsSync(exe)) {
    console.warn('[stamp-icon] exe ausente:', exe);
    return;
  }
  if (!fs.existsSync(ico)) {
    console.warn('[stamp-icon] ico ausente:', ico);
    return;
  }
  const rcedit = findRcedit();
  if (!rcedit) {
    console.warn('[stamp-icon] rcedit.exe não encontrado em node_modules/rcedit/bin');
    return;
  }
  const res = spawnSync(rcedit, [exe, '--set-icon', ico], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(
      `[stamp-icon] falhou (${res.status}): ${(res.stderr || res.stdout || '').trim()}`,
    );
  }
  console.log('[stamp-icon] ícone gravado em', exe);
};
