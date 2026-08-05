# GestorVend Desktop

Cliente Windows em janela própria (Electron) que carrega o sistema hospedado no servidor do cliente — **sem alterar** a estrutura web/API.

## Fluxo

1. Na primeira abertura, o usuário informa a **URL do servidor** e a **abreviatura da empresa**.
2. O app consulta `GET /api/license/status?tenant=<slug>`.
3. Se a licença estiver ativa, carrega o sistema na janela (login normal).
4. Se estiver suspensa/expirada, mostra a tela de bloqueio.
5. Se o servidor estiver offline, usa a última validação ok por até **72 h**.

## Desenvolvimento

```bash
# na raiz do monorepo
npm install
npm run desktop:dev
```

## Gerar instalador (.exe NSIS)

```bash
# na raiz do monorepo
npm run desktop:build
```

O instalador sai em `apps/desktop/out/GestorVend Setup 1.0.0.exe`.

### Se o build falhar no Windows

1. **Electron não instalado** — rode `npm install` na raiz (versão fixa `33.4.11` no `package.json` do desktop).
2. **Erro de symbolic link / winCodeSign** — ative o *Modo de desenvolvedor* do Windows (**Configurações → Privacidade e segurança → Para desenvolvedores**), ou extraia o cache sem a pasta `darwin` (ver script no histórico / README anterior).
3. **Arquivo em uso (`app.asar`)** — quase sempre o **Cursor** (ou o próprio `GestorVend.exe`) está com a pasta de build aberta. O `npm run desktop:build` já limpa/`out` e usa pasta alternativa se necessário. Evite manter `apps/desktop/out` aberto no explorador de arquivos do IDE.

> Sem certificado de assinatura de código, o Windows SmartScreen pode exibir um aviso na primeira instalação.

## Impressão silenciosa

O preload expõe `window.gestorvend.printSilent()` para uso futuro no cupom/cozinha via `webContents.print({ silent: true })`.
