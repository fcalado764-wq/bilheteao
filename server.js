// ============================================================
// server.js — BilheteAO v3.0 — 100% compatível com Vercel
// Sem escrita em disco — tudo em memória + Supabase Storage
// ============================================================
require('dotenv').config();

const express     = require('express');
const path        = require('path');
const { v4: uuidv4 } = require('uuid');
const QRCode      = require('qrcode');
const PDFDocument = require('pdfkit');
const multer      = require('multer');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PORT     = process.env.PORT || 3000;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || `http://localhost:${PORT}`;
const STORAGE_BUCKET = 'bilheteao';
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
const EMAILJS_REGISTER_TEMPLATE_ID = process.env.EMAILJS_REGISTER_TEMPLATE_ID;
const EMAILJS_TICKET_TEMPLATE_ID = process.env.EMAILJS_TICKET_TEMPLATE_ID;

console.log('SUPABASE_URL:', SUPABASE_URL ? 'OK' : 'EM FALTA');
console.log('SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? 'OK' : 'EM FALTA');
console.log('SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'OK' : 'EM FALTA');
console.log('EMAILJS:', EMAILJS_SERVICE_ID && EMAILJS_PUBLIC_KEY ? 'OK' : 'OPCIONAL/EM FALTA');

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const app = express();

// Servir ficheiros estáticos (HTML, CSS, JS) — leitura apenas, funciona no Vercel
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/css',  express.static(path.join(__dirname, 'static', 'css')));
app.use('/js',   express.static(path.join(__dirname, 'static', 'js')));
app.use(express.static(path.join(__dirname, 'static')));

// ------------------------------------------------------------
// MULTER — memória apenas (sem disco)
// ------------------------------------------------------------
const uploadEvent = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas.'));
  }
});

// ------------------------------------------------------------
// SUPABASE STORAGE — upload de imagem
// ------------------------------------------------------------
async function uploadImage(file, folder) {
  if (!file) return null;
  try {
    const ext      = path.extname(file.originalname);
    const filename = `${folder}/${uuidv4()}${ext}`;
    const { error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(filename, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) { console.error('Erro upload imagem:', error.message); return null; }
    const { data } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(filename);
    return data.publicUrl;
  } catch(e) { console.error('Upload erro:', e.message); return null; }
}

// ------------------------------------------------------------
// SUPABASE STORAGE — upload de PDF
// ------------------------------------------------------------
async function uploadPDF(buffer, filename) {
  try {
    const { error } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(`tickets/${filename}`, buffer, { contentType: 'application/pdf', upsert: false });
    if (error) { console.error('Erro upload PDF:', error.message); return null; }
    const { data } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(`tickets/${filename}`);
    return data.publicUrl;
  } catch(e) { console.error('PDF upload erro:', e.message); return null; }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(email || '').trim());
}

async function sendEmailJS(templateId, templateParams) {
  if (!EMAILJS_SERVICE_ID || !EMAILJS_PUBLIC_KEY || !templateId) {
    console.log('EmailJS ignorado: configuracao incompleta.');
    return { skipped: true };
  }

  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: templateId,
        user_id: EMAILJS_PUBLIC_KEY,
        accessToken: EMAILJS_PRIVATE_KEY || undefined,
        template_params: templateParams
      })
    });

    const text = await response.text();
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
    return { success: true, text };
  } catch (error) {
    console.error('Erro EmailJS:', error.message);
    return { success: false, error: error.message };
  }
}

