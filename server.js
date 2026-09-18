// Rotas De Pratas — servidor (painel + API do entregador)
process.env.TZ = process.env.TZ || 'America/Cuiaba';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const ADMIN_SENHA = process.env.ADMIN_SENHA || 'depratas';
const SEGREDO = process.env.SEGREDO || crypto.createHash('sha256').update('rotas-' + ADMIN_SENHA).digest('hex');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'rotas.db');
const LOJA = {
  nome: process.env.LOJA_NOME || 'De Pratas',
  lat: parseFloat(process.env.LOJA_LAT || '-20.4697'),
  lng: parseFloat(process.env.LOJA_LNG || '-54.6201'),
  cidade: process.env.LOJA_CIDADE || 'Campo Grande, MS',
};

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS entregadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL UNIQUE,
  pin TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  online INTEGER NOT NULL DEFAULT 0,
  ultima_lat REAL, ultima_lng REAL, ultima_precisao REAL, ultima_velocidade REAL, bateria INTEGER,
  ultima_pos_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS entregas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT,
  cliente TEXT,
  telefone_cliente TEXT,
  endereco TEXT NOT NULL,
  referencia TEXT,
  lat REAL, lng REAL,
  valor REAL DEFAULT 0,
  pagamento TEXT,
  obs TEXT,
  status TEXT NOT NULL DEFAULT 'loja',
  entregador_id INTEGER,
  ordem INTEGER DEFAULT 0,
  data TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  despachado_em TEXT, saiu_em TEXT, entregue_em TEXT,
  motivo_falha TEXT
);
CREATE TABLE IF NOT EXISTS posicoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entregador_id INTEGER NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  precisao REAL, velocidade REAL,
  em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pos_ent_em ON posicoes(entregador_id, em);
