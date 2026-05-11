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
const dns         = require('dns').promises;
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
const EMAILJS_RESET_TEMPLATE_ID = process.env.EMAILJS_RESET_TEMPLATE_ID;

console.log('SUPABASE_URL:', SUPABASE_URL ? 'OK' : 'EM FALTA');
console.log('SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? 'OK' : 'EM FALTA');
console.log('SUPABASE_SERVICE_KEY:', SUPABASE_SERVICE_KEY ? 'OK' : 'EM FALTA');
console.log('EMAILJS:', EMAILJS_SERVICE_ID && EMAILJS_PUBLIC_KEY ? 'OK' : 'OPCIONAL/EM FALTA');

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ------------------------------------------------------------
// SINCRONIZAR SEQUÊNCIAS DO BANCO
// ------------------------------------------------------------
async function syncSequences() {
  try {
    // Sincronizar sequência de admin_credentials
    const { data: maxAdminId } = await supabaseAdmin
      .from('admin_credentials')
      .select('id')
      .order('id', { ascending: false })
      .limit(1)
      .single();
    const nextAdminId = (maxAdminId?.id || 0) + 1;
    await supabaseAdmin.rpc('setval', { seq: 'admin_credentials_id_seq', value: nextAdminId, is_called: true });
    console.log('Sequência admin_credentials sincronizada para:', nextAdminId);
  } catch (err) {
    console.log('Erro ao sincronizar sequências:', err.message);
  }
}

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

async function emailDomainExists(email) {
  const domain = String(email || '').trim().split('@')[1];
  if (!domain) return false;
  try {
    const mx = await dns.resolveMx(domain);
    if (Array.isArray(mx) && mx.length > 0) return true;
  } catch (err) {
    console.log('MX lookup failed for', domain, err.code || err.message);
  }
  try {
    const records = await dns.resolve(domain);
    return Array.isArray(records) && records.length > 0;
  } catch (err) {
    console.log('DNS lookup failed for', domain, err.code || err.message);
    return false;
  }
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
    const panel = W * 0.68;
    const strip = W - panel;

    const bgMain = '#090A16';
    const leftBg = '#12162F';
    const rightBg = '#0A0D1B';
    const accent = '#6C63FF';
    const accent2 = '#57C7FF';
    const textPrimary = '#F4F7FF';
    const textMuted = '#8A8FB5';
    const border = '#2A2E4A';

    doc.rect(0, 0, W, H).fill(bgMain);
    doc.rect(0, 0, panel, H).fill(leftBg);
    doc.rect(panel, 0, strip, H).fill(rightBg);

    doc.roundedRect(18, 18, panel - 36, 68, 12).fill('#151B3D');
    doc.fontSize(8).fillColor(accent).font('Helvetica-Bold').text('VÁLIDO', 28, 30);
    doc.fontSize(10).fillColor(textMuted).font('Helvetica').text(data.event.category.toUpperCase(), 28, 44);
    doc.fontSize(26).fillColor(textPrimary).font('Helvetica-Bold').text(data.event.name, 28, 62, {width: panel - 56, ellipsis: true});

    const topLabelY = 108;
    doc.fillOpacity(0.18).rect(28, topLabelY, panel - 56, 68).fill('#FFFFFF');
    doc.fillOpacity(1);
    doc.fontSize(9).fillColor(textMuted).font('Helvetica-Bold').text('VIP ACCESS', 38, topLabelY + 8);
    doc.fontSize(16).fillColor(textPrimary).font('Helvetica-Bold').text(data.ticketType || 'Normal', 38, topLabelY + 30);

    const infoY = topLabelY + 84;
    const rowHeight = 34;
    const labelStyle = {width: panel - 72};
    const row = (label, value, y) => {
      doc.fontSize(7).fillColor(textMuted).font('Helvetica').text(label.toUpperCase(), 28, y);
      doc.fontSize(12).fillColor(textPrimary).font('Helvetica-Bold').text(value, 28, y + 10, labelStyle);
    };
    const eventDate = new Date(data.event.date).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
    row('Data', eventDate, infoY);
    row('Hora', data.event.time + 'h', infoY + rowHeight);
    row('Porta', data.ticketType ? `A${String(data.ticketType).charCodeAt(0) % 9 + 1}` : 'A3', infoY + rowHeight * 2);
    row('Local', data.event.location, infoY + rowHeight * 3);

    doc.moveTo(28, infoY + rowHeight * 4 + 6).lineTo(panel - 28, infoY + rowHeight * 4 + 6).strokeColor(border).lineWidth(0.8).stroke();
    doc.fontSize(9).fillColor(textMuted).font('Helvetica').text('Titular', 28, infoY + rowHeight * 4 + 16);
    doc.fontSize(14).fillColor(textPrimary).font('Helvetica-Bold').text(data.customerName, 28, infoY + rowHeight * 4 + 28);

    const stripPadding = 20;
    const qrSize = strip - stripPadding * 2;
    doc.roundedRect(panel + stripPadding - 4, stripPadding - 4, qrSize + 8, qrSize + 8, 16).fill('#1C2240');
    doc.image(Buffer.from(data.qrCodeDataURL.replace(/^data:image\/png;base64,/, ''), 'base64'), panel + stripPadding, stripPadding, { width: qrSize, height: qrSize });

    const barcodeY = stripPadding + qrSize + 18;
    const barX = panel + stripPadding;
    const barW = qrSize;
    const barH = 32;
    for (let i = 0; i < 20; i++) {
      const w = 2 + (i % 3);
      const x = barX + i * 10;
      doc.rect(x, barcodeY, w, barH).fill(i % 2 === 0 ? '#6C63FF' : '#57C7FF');
    }
    doc.fontSize(8).fillColor(textMuted).font('Helvetica').text(data.ticketCode, barX, barcodeY + barH + 8, { width: barW, align: 'center' });

    doc.fontSize(7).fillColor(textMuted).font('Helvetica').text('Apresente este bilhete digital na entrada • Não partilhe com terceiros', 28, H - 30, { width: W - 56, align: 'center' });

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
  console.log('Verificando token admin:', token);
  
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('admin_sessions').select('token,username,expires_at').eq('token', token)
    .gt('expires_at', new Date().toISOString()).single();
  console.log('Sessão admin encontrada:', session ? 'sim' : 'não', sessionError);
  if (sessionError || !session) return res.status(401).json({ success: false, message: 'Sessão admin expirada.' });

  const { data: admin, error: adminError } = await supabaseAdmin
    .from('admin_credentials').select('role,permissions').eq('username', session.username).single();
  if (adminError || !admin) return res.status(401).json({ success: false, message: 'Credenciais admin não encontradas.' });

  req.admin = {
    username: session.username,
    role: admin.role || 'superadmin',
    permissions: admin.permissions || { manage_events: true, manage_users: true, manage_admins: true }
  };
  console.log('Admin autenticado:', req.admin.username);
  next();
}

function requireAdminPermission(permission) {
  return (req, res, next) => {
    if (req.admin.role === 'superadmin' || req.admin.permissions?.[permission]) return next();
    return res.status(403).json({ success: false, message: 'Privilegios insuficientes.' });
  };
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
  '/login': 'login.html', '/register': 'register.html', '/confirm-email': 'confirm-email.html',
  '/forgot-password': 'forgot-password.html', '/reset-password': 'reset-password.html',
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
  if (!isValidEmail(cleanEmail)) return res.status(400).json({ success: false, message: 'Informe um e-mail válido.' });
  const emailExists = await emailDomainExists(cleanEmail);
  if (!emailExists) return res.status(400).json({ success: false, message: 'Informe um e-mail válido e existente.' });
  if (password.length < 6) return res.status(400).json({ success: false, message: 'Senha deve ter pelo menos 6 caracteres.' });
  const { data: existing } = await supabaseAdmin.from('users').select('id').eq('email', cleanEmail).single();
  if (existing) return res.status(400).json({ success: false, message: 'E-mail já registado.' });
  const confirmationToken = uuidv4();
  const { data: user, error } = await supabaseAdmin.from('users').insert({
    name,
    email: cleanEmail,
    password,
    role: 'user',
    email_confirmed: false,
    confirmation_token: confirmationToken
  }).select().single();
  if (error) return res.status(500).json({ success: false, message: 'Erro ao criar conta: ' + error.message });

  await sendEmailJS(EMAILJS_REGISTER_TEMPLATE_ID, {
    to_email: user.email,
    to_name: user.name,
    user_name: user.name,
    user_email: user.email,
    confirmation_url: `${SITE_URL}/confirm-email?token=${confirmationToken}`,
    site_url: SITE_URL,
    created_at: new Date().toLocaleString('pt-PT')
  });

  res.json({ success: true, message: 'Conta criada! Verifique o seu email para confirmar a conta.' });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = String(email || '').trim().toLowerCase();
  const { data: user, error } = await supabaseAdmin.from('users').select('*').eq('email', cleanEmail).eq('password', password).single();
  if (error || !user) return res.status(401).json({ success: false, message: 'E-mail ou senha incorrectos.' });
  if (!user.email_confirmed) return res.status(403).json({ success: false, message: 'Confirme seu e-mail antes de iniciar sessão.', needConfirm: true });
  const token = uuidv4();
  await supabaseAdmin.from('sessions').insert({
    token,
    user_id: user.id,
    user_name: user.name,
    user_email: user.email,
    user_role: user.role,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  });
  res.json({ success: true, token, user: { name: user.name, email: user.email } });
});