function normalizeTicketTypes(rawTypes, fallbackPrice, fallbackSeats) {
  let parsed = rawTypes;
  if (typeof rawTypes === 'string') {
    try { parsed = JSON.parse(rawTypes); } catch { parsed = null; }
  }

  const source = Array.isArray(parsed) && parsed.length ? parsed : [{
    id: 'normal',
    name: 'Normal',
    price: fallbackPrice,
    totalSeats: fallbackSeats,
    soldSeats: 0
  }];

  return source
    .map((type, index) => {
      const name = String(type.name || '').trim();
      const price = Number(type.price);
      const totalSeats = parseInt(type.totalSeats ?? type.total_seats ?? type.seats, 10);
      const soldSeats = parseInt(type.soldSeats ?? type.sold_seats ?? 0, 10) || 0;
      const safeName = name || `Area ${index + 1}`;
      return {
        id: String(type.id || safeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-|-$/g, '') || `area-${index + 1}`,
        name: safeName,
        price: Number.isFinite(price) && price >= 0 ? price : 0,
        totalSeats: Number.isFinite(totalSeats) && totalSeats > 0 ? totalSeats : 1,
        soldSeats: Math.max(0, soldSeats)
      };
    })
    .filter((type) => type.totalSeats > 0);
}

function summarizeTicketTypes(ticketTypes) {
  const totalSeats = ticketTypes.reduce((sum, type) => sum + type.totalSeats, 0);
  const soldSeats = ticketTypes.reduce((sum, type) => sum + type.soldSeats, 0);
  const minPrice = ticketTypes.reduce((min, type) => Math.min(min, type.price), Number.POSITIVE_INFINITY);
  return {
    totalSeats,
    soldSeats,
    price: Number.isFinite(minPrice) ? minPrice : 0
  };
}

// ------------------------------------------------------------
// GERAÇÃO DE PDF A5 — retorna Buffer (sem disco)
// ------------------------------------------------------------
async function generateTicketPDF(data) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A5', margin: 0 });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width, H = doc.page.height;
    doc.rect(0,0,W,H).fill('#0f0f1a');
    doc.rect(0,0,W,160).fill('#1a1a2e');
    doc.moveTo(0,160).lineTo(W,160).strokeColor('#e94560').lineWidth(3).stroke();
    doc.fontSize(36).fillColor('#ffffff').text(data.event.emoji||'🎟️', W/2-22, 20, {align:'center',width:44});
    doc.fontSize(15).fillColor('#ffffff').font('Helvetica-Bold').text(data.event.name.toUpperCase(), 20, 73, {align:'center',width:W-40});
    doc.fontSize(8).fillColor('#e94560').font('Helvetica').text(`[ ${data.event.category} ]`, 20, 127, {align:'center',width:W-40});

    const iY = 175;
    const df = (label, value, x, y) => {
      doc.fontSize(7).fillColor('#8888aa').font('Helvetica').text(label.toUpperCase(), x, y);
      doc.fontSize(9.5).fillColor('#ffffff').font('Helvetica-Bold').text(String(value), x, y+11);
    };
    const ds = new Date(data.event.date).toLocaleDateString('pt-PT', {day:'2-digit',month:'long',year:'numeric'});
    df('Data',      ds,                   20,       iY);
    df('Hora',      data.event.time+'h',  W/2+10,   iY);
    df('Local',     data.event.location,  20,       iY+45);
    df('Código',    data.ticketCode,      W/2+10,   iY+45);
    df('Titular',   data.customerName,    20,       iY+90);
    df('Area',      data.ticketType || 'Normal', W/2+10, iY+90);

    const sY = iY+145;
    doc.moveTo(0,sY).lineTo(W,sY).strokeColor('#333355').lineWidth(1.5).dash(6,{space:4}).stroke();
    doc.undash();
    doc.circle(0,sY,10).fill('#0f0f1a');
    doc.circle(W,sY,10).fill('#0f0f1a');
    doc.fontSize(7).fillColor('#555577').text('✂  DESTAQUE AQUI', 20, sY-7, {align:'center',width:W-40});

    const qY=sY+20, qS=118, qX=(W-qS)/2;
    doc.roundedRect(qX-8, qY-8, qS+16, qS+16, 8).fill('#ffffff');
    doc.image(Buffer.from(data.qrCodeDataURL.replace(/^data:image\/png;base64,/,''),'base64'), qX, qY, {width:qS,height:qS});
    doc.fontSize(12).fillColor('#e94560').font('Helvetica-Bold')
       .text(((data.ticketPrice ?? data.event.price)*data.quantity).toLocaleString('pt-AO')+' AOA', 20, qY+qS+18, {align:'center',width:W-40});
    doc.fontSize(7).fillColor('#555577').font('Helvetica')
       .text('Apresente este QR Code na entrada do evento', 20, qY+qS+34, {align:'center',width:W-40});
    doc.rect(0,H-28,W,32).fill('#1a1a2e');
    doc.fontSize(6).fillColor('#555577')
       .text(`Comprado em ${new Date(data.purchaseDate).toLocaleString('pt-PT')}  •  BilheteAO`, 10, H-18, {align:'center',width:W-20});
    doc.end();
  });
}

