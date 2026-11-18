# Memórias

App pessoal (PWA, instalável no celular) para registrar momentos e revê-los de forma espaçada.
Os arquivos ficam no OneDrive do usuário, em formato aberto.

## O que a versão 1 faz

- **Capturar:** vídeo curto, fotos e uma ficha (o quê, o que teve de único, quem, onde, uma fala, um dado não visual).
- **Rever:** fila diária conforme a agenda em `config.js` (8 revisões em 2 semanas, depois 1 e 3 meses).
  Antes de abrir o registro há um campo opcional "o que eu lembro?".
- **Arquivo:** busca, ficha, histórico de revisões e acréscimos datados com fonte e grau de confiança.
- **Autoexperimento:** cada registro novo é sorteado para "revisar" ou "não revisar".

## Onde os dados ficam

`<pasta base>/<ano>/<data hora título>/` no OneDrive, com:

- `video.*`, `foto-N.*` — originais;
- `ficha.md` — ficha legível sem o app;
- `evento.json` — os mesmos dados em formato de máquina (permite reconstruir o app a partir do OneDrive).

No aparelho, os registros ficam no IndexedDB até serem enviados.

## Estrutura

Site estático, sem etapa de build: `index.html`, `app.js`, `app.css`, `config.js`, `sw.js`.
Login pela Microsoft com MSAL (`vendor/msal-browser.min.js`, v4.30.0) e gravação pelo Microsoft Graph.

## Regras de desenho

- O registro original nunca é sobrescrito.
- Nenhuma instrução de "visualizar" ou "imaginar" a cena.
- Nenhum texto ou imagem é gerado automaticamente.
