export function mountGuardian({canManage = () => false, onSetupMfa, onAudit, onStaffAccess} = {}) {
  const widget = document.createElement('aside');
  widget.className = 'guardian-widget';
  widget.setAttribute('aria-label', 'Guardian Cyber Security');
  widget.innerHTML = `
    <section id="guardian-panel" class="guardian-panel" hidden>
      <header><strong>Guardian Cyber Security</strong>
        <button class="small-btn" type="button" data-guardian-close aria-label="Tutup Guardian">×</button>
      </header>
      <dl>
        <div><dt>Koneksi perangkat</dt><dd data-guardian-network></dd></div>
        <div><dt>Protokol halaman</dt><dd data-guardian-protocol></dd></div>
      </dl>
      <div data-guardian-owner hidden>
        <button class="small-btn" type="button" data-guardian-mfa>Autentikator akun</button>
        <button class="small-btn" type="button" data-guardian-audit>Jejak perubahan</button>
        <button class="small-btn" type="button" data-guardian-staff>Akses staf</button>
      </div>
      <p class="field-hint">Indikator ini membaca status koneksi dari browser.</p>
    </section>
    <button class="guardian-toggle" type="button" aria-controls="guardian-panel" aria-expanded="false" aria-label="Buka Guardian Cyber Security">
      <span class="guardian-orbit" aria-hidden="true"><span class="guardian-shield"><i></i></span></span>
      <span class="guardian-dot" aria-hidden="true"></span>
    </button>`;
  document.body.append(widget);

  const panel = widget.querySelector('.guardian-panel');
  const toggle = widget.querySelector('.guardian-toggle');
  const network = widget.querySelector('[data-guardian-network]');
  const protocol = widget.querySelector('[data-guardian-protocol]');

  function updateStatus() {
    const online = navigator.onLine;
    const https = window.location.protocol === 'https:';
    widget.dataset.network = online ? 'online' : 'offline';
    network.textContent = online ? 'Online' : 'Offline';
    protocol.textContent = https ? 'HTTPS' : 'HTTP';
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', (open ? 'Tutup' : 'Buka') + ' Guardian Cyber Security');
    if (open) {
      widget.querySelector('[data-guardian-owner]').hidden = !canManage();
      updateStatus();
    }
  }

  const close = () => {
    setOpen(false);
    toggle.focus();
  };

  widget.querySelector('[data-guardian-staff]').addEventListener('click', () => {
    if (canManage()) onStaffAccess?.();
  });
  widget.querySelector('[data-guardian-mfa]').addEventListener('click', () => {
    if (canManage()) onSetupMfa?.();
  });
  widget.querySelector('[data-guardian-audit]').addEventListener('click', () => {
    if (canManage()) onAudit?.();
  });
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  widget.querySelector('[data-guardian-close]').addEventListener('click', close);
  widget.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) close();
  });
  document.addEventListener('click', event => {
    if (!panel.hidden && !widget.contains(event.target)) setOpen(false);
  });
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();
}