app.get('/api/auth/confirm-email', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ success: false, message: 'Token de confirmação inválido.' });
  const { data: user, error } = await supabaseAdmin.from('users').select('*').eq('confirmation_token', token).single();
  if (error || !user) return res.status(400).json({ success: false, message: 'Token inválido ou expirado.' });
  if (user.email_confirmed) return res.json({ success: true, message: 'E-mail já confirmado.' });
  const { error: updateError } = await supabaseAdmin.from('users')
    .update({ email_confirmed: true, confirmation_token: null })
    .eq('id', user.id);
  if (updateError) return res.status(500).json({ success: false, message: 'Erro ao confirmar e-mail.' });
  res.json({ success: true, message: 'E-mail confirmado com sucesso. Agora pode iniciar sessão.' });
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

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!isValidEmail(cleanEmail)) return res.status(400).json({ success: false, message: 'Informe um e-mail válido.' });
  const { data: user, error } = await supabaseAdmin.from('users').select('*').eq('email', cleanEmail).single();
  if (error || !user) return res.status(404).json({ success: false, message: 'E-mail não encontrado.' });
  const resetToken = uuidv4();
  const resetExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes
  const { error: updateError } = await supabaseAdmin.from('users')
    .update({ reset_token: resetToken, reset_expires: resetExpires })
    .eq('id', user.id);
  if (updateError) return res.status(500).json({ success: false, message: 'Erro ao gerar token de recuperação.' });

  await sendEmailJS(EMAILJS_RESET_TEMPLATE_ID, {
    to_email: user.email,
    to_name: user.name,
    user_name: user.name,
    reset_url: `${SITE_URL}/reset-password?token=${resetToken}`,
    site_url: SITE_URL,
    expires_in: '15 minutos'
  });

  res.json({ success: true, message: 'E-mail de recuperação enviado. Verifique a sua caixa de entrada.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ success: false, message: 'Token e nova senha são obrigatórios.' });
  if (newPassword.length < 6) return res.status(400).json({ success: false, message: 'A nova senha deve ter pelo menos 6 caracteres.' });
  const { data: user, error } = await supabaseAdmin.from('users')
    .select('*').eq('reset_token', token).gt('reset_expires', new Date().toISOString()).single();
  if (error || !user) return res.status(400).json({ success: false, message: 'Token inválido ou expirado.' });
  const { error: updateError } = await supabaseAdmin.from('users')
    .update({ password: newPassword, reset_token: null, reset_expires: null })
    .eq('id', user.id);
  if (updateError) return res.status(500).json({ success: false, message: 'Erro ao actualizar senha.' });
  await supabaseAdmin.from('sessions').delete().eq('user_id', user.id);
  res.json({ success: true, message: 'Senha alterada com sucesso. Faça login com a nova senha.' });
});

