'use strict';

/**
 * Copia `src/generated` (clientes Prisma) para dentro de `dist`, no(s) lugar(es)
 * onde o JS compilado procura (`dist/src/generated` e/ou `dist/generated`).
 * O `nest build` tenta copiar via assets; no Windows falhas/atrasos são comuns —
 * este passo garante login e tenant Prisma funcionando na API compilada.
 */
const fs = require('fs');
const path = require('path');

const apiRoot = path.join(__dirname, '..');
const from = path.join(apiRoot, 'src', 'generated');

/** DLL do query engine pode ficar bloqueada com a API em execução no Windows. */
const SKIP_IF_LOCKED = /\.(dll|node)$/i;

function copyGeneratedRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const srcPath = path.join(src, name);
    const destPath = path.join(dest, name);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyGeneratedRecursive(srcPath, destPath);
      continue;
    }
    try {
      fs.copyFileSync(srcPath, destPath);
    } catch (err) {
      const locked =
        err &&
        (err.code === 'EPERM' ||
          err.code === 'EBUSY' ||
          err.code === 'EPIPE' ||
          err.code === 'ENOENT');
      if (SKIP_IF_LOCKED.test(name) && locked) {
        console.warn('[sync-generated] arquivo bloqueado (ignorado):', destPath);
        continue;
      }
      throw err;
    }
  }
}

if (!fs.existsSync(from)) {
  console.error(
    '[sync-generated] Pasta ausente: %s — rode npm run prisma:generate -w @gestorvend/api',
    from,
  );
  process.exit(1);
}

const targets = [];

const prismaNested = path.join(apiRoot, 'dist', 'src', 'prisma');
const prismaFlat = path.join(apiRoot, 'dist', 'prisma');
const mainNested = path.join(apiRoot, 'dist', 'src', 'main.js');

if (fs.existsSync(prismaNested)) {
  targets.push(path.join(apiRoot, 'dist', 'src', 'generated'));
}
if (fs.existsSync(prismaFlat)) {
  targets.push(path.join(apiRoot, 'dist', 'generated'));
}
// Fallback: layout típico monorepo (tsc preserva pasta `src` em `dist/src/`).
if (targets.length === 0 && fs.existsSync(mainNested)) {
  targets.push(path.join(apiRoot, 'dist', 'src', 'generated'));
}

if (targets.length === 0) {
  console.warn(
    '[sync-generated] Nenhum destino encontrado em dist/ (falta `dist/src/prisma`, `dist/prisma` ou `dist/src/main.js`). Rode `nest build` em apps/api com sucesso antes.',
  );
  process.exit(0);
}

for (const to of targets) {
  copyGeneratedRecursive(from, to);
  console.log('[sync-generated]', from, '→', to);
}
