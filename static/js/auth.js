// auth.js — Gestão de autenticação global (navbar)
// Incluído em todas as páginas públicas

(function() {
  const token = localStorage.getItem('authToken');
  const name  = localStorage.getItem('userName');
  const navAuth = document.getElementById('navAuth');
  if (!navAuth) return;

  if (token && name) {
    navAuth.innerHTML = `
      <div class="nav-user-menu">
        <button class="nav-user-btn" onclick="toggleUserMenu()">
          <span class="nav-avatar">${name.charAt(0).toUpperCase()}</span>
          <span class="nav-user-name">${name.split(' ')[0]}</span>
          <span style="font-size:0.7rem">▾</span>
        </button>
        <div class="user-dropdown" id="userDropdown" style="display:none">
          <div class="dropdown-header">${name}</div>
          <a href="/submit-event" class="dropdown-item">📤 Propor Evento</a>
          <button class="dropdown-item" onclick="doLogout()">🚪 Terminar Sessão</button>
        </div>
      </div>`;
  } else {
    navAuth.innerHTML = `
      <a href="/login"    class="nav-link">Entrar</a>
      <a href="/register" class="nav-link nav-register">Criar Conta</a>`;
  }

  window.toggleUserMenu = function() {
    const dd = document.getElementById('userDropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  };

  window.doLogout = async function() {
    const token = localStorage.getItem('authToken');
    if (token) {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-auth-token': token } }).catch(() => {});
    }
    localStorage.removeItem('authToken');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    window.location.href = '/';
  };

  // Fechar dropdown ao clicar fora
  document.addEventListener('click', function(e) {
    const menu = document.querySelector('.nav-user-menu');
    const dd   = document.getElementById('userDropdown');
    if (menu && dd && !menu.contains(e.target)) dd.style.display = 'none';
  });
})();