// ------------------------------------------------------------
// API ADMIN AUTH + CREDENCIAIS
// ------------------------------------------------------------
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const cleanUsername = String(username || '').trim();
  console.log('Tentativa de login:', cleanUsername);
  const { data: admin, error } = await supabaseAdmin.from('admin_credentials')
    .select('*').eq('username', cleanUsername).eq('password', password).single();
  console.log('Admin encontrado:', admin ? 'sim' : 'não', error);
  if (error || !admin) return res.status(401).json({ success: false, message: 'Credenciais inválidas.' });
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  console.log('Criando sessão para:', admin.username, 'com token:', token);

  const { error: insertError } = await supabaseAdmin.from('admin_sessions').insert([{ 
    token,
    username: admin.username,
    expires_at: expiresAt
  }]);
  if (insertError) {
    console.error('Erro ao inserir sessão admin:', insertError);
    return res.status(500).json({ success: false, message: 'Erro ao criar sessão.' });
  }

  res.json({ success: true, token, admin: { username: admin.username, role: admin.role || 'superadmin', permissions: admin.permissions || {} } });
});

app.get('/api/admin/me', requireAdminAuth, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

app.post('/api/admin/logout', requireAdminAuth, async (req, res) => {
  const token = req.headers['x-admin-token'];
  const { error } = await supabaseAdmin.from('admin_sessions').delete().eq('token', token);
  if (error) console.error('Erro ao apagar sessão admin:', error);
  console.log('Admin desconectado:', req.admin.username);
  res.json({ success: true });
});

app.put('/api/admin/credentials', requireAdminAuth, async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  const { data: creds } = await supabaseAdmin.from('admin_credentials').select('*').eq('username', req.admin.username).single();
  if (!creds) return res.status(404).json({ success: false, message: 'Administrador não encontrado.' });
  if (currentPassword !== creds.password) return res.status(400).json({ success: false, message: 'Senha actual incorrecta.' });
  if (newPassword && newPassword.length < 6) return res.status(400).json({ success: false, message: 'Nova senha deve ter pelo menos 6 caracteres.' });
  const updates = {};
  if (username) updates.username = String(username).trim();
  if (newPassword) updates.password = newPassword;
  await supabaseAdmin.from('admin_credentials').update(updates).eq('id', creds.id);
  await supabaseAdmin.from('admin_sessions').delete().neq('token', '');
  res.json({ success: true, message: 'Credenciais actualizadas. Faça login novamente.' });
});

