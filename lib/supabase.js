// lib/supabase.js — Cliente Supabase partilhado
// Usado por todas as rotas da API

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl     = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórios no ficheiro .env');
}

// Cliente público (para operações normais)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente de serviço (para operações admin — ignora RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

module.exports = { supabase, supabaseAdmin };