// ------------------------------------------------------------
// HELPERS AUTH
// ------------------------------------------------------------
async function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token) return res.status(401).json({ success: false, message: 'Sessão expirada. Faça login novamente.', needLogin: true });
  const { data, error } = await supabaseAdmin
    .from('sessions').select('*').eq('token', token)
    .gt('expires_at', new Date().toISOString()).single();
  if (error || !data) return res.status(401).json({ success: false, message: 'Sessão expirada. Faça login novamente.', needLogin: true });
  req.user = { id: data.user_id, name: data.user_name, email: data.user_email, role: data.user_role };
  next();
}

async function requireAdminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ success: false, message: 'Acesso não autorizado.' });
  const { data, error } = await supabaseAdmin
    .from('admin_sessions').select('*').eq('token', token)
    .gt('expires_at', new Date().toISOString()).single();
  if (error || !data) return res.status(401).json({ success: false, message: 'Sessão admin expirada.' });
  req.admin = { username: data.username };
  next();
}

function withExtras(e) {
  const ticketTypes = normalizeTicketTypes(e.ticket_types, e.price, e.total_seats);
  const summary = summarizeTicketTypes(ticketTypes);
  return {
    ...e,
    price:          summary.price,
    availableSeats: summary.totalSeats - summary.soldSeats,
    soldOut:        summary.soldSeats >= summary.totalSeats,
    totalSeats:     summary.totalSeats,
    soldSeats:      summary.soldSeats,
    ticketTypes,
    ticket_types:   ticketTypes,
    submittedByName: e.submitted_by_name,
    coverUrl:  e.cover  || null,
    posterUrl: e.poster || null
  };
}

function saleWithExtras(s) {
  return {
    ...s,
    purchaseDate: s.purchased_at,
    pdfFile: s.pdf_file,
    pdfUrl: s.pdf_file,
    ticketCode: s.ticket_code,
    eventName: s.event_name,
    customerName: s.customer_name,
    customerEmail: s.customer_email,
    ticketType: s.ticket_type || 'Normal',
    totalPrice: parseFloat(s.total_price) || 0,
    quantity: parseInt(s.quantity, 10) || 1
  };
}

// ------------------------------------------------------------
// PÁGINAS HTML
// ------------------------------------------------------------
const pages = {
  '/': 'index.html', '/event/:id': 'event.html',
  '/confirmation': 'confirmation.html', '/validate': 'validate.html',
  '/login': 'login.html', '/register': 'register.html',
  '/submit-event': 'submit-event.html', '/account': 'account.html',
  '/admin': 'admin-login.html', '/admin/dashboard': 'admin-dashboard.html'
};
Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'templates', file)));
});

// Diagnóstico
app.get('/api/health', async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('events').select('count').limit(1);
    res.json({
      status: 'ok',
      supabaseUrl: SUPABASE_URL ? 'definido' : 'em falta',
      supabaseKey: SUPABASE_ANON_KEY ? 'definido' : 'em falta',
      supabaseServiceKey: SUPABASE_SERVICE_KEY ? 'definido' : 'em falta',
      dbConnection: error ? 'erro: ' + error.message : 'ok'
    });
  } catch(e) { res.json({ status: 'erro', message: e.message }); }
});

