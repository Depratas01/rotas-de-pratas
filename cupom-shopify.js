// Cupom automático dos pedidos do site (Shopify) — usado pela tela /cupom.html
//
// A tela do computador da loja pergunta a cada poucos segundos se há pedido pago
// ainda não impresso. Depois de imprimir, o pedido recebe a etiqueta (tag)
// "cupom-impresso" na própria Shopify — assim nada se perde se o servidor reiniciar
// e nenhum cupom sai repetido.
//
// Variáveis de ambiente:
//   SHOPIFY_LOJA            subdomínio da loja (padrão: jvgbjv-ti → jvgbjv-ti.myshopify.com)
//   SHOPIFY_CLIENT_ID       ┐ app criado no Dev Dashboard da Shopify
//   SHOPIFY_CLIENT_SECRET   ┘ (escopos: read_orders, write_orders)
//   SHOPIFY_TOKEN           alternativa: token shpat_... de um app antigo criado no admin
//   SHOPIFY_API_VERSAO      padrão 2026-07

const LOJA_SHOP = process.env.SHOPIFY_LOJA || 'jvgbjv-ti';
const DOMINIO = LOJA_SHOP.includes('.') ? LOJA_SHOP : `${LOJA_SHOP}.myshopify.com`;
const VERSAO = process.env.SHOPIFY_API_VERSAO || '2026-07';
const TAG = 'cupom-impresso';

let cache = { token: null, expira: 0 };

const configurado = () => !!(process.env.SHOPIFY_TOKEN || (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET));

async function obterToken(forcar = false) {
  if (process.env.SHOPIFY_TOKEN) return process.env.SHOPIFY_TOKEN;
  if (!forcar && cache.token && Date.now() < cache.expira) return cache.token;
  const r = await fetch(`https://${DOMINIO}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Shopify recusou as credenciais (' + r.status + ') ' + (j.error_description || j.error || ''));
  // renova 10 min antes de vencer (o token dura 24 h)
  cache = { token: j.access_token, expira: Date.now() + ((Number(j.expires_in) || 86400) - 600) * 1000 };
  return cache.token;
}

async function gql(query, variables, tentativa = 0) {
  const token = await obterToken(tentativa > 0);
  const r = await fetch(`https://${DOMINIO}/admin/api/${VERSAO}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (r.status === 401 && tentativa === 0 && !process.env.SHOPIFY_TOKEN) return gql(query, variables, 1);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error('Shopify: ' + (j.errors ? JSON.stringify(j.errors).slice(0, 300) : r.status));
  return j.data;
}

const Q_PEDIDOS = `query($q: String!) {
  orders(first: 50, sortKey: CREATED_AT, reverse: true, query: $q) {
    nodes {
      id name createdAt processedAt tags displayFinancialStatus cancelledAt note
      paymentGatewayNames email phone
      customer { displayName phone }
      shippingAddress { name address1 address2 city provinceCode zip phone company }
      shippingLine { title }
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      currentTotalPriceSet { shopMoney { amount } }
      lineItems(first: 60) { nodes { name sku quantity originalUnitPriceSet { shopMoney { amount } } discountedTotalSet { shopMoney { amount } } } }
    }
  }
}`;

const PAGOS = ['PAID', 'PARTIALLY_PAID', 'AUTHORIZED', 'PARTIALLY_REFUNDED'];
const limpar = (s) => String(s ?? '').replace(/[​-‍⁠﻿]/g, '').replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim();
const n = (m) => Number(m?.shopMoney?.amount || 0);

function normalizar(o) {
  const end = o.shippingAddress;
  const titulo = limpar(o.shippingLine?.title);
  const retirada = !end || /retir|pick ?up|busca/i.test(titulo);
  const itens = (o.lineItems?.nodes || []).map((i) => ({
    nome: limpar(i.name), sku: i.sku || '', qtd: i.quantity,
    unit: n(i.originalUnitPriceSet), total: n(i.discountedTotalSet),
  }));
  return {
    id: o.id,
    numero: o.name,
    criado_em: o.createdAt,
    pago: PAGOS.includes(o.displayFinancialStatus),
    status_pagamento: o.displayFinancialStatus,
    cancelado: !!o.cancelledAt,
    impresso: (o.tags || []).includes(TAG),
    cliente: limpar(end?.name || o.customer?.displayName || o.email || ''),
    telefone: limpar(end?.phone || o.customer?.phone || o.phone || ''),
    email: o.email || '',
    retirada,
    frete_nome: titulo,
    endereco: end ? [limpar(end.address1), limpar(end.address2), [limpar(end.city), end.provinceCode].filter(Boolean).join('/'), end.zip ? 'CEP ' + end.zip : ''].filter(Boolean).join(' · ') : '',
    itens,
    subtotal: itens.reduce((s, i) => s + i.unit * i.qtd, 0),
    desconto: n(o.totalDiscountsSet),
    frete: n(o.totalShippingPriceSet),
    total: n(o.currentTotalPriceSet),
    pagamento: (o.paymentGatewayNames || []).map(limpar).join(' + '),
    obs: limpar(o.note),
  };
}

function registrar(app, admin) {
  app.get('/api/cupom/status', admin, (req, res) => res.json({ configurado: configurado(), loja: DOMINIO }));

  // pedidos recentes (padrão: últimas 72 h), do mais antigo para o mais novo
  app.get('/api/cupom/pedidos', admin, async (req, res) => {
    if (!configurado()) return res.status(503).json({ erro: 'Shopify não configurada no servidor (falta SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET)' });
    try {
      const horas = Math.min(Math.max(Number(req.query.horas) || 72, 1), 24 * 30);
      const desde = new Date(Date.now() - horas * 3600e3).toISOString();
      const d = await gql(Q_PEDIDOS, { q: `created_at:>='${desde}'` });
      res.json({ pedidos: d.orders.nodes.map(normalizar).reverse(), servidor_em: new Date().toISOString() });
    } catch (e) {
      console.error('cupom/pedidos', e.message);
      res.status(502).json({ erro: e.message });
    }
  });

  app.post('/api/cupom/impresso', admin, async (req, res) => {
    const id = String(req.body.id || '');
    if (!id.startsWith('gid://shopify/Order/')) return res.status(400).json({ erro: 'id inválido' });
    try {
      const d = await gql(`mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`, { id, tags: [TAG] });
      const erros = d.tagsAdd.userErrors;
      if (erros.length) return res.status(400).json({ erro: erros.map((x) => x.message).join('; ') });
      res.json({ ok: true });
    } catch (e) {
      console.error('cupom/impresso', e.message);
      res.status(502).json({ erro: e.message });
    }
  });
}

module.exports = { registrar, normalizar };