CREATE INDEX IF NOT EXISTS idx_entregas_data ON entregas(data);
CREATE TABLE IF NOT EXISTS geocache (q TEXT PRIMARY KEY, lat REAL, lng REAL, display TEXT);
`);

// ---------- utilidades ----------
const hoje = () => new Date().toLocaleDateString('sv');           // YYYY-MM-DD (fuso local)
const agora = () => new Date().toLocaleString('sv').replace('T', ' '); // YYYY-MM-DD HH:MM:SS
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

function assinar(tipo, id, dias = 30) {
  const exp = Date.now() + dias * 864e5;
  const base = `${tipo}:${id}:${exp}`;
  const sig = crypto.createHmac('sha256', SEGREDO).update(base).digest('base64url');
  return Buffer.from(base).toString('base64url') + '.' + sig;
}
function verificar(token) {
  if (!token || !token.includes('.')) return null;
  const [b, sig] = token.split('.');
  const base = Buffer.from(b, 'base64url').toString();
  const ok = crypto.createHmac('sha256', SEGREDO).update(base).digest('base64url');
  if (ok !== sig) return null;
  const [tipo, id, exp] = base.split(':');
  if (Date.now() > Number(exp)) return null;
  return { tipo, id: Number(id) };
}
const STATUS = ['loja', 'com_entregador', 'em_rota', 'entregue', 'nao_entregue', 'cancelada'];

// geocodificação (Nominatim/OpenStreetMap) com cache
async function geocodificar(endereco) {
  const q = String(endereco || '').trim();
  if (!q) return null;
  const chave = q.toLowerCase();
  const c = db.prepare('SELECT lat,lng,display FROM geocache WHERE q=?').get(chave);
  if (c) return c;
  const consulta = /campo grande|,\s*ms\b/i.test(q) ? q : `${q}, ${LOJA.cidade}`;
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' + encodeURIComponent(consulta);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'RotasDePratas/1.0 (painel de entregas)' } });
    const j = await r.json();
    if (!j[0]) return null;
    const res = { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), display: j[0].display_name };
    db.prepare('INSERT OR REPLACE INTO geocache VALUES (?,?,?,?)').run(chave, res.lat, res.lng, res.display);
    return res;
  } catch (e) { return null; }
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/api/loja', (req, res) => res.json(LOJA));

// --- auth ---
function admin(req, res, next) {
  const t = verificar(req.get('x-admin-token') || req.query.token);
  if (!t || t.tipo !== 'admin') return res.status(401).json({ erro: 'não autorizado' });
  next();
}
function entregador(req, res, next) {
  const t = verificar(req.get('x-token') || req.query.token);
  if (!t || t.tipo !== 'ent') return res.status(401).json({ erro: 'não autorizado' });
  const e = db.prepare('SELECT * FROM entregadores WHERE id=? AND ativo=1').get(t.id);
  if (!e) return res.status(401).json({ erro: 'entregador inativo' });
  req.entregador = e;
  next();
}

app.post('/api/admin/login', (req, res) => {
  if (String(req.body.senha || '') !== ADMIN_SENHA) return res.status(401).json({ erro: 'senha incorreta' });
  res.json({ token: assinar('admin', 1, 90) });
});
app.get('/api/admin/eu', admin, (req, res) => res.json({ ok: true }));

// --- entregadores ---
app.get('/api/admin/entregadores', admin, (req, res) => {
  res.json(db.prepare('SELECT id,nome,telefone,pin,ativo,online,ultima_lat,ultima_lng,ultima_precisao,ultima_velocidade,bateria,ultima_pos_em FROM entregadores ORDER BY nome').all());
});
app.post('/api/admin/entregadores', admin, (req, res) => {
  const { nome, telefone, pin } = req.body;
  const tel = soDigitos(telefone);
  if (!nome || tel.length < 10 || !/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ erro: 'nome, telefone (com DDD) e PIN de 4 dígitos' });
  try {
    const r = db.prepare('INSERT INTO entregadores (nome,telefone,pin) VALUES (?,?,?)').run(nome.trim(), tel, String(pin));
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(400).json({ erro: 'telefone já cadastrado' }); }
});
app.put('/api/admin/entregadores/:id', admin, (req, res) => {
  const e = db.prepare('SELECT * FROM entregadores WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ erro: 'não encontrado' });
  const nome = req.body.nome ?? e.nome, pin = req.body.pin ?? e.pin, ativo = req.body.ativo ?? e.ativo;
  const telefone = req.body.telefone ? soDigitos(req.body.telefone) : e.telefone;
  db.prepare('UPDATE entregadores SET nome=?,telefone=?,pin=?,ativo=? WHERE id=?').run(nome, telefone, String(pin), ativo ? 1 : 0, e.id);
  res.json({ ok: true });
});
app.delete('/api/admin/entregadores/:id', admin, (req, res) => {
  db.prepare('UPDATE entregadores SET ativo=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/entregadores/posicoes', admin, (req, res) => {
  const data = req.query.data || hoje();
  const rows = db.prepare(`
    SELECT e.id,e.nome,e.telefone,e.online,e.ultima_lat lat,e.ultima_lng lng,e.ultima_precisao precisao,e.ultima_velocidade velocidade,e.bateria,e.ultima_pos_em em,
      (SELECT COUNT(*) FROM entregas x WHERE x.entregador_id=e.id AND x.data=? AND x.status IN ('com_entregador','em_rota')) pendentes,
      (SELECT COUNT(*) FROM entregas x WHERE x.entregador_id=e.id AND x.data=? AND x.status='entregue') entregues
    FROM entregadores e WHERE e.ativo=1 ORDER BY e.nome`).all(data, data);
  const limite = Date.now() - 3 * 60e3;
  for (const r of rows) r.ao_vivo = !!(r.em && new Date(r.em).getTime() > limite);
  res.json(rows);
});
app.get('/api/admin/entregadores/:id/trajeto', admin, (req, res) => {
  const data = req.query.data || hoje();
  const rows = db.prepare(`SELECT lat,lng,precisao,velocidade,em FROM posicoes WHERE entregador_id=? AND em BETWEEN ? AND ? ORDER BY em`)
    .all(req.params.id, data + ' 00:00:00', data + ' 23:59:59');
  res.json(rows);
});

// --- entregas ---
function listarEntregas(data) {
  return db.prepare(`SELECT x.*, e.nome entregador_nome FROM entregas x LEFT JOIN entregadores e ON e.id=x.entregador_id
    WHERE x.data=? ORDER BY x.entregador_id IS NULL DESC, x.entregador_id, x.ordem, x.id`).all(data);
}
app.get('/api/admin/entregas', admin, (req, res) => res.json(listarEntregas(req.query.data || hoje())));
app.get('/api/admin/resumo', admin, (req, res) => {
  const data = req.query.data || hoje();
  const r = {};
  for (const s of STATUS) r[s] = 0;
  for (const x of db.prepare('SELECT status, COUNT(*) n, SUM(valor) v FROM entregas WHERE data=? GROUP BY status').all(data)) r[x.status] = x.n;
  r.a_receber = db.prepare(`SELECT COALESCE(SUM(valor),0) v FROM entregas WHERE data=? AND status IN ('com_entregador','em_rota','entregue') AND LOWER(COALESCE(pagamento,'')) LIKE '%entrega%'`).get(data).v;
  r.na_rua = db.prepare(`SELECT COUNT(DISTINCT entregador_id) n FROM entregas WHERE data=? AND status IN ('com_entregador','em_rota')`).get(data).n;
  res.json(r);
});
app.post('/api/admin/entregas', admin, async (req, res) => {
  const b = req.body;
  if (!b.endereco) return res.status(400).json({ erro: 'endereço obrigatório' });
  let lat = b.lat, lng = b.lng;
  if (lat == null || lng == null) { const g = await geocodificar(b.endereco); if (g) { lat = g.lat; lng = g.lng; } }
  const r = db.prepare(`INSERT INTO entregas (numero,cliente,telefone_cliente,endereco,referencia,lat,lng,valor,pagamento,obs,data)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(b.numero || null, b.cliente || null, soDigitos(b.telefone_cliente) || null, b.endereco, b.referencia || null,
    lat ?? null, lng ?? null, Number(b.valor) || 0, b.pagamento || null, b.obs || null, b.data || hoje());
  res.json({ id: r.lastInsertRowid, lat, lng, geocodificado: lat != null });
});
app.put('/api/admin/entregas/:id', admin, async (req, res) => {
  const x = db.prepare('SELECT * FROM entregas WHERE id=?').get(req.params.id);
  if (!x) return res.status(404).json({ erro: 'não encontrada' });
  const b = req.body;
  let lat = b.lat ?? x.lat, lng = b.lng ?? x.lng;
  if (b.endereco && b.endereco !== x.endereco && b.lat == null) { const g = await geocodificar(b.endereco); if (g) { lat = g.lat; lng = g.lng; } }
  db.prepare(`UPDATE entregas SET numero=?,cliente=?,telefone_cliente=?,endereco=?,referencia=?,lat=?,lng=?,valor=?,pagamento=?,obs=? WHERE id=?`)
    .run(b.numero ?? x.numero, b.cliente ?? x.cliente, b.telefone_cliente != null ? soDigitos(b.telefone_cliente) : x.telefone_cliente, b.endereco ?? x.endereco,
      b.referencia ?? x.referencia, lat, lng, b.valor != null ? Number(b.valor) : x.valor, b.pagamento ?? x.pagamento, b.obs ?? x.obs, x.id);
  res.json({ ok: true });
});
app.delete('/api/admin/entregas/:id', admin, (req, res) => {
  db.prepare('DELETE FROM entregas WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/entregas/despachar', admin, (req, res) => {
  const { ids, entregador_id } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ erro: 'selecione entregas' });
  const ent = entregador_id ? db.prepare('SELECT id FROM entregadores WHERE id=? AND ativo=1').get(entregador_id) : null;
  const tx = db.transaction(() => {
    let ordem = ent ? (db.prepare('SELECT COALESCE(MAX(ordem),0) m FROM entregas WHERE entregador_id=? AND data=?').get(ent.id, hoje()).m) : 0;
    for (const id of ids) {
      if (ent) db.prepare(`UPDATE entregas SET entregador_id=?, status='com_entregador', despachado_em=?, ordem=? WHERE id=? AND status NOT IN ('entregue','cancelada')`).run(ent.id, agora(), ++ordem, id);
      else db.prepare(`UPDATE entregas SET entregador_id=NULL, status='loja', despachado_em=NULL, ordem=0 WHERE id=? AND status NOT IN ('entregue','cancelada')`).run(id);
    }
  });
  tx();
  res.json({ ok: true });
});
app.post('/api/admin/entregas/status', admin, (req, res) => {
  const { ids, status } = req.body;
  if (!STATUS.includes(status) || !Array.isArray(ids)) return res.status(400).json({ erro: 'status inválido' });
  const campo = status === 'entregue' ? 'entregue_em' : status === 'em_rota' ? 'saiu_em' : null;
  for (const id of ids) {
    db.prepare(`UPDATE entregas SET status=? ${campo ? `, ${campo}=?` : ''} ${status === 'loja' ? ', entregador_id=NULL, despachado_em=NULL' : ''} WHERE id=?`)
      .run(...(campo ? [status, agora(), id] : [status, id]));
  }
  res.json({ ok: true });
});
app.post('/api/admin/entregas/reordenar', admin, (req, res) => {
  const { ids } = req.body; // ordem desejada
  const tx = db.transaction(() => ids.forEach((id, i) => db.prepare('UPDATE entregas SET ordem=? WHERE id=?').run(i + 1, id)));
  tx();
  res.json({ ok: true });
});
app.get('/api/admin/geocode', admin, async (req, res) => res.json(await geocodificar(req.query.q) || { erro: 'não encontrado' }));