// ------------------------------------------------------------
// API AUTH UTILIZADORES
// ------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Preencha todos os campos.' });
  if (!isValidEmail(cleanEmail)) return res.status(400).json({ success: false, message: 'Informe um e-mail valido.' });
  if (password.length < 6) return res.status(400).json({ success: false, message: 'Senha deve ter pelo menos 6 caracteres.' });
  const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', cleanEmail).single();
  if (existing) return res.status(400).json({ success: false, message: 'E-mail já registado.' });
  const { data: user, error } = await supabaseAdmin.from('users').insert({ name, email: cleanEmail, password, role: 'user' }).select().single();
  if (error) return res.status(500).json({ success: false, message: 'Erro ao criar conta: ' + error.message });
  const token = uuidv4();
  await supabaseAdmin.from('sessions').insert({ token, user_id: user.id, user_name: user.name, user_email: user.email, user_role: user.role });
  await sendEmailJS(EMAILJS_REGISTER_TEMPLATE_ID, {
    to_email: user.email,
    to_name: user.name,
    user_name: user.name,
    user_email: user.email,
    site_url: SITE_URL,
    created_at: new Date().toLocaleString('pt-PT')
  });
  res.json({ success: true, token, user: { name: user.name, email: user.email } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = String(email || '').trim().toLowerCase();
  const { data: user, error } = await supabaseAdmin.from('users').select('*').eq('email', cleanEmail).eq('password', password).single();
  if (error || !user) return res.status(401).json({ success: false, message: 'E-mail ou senha incorrectos.' });
  const token = uuidv4();
  await supabaseAdmin.from('sessions').insert({ token, user_id: user.id, user_name: user.name, user_email: user.email, user_role: user.role });
  res.json({ success: true, token, user: { name: user.name, email: user.email } });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await supabaseAdmin.from('sessions').delete().eq('token', req.headers['x-auth-token']);
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.put('/api/auth/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ success: false, message: 'Preencha a senha actual e a nova senha.' });
  if (newPassword.length < 6)
    return res.status(400).json({ success: false, message: 'A nova senha deve ter pelo menos 6 caracteres.' });

  const { data: user, error } = await supabaseAdmin
    .from('users').select('password').eq('id', req.user.id).single();
  if (error || !user) return res.status(404).json({ success: false, message: 'Utilizador não encontrado.' });
  if (user.password !== currentPassword)
    return res.status(400).json({ success: false, message: 'Senha actual incorrecta.' });

  const { error: updateError } = await supabaseAdmin
    .from('users').update({ password: newPassword }).eq('id', req.user.id);
  if (updateError) return res.status(500).json({ success: false, message: 'Erro ao actualizar senha.' });

  await supabaseAdmin.from('sessions').delete().eq('user_id', req.user.id).neq('token', req.headers['x-auth-token']);
  res.json({ success: true, message: 'Senha actualizada com sucesso.' });
});

// ------------------------------------------------------------
// API ADMIN AUTH + CREDENCIAIS
// ------------------------------------------------------------
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const { data: creds, error } = await supabaseAdmin.from('admin_credentials').select('*').eq('id', 1).single();
  if (error) return res.status(500).json({ success: false, message: 'Erro BD: ' + error.message });
  if (!creds || username !== creds.username || password !== creds.password)
    return res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
  const token = uuidv4();
  await supabaseAdmin.from('admin_sessions').insert({ token, username });
  res.json({ success: true, token });
});

app.post('/api/admin/logout', requireAdminAuth, async (req, res) => {
  await supabaseAdmin.from('admin_sessions').delete().eq('token', req.headers['x-admin-token']);
  res.json({ success: true });
});

app.put('/api/admin/credentials', requireAdminAuth, async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  const { data: creds } = await supabaseAdmin.from('admin_credentials').select('*').eq('id', 1).single();
  if (currentPassword !== creds.password) return res.status(400).json({ success: false, message: 'Senha actual incorrecta.' });
  if (newPassword && newPassword.length < 6) return res.status(400).json({ success: false, message: 'Nova senha deve ter pelo menos 6 caracteres.' });
  const updates = {};
  if (username) updates.username = username;
  if (newPassword) updates.password = newPassword;
  await supabaseAdmin.from('admin_credentials').update(updates).eq('id', 1);
  await supabaseAdmin.from('admin_sessions').delete().neq('token', '');
  res.json({ success: true, message: 'Credenciais actualizadas. Faça login novamente.' });
});