app.get('/api/admin/admins', requireAdminAuth, requireAdminPermission('manage_admins'), async (req, res) => {
  const { data, error } = await supabaseAdmin.from('admin_credentials').select('id,username,role,permissions').order('id', { ascending: false });
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, data: (data||[]).map(admin => ({
    id: admin.id,
    username: admin.username,
    role: admin.role || 'admin',
    permissions: admin.permissions || {},
    createdAt: admin.created_at || null
  })) });
});

app.post('/api/admin/admins', requireAdminAuth, requireAdminPermission('manage_admins'), async (req, res) => {
  const { username, password, role, permissions } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username e senha são obrigatórios.' });
  const cleanUsername = String(username).trim();
  const { data: existingAdmin } = await supabaseAdmin.from('admin_credentials').select('id').eq('username', cleanUsername).single();
  if (existingAdmin) return res.status(400).json({ success: false, message: 'Administrador já existente.' });
  const adminRole = role || 'admin';
  const adminPermissions = permissions || { manage_events: true, manage_users: true, manage_admins: true };
  const { data: lastAdmin } = await supabaseAdmin.from('admin_credentials')
    .select('id').order('id', { ascending: false }).limit(1).single();
  const nextId = (lastAdmin?.id || 0) + 1;
  const { data: newAdmin, error } = await supabaseAdmin.from('admin_credentials')
    .insert({ id: nextId, username: cleanUsername, password, role: adminRole, permissions: adminPermissions })
    .select('id,username,role,permissions').single();
  if (error) {
    console.error('Erro ao criar administrador (id=', nextId, '):', error.message || error);
    if (String(error.message || '').includes('admin_credentials_pkey')) {
      const { data: lastAdminRetry } = await supabaseAdmin.from('admin_credentials')
        .select('id').order('id', { ascending: false }).limit(1).single();
      const retryId = (lastAdminRetry?.id || 0) + 1;
      const { data: retryAdmin, error: retryError } = await supabaseAdmin.from('admin_credentials')
        .insert({ id: retryId, username: cleanUsername, password, role: adminRole, permissions: adminPermissions })
        .select('id,username,role,permissions').single();
      if (!retryError) {
        return res.json({ success: true, data: { id: retryAdmin.id, username: retryAdmin.username, role: retryAdmin.role, permissions: retryAdmin.permissions, createdAt: null } });
      }
      console.error('Erro ao re-criar administrador:', retryError.message || retryError);
    }
    return res.status(500).json({ success: false, message: error.message || 'Erro ao criar administrador.' });
  }
  res.json({ success: true, data: { id: newAdmin.id, username: newAdmin.username, role: newAdmin.role, permissions: newAdmin.permissions, createdAt: null } });
});

app.put('/api/admin/admins/:id', requireAdminAuth, requireAdminPermission('manage_admins'), async (req, res) => {
  const { username, password, role, permissions } = req.body;
  const updates = {};
  if (username) updates.username = String(username).trim();
  if (password) updates.password = password;
  if (role) updates.role = role;
  if (permissions) updates.permissions = permissions;
  if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, message: 'Nenhum dado para atualizar.' });
  const { error } = await supabaseAdmin.from('admin_credentials').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, message: 'Administrador atualizado.' });
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
        color: { dark: '#ffffff', light: '#080810' }, width: 200
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
      console.log('PDF URL gerado:', pdfUrl, 'para ticket:', ticketCode);
      tickets.push({
        ticketCode,
        pdfUrl,
        ticketType: selectedType.name,
        price: selectedType.price,
        purchaseDate: purchaseDate.toISOString(),
        validateUrl
      });
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

// ------------------------------------------------------------
// INICIALIZAÇÃO
// ------------------------------------------------------------
syncSequences().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅  BilheteAO v3.0 iniciado em http://localhost:${PORT}`);
  });
});
