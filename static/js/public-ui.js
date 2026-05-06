(function () {
  const money = new Intl.NumberFormat('pt-AO', {
    maximumFractionDigits: 0
  });

  const dateShort = new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  const dateLong = new Intl.DateTimeFormat('pt-PT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[char]);
  }

  function formatMoney(value) {
    return `${money.format(Number(value) || 0)} AOA`;
  }

  function formatDate(value, style) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Data por definir';
    return style === 'long' ? dateLong.format(date) : dateShort.format(date);
  }

  function seatsPercent(event) {
    const total = Number(event.totalSeats || event.total_seats || 0);
    const sold = Number(event.soldSeats || event.sold_seats || 0);
    if (!total) return 0;
    return Math.min(100, Math.max(0, Math.round((sold / total) * 100)));
  }

  function firstLocationPart(value) {
    return String(value || '').split(',')[0].trim() || 'Local por definir';
  }

  function currentUser() {
    return {
      token: localStorage.getItem('authToken'),
      name: localStorage.getItem('userName'),
      email: localStorage.getItem('userEmail')
    };
  }

  window.BilheteUI = {
    escapeHTML,
    formatMoney,
    formatDate,
    seatsPercent,
    firstLocationPart,
    currentUser
  };
})();
