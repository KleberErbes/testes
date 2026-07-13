const SHEETS_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTU8-45F4IYTWaim8pMyNru3071eB87U0-oZy98g8796_m9BKLMJ8vetpfeZ9AOXYZ569vOkvzcfzBS/pub?output=tsv';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzk9p47SYi4t9HEotN6FmelyTwf3nuioTsDDbR2TdqvTX7NDldxmev7VxTgQpLS5A1E/exec';

const WHATSAPP_NUMBER = "554733752227";

// ========== CONFIGURAÇÃO DE HORÁRIO ==========
const HORARIO_PEDIDOS    = { h: 8,  m: 0  };
// Buffet / atendimento presencial: 11h00
const HORARIO_ABERTURA   = { h: 19, m: 0  };
// Fechamento: 14h00
const HORARIO_FECHAMENTO = { h: 19, m: 0  };

let DIAS_FECHADOS_ESPECIAIS = [];

let cart = [];
let selectedSize = 'media';

// ========== ID ÚNICO DE PEDIDO ==========
function gerarIdPedido() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
let selAcomp  = [];
let selCarne  = {};   
let selSalada = [];

let CARDAPIO = { acompanhamentos: [], carnes: [], saladas: [], sobremesas: [] };
let CARDAPIO_ATUALIZADO_EM = '';

function showToast(msg, tipo = 'info', duracao = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.innerHTML = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duracao);
}

function getEstado() {
  const agora = new Date();

  // Data e hora no fuso de Brasília
  const partesBR = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false
  }).formatToParts(agora);

  const get = (tipo) => partesBR.find(p => p.type === tipo)?.value ?? '';
  const hora    = parseInt(get('hour'),   10);
  const minuto  = parseInt(get('minute'), 10);
  const dataHoje = `${get('year')}-${get('month')}-${get('day')}`;

  const dataBR = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const diaSem = dataBR.getDay();

  if (DIAS_FECHADOS_ESPECIAIS.includes(dataHoje)) return 'fechado';

  if (diaSem === 0) return 'fechado';

  const totalMin      = hora * 60 + minuto;
  const inicioPedidos = HORARIO_PEDIDOS.h    * 60 + HORARIO_PEDIDOS.m;
  const abre          = HORARIO_ABERTURA.h   * 60 + HORARIO_ABERTURA.m;
  const fecha         = HORARIO_FECHAMENTO.h * 60 + HORARIO_FECHAMENTO.m;

  if (totalMin >= inicioPedidos && totalMin < abre)  return 'pedidos'; // 08h–10h30
  if (totalMin >= abre          && totalMin < fecha)  return 'aberto';  // 10h30–14h
  return 'fechado'; // antes das 8h ou depois das 14h
}
function estaAberto() {
  return getEstado() === 'pedidos';
}

function atualizarBadgeHorario() {
  const badge = document.getElementById('badgeHorario');
  if (!badge) return;
  const estado = getEstado();
  if (estado === 'aberto') {
    badge.textContent = 'Aberto agora';
    badge.className = 'badge-horario badge-aberto';
  } else if (estado === 'pedidos') {
    badge.textContent = 'Pedidos disponíveis';
    badge.className = 'badge-horario badge-pedidos';
  } else {
    badge.textContent = 'Fechado agora';
    badge.className = 'badge-horario badge-fechado';
  }
}