// ------------------------------------------------------------
// API ADMIN DADOS
// ------------------------------------------------------------
app.get('/api/admin/stats', requireAdminAuth, async (req, res) => {
  const [evRes, usRes, saRes] = await Promise.all([
    supabaseAdmin.from('events').select('status'),
    supabaseAdmin.from('users').select('id'),
    supabaseAdmin.from('sales').select('quantity, total_price, validated')
  ]);
  const events = evRes.data||[], sales = saRes.data||[];
  res.json({ success: true, data: {
    totalEvents:      events.filter(e => e.status==='approved').length,
    pendingEvents:    events.filter(e => e.status==='pending').length,
    totalUsers:       (usRes.data||[]).length,
    totalSales:       sales.length,
    totalTickets:     sales.reduce((s,x) => s+(parseInt(x.quantity, 10) || 1), 0),
    totalRevenue:     sales.reduce((s,x) => s+(parseFloat(x.total_price) || 0), 0),
    validatedTickets: sales.filter(s => s.validated).length
  }});
});

app.get('/api/admin/users', requireAdminAuth, async (req, res) => {
  const { data } = await supabaseAdmin.from('users').select('id,name,email,role,created_at').order('created_at', { ascending: false });
  res.json({ success: true, data: (data||[]).map(u => ({ ...u, createdAt: u.created_at })) });
});

app.get('/api/admin/sales', requireAdminAuth, async (req, res) => {
  const { data } = await supabaseAdmin.from('sales').select('*').order('purchased_at', { ascending: false });
  res.json({ success: true, data: (data||[]).map(saleWithExtras) });
});

app.get('/api/admin/events', requireAdminAuth, async (req, res) => {
  const { data } = await supabaseAdmin.from('events').select('*').order('created_at', { ascending: false });
  res.json({ success: true, data: (data||[]).map(withExtras) });
});

app.put('/api/admin/events/:id/approve', requireAdminAuth, async (req, res) => {
  const { error } = await supabaseAdmin.from('events').update({ status: 'approved' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, message: 'Evento aprovado.' });
});

app.put('/api/admin/events/:id/reject', requireAdminAuth, async (req, res) => {
  const { error } = await supabaseAdmin.from('events').update({ status: 'rejected' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, message: 'Evento rejeitado.' });
});

app.post('/api/admin/events', requireAdminAuth, uploadEvent.fields([
  { name: 'cover', maxCount: 1 }, { name: 'poster', maxCount: 1 }
]), async (req, res) => {
  const { name, date, time, location, price, category, customCategory, totalSeats, emoji, description } = req.body;
  if (!name || !date || !time || !location || !price || !totalSeats)
    return res.status(400).json({ success: false, message: 'Preencha todos os campos obrigatórios.' });
  const ticketTypes = normalizeTicketTypes(req.body.ticketTypes, price, totalSeats);
  const summary = summarizeTicketTypes(ticketTypes);
  const finalCategory = category === 'Personalizar' ? String(customCategory || '').trim() : category;
  if (category === 'Personalizar' && !finalCategory)
    return res.status(400).json({ success: false, message: 'Informe a categoria personalizada.' });
  const coverUrl  = await uploadImage(req.files?.cover?.[0],  'covers');
  const posterUrl = await uploadImage(req.files?.poster?.[0], 'posters');
  const { data, error } = await supabaseAdmin.from('events').insert({
    name, date, time, location, price: summary.price, category: finalCategory||'Geral',
    total_seats: summary.totalSeats, sold_seats: summary.soldSeats, ticket_types: ticketTypes, emoji: emoji||'B',
    description: description||'', cover: coverUrl, poster: posterUrl,
    status: 'approved', submitted_by_name: 'Administrador'
  }).select().single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data: withExtras(data) });
});

app.delete('/api/admin/events/:id', requireAdminAuth, async (req, res) => {
  const { error } = await supabaseAdmin.from('events').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, message: 'Evento eliminado.' });
});

// ------------------------------------------------------------
// API EVENTOS PÚBLICOS
// ------------------------------------------------------------
app.get('/api/events', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('events').select('*').eq('status', 'approved').order('date');
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data: (data||[]).map(withExtras) });
});