// --- API do entregador (app do celular) ---
app.post('/api/entregador/login', (req, res) => {
  const tel = soDigitos(req.body.telefone), pin = String(req.body.pin || '');
  const e = db.prepare('SELECT * FROM entregadores WHERE telefone=? AND pin=? AND ativo=1').get(tel, pin);
  if (!e) return res.status(401).json({ erro: 'telefone ou PIN incorretos' });
  db.prepare('UPDATE entregadores SET online=1 WHERE id=?').run(e.id);
  res.json({ token: assinar('ent', e.id, 180), nome: e.nome, id: e.id, loja: LOJA });
});
app.get('/api/entregador/rota', entregador, (req, res) => {
  const rows = db.prepare(`SELECT id,numero,cliente,telefone_cliente,endereco,referencia,lat,lng,valor,pagamento,obs,status,ordem,saiu_em,entregue_em
    FROM entregas WHERE entregador_id=? AND data=? ORDER BY (status='entregue'), ordem, id`).all(req.entregador.id, hoje());
  res.json({ nome: req.entregador.nome, loja: LOJA, entregas: rows, servidor_em: agora() });
});
function gravarPosicao(entId, p) {
  const lat = Number(p.lat), lng = Number(p.lng);
  if (!isFinite(lat) || !isFinite(lng)) return;
  const em = p.em ? new Date(p.em).toLocaleString('sv').replace('T', ' ') : agora();
  db.prepare('INSERT INTO posicoes (entregador_id,lat,lng,precisao,velocidade,em) VALUES (?,?,?,?,?,?)').run(entId, lat, lng, p.precisao ?? null, p.velocidade ?? null, em);
  db.prepare('UPDATE entregadores SET online=1, ultima_lat=?, ultima_lng=?, ultima_precisao=?, ultima_velocidade=?, bateria=COALESCE(?,bateria), ultima_pos_em=? WHERE id=? AND (ultima_pos_em IS NULL OR ultima_pos_em<=?)')
    .run(lat, lng, p.precisao ?? null, p.velocidade ?? null, p.bateria ?? null, em, entId, em);
}
app.post('/api/entregador/posicao', entregador, (req, res) => {
  const lista = Array.isArray(req.body) ? req.body : (req.body.posicoes || [req.body]);
  const tx = db.transaction(() => lista.forEach(p => gravarPosicao(req.entregador.id, p)));
  tx();
  res.json({ ok: true, n: lista.length });
});
app.post('/api/entregador/entrega/:id', entregador, (req, res) => {
  const x = db.prepare('SELECT * FROM entregas WHERE id=? AND entregador_id=?').get(req.params.id, req.entregador.id);
  if (!x) return res.status(404).json({ erro: 'entrega não é sua' });
  const s = req.body.status;
  if (s === 'em_rota') db.prepare(`UPDATE entregas SET status='em_rota', saiu_em=COALESCE(saiu_em,?) WHERE id=?`).run(agora(), x.id);
  else if (s === 'entregue') db.prepare(`UPDATE entregas SET status='entregue', entregue_em=?, saiu_em=COALESCE(saiu_em,?) WHERE id=?`).run(agora(), agora(), x.id);
  else if (s === 'nao_entregue') db.prepare(`UPDATE entregas SET status='nao_entregue', motivo_falha=? WHERE id=?`).run(req.body.motivo || null, x.id);
  else return res.status(400).json({ erro: 'status inválido' });
  if (req.body.lat != null) gravarPosicao(req.entregador.id, req.body);
  res.json({ ok: true });
});
app.post('/api/entregador/sair', entregador, (req, res) => {
  db.prepare('UPDATE entregadores SET online=0 WHERE id=?').run(req.entregador.id);
  res.json({ ok: true });
});

// limpeza: mantém 60 dias de posições
setInterval(() => { try { db.prepare("DELETE FROM posicoes WHERE em < date('now','-60 days')").run(); } catch (e) {} }, 6 * 3600e3);

app.get('/', (req, res) => res.redirect('/rotas.html'));
app.listen(PORT, () => console.log(`Rotas ${LOJA.nome} rodando em http://localhost:${PORT}  (senha admin: ${ADMIN_SENHA === 'depratas' ? 'padrão "depratas" — defina ADMIN_SENHA' : 'definida'})`));
