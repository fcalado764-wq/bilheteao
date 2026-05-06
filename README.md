# 🎟️ BilheteAO — Sistema de Venda de Bilhetes

Sistema web completo para venda de bilhetes online com geração de PDF e QR Code.

## Stack Tecnológica

- **Backend:** Node.js + Express
- **Base de Dados:** PostgreSQL via Supabase
- **Frontend:** HTML5 + CSS3 + JavaScript
- **PDF:** PDFKit (A5 com QR Code)
- **Hosting:** Vercel
- **Storage BD:** Supabase

---

## Configuração Local

### 1. Instalar dependências
```bash
npm install
```

### 2. Configurar variáveis de ambiente
```bash
cp .env.example .env
```
Edite o ficheiro `.env` com as suas credenciais do Supabase.

### 3. Configurar a base de dados
- Aceda ao Supabase → SQL Editor
- Execute o conteúdo do ficheiro `schema.sql`

### 4. Iniciar o servidor
```bash
node server.js
```

Aceda a `http://localhost:3000`

---

## Credenciais padrão do Admin

- **Utilizador:** admin
- **Senha:** admin123

⚠️ Altere as credenciais após o primeiro login em Admin → Definições.

---

## Deploy no Vercel

1. Suba o código para o GitHub
2. Importe o repositório no Vercel
3. Configure as variáveis de ambiente no painel do Vercel:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY`
   - `NEXT_PUBLIC_SITE_URL` (URL do site no Vercel)
4. Deploy automático

---

## Estrutura do Projecto

```
ticket-system/
├── server.js           # Servidor principal + API
├── lib/
│   └── supabase.js     # Cliente Supabase
├── schema.sql          # Esquema da base de dados
├── templates/          # Páginas HTML
├── static/
│   ├── css/style.css   # Estilos
│   └── js/auth.js      # Autenticação frontend
├── tickets/            # PDFs gerados
├── uploads/            # Imagens dos eventos
├── vercel.json         # Configuração Vercel
└── .env.example        # Exemplo de variáveis
```