app.get('/api/events/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('events').select('*').eq('id', req.params.id).eq('status', 'approved').single();
  if (error || !data) return res.status(404).json({ success: false, message: 'Evento não encontrado.' });
  res.json({ success: true, data: withExtras(data) });
});

// ------------------------------------------------------------
// API SUBMISSÃO DE EVENTO POR UTILIZADOR
// ------------------------------------------------------------
app.post('/api/events/submit', requireAuth, uploadEvent.fields([
  { name: 'cover', maxCount: 1 }, { name: 'poster', maxCount: 1 }
]), async (req, res) => {
  const { name, date, time, location, price, category, customCategory, totalSeats, emoji, description } = req.body;
  if (!name || !date || !time || !location || !price || !totalSeats)
    return res.status(400).json({ success: false, message: 'Preencha todos os campos obrigatórios.' });
  const ticketTypes = normalizeTicketTypes(req.body.ticketTypes, price, totalSeats);
  const summary = summarizeTicketTypes(ticketTypes);
  const finalCategory = category === 'Personalizar' ? String(customCategory || '').trim() : category;
  if (category === 'Personalizar' && !finalCategory)
    return res.status(400).json({ success: false, message: 'Informe a categoria personalizada.' });
  const coverUrl  = await uploadImage(req.files?.cover?.[0],  'covers');
  const posterUrl = await uploadImage(req.files?.poster?.[0], 'posters');
  const { error } = await supabaseAdmin.from('events').insert({
    name, date, time, location, price: summary.price, category: finalCategory||'Geral',
    total_seats: summary.totalSeats, sold_seats: summary.soldSeats, ticket_types: ticketTypes, emoji: emoji||'B',
    description: description||'', cover: coverUrl, poster: posterUrl,
    status: 'pending', submitted_by: req.user.id, submitted_by_name: req.user.name
  });
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, message: 'Evento submetido! Aguarda aprovação do administrador.' });
});

app.get('/api/events/my/submissions', requireAuth, async (req, res) => {
  const { data } = await supabaseAdmin.from('events').select('*').eq('submitted_by', req.user.id).order('created_at', { ascending: false });
  res.json({ success: true, data: (data||[]).map(withExtras) });
});

app.get('/api/my/tickets', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('sales').select('*').eq('user_id', req.user.id)
    .order('purchased_at', { ascending: false });
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data: (data||[]).map(saleWithExtras) });
});

