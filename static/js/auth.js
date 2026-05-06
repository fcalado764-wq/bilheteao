// Global navbar authentication state for public pages.
(function () {
  const token = localStorage.getItem('authToken');
  const name = localStorage.getItem('userName');
  const email = localStorage.getItem('userEmail');
  const navAuth = document.getElementById('navAuth');
  if (!navAuth) return;

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[char]);
  }

  if (token && name) {
    const initial = name.charAt(0).toUpperCase();
    const firstName = name.split(' ')[0];
    navAuth.innerHTML = `
      <div class="nav-user-menu">
        <button class="nav-user-btn" type="button" onclick="toggleUserMenu()" aria-haspopup="true" aria-expanded="false">
          <span class="nav-avatar">${escapeHTML(initial)}</span>
          <span class="nav-user-name">${escapeHTML(firstName)}</span>
          <span aria-hidden="true">⌄</span>
        </button>
        <div class="user-dropdown" id="userDropdown" style="display:none">
          <div class="dropdown-header">
            <strong>${escapeHTML(name)}</strong>
            ${email ? `<span>${escapeHTML(email)}</span>` : ''}
          </div>
          <a href="/submit-event" class="dropdown-item">Propor evento</a>
          <button class="dropdown-item" type="button" onclick="doLogout()">Terminar sessão</button>
        </div>
      </div>`;
  } else {
    navAuth.innerHTML = `
      <a href="/login" class="nav-link">Entrar</a>
      <a href="/register" class="nav-link nav-register">Criar conta</a>`;
  }

  window.toggleUserMenu = function () {
    const dropdown = document.getElementById('userDropdown');
    const button = document.querySelector('.nav-user-btn');
    if (!dropdown) return;
    const willOpen = dropdown.style.display === 'none';
    dropdown.style.display = willOpen ? 'block' : 'none';
    if (button) button.setAttribute('aria-expanded', String(willOpen));
  };

  window.doLogout = async function () {
    const token = localStorage.getItem('authToken');
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-auth-token': token }
      }).catch(() => {});
    }
    localStorage.removeItem('authToken');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    window.location.href = '/';
  };

  document.addEventListener('click', function (event) {
    const menu = document.querySelector('.nav-user-menu');
    const dropdown = document.getElementById('userDropdown');
    const button = document.querySelector('.nav-user-btn');
    if (menu && dropdown && !menu.contains(event.target)) {
      dropdown.style.display = 'none';
      if (button) button.setAttribute('aria-expanded', 'false');
    }
  });
})();
