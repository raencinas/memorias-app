'use strict';
/* Memórias — versão 1: capturar, rever, arquivo.
   Os registros ficam no aparelho (IndexedDB) até subirem para o OneDrive.
   Regras de desenho: o registro original nunca é sobrescrito; todo acréscimo
   leva fonte e status; nenhum texto é gerado ou completado automaticamente. */

const C = window.CONFIG;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const DIA = 86400000;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FONTES = { lembrei: 'lembrei', registro: 'vi no registro', ouvi: 'ouvi de alguém', inferi: 'inferi' };
const STATUS = { verificado: 'verificado', provavel: 'provável', incerto: 'incerto', contada: 'história contada' };

/* ---------- preferências ---------- */
const pref = {
  get pastaBase() { return localStorage.getItem('pastaBase') || C.pastaBase; },
  set pastaBase(v) { localStorage.setItem('pastaBase', v); },
  get experimento() { return localStorage.getItem('experimento') !== 'nao'; },
  set experimento(v) { localStorage.setItem('experimento', v ? 'sim' : 'nao'); }
};

/* ---------- banco local ---------- */
let dbp;
function abrirDb() {
  return dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('memorias', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('eventos', { keyPath: 'id' });
      r.result.createObjectStore('blobs');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, modo, fn) {
  const d = await abrirDb();
  return new Promise((res, rej) => {
    const t = d.transaction(store, modo);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const bd = {
  eventos: () => tx('eventos', 'readonly', s => s.getAll()),
  evento: id => tx('eventos', 'readonly', s => s.get(id)),
  salvar: ev => tx('eventos', 'readwrite', s => s.put(ev)),
  apagar: id => tx('eventos', 'readwrite', s => s.delete(id)),
  blob: chave => tx('blobs', 'readonly', s => s.get(chave)),
  salvarBlob: (chave, b) => tx('blobs', 'readwrite', s => s.put(b, chave)),
  apagarBlob: chave => tx('blobs', 'readwrite', s => s.delete(chave))
};

/* ---------- datas e nomes ---------- */
const p2 = n => String(n).padStart(2, '0');
const dataBr = iso => { const d = new Date(iso); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const inicioDoDia = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
function nomeSeguro(s) {
  // OneDrive não aceita " * : < > ? / \ | nem nome terminado em ponto ou espaço.
  return s.normalize('NFC').replace(/["*:<>?/\\|#%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50).replace(/[. ]+$/, '') || 'evento';
}
function novoId(agora, oque) {
  const d = agora;
  const dia = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const hora = `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  return { id: `${dia}_${hora}`, pasta: `${d.getFullYear()}/${dia} ${hora.slice(0, 4)} ${nomeSeguro(oque)}` };
}

/* ---------- autoexperimento: sorteio em pares ---------- */
function sortearGrupo() {
  if (!pref.experimento) return 'revisar';
  const pendente = localStorage.getItem('grupoPendente');
  if (pendente) { localStorage.removeItem('grupoPendente'); return pendente; }
  const g = Math.random() < 0.5 ? 'revisar' : 'nao_revisar';
  localStorage.setItem('grupoPendente', g === 'revisar' ? 'nao_revisar' : 'revisar');
  return g;
}

/* ---------- agenda de revisão ---------- */
function proximaRevisao(ev) {
  if (ev.grupo !== 'revisar') return null;
  const n = ev.revisoes.length;
  if (n >= C.agenda.length) return null;
  let quando = inicioDoDia(ev.criadoEm) + C.agenda[n] * DIA;
  if (C.agenda[n] === 0) quando = new Date(ev.criadoEm).getTime() + C.horasMinimasDia0 * 3600000;
  const ultima = ev.revisoes[n - 1];
  if (ultima) quando = Math.max(quando, inicioDoDia(ultima.em) + DIA); // no máximo uma por dia
  return quando;
}
const pendentesDeRevisao = evs => evs.filter(e => { const q = proximaRevisao(e); return q !== null && q <= Date.now(); })
  .sort((a, b) => proximaRevisao(a) - proximaRevisao(b));

/* ---------- ficha em texto (legível sem o app) ---------- */
function fichaMd(ev) {
  const l = [];
  l.push(`# ${ev.oque}`, '');
  l.push(`- Registrado em: ${dataBr(ev.criadoEm)}`);
  l.push(`- Grupo do autoexperimento: ${ev.grupo === 'revisar' ? 'revisar' : 'não revisar'}`);
  l.push('', '## Registro original (fonte: anotado no momento)', '');
  const campo = (rot, v) => { if (v) l.push(`- **${rot}:** ${v.replace(/\n/g, ' ')}`); };
  campo('O que teve de único', ev.unico);
  campo('Quem', ev.quem);
  campo('Onde', ev.onde);
  campo('Uma fala', ev.fala);
  campo('Dado não visual', ev.naoVisual);
  if (ev.midias.length) l.push(`- **Arquivos:** ${ev.midias.map(m => m.nome).join(', ')}`);
  l.push('', '## Acréscimos posteriores', '');
  if (!ev.acrescimos.length) l.push('(nenhum)');
  for (const a of ev.acrescimos) {
    const fonte = FONTES[a.fonte] + (a.quem ? `: ${a.quem}` : '');
    l.push(`- ${dataBr(a.em)} — [${fonte}] [${STATUS[a.status]}] ${a.texto.replace(/\n/g, ' ')}`);
  }
  l.push('', '## Revisões', '');
  if (!ev.revisoes.length) l.push('(nenhuma)');
  for (const r of ev.revisoes) {
    l.push(`- ${dataBr(r.em)}` + (r.tentativa ? ` — lembrado antes de abrir: "${r.tentativa.replace(/\n/g, ' ')}"` : ' — sem tentativa escrita'));
  }
  return l.join('\n') + '\n';
}

/* ---------- login Microsoft ---------- */
let pca = null, conta = null, erroLogin = '';
async function iniciarLogin() {
  if (!window.msal) { erroLogin = 'Biblioteca de login não carregou.'; return; }
  try {
    pca = await msal.PublicClientApplication.createPublicClientApplication({
      auth: { clientId: C.clientId, authority: C.authority, redirectUri: location.origin + '/' },
      cache: { cacheLocation: 'localStorage' }
    });
    const r = await pca.handleRedirectPromise();
    conta = (r && r.account) || pca.getAllAccounts()[0] || null;
    if (conta) pca.setActiveAccount(conta);
  } catch (e) { erroLogin = String(e && e.message || e); }
}
async function token() {
  if (!pca || !conta) throw new Error('sem-login');
  try {
    return (await pca.acquireTokenSilent({ scopes: C.scopes, account: conta })).accessToken;
  } catch (e) {
    if (e instanceof msal.InteractionRequiredAuthError) { conta = null; atualizarEstado(); throw new Error('sem-login'); }
    throw e;
  }
}
const entrar = () => pca && pca.loginRedirect({ scopes: C.scopes, prompt: 'select_account' });
const sair = () => pca && pca.logoutRedirect({ account: conta });

/* ---------- OneDrive (Microsoft Graph) ---------- */
const raiz = caminho => '/me/drive/root:/' + caminho.split('/').filter(Boolean).map(encodeURIComponent).join('/');
async function g(url, opt = {}) {
  const t = await token();
  const r = await fetch(url.startsWith('http') ? url : GRAPH + url, { ...opt, headers: { Authorization: 'Bearer ' + t, ...(opt.headers || {}) } });
  if (!r.ok && !(opt.aceitar || []).includes(r.status)) throw new Error(`OneDrive respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}
const pastasProntas = new Set();
async function garantirPasta(caminho) {
  const partes = caminho.split('/').filter(Boolean);
  let prefixo = '';
  for (const nome of partes) {
    const alvo = prefixo ? `${prefixo}/${nome}` : nome;
    if (!pastasProntas.has(alvo)) {
      const existe = await g(raiz(alvo) + '?$select=id', { aceitar: [404] });
      if (existe.status === 404) {
        const onde = prefixo ? raiz(prefixo) + ':/children' : '/me/drive/root/children';
        await g(onde, { method: 'POST', headers: { 'Content-Type': 'application/json' }, aceitar: [409],
          body: JSON.stringify({ name: nome, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) });
      }
      pastasProntas.add(alvo);
    }
    prefixo = alvo;
  }
}
async function enviarArquivo(caminho, blob, tipo) {
  if (blob.size <= 4 * 1024 * 1024) {
    await g(raiz(caminho) + ':/content', { method: 'PUT', headers: { 'Content-Type': tipo || 'application/octet-stream' }, body: blob });
    return;
  }
  // Arquivos grandes (vídeos) sobem em partes.
  const sessao = await (await g(raiz(caminho) + ':/createUploadSession', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) })).json();
  const PARTE = 320 * 1024 * 16;
  for (let i = 0; i < blob.size; i += PARTE) {
    const fim = Math.min(i + PARTE, blob.size);
    const r = await fetch(sessao.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${i}-${fim - 1}/${blob.size}` }, body: blob.slice(i, fim) });
    if (!r.ok) throw new Error(`Envio do vídeo falhou (${r.status}).`);
  }
}
async function linkDeDownload(caminho) {
  const j = await (await g(raiz(caminho) + '?select=id,@microsoft.graph.downloadUrl')).json();
  return j['@microsoft.graph.downloadUrl'];
}

/* ---------- sincronização ---------- */
let sincronizando = false, ultimoErroSync = '';
async function sincronizar() {
  if (sincronizando || !conta || !navigator.onLine) return;
  sincronizando = true; ultimoErroSync = ''; atualizarEstado();
  try {
    const evs = (await bd.eventos()).filter(e => e.sync !== 'ok');
    for (const ev of evs) {
      if (!(await bd.evento(ev.id))) continue; // excluído enquanto aguardava
      const pasta = `${pref.pastaBase}/${ev.pasta}`;
      await garantirPasta(pasta);
      for (const m of ev.midias) {
        if (m.enviado) continue;
        const chave = `${ev.id}/${m.nome}`;
        const b = await bd.blob(chave);
        if (b) await enviarArquivo(`${pasta}/${m.nome}`, b, m.tipo);
        m.enviado = true;
        await bd.salvar(ev);
        await bd.apagarBlob(chave);
      }
      const marca = ev.alteradoEm;
      const paraNuvem = { ...ev, sync: 'ok' };
      await enviarArquivo(`${pasta}/evento.json`, new Blob([JSON.stringify(paraNuvem, null, 2)], { type: 'application/json' }), 'application/json');
      await enviarArquivo(`${pasta}/ficha.md`, new Blob([fichaMd(ev)], { type: 'text/markdown' }), 'text/markdown');
      const atual = await bd.evento(ev.id);
      if (atual && atual.alteradoEm === marca) { atual.sync = 'ok'; await bd.salvar(atual); }
    }
    await processarExclusoes();
  } catch (e) {
    if (e.message !== 'sem-login') ultimoErroSync = e.message;
  } finally {
    sincronizando = false; atualizarEstado();
  }
}
/* Exclusões: o registro some do aparelho na hora; a pasta no OneDrive é apagada
   assim que houver login e conexão (vai para a lixeira do OneDrive). */
const filaExclusao = {
  ler: () => JSON.parse(localStorage.getItem('exclusoes') || '[]'),
  gravar: l => localStorage.setItem('exclusoes', JSON.stringify(l))
};
async function processarExclusoes() {
  for (const pasta of filaExclusao.ler()) {
    await g(raiz(pasta), { method: 'DELETE', aceitar: [404] });
    filaExclusao.gravar(filaExclusao.ler().filter(x => x !== pasta));
  }
}
async function excluirEvento(ev) {
  for (const m of ev.midias) await bd.apagarBlob(`${ev.id}/${m.nome}`);
  await bd.apagar(ev.id);
  filaExclusao.gravar([...filaExclusao.ler(), `${pref.pastaBase}/${ev.pasta}`]);
  atualizarEstado();
  sincronizar();
}
async function gravar(ev) {
  ev.alteradoEm = new Date().toISOString();
  ev.sync = 'pendente';
  await bd.salvar(ev);
  atualizarEstado();
  sincronizar();
}
async function restaurarDoOneDrive(progresso) {
  const locais = new Set((await bd.eventos()).map(e => e.id));
  let novos = 0;
  const listar = async caminho => {
    const r = await g(raiz(caminho) + ':/children?$select=name,folder&$top=999', { aceitar: [404] });
    return r.status === 404 ? [] : (await r.json()).value.filter(x => x.folder).map(x => x.name);
  };
  for (const ano of await listar(pref.pastaBase)) {
    for (const pasta of await listar(`${pref.pastaBase}/${ano}`)) {
      progresso(`${ano}/${pasta}`);
      try {
        const url = await linkDeDownload(`${pref.pastaBase}/${ano}/${pasta}/evento.json`);
        const ev = await (await fetch(url)).json();
        if (ev && ev.id && !locais.has(ev.id)) { ev.sync = 'ok'; await bd.salvar(ev); novos++; }
      } catch (e) { /* pasta sem evento.json: ignora */ }
    }
  }
  return novos;
}

/* ---------- mídia ---------- */
const urlsCriadas = [];
async function urlDaMidia(ev, m) {
  const b = await bd.blob(`${ev.id}/${m.nome}`);
  if (b) { const u = URL.createObjectURL(b); urlsCriadas.push(u); return u; }
  return linkDeDownload(`${pref.pastaBase}/${ev.pasta}/${m.nome}`);
}
function duracaoDoVideo(arquivo) {
  return new Promise(res => {
    const v = document.createElement('video');
    const u = URL.createObjectURL(arquivo);
    const fim = d => { URL.revokeObjectURL(u); res(d); };
    v.preload = 'metadata';
    v.onloadedmetadata = () => fim(isFinite(v.duration) ? Math.round(v.duration) : null);
    v.onerror = () => fim(null);
    setTimeout(() => fim(null), 4000);
    v.src = u;
  });
}
const extensao = (arquivo, padrao) => {
  const doNome = (arquivo.name || '').split('.').pop().toLowerCase();
  if (doNome && doNome.length <= 4 && doNome !== (arquivo.name || '').toLowerCase()) return doNome;
  return ({ 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic' })[arquivo.type] || padrao;
};
async function htmlMidias(ev) {
  let h = '';
  for (const m of ev.midias) {
    try {
      const u = await urlDaMidia(ev, m);
      h += m.tipo.startsWith('video') ? `<video controls playsinline preload="metadata" src="${esc(u)}"></video>` : `<img class="foto" alt="Foto do registro" src="${esc(u)}">`;
    } catch (e) {
      h += `<p class="erro">Não consegui abrir ${esc(m.nome)}${conta ? '' : ' (entre com a conta Microsoft em Ajustes)'}.</p>`;
    }
  }
  return h;
}

/* ---------- interface ---------- */
let abaAtual = 'capturar';
function aviso(texto) {
  const a = $('#aviso'); a.textContent = texto; a.classList.add('visivel');
  clearTimeout(aviso.t); aviso.t = setTimeout(() => a.classList.remove('visivel'), 2600);
}
async function atualizarEstado() {
  const evs = await bd.eventos();
  const pend = evs.filter(e => e.sync !== 'ok').length;
  const partes = [];
  if (!conta) partes.push('sem login');
  else if (sincronizando) partes.push('enviando…');
  else if (pend) partes.push(`${pend} a enviar`);
  else if (filaExclusao.ler().length) partes.push('exclusão pendente');
  else partes.push('tudo no OneDrive');
  if (!navigator.onLine) partes.push('offline');
  $('#estado').textContent = partes.join(' · ');
  const n = pendentesDeRevisao(evs).length;
  const selo = $('#selo'); selo.hidden = !n; selo.textContent = n;
}
function ir(aba, arg) {
  abaAtual = aba;
  while (urlsCriadas.length) URL.revokeObjectURL(urlsCriadas.pop());
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === aba));
  ({ capturar: telaCapturar, rever: telaRever, arquivo: telaArquivo, ajustes: telaAjustes, evento: telaEvento, revisao: telaRevisao })[aba](arg);
  window.scrollTo(0, 0);
}

/* --- Capturar --- */
function telaCapturar() {
  $('#view').innerHTML = `
    <form id="f" autocomplete="off">
      <label class="botao grande principal" for="video">Gravar vídeo (10 a 30 s)</label>
      <input type="file" id="video" accept="video/*" capture="environment">
      <div id="infoVideo" class="midia-info">Depois de observar o momento. Fale no vídeo o que ele tem de único.</div>
      <div class="fila">
        <label class="botao" for="fotos" style="text-align:center;margin:0">Adicionar fotos (poucas)</label>
        <input type="file" id="fotos" accept="image/*" multiple>
      </div>
      <div id="infoFotos" class="midia-info"></div>

      <label for="oque">O quê <small>(obrigatório — vira o título)</small></label>
      <input type="text" id="oque" required maxlength="120" placeholder="Ex.: almoço de domingo na casa da tia">
      <label for="unico">O que este momento teve de único</label>
      <textarea id="unico" placeholder="O que o distingue de outras ocasiões parecidas"></textarea>
      <label for="quem">Quem</label>
      <input type="text" id="quem">
      <label for="onde">Onde</label>
      <input type="text" id="onde">
      <label for="fala">Uma fala <small>(algo que alguém disse)</small></label>
      <input type="text" id="fala">
      <label for="naoVisual">Um dado não visual <small>(som, cheiro, temperatura)</small></label>
      <input type="text" id="naoVisual">
      <p><button class="principal grande" type="submit">Registrar</button></p>
      <p class="suave">A data e a hora entram sozinhas. Só "O quê" é obrigatório; o resto ajuda a revisão.</p>
    </form>`;
  $('#video').onchange = async e => {
    const a = e.target.files[0]; const info = $('#infoVideo');
    if (!a) { info.textContent = ''; return; }
    const d = await duracaoDoVideo(a);
    e.target.dataset.duracao = d ?? '';
    info.className = 'midia-info' + (d && (d > 40 || d < 5) ? ' alerta' : '');
    info.textContent = `Vídeo pronto${d ? ` (${d} s)` : ''} · ${(a.size / 1048576).toFixed(1)} MB` + (d > 40 ? ' — mais longo que o ideal (10 a 30 s); vale regravar se der.' : '');
  };
  $('#fotos').onchange = e => { const n = e.target.files.length; $('#infoFotos').textContent = n ? `${n} foto(s) selecionada(s)` + (n > 3 ? ' — prefira poucas e intencionais.' : '') : ''; };
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const oque = $('#oque').value.trim();
    if (!oque) return;
    const botao = e.target.querySelector('button[type=submit]'); botao.disabled = true;
    try {
      const agora = new Date();
      const { id, pasta } = novoId(agora, oque);
      const ev = { id, pasta, criadoEm: agora.toISOString(), oque,
        unico: $('#unico').value.trim(), quem: $('#quem').value.trim(), onde: $('#onde').value.trim(),
        fala: $('#fala').value.trim(), naoVisual: $('#naoVisual').value.trim(),
        grupo: sortearGrupo(), midias: [], acrescimos: [], revisoes: [], versao: 1 };
      const v = $('#video').files[0];
      if (v) {
        const nome = `video.${extensao(v, 'mp4')}`;
        await bd.salvarBlob(`${id}/${nome}`, v);
        ev.midias.push({ nome, tipo: v.type || 'video/mp4', tamanho: v.size, duracao: Number($('#video').dataset.duracao) || null, enviado: false });
      }
      let i = 1;
      for (const f of $('#fotos').files) {
        const nome = `foto-${i++}.${extensao(f, 'jpg')}`;
        await bd.salvarBlob(`${id}/${nome}`, f);
        ev.midias.push({ nome, tipo: f.type || 'image/jpeg', tamanho: f.size, enviado: false });
      }
      await gravar(ev);
      aviso('Registrado.');
      ir('capturar');
    } catch (err) {
      botao.disabled = false;
      aviso('Não consegui salvar: ' + err.message);
    }
  };
}

/* --- Rever --- */
async function telaRever() {
  const evs = await bd.eventos();
  const fila = pendentesDeRevisao(evs);
  const futuras = evs.map(e => ({ e, q: proximaRevisao(e) })).filter(x => x.q && x.q > Date.now()).sort((a, b) => a.q - b.q).slice(0, 5);
  $('#view').innerHTML = `
    <h2>Rever hoje</h2>
    ${fila.length ? fila.map(e => `<button class="item" data-id="${esc(e.id)}"><strong>${esc(e.oque)}</strong>
      <span class="suave">registrado em ${dataBr(e.criadoEm)} · revisão ${e.revisoes.length + 1} de ${C.agenda.length}</span></button>`).join('')
      : '<p class="suave">Nada para rever agora.</p>'}
    ${futuras.length ? `<h2>Próximas</h2><ul class="limpa">${futuras.map(x => `<li>${esc(x.e.oque)} <span class="suave">— a partir de ${dataBr(x.q)}</span></li>`).join('')}</ul>` : ''}`;
  $('#view').querySelectorAll('button.item').forEach(b => b.onclick = () => ir('revisao', b.dataset.id));
}
async function telaRevisao(id) {
  const ev = await bd.evento(id);
  if (!ev) return ir('rever');
  $('#view').innerHTML = `
    <h2>${esc(ev.oque)}</h2>
    <div class="cartao">
      <label for="tentativa">Antes de abrir: o que eu lembro? <small>(1 minuto, opcional)</small></label>
      <textarea id="tentativa" placeholder="Escreva só o que vier. Não precisa completar nem deduzir."></textarea>
      <p class="suave">Isto serve para separar o que é lembrança do que está no registro. O que fixa é rever.</p>
      <p><button class="principal" id="abrir">Abrir o registro</button></p>
    </div>
    <div id="conteudo"></div>`;
  $('#abrir').onclick = async () => {
    const tentativa = $('#tentativa').value.trim();
    $('#tentativa').readOnly = true; $('#abrir').disabled = true;
    $('#conteudo').innerHTML = '<p class="suave">Abrindo…</p>';
    $('#conteudo').innerHTML = `${await htmlMidias(ev)}${htmlFicha(ev)}
      <p><button class="principal grande" id="feito">Marcar como revisto</button></p>`;
    $('#feito').onclick = async () => {
      const atual = await bd.evento(id);
      atual.revisoes.push({ em: new Date().toISOString(), tentativa });
      await gravar(atual);
      aviso('Revisão registrada.');
      ir('rever');
    };
  };
}

/* --- ficha na tela --- */
function htmlFicha(ev) {
  const d = (rot, v) => v ? `<dt>${rot}</dt><dd>${esc(v)}</dd>` : '';
  return `<div class="cartao"><dl>
    ${d('O que teve de único', ev.unico)}${d('Quem', ev.quem)}${d('Onde', ev.onde)}${d('Uma fala', ev.fala)}${d('Dado não visual', ev.naoVisual)}
    <dt>Registrado em</dt><dd>${dataBr(ev.criadoEm)} <span class="suave">(anotado no momento)</span></dd></dl></div>
    ${ev.acrescimos.length ? `<div class="cartao"><strong>Acréscimos posteriores</strong><ul class="limpa">${ev.acrescimos.map(a =>
      `<li><span class="etiqueta">${esc(FONTES[a.fonte])}${a.quem ? ': ' + esc(a.quem) : ''}</span><span class="etiqueta">${esc(STATUS[a.status])}</span><br>${esc(a.texto)}<br><span class="suave">${dataBr(a.em)}</span></li>`).join('')}</ul></div>` : ''}`;
}

/* --- Arquivo --- */
async function telaArquivo() {
  const evs = (await bd.eventos()).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  $('#view').innerHTML = `
    <label for="busca">Buscar por o quê, quem ou onde</label>
    <input type="text" id="busca" placeholder="Ex.: chácara">
    <div id="lista"></div>`;
  const desenhar = () => {
    const q = $('#busca').value.trim().toLowerCase();
    const achados = evs.filter(e => !q || [e.oque, e.quem, e.onde, e.unico].join(' ').toLowerCase().includes(q));
    let mes = '', h = '';
    for (const e of achados) {
      const m = new Date(e.criadoEm).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      if (m !== mes) { mes = m; h += `<h2>${esc(m)}</h2>`; }
      h += `<button class="item" data-id="${esc(e.id)}"><strong>${esc(e.oque)}</strong>
        <span class="suave">${dataBr(e.criadoEm)}${e.onde ? ' · ' + esc(e.onde) : ''}</span>
        <span class="etiqueta ${e.sync === 'ok' ? 'ok' : 'pendente'}">${e.sync === 'ok' ? 'no OneDrive' : 'a enviar'}</span>
        ${pref.experimento ? `<span class="etiqueta">${e.grupo === 'revisar' ? `revisar · ${e.revisoes.length} feita(s)` : 'não revisar'}</span>` : ''}</button>`;
    }
    $('#lista').innerHTML = h || '<p class="suave">Nenhum registro.</p>';
    $('#lista').querySelectorAll('button.item').forEach(b => b.onclick = () => ir('evento', b.dataset.id));
  };
  $('#busca').oninput = desenhar; desenhar();
}
async function telaEvento(id, liberado) {
  const ev = await bd.evento(id);
  if (!ev) return ir('arquivo');
  const controle = pref.experimento && ev.grupo === 'nao_revisar' && !liberado;
  const cabeca = `<p><button id="voltar">‹ Arquivo</button></p><h2>${esc(ev.oque)}</h2>`;
  if (controle) {
    $('#view').innerHTML = `${cabeca}<div class="cartao"><p>Este registro está no grupo <strong>"não revisar"</strong> do autoexperimento.
      Abrir agora mistura os dois grupos e enfraquece a comparação.</p>
      <p><button id="abrirAssim">Abrir mesmo assim</button></p></div>`;
    $('#voltar').onclick = () => ir('arquivo');
    $('#abrirAssim').onclick = () => telaEvento(id, true);
    return;
  }
  $('#view').innerHTML = `${cabeca}<div id="midias"><p class="suave">Abrindo…</p></div>${htmlFicha(ev)}
    <div class="cartao"><strong>Revisões</strong>
      ${ev.revisoes.length ? `<ul class="limpa">${ev.revisoes.map(r => `<li>${dataBr(r.em)}${r.tentativa ? `<br><span class="suave">Lembrado antes de abrir:</span> ${esc(r.tentativa)}` : ''}</li>`).join('')}</ul>` : '<p class="suave">Nenhuma ainda.</p>'}
    </div>
    <form class="cartao" id="fa">
      <strong>Acrescentar algo</strong>
      <p class="suave">O registro original não muda. Cada acréscimo fica datado, com a origem da informação.</p>
      <label for="atexto">O que acrescentar</label>
      <textarea id="atexto" required></textarea>
      <label for="afonte">De onde vem</label>
      <select id="afonte">${Object.entries(FONTES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <div id="aquemBox" hidden><label for="aquem">Quem contou</label><input type="text" id="aquem"></div>
      <label for="astatus">Grau de confiança</label>
      <select id="astatus">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === 'incerto' ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <p><button class="principal" type="submit">Salvar acréscimo</button></p>
    </form>
    <div class="cartao" id="zonaExcluir">
      <button id="excluir" class="perigo">Excluir registro</button>
    </div>`;
  $('#excluir').onclick = () => {
    $('#zonaExcluir').innerHTML = `<p><strong>Excluir "${esc(ev.oque)}"?</strong></p>
      <p class="suave">Apaga o registro deste aparelho e a pasta dele no OneDrive (vídeo, fotos, ficha, revisões e acréscimos).
      A pasta fica na lixeira do OneDrive por um tempo, de onde ainda pode ser restaurada.</p>
      <div class="fila"><button id="naoExcluir">Cancelar</button><button id="simExcluir" class="perigo cheio">Excluir</button></div>`;
    $('#naoExcluir').onclick = () => telaEvento(id, true);
    $('#simExcluir').onclick = async () => {
      await excluirEvento(ev);
      aviso(conta && navigator.onLine ? 'Registro excluído.' : 'Excluído aqui; a pasta no OneDrive sai quando houver conexão.');
      ir('arquivo');
    };
  };
  $('#voltar').onclick = () => ir('arquivo');
  $('#afonte').onchange = e => {
    $('#aquemBox').hidden = e.target.value !== 'ouvi';
    if (e.target.value === 'ouvi') $('#astatus').value = 'contada';
  };
  $('#fa').onsubmit = async e => {
    e.preventDefault();
    const atual = await bd.evento(id);
    atual.acrescimos.push({ em: new Date().toISOString(), texto: $('#atexto').value.trim(), fonte: $('#afonte').value,
      quem: $('#afonte').value === 'ouvi' ? $('#aquem').value.trim() : '', status: $('#astatus').value });
    await gravar(atual);
    aviso('Acréscimo salvo.');
    telaEvento(id, true);
  };
  htmlMidias(ev).then(h => { const m = $('#midias'); if (m) m.innerHTML = h; });
}

/* --- Ajustes --- */
async function telaAjustes() {
  const evs = await bd.eventos();
  const pend = evs.filter(e => e.sync !== 'ok').length;
  $('#view').innerHTML = `
    <div class="cartao"><strong>Conta Microsoft</strong>
      <p>${conta ? `Conectado como ${esc(conta.username || conta.name || 'conta Microsoft')}.` : 'Não conectado. Os registros ficam guardados neste aparelho até você entrar.'}</p>
      ${erroLogin ? `<p class="erro">Erro no login: ${esc(erroLogin)}</p>` : ''}
      <button class="principal" id="login">${conta ? 'Sair' : 'Entrar com a conta Microsoft'}</button>
    </div>
    <div class="cartao"><strong>OneDrive</strong>
      <p>${evs.length} registro(s) neste aparelho · ${pend} a enviar.</p>
      ${ultimoErroSync ? `<p class="erro">Último erro de envio: ${esc(ultimoErroSync)}</p>` : ''}
      <label for="pasta">Pasta dos registros no OneDrive</label>
      <input type="text" id="pasta" value="${esc(pref.pastaBase)}">
      <div class="fila"><button id="salvarPasta">Salvar pasta</button><button id="enviar">Enviar agora</button></div>
      <div class="fila"><button id="restaurar">Trazer registros do OneDrive</button></div>
      <p class="suave" id="progresso"></p>
    </div>
    <div class="cartao"><strong>Autoexperimento</strong>
      <p class="suave">Metade dos registros novos é sorteada para "revisar" e metade para "não revisar",
        para comparar depois se a revisão funciona para você.</p>
      <label style="font-weight:400"><input type="checkbox" id="exp" ${pref.experimento ? 'checked' : ''}> Sortear os grupos nos registros novos</label>
    </div>
    <div class="cartao"><strong>Armazenamento neste aparelho</strong>
      <p class="suave" id="persistencia">Verificando…</p>
    </div>`;
  $('#login').onclick = () => conta ? sair() : entrar();
  $('#salvarPasta').onclick = () => { pref.pastaBase = $('#pasta').value.trim().replace(/^\/+|\/+$/g, '') || C.pastaBase; pastasProntas.clear(); aviso('Pasta salva.'); };
  $('#enviar').onclick = async () => { if (!conta) return aviso('Entre com a conta Microsoft primeiro.'); await sincronizar(); telaAjustes(); };
  $('#restaurar').onclick = async () => {
    if (!conta) return aviso('Entre com a conta Microsoft primeiro.');
    try { const n = await restaurarDoOneDrive(t => { $('#progresso').textContent = 'Lendo ' + t; }); $('#progresso').textContent = `${n} registro(s) trazido(s).`; atualizarEstado(); }
    catch (e) { $('#progresso').textContent = 'Falhou: ' + e.message; }
  };
  $('#exp').onchange = e => { pref.experimento = e.target.checked; };
  if (navigator.storage && navigator.storage.persist) {
    const ok = await navigator.storage.persisted() || await navigator.storage.persist();
    const el = $('#persistencia');
    if (el) el.textContent = ok ? 'Protegido: o navegador não apaga os registros pendentes por conta própria.' : 'O navegador ainda pode limpar dados locais. Instale o app na tela inicial e mantenha os envios em dia.';
  }
}

/* ---------- início ---------- */
document.querySelectorAll('#abas button').forEach(b => b.onclick = () => ir(b.dataset.aba));
window.addEventListener('online', () => { atualizarEstado(); sincronizar(); });
window.addEventListener('offline', atualizarEstado);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { atualizarEstado(); sincronizar(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

(async () => {
  ir('capturar');
  await iniciarLogin();
  await atualizarEstado();
  if (erroLogin) ir('ajustes');
  sincronizar();
})();