// ------------------------------------------------------------
// API COMPRA — PDF em memória + Supabase Storage
// ------------------------------------------------------------
app.post('/api/purchase', requireAuth, async (req, res) => {
  const { eventId, quantity, ticketTypeId } = req.body;
  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  const { data: event, error: evErr } = await supabaseAdmin
    .from('events').select('*').eq('id', eventId).eq('status', 'approved').single();
  if (evErr || !event) return res.status(404).json({ success: false, message: 'Evento não encontrado.' });
  const ticketTypes = normalizeTicketTypes(event.ticket_types, event.price, event.total_seats);
  const selectedType = ticketTypes.find((type) => type.id === ticketTypeId) || ticketTypes[0];
  if (!selectedType) return res.status(400).json({ success: false, message: 'Tipo de bilhete indisponivel.' });
  if (selectedType.soldSeats + qty > selectedType.totalSeats)
    return res.status(400).json({ success: false, message: 'Lugares insuficientes.' });

  const purchaseDate = new Date();
  const tickets = [];
  const saleRows = [];
  const emailTickets = [];

  try {
    for (let i = 0; i < qty; i++) {
      const ticketCode = `TKT-${uuidv4().substring(0,8).toUpperCase()}`;
      const validateUrl = `${SITE_URL}/admin/dashboard?tab=validate&code=${ticketCode}`;

      const qrCodeDataURL = await QRCode.toDataURL(validateUrl, {
        errorCorrectionLevel: 'H', margin: 1,
        color: { dark: '#1a1a2e', light: '#FFFFFF' }, width: 200
      });

      const pdfBuffer = await generateTicketPDF({
        ticketCode, event,
        customerName: req.user.name, customerEmail: req.user.email,
        quantity: 1, purchaseDate, qrCodeDataURL,
        ticketType: selectedType.name,
        ticketPrice: selectedType.price
      });
      const pdfFileName = `bilhete-${ticketCode}.pdf`;
      const pdfUrl = await uploadPDF(pdfBuffer, pdfFileName);
      emailTickets.push({ ticketCode, pdfUrl, pdfFileName, pdfData: `data:application/pdf;base64,${pdfBuffer.toString('base64')}` });

      saleRows.push({
        ticket_code: ticketCode, event_id: eventId,
        event_name: event.name, customer_name: req.user.name,
        customer_email: req.user.email, user_id: req.user.id,
        ticket_type: selectedType.name,
        quantity: 1, total_price: selectedType.price,
        pdf_file: pdfUrl, validated: false
      });
    }

    selectedType.soldSeats += qty;
    const ticketSummary = summarizeTicketTypes(ticketTypes);
    await supabaseAdmin.from('events').update({
      sold_seats: ticketSummary.soldSeats,
      ticket_types: ticketTypes
    }).eq('id', eventId);

    const { error: saleErr } = await supabaseAdmin.from('sales').insert(saleRows);
    if (saleErr) throw saleErr;

    for (const [index, ticket] of emailTickets.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1100));
      await sendEmailJS(EMAILJS_TICKET_TEMPLATE_ID, {
        to_email: req.user.email,
        to_name: req.user.name,
        user_name: req.user.name,
        event_name: event.name,
        ticket_code: ticket.ticketCode,
        ticket_type: selectedType.name,
        ticket_price: selectedType.price,
        ticket_url: ticket.pdfUrl,
        ticket_pdf: ticket.pdfData,
        ticket_filename: ticket.pdfFileName,
        purchase_date: purchaseDate.toLocaleString('pt-PT'),
        site_url: SITE_URL
      });
    }

    res.json({
      success: true, message: qty > 1 ? 'Bilhetes gerados!' : 'Bilhete gerado!',
      data: {
        tickets,
        ticketCode: tickets[0]?.ticketCode,
        pdfUrl: tickets[0]?.pdfUrl,
        eventName: event.name,
        customerName: req.user.name,
        ticketType: selectedType.name,
        totalPrice: selectedType.price * qty,
        quantity: qty
      }
    });
  } catch(err) {
    console.error('Erro ao gerar bilhete:', err.message);
    res.status(500).json({ success: false, message: 'Erro ao gerar bilhete: ' + err.message });
  }
});

// ------------------------------------------------------------
// API VALIDAÇÃO
// ------------------------------------------------------------
async function validateTicket(req, res, validatedBy) {
  const { ticketCode } = req.body;
  if (!ticketCode) return res.status(400).json({ success: false, valid: false, message: 'Informe o código do bilhete.' });
  const { data: sale, error } = await supabaseAdmin
    .from('sales').select('*').eq('ticket_code', ticketCode).single();
  if (error || !sale) return res.json({ success: false, valid: false, message: 'Bilhete inválido ou inexistente.' });
  if (sale.validated) return res.json({
    success: true, valid: false, message: 'Este bilhete já foi utilizado.',
    data: saleWithExtras(sale)
  });
  await supabaseAdmin.from('sales').update({
    validated: true, validated_at: new Date().toISOString(), validated_by: validatedBy
  }).eq('ticket_code', ticketCode);
  res.json({
    success: true, valid: true, message: 'Bilhete válido! Acesso autorizado.',
    data: { ...saleWithExtras(sale), validatedBy }
  });
}

app.post('/api/validate', requireAuth, async (req, res) => {
  await validateTicket(req, res, req.user.name);
});

app.post('/api/admin/validate', requireAdminAuth, async (req, res) => {
  await validateTicket(req, res, req.admin.username || 'Administrador');
});

app.listen(PORT, () => {
  console.log(`\n✅  BilheteAO v3.0 iniciado em http://localhost:${PORT}`);
});