// ========== CARREGAR CARDÁPIO DO GOOGLE SHEETS (TSV) ==========
function parseDateBR(str) {
  const partes = str.trim().split('/');
  if (partes.length !== 3) return null;
  const [d, m, a] = partes;
  if (!d || !m || !a) return null;
  return `${a.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

async function carregarCardapio() {
  mostrarSkeleton(true);
  try {
    const res = await fetch(SHEETS_URL);
    const tsv = await res.text();

    CARDAPIO = { acompanhamentos: [], carnes: [], saladas: [], sobremesas: [] };
    DIAS_FECHADOS_ESPECIAIS = [];

    const linhas = tsv.split('\n').slice(1);
    linhas.forEach(linha => {
      if (!linha.trim()) return;
      const partes = linha.split('\t');
      const categoria = (partes[0] || '').trim().replace(/"/g, '').toLowerCase();
      const item = (partes[1] || '').trim().replace(/"/g, '');
      if (!item) return;

      if (categoria === 'acompanhamentos' || categoria === 'acompanhamento') CARDAPIO.acompanhamentos.push(item);
      else if (categoria === 'carnes' || categoria === 'carne') CARDAPIO.carnes.push(item);
      else if (categoria === 'saladas' || categoria === 'salada') CARDAPIO.saladas.push(item);
      else if (categoria === 'sobremesas' || categoria === 'sobremesa') CARDAPIO.sobremesas.push(item);
      else if (categoria === 'fechado') {
        const iso = item.includes('/') ? parseDateBR(item) : item;
        if (iso) DIAS_FECHADOS_ESPECIAIS.push(iso);
      }
      else if (categoria === 'atualizado') {
        CARDAPIO_ATUALIZADO_EM = item;
      }
    });

    buildCardapio();
    buildGrids();
    updatePrecoPersonalizada();
    atualizarBadgeHorario();
    mostrarCardapioAtualizado();
  } catch (e) {
    console.error('Erro ao carregar cardápio:', e);
    CARDAPIO = {
      acompanhamentos: ["Arroz branco", "Feijão", "Macarrão espaguete", "Aipim com bacon"],
      carnes: ["Carne do dia"],
      saladas: ["Salada da casa"],
      sobremesas: ["Sobremesa do dia"]
    };
    buildCardapio();
    buildGrids();
    updatePrecoPersonalizada();
    showToast('Cardápio padrão carregado. Verifique sua conexão.', 'aviso', 5000);
  } finally {
    mostrarSkeleton(false);
  }
}

function mostrarSkeleton(show) {
  if (show) {
    document.querySelectorAll('.cardapio-box-list, .cpg-list').forEach(el => {
      el.innerHTML = '<span class="skeleton-item"></span><span class="skeleton-item"></span><span class="skeleton-item"></span>';
    });
  } else {
    document.querySelectorAll('.skeleton-item').forEach(el => el.remove());
  }
}

function showSection(id, btn) {
  document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  const sec = document.getElementById(id);
  if (sec) sec.classList.add('active');
  if (btn) btn.classList.add('active');
  window.scrollTo(0, 0);
  const aviso = document.getElementById('avisoBalcao');
  if (aviso) aviso.classList.toggle('visible', id === 'pedidos');
}

function goToMarmitas() { showSection('pedidos', document.querySelector('nav button:nth-child(3)')); }
function goToCardapio()  { showSection('cardapio-dia-sec', document.querySelector('nav button:nth-child(2)')); }

// ========== CARDÁPIO ==========
function buildCardapio() {
  const grupos = [
    { id: 'listaAcomp',     items: CARDAPIO.acompanhamentos, cls: 'tag-acomp' },
    { id: 'listaCarne',     items: CARDAPIO.carnes,          cls: 'tag-carne' },
    { id: 'listaSalada',    items: CARDAPIO.saladas,         cls: 'tag-salada' },
    { id: 'listaSobremesa', items: CARDAPIO.sobremesas,      cls: 'tag-sobremesa' },
  ];
  grupos.forEach(({ id, items, cls }) => {
    const div = document.getElementById(id);
    if (!div) return;
    div.innerHTML = '';
    if (!items.length) { div.innerHTML = '<span style="color:#aaa;font-size:0.85rem;">Nenhum item hoje</span>'; return; }
    items.forEach(item => {
      const tag = document.createElement('span');
      tag.className = `cardapio-item-tag ${cls}`;
      tag.textContent = item;
      div.appendChild(tag);
    });
  });

  const cpgGrupos = [
    { id: 'cpgAcomp',  items: CARDAPIO.acompanhamentos, cls: 'tag-acomp' },
    { id: 'cpgCarne',  items: CARDAPIO.carnes,          cls: 'tag-carne' },
    { id: 'cpgSalada', items: CARDAPIO.saladas,         cls: 'tag-salada' },
  ];
  cpgGrupos.forEach(({ id, items, cls }) => {
    const div = document.getElementById(id);
    if (!div) return;
    div.innerHTML = '';
    items.forEach(item => {
      const tag = document.createElement('span');
      tag.className = `cardapio-item-tag ${cls}`;
      tag.textContent = item;
      div.appendChild(tag);
    });
  });
}

function buildGrids() {
  buildGrid('acompGrid',  CARDAPIO.acompanhamentos, 'acomp');
  buildGrid('carneGrid',  CARDAPIO.carnes,          'carne');
  buildGrid('saladaGrid', CARDAPIO.saladas,          'salada');
}

function buildGrid(containerId, items, type) {
  const div = document.getElementById(containerId);
  if (!div) return;
  div.innerHTML = '';
  items.forEach(item => {
    if (type === 'carne') {
      const card = document.createElement('div');
      card.className = 'carne-card';
      card.dataset.item = item;

      const nome = document.createElement('span');
      nome.className = 'carne-nome';
      nome.textContent = item;

      const counter = document.createElement('div');
      counter.className = 'carne-counter';
      counter.style.display = 'none';

      const btnMinus = document.createElement('button');
      btnMinus.className = 'carne-btn carne-btn-minus';
      btnMinus.textContent = '−';
      btnMinus.onclick = (e) => { e.stopPropagation(); alterarCarne(card, item, -1); };

      const qty = document.createElement('span');
      qty.className = 'carne-qty';
      qty.textContent = '0';

      const btnPlus = document.createElement('button');
      btnPlus.className = 'carne-btn carne-btn-plus';
      btnPlus.textContent = '+';
      btnPlus.onclick = (e) => { e.stopPropagation(); alterarCarne(card, item, 1); };

      counter.appendChild(btnMinus);
      counter.appendChild(qty);
      counter.appendChild(btnPlus);
      card.appendChild(nome);
      card.appendChild(counter);
      card.onclick = () => alterarCarne(card, item, 1);
      div.appendChild(card);
    } else {
      const chip = document.createElement('button');
      chip.className = 'item-chip';
      chip.textContent = item;
      chip.dataset.item = item;
      chip.dataset.type = type;
      chip.onclick = () => toggleItem(chip, type, item);
      div.appendChild(chip);
    }
  });
}

function alterarCarne(card, item, delta) {
  const atual = selCarne[item] || 0;
  const novo = Math.max(0, atual + delta);

  if (novo === 0) {
    delete selCarne[item];
    card.classList.remove('carne-selecionada');
    card.querySelector('.carne-counter').style.display = 'none';
    card.querySelector('.carne-qty').textContent = '0';
  } else {
    selCarne[item] = novo;
    card.classList.add('carne-selecionada');
    card.querySelector('.carne-counter').style.display = 'flex';
    card.querySelector('.carne-qty').textContent = novo;
  }

  const totalPedacos = Object.values(selCarne).reduce((a, b) => a + b, 0);
  const extras = Math.max(0, totalPedacos - 3);
  const extraInfo = extras > 0 ? ` (+${extras} extra${extras > 1 ? 's' : ''} = +R$${extras * 4})` : '';
  const counter = document.getElementById('carneCounter');
  counter.textContent = `Selecionados: ${totalPedacos} pedaço${totalPedacos !== 1 ? 's' : ''}${extraInfo}`;
  counter.classList.toggle('warn', extras > 0);
  updatePrecoPersonalizada();
}

function toggleItem(chip, type, item) {
  if (type === 'acomp') {
    if (selAcomp.includes(item)) {
      selAcomp = selAcomp.filter(i => i !== item);
      chip.classList.remove('selected');
    } else {
      if (selAcomp.length >= 6) { showToast('Máximo de 6 acompanhamentos!', 'aviso'); return; }

      selAcomp.push(item);
      chip.classList.add('selected');
    }
    const extras = Math.max(0, selAcomp.length - 5);
    const extraInfo = extras > 0 ? ` (+${extras} extra${extras > 1 ? 's' : ''} = +R$${(extras * 4).toFixed(0)})` : '';
    document.getElementById('acompCounter').textContent = `Selecionados: ${selAcomp.length} / 5${extraInfo}`;
    document.getElementById('acompCounter').classList.toggle('warn', selAcomp.length > 5);
  } else if (type === 'salada') {
    if (selSalada.includes(item)) {
      selSalada = selSalada.filter(i => i !== item);
      chip.classList.remove('selected-salada');
    } else {
      if (selSalada.length >= 3) { showToast('Máximo de 3 saladas!', 'aviso'); return; }
      selSalada.push(item);
      chip.classList.add('selected-salada');
    }
    document.getElementById('saladaCounter').textContent =
      `Selecionadas: ${selSalada.length} / 3${selSalada.length > 0 ? ` (+R$${(selSalada.length * 2).toFixed(0)})` : ''}`;
  }
  updatePrecoPersonalizada();
}

function selectSize(size) {
  selectedSize = size;
  document.getElementById('sizeMedia').classList.toggle('selected', size === 'media');
  document.getElementById('sizeGrande').classList.toggle('selected', size === 'grande');
  updatePrecoPersonalizada();
}

function isModoPesar() {
  const totalPedacos = Object.values(selCarne).reduce((a, b) => a + b, 0);

  if (selAcomp.length === 4 && totalPedacos === 3) return false;

  return true;
}

function calcularBasePersonalizada(totalAcomp, totalPedacos, tamanho) {
  const offset = tamanho === 'grande' ? 2 : 0;
  const base = 26 + offset;
  const difAcomp = (totalAcomp - 4) * 2;
  const difCarne = (totalPedacos - 3) * 4;
  return base + difAcomp + difCarne;
}

function updatePrecoPersonalizada() {
  const totalPedacos = Object.values(selCarne).reduce((a, b) => a + b, 0);
  const el = document.getElementById('precoPersonalizada');
  const infoEl = document.getElementById('infoPesar');

  const nadaSelecionado = selAcomp.length === 0 && totalPedacos === 0 && selSalada.length === 0;

  if (nadaSelecionado) {
    el.textContent = 'R$ 0,00';
    el.classList.remove('preco-a-pesar');
    if (infoEl) infoEl.style.display = 'none';
    return;
  }

  if (isModoPesar()) {
    el.textContent = 'A pesar';
    el.classList.add('preco-a-pesar');
    if (infoEl) infoEl.style.display = 'block';
  } else {
    el.classList.remove('preco-a-pesar');
    if (infoEl) infoEl.style.display = 'none';

    const base = calcularBasePersonalizada(selAcomp.length, totalPedacos, selectedSize);
    const total = base + (selSalada.length * 2);
    el.textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
  }
}

let qtyPadrao = { media: 1, grande: 1 };
let qtyPersonalizada = 1;

function changeQtyPersonalizada(delta) {
  qtyPersonalizada = Math.max(1, qtyPersonalizada + delta);
  document.getElementById('qtyPersonalizada').textContent = qtyPersonalizada;
}

function changeQty(size, delta) {
  qtyPadrao[size] = Math.max(1, qtyPadrao[size] + delta);
  document.getElementById(size === 'media' ? 'qtyMedia' : 'qtyGrande').textContent = qtyPadrao[size];
}

function ordenarPelaplanilha(itens) {
  return [...itens].sort((a, b) => {
    const ia = CARDAPIO.acompanhamentos.indexOf(a);
    const ib = CARDAPIO.acompanhamentos.indexOf(b);
    const posA = ia === -1 ? 9999 : ia;
    const posB = ib === -1 ? 9999 : ib;
    return posA - posB;
  });
}

function montarDescricaoOrdenada({ carnes, acompanhamentos, saladas, obs, incluiFixos, carnesOpcoes }) {
  const partes = [];

  if (incluiFixos) {

    const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const ehSabado = hoje.getDay() === 6;
    let fixos = ['Arroz branco', 'Macarrão', 'Aipim com bacon', 'Feijão'];
    if (ehSabado) fixos = ['Lasanha de Frango', ...fixos];
    partes.push(fixos.join(', '));
    if (carnesOpcoes && carnesOpcoes.length > 0) {
      const carnesDesc = carnesOpcoes.map(c => `1x ${c}`).join(', ');
      partes.push(`Carnes: ${carnesDesc}`);
    }
  } else {
    if (acompanhamentos.length > 0) {
      const acompOrdenados = ordenarPelaplanilha(acompanhamentos);
      partes.push(acompOrdenados.join(', '));
    }
    if (carnes && Object.keys(carnes).length > 0) {
      const carnesDesc = Object.entries(carnes).map(([c, q]) => `${q}x ${c}`).join(', ');
      partes.push(`Carnes: ${carnesDesc}`);
    }
  }

  if (saladas && saladas.length > 0) partes.push('Salada: ' + saladas.join(', '));
  if (obs) partes.push(`⚠️ Obs: ${obs}`);

  return partes.join(' | ');
}


function addPadrao(size) {
  if (!estaAberto()) {
    const msg = getEstado() === 'fechado'
      ? 'Estamos fechados'
      : 'Horário de pedidos encerrado! Aceitamos pedidos das 08h às 11h.';
    showToast(msg, 'aviso', 5000);
    return;
  }
  const precoUnit = size === 'media' ? 26 : 28;
  const label = size === 'media' ? 'Média' : 'Grande';
  const qty = qtyPadrao[size];
  const obsId = size === 'media' ? 'obsMedia' : 'obsGrande';
  const obs = document.getElementById(obsId).value.trim();

  const carnesOpcoes = CARDAPIO.carnes.length > 0 ? CARDAPIO.carnes.slice(0, 3) : ['Carne do dia'];

  const desc = montarDescricaoOrdenada({
    carnes: {}, acompanhamentos: [], saladas: [], obs,
    incluiFixos: true, carnesOpcoes, tamanho: label
  });
  const descPlanilha = desc;

  cart.push({
    tipo: `Marmita ${label}`, desc, descPlanilha, preco: precoUnit * qty, qty,
    composicao: { tipoPedido: 'padrao', tamanho: size, pesar: false }
  });

  salvarCarrinhoLocal();
  qtyPadrao[size] = 1;
  document.getElementById(size === 'media' ? 'qtyMedia' : 'qtyGrande').textContent = '1';
  document.getElementById(obsId).value = '';
  updateCart();

  showToast(`✅ ${qty > 1 ? qty + 'x ' : ''}Marmita ${label} adicionada!`, 'sucesso');
}

function addPersonalizada() {
  if (!estaAberto()) {
    const msg = getEstado() === 'fechado'
      ? 'Estamos fechados'
      : 'Horário de pedidos encerrado! Aceitamos pedidos das 08h às 11h.';
    showToast(msg, 'aviso', 5000);
    return;
  }
  const totalPedacos = Object.values(selCarne).reduce((a, b) => a + b, 0);

  if (selAcomp.length === 0 && totalPedacos === 0 && selSalada.length === 0) {
    showToast('Selecione ao menos um item para montar sua marmita!', 'aviso');
    return;
  }

  const label = selectedSize === 'media' ? 'Média' : 'Grande';
  const pesar = isModoPesar();

  let preco;
  if (pesar) {
    preco = 0; 
  } else {
    const base = calcularBasePersonalizada(selAcomp.length, totalPedacos, selectedSize);
    preco = base + (selSalada.length * 2);
  }

  const obs = document.getElementById('obsPersonalizada') ? document.getElementById('obsPersonalizada').value.trim() : '';
  const descCompleta = montarDescricaoOrdenada({
    carnes: selCarne, acompanhamentos: selAcomp, saladas: selSalada, obs,
    incluiFixos: false
  });
  const qty = qtyPersonalizada;

  cart.push({
    tipo: `Marmita ${label}`, desc: descCompleta, descPlanilha: descCompleta,
    preco: pesar ? 0 : preco * qty, qty, aPesar: pesar,
    composicao: {
      tipoPedido: 'personalizada', tamanho: selectedSize, pesar,
      qtyAcomp: selAcomp.length, qtyCarnePedacos: totalPedacos, qtySalada: selSalada.length
    }
  });

  salvarCarrinhoLocal();
  updateCart();
  clearPersonalizada();
  showToast(`✅ ${qty > 1 ? qty + 'x ' : ''}Marmita ${label} adicionada!`, 'sucesso');
}

function clearPersonalizada() {
  selAcomp = []; selCarne = {}; selSalada = [];
  qtyPersonalizada = 1;
  const qtyEl = document.getElementById('qtyPersonalizada');
  if (qtyEl) qtyEl.textContent = '1';
  buildGrids();
  document.getElementById('acompCounter').textContent  = 'Selecionados: 0 / 5';
  document.getElementById('carneCounter').textContent  = 'Selecionados: 0 pedaços';
  document.getElementById('saladaCounter').textContent = 'Selecionadas: 0 / 3';
  document.getElementById('acompCounter').classList.remove('warn');
  document.getElementById('carneCounter').classList.remove('warn');
  const obsP = document.getElementById('obsPersonalizada');
  if (obsP) obsP.value = '';
  updatePrecoPersonalizada();
}

// ========== CARRINHO ==========
function updateCart() {
  const container = document.getElementById('cartItems');
  document.getElementById('cartCount').textContent = cart.length;

  if (cart.length === 0) {
    container.innerHTML = '<p class="cart-empty">Seu carrinho está vazio.</p>';
    document.getElementById('cartTotal').textContent = 'R$ 0,00';
    return;
  }

  container.innerHTML = '';
  let total = 0;
  let temAPesar = false;
  cart.forEach((item, i) => {
    total += item.preco;
    if (item.aPesar) temAPesar = true;
    const div = document.createElement('div');
    div.className = 'cart-item';
    const precoExibido = item.aPesar
      ? `<span class="cart-item-price-pesar">A pesar</span>`
      : `<div class="cart-item-price">R$ ${item.preco.toFixed(2).replace('.', ',')}</div>`;
    div.innerHTML = `
      <div class="cart-item-title">${item.qty > 1 ? item.qty + 'x ' : ''}${item.tipo}</div>
      <div class="cart-item-desc">${item.desc}</div>
      ${precoExibido}
      <button class="remove-item" onclick="confirmarRemocao(${i})" title="Remover">✕</button>
    `;
    container.appendChild(div);
  });

  const totalEl = document.getElementById('cartTotal');
  if (temAPesar) {
    totalEl.innerHTML = `R$ ${total.toFixed(2).replace('.', ',')} <span class="total-pesar-aviso">+ itens a pesar</span>`;
  } else {
    totalEl.textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
  }
}

function confirmarRemocao(i) {
  abrirModalConfirm(
    'Remover item?',
    `Deseja remover <strong>${cart[i].tipo}</strong> do carrinho?`,
    () => removeItem(i)
  );
}

function removeItem(i) {
  cart.splice(i, 1);
  salvarCarrinhoLocal();
  updateCart();
}

function toggleCart() {
  const panel   = document.getElementById('cartPanel');
  const overlay = document.getElementById('overlay');
  const aviso   = document.getElementById('avisoBalcao');
  panel.classList.toggle('open');
  overlay.classList.toggle('open');
  if (aviso) aviso.classList.toggle('hidden-by-cart', panel.classList.contains('open'));
}

function salvarCarrinhoLocal() {
  try {
    localStorage.setItem('rdm_cart', JSON.stringify(cart));
    localStorage.setItem('rdm_cart_ts', Date.now());
  } catch(e) {}
}

function carregarCarrinhoLocal() {
  try {
    const ts = parseInt(localStorage.getItem('rdm_cart_ts') || '0');
    if (Date.now() - ts > 4 * 60 * 60 * 1000) {
      localStorage.removeItem('rdm_cart');
      localStorage.removeItem('rdm_cart_ts');
      return;
    }
    const salvo = localStorage.getItem('rdm_cart');
    if (salvo) {
      const parsed = JSON.parse(salvo);
      if (Array.isArray(parsed) && parsed.every(i => i && typeof i.tipo === 'string' && typeof i.preco === 'number')) {
        cart = parsed;
        updateCart();
        if (cart.length > 0) showToast(`Você tem ${cart.length} item(ns) do seu último acesso!`, 'info', 4000);
      } else {
        localStorage.removeItem('rdm_cart');
        localStorage.removeItem('rdm_cart_ts');
      }
    }
  } catch(e) {
    localStorage.removeItem('rdm_cart');
    localStorage.removeItem('rdm_cart_ts');
  }
}

function abrirModalConfirm(titulo, mensagem, onConfirm) {
  const overlay = document.getElementById('modalConfirmOverlay');
  const modal   = document.getElementById('modalConfirm');
  if (!overlay || !modal) { onConfirm(); return; }
  modal.querySelector('.modal-confirm-title').textContent = titulo;
  modal.querySelector('.modal-confirm-msg').innerHTML = mensagem;
  modal.querySelector('.modal-confirm-ok').onclick = () => { fecharModalConfirm(); onConfirm(); };
  overlay.classList.add('open');
  modal.classList.add('open');
}

function fecharModalConfirm() {
  document.getElementById('modalConfirmOverlay').classList.remove('open');
  document.getElementById('modalConfirm').classList.remove('open');
}

function abrirModalNome() {
  if (cart.length === 0) { showToast('Seu carrinho está vazio!', 'aviso'); return; }
  if (!estaAberto()) { showToast('Estamos fechados', 'aviso', 5000); return; }
  document.getElementById('inputNomeCliente').value = '';
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById('modalNome').classList.add('open');
  setTimeout(() => document.getElementById('inputNomeCliente').focus(), 100);
}

function fecharModalNome() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.getElementById('modalNome').classList.remove('open');
}

function confirmarPedido() {
  const nome = document.getElementById('inputNomeCliente').value.trim();
  if (!nome) {
    showToast('Por favor, digite seu nome antes de continuar.', 'aviso');
    document.getElementById('inputNomeCliente').focus();
    return;
  }
  fecharModalNome();
  enviarWhatsApp(nome);
}
function enviarWhatsApp(nomeCliente) {
  if (cart.length === 0) { showToast('Carrinho vazio!', 'aviso'); return; }

  const total = cart.reduce((sum, item) => sum + item.preco, 0);
  const temAPesar = cart.some(item => item.aPesar);
  const pedidoId = gerarIdPedido();

  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      pedidoId,
      nomeCliente,
      itens: cart.map(item => ({
        tipo: item.tipo,
        desc: item.descPlanilha,
        preco: item.aPesar ? 'A pesar' : item.preco,
        qty: item.qty || 1,
        composicao: item.composicao || null
      })),
      total: temAPesar ? `${total.toFixed(2)} + itens a pesar` : total.toFixed(2),
      totalMarmitas: cart.reduce((sum, item) => sum + (item.qty || 1), 0)
    })
  }).catch(err => console.warn('Erro ao salvar no Drive:', err));

  const totalMarmitas = cart.reduce((sum, item) => sum + (item.qty || 1), 0);
  let msg = `*Pedido — Restaurante do Mário*\n`;
  msg += `*Cliente: ${nomeCliente}*\n`;
  msg += `*Total de marmitas: ${totalMarmitas}*\n\n`;
  cart.forEach((item, i) => {
    const prefixo = item.qty > 1 ? `${item.qty}x ` : '';
    const precoStr = item.aPesar ? 'A pesar' : `R$ ${item.preco.toFixed(2).replace('.', ',')}`;
    msg += `*${i + 1}. ${prefixo}${item.tipo}*\n${item.desc}\n${precoStr}\n\n`;
  });
  const totalStr = temAPesar
    ? `R$ ${total.toFixed(2).replace('.', ',')} + itens a pesar`
    : `R$ ${total.toFixed(2).replace('.', ',')}`;
  msg += `*Total: ${totalStr}*\n`;

  cart = [];
  salvarCarrinhoLocal();
  updateCart();

  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}
    // ===== SCROLL SUAVE PARA SEÇÕES =====
    function scrollToSection(id) {
      const el = document.getElementById(id);
      if (!el) return;
      // Calcula a posição levando em conta o header fixo
      const headerHeight = document.querySelector('header').offsetHeight;
      const top = el.getBoundingClientRect().top + window.scrollY - headerHeight;
      window.scrollTo({ top, behavior: 'smooth' });
    }

    function atualizarNavAtiva() {
      const headerH = document.querySelector('header').offsetHeight;
      const secoes = [
        { id: 'inicio', navIdx: 0 },
        { id: 'cardapio-dia-sec', navIdx: 1 },
        { id: 'pedidos', navIdx: 2 },
        { id: 'localizacao', navIdx: 3 },
      ];

      let ativa = 0;
      secoes.forEach(({ id, navIdx }) => {
        const el = document.getElementById(id);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.top <= headerH + 10) ativa = navIdx;
      });

      document.querySelectorAll('nav button').forEach((btn, i) => {
        btn.classList.toggle('active', i === ativa);
      });

      const pedidosEl = document.getElementById('pedidos');
      const aviso = document.getElementById('avisoBalcao');
      if (pedidosEl && aviso) {
        const rect = pedidosEl.getBoundingClientRect();
        const visivel = rect.top < window.innerHeight && rect.bottom > headerH;
        aviso.classList.toggle('visible', visivel);
      }
    }

    window.addEventListener('scroll', atualizarNavAtiva, { passive: true });
    window.addEventListener('load', atualizarNavAtiva);

    function goToMarmitas() { scrollToSection('pedidos'); }
    function goToCardapio() { scrollToSection('cardapio-dia-sec'); }

    function showSection(id) { scrollToSection(id); }


// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
  carregarCardapio();
  carregarCarrinhoLocal();
  atualizarBadgeHorario();
  setInterval(atualizarBadgeHorario, 60000);
});
// ========== SELO "CARDÁPIO ATUALIZADO EM..." ==========
// Lê a data da categoria "atualizado" da planilha do cardápio e mostra
// no selo acima do Cardápio do Dia. Aceita "11/07/2026" ou "2026-07-11".
// Se a planilha não tiver a linha, o selo permanece oculto.
function mostrarCardapioAtualizado() {
  const selo = document.getElementById('cardapioAtualizado');
  if (!selo) return;

  const bruto = String(CARDAPIO_ATUALIZADO_EM || '').trim();
  if (!bruto) { selo.hidden = true; return; }

  // Normaliza para DD/MM/AAAA
  let dataBR = bruto;
  if (/^\d{4}-\d{2}-\d{2}/.test(bruto)) {
    const [a, m, d] = bruto.slice(0, 10).split('-');
    dataBR = `${d}/${m}/${a}`;
  }

  selo.textContent = `Cardápio atualizado em ${dataBR}`;
  selo.hidden = false;
}