import { pamphletSpecs, renderProductPamphlet, downloadProductPamphlet } from './product-pamphlet.js';
import { hasBackendConfig, supabase } from './supabase.js';
import './style.css';

const root = document.querySelector('#app');
const state = { user: null, profile: null, organization: null, branches: [], branchId: '', financeBranch: 'all', page: 'dashboard', products: [], cart: [], realtimeChannel: null, refreshTimer: null };
const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
const productImageUrl = (path) => path ? supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl : '';
const esc = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const initials = (name = '') => name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'DL';
const branchName = (id) => state.branches.find((branch) => branch.id === id)?.name || 'Cabang';
const resolveOwnerBranch = (organizationId, branches, current = '') => {
  const valid = (id) => branches.some((branch) => branch.id === id);
  const saved = localStorage.getItem(`digi-selected-branch:${organizationId}`) || '';
  return valid(current) ? current : valid(saved) ? saved : branches.find((branch) => branch.is_central)?.id || branches[0]?.id || '';
};
const canManage = () => state.profile?.role === 'owner';
const centralBranch = () => state.branches.find((branch) => branch.is_central);
const atCentral = () => centralBranch()?.id === state.branchId;
const isCentralAdmin = () => atCentral() && state.profile?.role === 'central_admin';
const canIntake = () => atCentral() && (canManage() || isCentralAdmin());
const canStockQc = () => atCentral() && ['owner','technician','central_admin'].includes(state.profile?.role);
const canEditProducts = () => canManage() || isCentralAdmin();
const readyStockLabel = () => atCentral() ? 'Siap didistribusikan' : 'Siap jual';
const rolePages = () => {
  const role = state.profile?.role;
  if (role === 'central_admin') return ['dashboard','receiving','quality','inventory','transfers'];
  if (role === 'investor') return ['reports'];
  if (role === 'technician') return canStockQc() ? ['quality','service'] : ['service'];
  if (role === 'owner') return ['dashboard','inventory','transfers','service','warranty','contacts','finance','reports','branches', ...(atCentral() ? ['receiving','quality'] : [])];
  if (role === 'operator' && atCentral()) return ['dashboard','inventory','service','warranty','reports'];
  return ['dashboard','inventory','transfers', ...(role === 'operator' ? ['cashier'] : []), 'service','warranty','reports', ...(atCentral() ? ['receiving'] : [])];
};
const canTechnician = () => state.profile?.role === 'technician';
const statusText = { received: 'Diterima', diagnosing: 'Diagnosa', waiting_approval: 'Menunggu persetujuan', waiting_parts: 'Menunggu sparepart', repairing: 'Sedang dikerjakan', ready: 'Siap diambil', handed_over: 'Diserahkan', cancelled: 'Dibatalkan' };
const stockStatusText = { pending_qc: 'Menunggu QC', repair_needed: 'Perlu repair', repairing: 'Sedang repair', waiting_parts: 'Menunggu sparepart', available: 'Tersedia', not_sellable: 'Karantina / retur', scrap: 'Scrap / kanibal', sold: 'Terjual', used_for_service: 'Terpakai servis', transferred: 'Dipindahkan' };
const pages = { dashboard: ['Dashboard', '▦'], receiving: ['Penerimaan & barcode', '▤'], quality: ['QC & repair', '⌁'], inventory: ['Produk & stok', '▧'], transfers: ['Mutasi stok', '⇄'], cashier: ['Kasir', '▣'], service: ['Servis pelanggan', '⌁'], warranty: ['Garansi', '◈'], contacts: ['Pelanggan & supplier', '♙'], finance: ['Keuangan', 'Rp'], reports: ['Laporan', '▥'], branches: ['Pengaturan Aplikasi', '⌂'] };

function toast(message, error = false) {
  const old = document.querySelector('.toast');
  old?.remove();
  const element = document.createElement('div');
  element.className = `toast${error ? ' error' : ''}`;
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 4200);
}

function loading(message = 'Memuat data…') {
  root.innerHTML = `<div class="loading-screen"><img class="brand-mark" src="/store-logo-transparent.png" alt="Logo DIGITAL LAPTOP JOMBANG" /><p>${esc(message)}</p></div>`;
}

function configurationScreen() {
  root.innerHTML = `<main class="login-page"><section class="login-art"><div class="login-art-inner"><img class="brand-mark" src="/store-logo-transparent.png" alt="Logo DIGITAL LAPTOP JOMBANG" /><h1>MANAJEMEN STOK &amp; OPERASIONAL TOKO<br />DIGITAL LAPTOP</h1><p class="login-contact">Jl. Raya Ceweng (timur SPBU Ceweng), Ceweng, Diwek, Jombang, Jawa Timur<br /><span>Tlp/WA: 082226666166</span></p></div></section><section class="login-box-wrap"><div class="login-box"><div class="brand"><img class="brand-mark" src="/store-logo-transparent.png" alt="Logo DIGITAL LAPTOP JOMBANG" /><span class="brand-text"><b>DIGI<span>-</span>LAPTOP</b><small>DIGITAL LAPTOP JOMBANG</small></span></div><h2>Hubungkan database toko</h2><p>Project Supabase belum terpasang di konfigurasi lokal.</p><div class="notice">Salin .env.example menjadi .env.local lalu isi URL dan publishable key project Digi-Laptop. Setelah itu jalankan kembali aplikasi.</div><p class="field-hint">Kunci publishable boleh dipakai di aplikasi web. Jangan masukkan secret key atau service_role ke sini.</p></div></section></main>`;
}

let installPrompt;
let installDismissed = false;
const installStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function isAppleMobile() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function showMobileInstall() {
  const apple = isAppleMobile();
  const androidChrome = /Android.*Chrome\//.test(navigator.userAgent);
  if ((!apple && !androidChrome) || installStandalone() || installDismissed || document.querySelector('#mobile-install')) return;
  const banner = document.createElement('aside');
  banner.id = 'mobile-install';
  banner.className = 'mobile-install';
  banner.setAttribute('aria-label', 'Instal Digi-Laptop');
  banner.innerHTML = `<img src="/icon-192.png" width="40" height="40" alt="" />
    <div><strong>Instal Digi-Laptop</strong><p>Buka langsung dari layar utama.</p>
    <button type="button" class="btn primary" data-install>Instal aplikasi</button>
    <p data-install-help hidden>${apple ? 'Ketuk Bagikan → Tambahkan ke Layar Utama → Tambah. Jika pilihan belum muncul, buka halaman ini di Safari.' : 'Buka menu Chrome ⋮ → Instal aplikasi atau Tambahkan ke layar utama.'}</p></div>
    <button type="button" class="small-btn" data-install-close aria-label="Tutup ajakan instal">×</button>`;
  const install = banner.querySelector('[data-install]');
  const help = banner.querySelector('[data-install-help]');
  install.addEventListener('click', async () => {
    if (!installPrompt) { help.hidden = false; return; }
    const prompt = installPrompt;
    installPrompt = null;
    install.disabled = true;
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === 'accepted') banner.remove();
    } catch { help.hidden = false; }
    finally { install.disabled = false; }
  });
  banner.querySelector('[data-install-close]').addEventListener('click', () => {
    installDismissed = true;
    banner.remove();
  });
  document.body.append(banner);
}

window.addEventListener('beforeinstallprompt', event => {
  if (!/Android.*Chrome\//.test(navigator.userAgent)) return;
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installDismissed = true;
  document.querySelector('#mobile-install')?.remove();
});

function showLoginError(error) {
  const dialog = document.createElement('dialog');
  dialog.className = 'login-error-dialog';
  dialog.setAttribute('aria-labelledby', 'login-error-title');
  dialog.setAttribute('aria-describedby', 'login-error-message');
  dialog.innerHTML = '<h2 id="login-error-title">Gagal masuk</h2><p id="login-error-message"></p><form method="dialog"><button class="modal-close" type="submit" aria-label="Tutup" autofocus>×</button></form>';
  dialog.querySelector('p').textContent = error.code === 'invalid_credentials' || error.message === 'Invalid login credentials'
    ? 'Email atau password salah. Periksa kembali lalu coba lagi.'
    : 'Login belum berhasil. Periksa koneksi atau coba lagi nanti.';
  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.addEventListener('close', () => {
    dialog.remove();
    root.querySelector('#auth-form [name="password"]')?.focus();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

function authScreen(message = '') {
  root.innerHTML = `<main class="login-page"><section class="login-art"><img class="login-hero-photo" src="/login-laptops.webp" alt="Tiga laptop bisnis untuk DIGITAL LAPTOP JOMBANG" /><div class="login-art-inner"><div class="login-brand"><img class="brand-mark" src="/store-logo-transparent.png" alt="" /><span class="brand-text"><b class="login-brand-name">DIGITAL LAPTOP JOMBANG</b></span></div><h1>MANAJEMEN STOK &amp; OPERASIONAL TOKO<br />DIGITAL LAPTOP</h1><p class="login-contact">Jl. Raya Ceweng (timur SPBU Ceweng), Ceweng, Diwek, Jombang, Jawa Timur<br /><span>Tlp/WA: 082226666166</span></p></div></section><section class="login-box-wrap"><form class="login-box" id="auth-form"><div class="brand"><img class="brand-mark" src="/store-logo-transparent.png" alt="Logo DIGITAL LAPTOP JOMBANG" /><span class="brand-text"><b class="login-brand-name">DIGITAL LAPTOP JOMBANG</b></span></div>${message ? `<div class="notice error">${esc(message)}</div>` : ''}<div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required /></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" minlength="8" required /></div><button class="btn primary" type="submit">Masuk</button><div class="login-switch"><a href="/catalog">Katalog produk</a> · <a href="/lacak-servis">Lacak servis</a></div></form></section></main>`;
  document.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email')).trim().toLowerCase();
    const password = String(form.get('password'));
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      state.user = data.user;
      state.branchId = '';
      state.page = 'dashboard';
      await afterAuth({ preferCentral: true });
    } catch (error) {
      if (button.isConnected) {
        button.closest('form').querySelector('[name=password]').value = '';
      } else authScreen();
      showLoginError(error);
    } finally { button.disabled = false; }
  });
}

function ownerSetupScreen(message = '') {
  root.innerHTML = `<main class="login-page"><section class="login-art"><div class="login-art-inner"><img class="brand-mark" src="/store-logo-transparent.png" alt="Logo DIGITAL LAPTOP JOMBANG" /><h1>Mulai kelola toko.</h1><p>Buat ruang kerja untuk DIGITAL LAPTOP JOMBANG dan tambahkan cabang yang akan lo kelola.</p></div></section><section class="login-box-wrap"><form class="login-box" id="setup-form"><div class="brand"><img class="brand-mark" src="/store-logo-transparent.png" alt="Logo DIGITAL LAPTOP JOMBANG" /><span class="brand-text"><b>DIGI<span>-</span>LAPTOP</b><small>DIGITAL LAPTOP JOMBANG</small></span></div><h2>Siapkan toko</h2><p>Akun pertama menjadi pemilik. Nama cabang bisa diedit lagi nanti.</p>${message ? `<div class="notice error">${esc(message)}</div>` : ''}<div class="field"><label>Nama toko</label><input name="store" value="DIGITAL LAPTOP JOMBANG" required /></div><div class="field"><label>Nama cabang 1</label><input name="branch1" placeholder="Contoh: Jombang" required /></div><div class="field"><label>Nama cabang 2</label><input name="branch2" placeholder="Nama cabang" /></div><div class="field"><label>Nama cabang 3</label><input name="branch3" placeholder="Nama cabang" /></div><div class="field"><label>Nama cabang 4</label><input name="branch4" placeholder="Nama cabang" /></div><button class="btn primary" type="submit">Buat ruang kerja</button></form></section></main>`;
  document.querySelector('#setup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const branches = [1, 2, 3, 4].map((n) => String(form.get(`branch${n}`)).trim()).filter(Boolean);
    const button = event.currentTarget.querySelector('button'); button.disabled = true;
    const { error } = await supabase.rpc('bootstrap_owner', { _store_name: String(form.get('store')).trim(), _branch_names: branches });
    if (error) { ownerSetupScreen(error.message); return; }
    await afterAuth();
  });
}

async function afterAuth({ preferCentral = false } = {}) {
  loading();
  const sessionCacheKey=`digi-offline-session:${state.user.id}`;
  const deadline = AbortSignal.timeout(10000);
  const [{ data: profile, error }, { data: branches, error: branchError }] = await Promise.all([
    supabase.from('profiles').select('*, organizations(*)').eq('id', state.user.id).abortSignal(deadline).maybeSingle(),
    supabase.from('branches').select('*').eq('is_active', true).order('name').abortSignal(deadline),
  ]);
  if(error){
    if(!navigator.onLine){const cached=JSON.parse(localStorage.getItem(sessionCacheKey)||'null');if(cached?.profile&&cached?.branches){state.profile=cached.profile;state.organization=cached.profile.organizations;state.branches=cached.branches;state.branchId=state.profile.role==='owner'?resolveOwnerBranch(state.organization.id,state.branches,state.branchId):state.profile.branch_id;if(state.profile.role==='operator'&&localStorage.getItem(`digi-offline-cashier:${state.organization.id}:${state.branchId}`))state.page='cashier';subscribeOperationalUpdates();showShell();await showPage(state.page);return}}
    authScreen(error.message);return;
  }
  if(!profile){ownerSetupScreen();return;}
  state.profile=profile;state.organization=profile.organizations;
  if(branchError){
    if(!navigator.onLine){const cached=JSON.parse(localStorage.getItem(sessionCacheKey)||'null');if(cached?.branches){state.branches=cached.branches;state.branchId=profile.role==='owner'?resolveOwnerBranch(state.organization.id,state.branches,state.branchId):profile.branch_id;if(profile.role==='operator'&&localStorage.getItem(`digi-offline-cashier:${state.organization.id}:${state.branchId}`))state.page='cashier';subscribeOperationalUpdates();showShell();await showPage(state.page);return}}
    authScreen(branchError.message);return;
  }
  state.branches=branches||[];

  const initialBranch = preferCentral ? state.branches.find((branch) => branch.is_central)?.id : state.branchId;
  state.branchId=profile.role==='owner'?resolveOwnerBranch(state.organization.id,state.branches,initialBranch):profile.branch_id;
  if (preferCentral && profile.role === 'owner' && state.branchId) localStorage.setItem(`digi-selected-branch:${state.organization.id}`, state.branchId);
  if(!state.branchId){authScreen('Akun ini belum terhubung ke cabang. Minta pemilik toko mengatur cabangnya di Pengaturan Aplikasi.');return;}
  localStorage.setItem(sessionCacheKey,JSON.stringify({profile,branches:state.branches,cachedAt:new Date().toISOString()}));
  if (!rolePages().includes(state.page)) state.page = rolePages()[0];
  subscribeOperationalUpdates();showShell();await showPage(state.page);syncPendingOfflineSales();
}

const pageLabel = (key) => key === 'quality' && !canTechnician() ? 'Laporan QC Teknisi' : pages[key]?.[0] || 'Dashboard';

const staffRoleLabels = {
  owner: 'Pemilik',
  central_admin: 'Admin Pusat',
  operator: 'Operator · kasir + servis',
  technician: 'Teknisi',
  investor: 'Investor · baca saja',
};
const staffRoleLabel = (role) => staffRoleLabels[role] || 'Role belum dikenali';

function showShell() {
  const permittedPages = Object.entries(pages).filter(([key]) => rolePages().includes(key));
  const navHtml = permittedPages.map(([key, [, icon]]) => `<button class="nav-button${state.page === key ? ' active' : ''}" data-page="${key}"><span class="nav-icon">${icon}</span>${pageLabel(key)}</button>${key === 'quality' && canTechnician() ? `<button type="button" class="nav-button qc-subnav" data-qc-view="repair">Papan repair</button><button type="button" class="nav-button qc-subnav" data-qc-view="results">Hasil pemeriksaan QC</button>` : ''}`).join('');
  const mobilePages = {
    operator: [['dashboard', 'Beranda'], ['cashier', 'Kasir'], ['inventory', 'Stok'], ['service', 'Servis']],
    technician: [['quality', 'QC'], ['service', 'Servis']],
  }[state.profile.role] || [];
  const mobileNav = mobilePages.length ? `<nav class="staff-bottom-nav" aria-label="Navigasi cepat petugas">
    ${mobilePages.filter(([key]) => rolePages().includes(key)).map(([key, label]) => `<button type="button" data-page="${key}" ${state.page === key ? 'aria-current="page"' : ''}><span aria-hidden="true">${pages[key][1]}</span>${label}</button>`).join('')}
    <button type="button" id="staff-more" aria-controls="sidebar"><span aria-hidden="true">☰</span>Menu</button>
  </nav>` : '';
  const branchOptions = state.profile.role === 'owner' ? state.branches.map((branch) => `<option value="${branch.id}"${state.branchId === branch.id ? ' selected' : ''}>${esc(branch.name)}</option>`).join('') : `<option value="${state.profile.branch_id}">${esc(branchName(state.profile.branch_id))}</option>`;
  const roleLabel = canManage() ? 'Pemilik toko' : staffRoleLabel(state.profile.role);
  const supportMessage = encodeURIComponent('Halo, saya Admin Pusat Digi-Laptop. Saya ingin konsultasi penggunaan aplikasi atau melaporkan bug.\n\nHalaman: \nPertanyaan atau kendala: ');
  const supportLink = isCentralAdmin() ? `<div class="central-support">
    <a href="https://wa.me/6281298406844?text=${supportMessage}" target="_blank" rel="noopener noreferrer"
      aria-label="Konsultasi penggunaan dan lapor bug lewat WhatsApp">
      <span class="central-support-icon" aria-hidden="true">?</span> Bantuan WhatsApp
    </a>
  </div>` : '';
  root.innerHTML = `<div class="app${mobileNav ? ' staff-mobile-tabs' : ''}" data-branch-theme="${selectedBranchTheme()}"><aside class="sidebar" id="sidebar"><a class="brand" href="#dashboard"><img class="brand-mark" src="/store-logo-transparent.png" alt="Logo DIGITAL LAPTOP JOMBANG" /><span class="brand-text"><b>Digital Laptop</b><small>Jombang</small></span></a><nav class="nav">${navHtml}</nav><div class="side-spacer"></div><div class="side-bottom"><div class="profile"><span class="avatar">${esc(initials(state.profile.full_name))}</span><span class="profile-meta"><b>${esc(state.profile.full_name || 'Pengguna')}</b><span>${roleLabel}</span></span><button class="logout" type="button" data-logout>Keluar</button></div></div></aside><main class="main"><header class="topbar"><button class="mobile-menu" id="mobile-menu" aria-label="Buka menu">☰</button><div class="crumb"><b id="crumb-label">${pageLabel(state.page)}</b></div><div class="top-tools"><span class="online-label"><i></i><span id="connect-label">Online</span></span><select class="branch-select" id="branch-select" aria-label="Pilih cabang">${branchOptions}</select><button class="logout top-logout" type="button" id="print-settings">Printer</button></div></header>${supportLink}<section class="page" id="page"></section><footer class="footer"><span>© ${new Date().getFullYear()} Digital Laptop</span><span>Operasional DIGITAL LAPTOP JOMBANG</span></footer></main>${mobileNav}<div id="modal-root"></div></div>`;
  const nav = document.querySelector('.nav');
  nav.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-qc-view]');
    if (!tab) return;
    state.qcView = tab.dataset.qcView;
    showPage('quality');
    window.scrollTo(0, 0);
  });
  document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', async () => { state.page = button.dataset.page; if (button.closest('.staff-bottom-nav')) window.scrollTo(0, 0); if (state.page === 'quality') { state.qcView = 'queue'; window.scrollTo(0, 0); } await showPage(state.page); }));
  root.querySelector('#staff-more')?.addEventListener('click', () => root.querySelector('#mobile-menu').click());
  root.querySelector('#print-settings').addEventListener('click', printerSettings);
  const logoutButtons = root.querySelectorAll('[data-logout]');
  const logout = async () => {
    logoutButtons.forEach((button) => { button.disabled = true; });
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      logoutButtons.forEach((button) => { button.disabled = false; });
      throw new Error(error.message || 'Gagal keluar. Coba lagi.');
    }
    clearTimeout(state.refreshTimer);
    const channel = state.realtimeChannel;
    state.realtimeChannel = null;
    state.profile = null;
    state.user = null;
    state.page = 'dashboard';
    authScreen();
    if (channel) await supabase.removeChannel(channel);
  };
  logoutButtons.forEach((button) => button.addEventListener('click', () => {
    openModal('Keluar dari aplikasi?', 'Anda perlu masuk kembali untuk melanjutkan.',
      '', logout, 'Ya, keluar');
  }));
  document.querySelector('#mobile-menu').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
  document.querySelector('#branch-select').addEventListener('change', async (event) => {
    const selected = event.target.value;
    const allowed = canManage()
      ? state.branches.some((branch) => branch.id === selected)
      : selected === state.profile.branch_id;
    if (!allowed) {
      event.target.value = state.branchId;
      toast('Cabang ini tidak tersedia untuk akun lo.', true);
      return;
    }
    await openBranchPage(selected, state.page);
  });
  updateConnection();
}

async function openBranchPage(branchId, page, inventoryFilters = null) {
  state.branchId = branchId;
  state.inventoryFilters = inventoryFilters;
  state.inventoryUnitPage = inventoryFilters ? { filter: 'available' } : null;
  state.inventorySearchQuery = '';
  if (canManage()) localStorage.setItem(`digi-selected-branch:${state.organization.id}`, branchId);
  const allowedPages = rolePages();
  state.page = allowedPages.includes(page) ? page : allowedPages[0];
  showShell();
  subscribeOperationalUpdates();
  await showPage(state.page);
}

function selectedBranchTheme() {
  const name = String(state.branches.find((branch) => branch.id === state.branchId)?.name || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (/\bmalang\b/.test(name)) return 'purple';
  if (/\bac\b|\bcabang\s+c\b/.test(name)) return 'amber';
  if (/\bab\b|\bcabang\s+b\b/.test(name)) return 'blue';
  return 'green';
}
function updateConnection() { const label=document.querySelector('#connect-label');if(label)label.textContent=navigator.onLine?'Online':'Offline · antrean kasir tersimpan di perangkat'; }
function refreshOwnerOverview() {
  if (state.profile?.role !== 'owner' || !['dashboard', 'service', 'reports', 'finance'].includes(state.page)) return;
  if (!navigator.onLine || document.hidden || !document.querySelector('#page')) return;
  if (document.querySelector('.modal-backdrop, .report-detail-panel') ||
      document.activeElement?.closest('#page input, #page select, #page textarea')) return;
  if (state.ownerRefreshInProgress) return;
  state.ownerRefreshInProgress = true;
  showPage(state.page, { background: true }).finally(() => { state.ownerRefreshInProgress = false; });
}

document.addEventListener('visibilitychange', refreshOwnerOverview);
window.addEventListener('online', refreshOwnerOverview);
window.addEventListener('online', () => {
  updateConnection();
  syncPendingOfflineSales();
});
window.addEventListener('offline', updateConnection);
setInterval(refreshOwnerOverview, 45000);

let operationalSubscriptionRequest = 0;
async function subscribeOperationalUpdates() {
  const request = ++operationalSubscriptionRequest;
  const previous = state.realtimeChannel;
  state.realtimeChannel = null;
  clearTimeout(state.refreshTimer);
  if (previous) await supabase.removeChannel(previous);
  if (request !== operationalSubscriptionRequest || !state.branchId || !state.profile) return;
  const refresh = () => {
    if (request !== operationalSubscriptionRequest || state.realtimeChannel !== channel) return;
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (canManage() && ['dashboard', 'service', 'reports', 'finance'].includes(state.page)) refreshOwnerOverview();
      else if (state.page !== 'cashier' && document.querySelector('#page') && !document.querySelector('.modal-backdrop') && !document.activeElement?.closest('#page input, #page select, #page textarea')) showPage(state.page, { background: true });
    }, 350);
  };
  const channel = supabase.channel(`digi-branch-${state.branchId}-${request}`);
  for (const table of ['stock_items','stock_repairs','intake_batches','sales','service_tickets']) {
    const subscription = { event: '*', schema: 'public', table };
    if (!canManage()) subscription.filter = `branch_id=eq.${state.branchId}`;
    channel.on('postgres_changes', subscription, refresh);
  }
  for (const table of ['stock_transfers','stock_transfer_items']) channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
  for (const table of ['products','suppliers','customers']) channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `organization_id=eq.${state.organization.id}` }, refresh);
  if (canManage()) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'cash_transactions' }, refresh);
  else channel.on('postgres_changes', { event: '*', schema: 'public', table: 'cash_transactions', filter: `branch_id=eq.${state.branchId}` }, refresh);
  state.realtimeChannel = channel.subscribe();
}
function header(title, subtitle, actions = '') { return `<div class="page-head"><div><div class="eyebrow">DIGITAL LAPTOP JOMBANG</div><h1>${title}</h1><p>${subtitle}</p></div><div class="head-actions">${actions}</div></div>`; }
function openModal(title, subtitle, body, onSubmit, submitLabel = 'Simpan') {
  const host = document.querySelector('#modal-root');
  host.innerHTML = `<div class="modal-backdrop"><form class="modal" id="active-modal"><div class="modal-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="modal-close" type="button" data-close-modal aria-label="Tutup">×</button></div>${body}${onSubmit ? `<div class="modal-actions"><button class="btn primary" type="submit">${submitLabel}</button></div>` : ''}</form></div>`;
  host.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => { host.innerHTML = ''; }));
  const modalForm = host.querySelector('#active-modal');
  modalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!onSubmit) return;
    const button = modalForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await onSubmit(new FormData(modalForm));
      if (host.contains(modalForm)) host.innerHTML = '';
    } catch (error) {
      if (!host.contains(modalForm)) return;
      button.disabled = false;
      let notice = modalForm.querySelector('[data-modal-error]');
      if (!notice) {
        notice = document.createElement('div');
        notice.className = 'notice error';
        notice.setAttribute('data-modal-error', '');
        notice.setAttribute('role', 'alert');
        modalForm.insertBefore(notice, modalForm.querySelector('.modal-actions'));
      }
      notice.textContent = error.message || 'Tidak bisa menyimpan data.';
    }
  });
  return host;
}
function branchField(name = 'branch_id', value = state.branchId, centralOnly = false) {
  const branches = state.profile.role === 'owner' ? state.branches : state.branches.filter((branch) => branch.id === state.profile.branch_id);
  return `<div class="field"><label>Cabang</label><select name="${name}" required>${branches.filter((branch) => !centralOnly || branch.is_central).map((branch) => `<option value="${branch.id}" ${branch.id === value ? 'selected' : ''}>${esc(branch.name)}</option>`).join('')}</select></div>`;
}
function checkError(result) { if (result.error) throw result.error; return result.data; }

function productPhotoPicker(existingPath = '', required = true) {
  const url = productImageUrl(existingPath);
  return `<div class="field full"><label>Foto produk <span class="required-note">${required ? 'wajib untuk produk baru' : 'opsional'}</span></label><div class="photo-picker"><div class="photo-preview" data-photo-preview>${url ? `<img src="${esc(url)}" alt="Foto produk" />` : '<span>Pilih foto dari perangkat atau ambil langsung dari kamera</span>'}</div><div class="photo-actions"><label class="btn">Pilih file / galeri<input class="photo-input" name="product_photo_file" type="file" accept="image/*" /></label><label class="btn">Foto pakai kamera<input class="photo-input camera-input" name="product_photo_camera" type="file" accept="image/*" capture="environment" /></label><small>Foto disimpan untuk katalog dan semua cabang.</small></div></div></div>`;
}

function bindProductPhotoPicker(form) {
  const preview = form.querySelector('[data-photo-preview]');
  form.querySelectorAll('[name="product_photo_file"],[name="product_photo_camera"]').forEach((input) => input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    form.querySelectorAll('[name="product_photo_file"],[name="product_photo_camera"]').forEach((other) => { if (other !== input) other.value = ''; });
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Pratinjau foto produk" />`;
  }));
}

function selectedProductPhoto(formData) { return formData.get('product_photo_file')?.size ? formData.get('product_photo_file') : formData.get('product_photo_camera')?.size ? formData.get('product_photo_camera') : null; }

async function loadCashierProducts() {
  const columns = 'id,name,sku,brand,model,retail_price,reseller_price,image_path,is_public';
  const query = (fields) => fetchAllRows(supabase.from('products').select(fields).order('name'));
  try {
    return await query(`${columns},catalog_discount`);
  } catch (error) {
    if (error.code !== '42703' && error.code !== 'PGRST204') throw error;
    return query(columns);
  }
}

function publicRetailPrice(product) {
  return Number(product.retail_price) - (product.is_public === false ? 0 : Number(product.catalog_discount || 0));
}

function publicPriceMarkup(product) {
  const price = publicRetailPrice(product);
  const discount = Number(product.retail_price) - price;
  return `<span class="public-price-block">
    ${discount > 0 ? `<span class="public-price-savings"><del aria-label="Harga normal ${money(product.retail_price)}">${money(product.retail_price)}</del>
      <span>Hemat ${money(discount)}</span></span>` : ''}
    <strong>${money(price)}</strong></span>`;
}

function productPromoField(product) {
  if (!canManage() && !(isCentralAdmin() && product)) return '';
  return `<div class="field"><label for="catalog-discount">Potongan harga (Rp)</label>
    <input id="catalog-discount" name="catalog_discount" type="number" min="0" step="1" value="${esc(product?.catalog_discount ?? 0)}" />
    <small class="field-hint">Berlaku untuk pembeli umum selama produk ditampilkan di katalog. Isi 0 untuk menonaktifkan.</small></div>`;
}

function productPromoValues(form, product, retailPrice) {
  if (!form.has('catalog_discount')) return {};
  const discount = Number(form.get('catalog_discount') || 0);
  if (!Number.isSafeInteger(discount) || discount < 0 || (discount > 0 && discount >= retailPrice)) {
    throw new Error('Potongan harus lebih kecil dari harga end user.');
  }
  if (discount === Number(product?.catalog_discount ?? 0)) return {};
  return { catalog_discount: discount };
}

function productCopyFields(product) {
  return `<div class="field full"><label for="product-description">Deskripsi produk</label>
    <textarea id="product-description" name="description" rows="4" maxlength="4000" placeholder="Kondisi fisik, kelengkapan, dan catatan produk">${esc(product?.description || '')}</textarea></div>
    ${pamphletSpecs.map(([key, label]) => `<div class="field"><label for="spec-${key}">${label}</label>
    <input id="spec-${key}" name="spec_${key}" maxlength="100" value="${esc(product?.specifications?.[key] || '')}" /></div>`).join('')}`;
}

function productCopyValues(form) {
  return {
    description: String(form.get('description') || '').trim(),
    specifications: Object.fromEntries(pamphletSpecs.map(([key]) => [key, String(form.get(`spec_${key}`) || '').trim()])),
  };
}

function galleryFields(product) {
  const photos = product?.gallery_paths || [];
  return Array.from({ length: 3 }, (_, i) => `<div class="field">
    <label for="gallery-photo-${i}">Foto ${i + 2} (opsional)</label>
    ${photos[i] ? `<img class="product-gallery-thumb" src="${esc(productImageUrl(photos[i]))}" alt="Foto ${i + 2}" />
    <label><input type="checkbox" name="remove_gallery_${i}" /> Lepas foto</label>` : ''}
    <input id="gallery-photo-${i}" type="file" name="gallery_${i}" accept="image/jpeg,image/png,image/webp" />
  </div>`).join('');
}

async function readGallery(form, existing = []) {
  const paths = [];
  for (let i = 0; i < 3; i++) {
    const file = form.get(`gallery_${i}`);
    if (file?.size) paths.push(await uploadProductPhoto(file, crypto.randomUUID()));
    else if (existing[i] && !form.has(`remove_gallery_${i}`)) paths.push(existing[i]);
  }
  return paths;
}

async function uploadProductPhoto(file, key) {
  const path = `${state.organization.id}/products/${key}.jpg`;
  const compressed = await compressPhoto(file);
  const { error } = await supabase.storage.from('product-images').upload(path, compressed, { contentType: 'image/jpeg', upsert: !isCentralAdmin(), cacheControl: '3600' });
  if (error) throw error;
  return path;
}

function productPhotoModal(product) {
  const host = openModal('Foto produk', `${product.name} · fotonya dipakai katalog dan daftar stok.`, `<div class="form-grid">${productPhotoPicker(product.image_path, false)}${galleryFields(product)}</div>`, async (form) => {
    const file = selectedProductPhoto(form);
    if (!file && !product.image_path) throw new Error('Pilih foto sampul terlebih dahulu.');
    const imagePath = file ? await uploadProductPhoto(file, crypto.randomUUID()) : product.image_path;
    const previousGallery = product.gallery_paths || [];
    const gallery = await readGallery(form, previousGallery);
    const { error } = await supabase.rpc('set_product_gallery', {
      _product_id: product.id, _cover: imagePath, _gallery: gallery,
      _previous_cover: product.image_path, _previous_gallery: previousGallery,
    });
    if (error) throw error;
    toast('Foto produk tersimpan.'); await showPage('inventory');
  }, 'Simpan foto');
  bindProductPhotoPicker(host.querySelector('#active-modal'));
}

async function showPage(name, { background = false } = {}) {
  if (!rolePages().includes(name)) name = rolePages()[0];
  state.page = name;
  if (name !== 'quality') document.querySelectorAll('[data-qc-view]').forEach((tab) => { tab.classList.remove('active'); tab.removeAttribute('aria-current'); });
  if (!root.querySelector('.app')) showShell();
  document.querySelectorAll('.nav-button[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === name));
  root.querySelectorAll('.staff-bottom-nav [data-page]').forEach(button => {
    if (button.dataset.page === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelector('#crumb-label').textContent = pageLabel(name);
  if (!background) document.querySelector('#sidebar').classList.remove('open');
  let page = document.querySelector('#page');
  if (background) {
    if (page.dataset.refreshing) return;
    page.dataset.refreshing = 'true';
  } else {
    const nextPage = page.cloneNode(false);
    delete nextPage.dataset.refreshing;
    nextPage.innerHTML = '<div class="empty">Memuat data.</div>';
    page.replaceWith(nextPage);
    page = nextPage;
  }
  const loadTimer = background ? null : setTimeout(() => {
    if (!page.isConnected || page.firstElementChild?.className !== 'empty') return;
    const retryPage = page.cloneNode(false);
    retryPage.innerHTML = '<div class="notice error" role="alert">Data halaman belum merespons. Menu lain tetap bisa dibuka.</div><button type="button" class="btn">Coba muat data lagi</button>';
    page.replaceWith(retryPage);
    retryPage.querySelector('button').addEventListener('click', () => showPage(name));
  }, 12000);
  try {
    if (name === 'dashboard') await dashboardPage(page);
    else if (name === 'receiving') await receivingPage(page);
    else if (name === 'quality') await qualityPage(page);
    else if (name === 'inventory') await inventoryPage(page);
    else if (name === 'transfers') await transfersPage(page);
    else if (name === 'cashier') await cashierPage(page);
    else if (name === 'service') await servicePage(page);
    else if (name === 'warranty') await warrantyPage(page);
    else if (name === 'contacts') await contactsPage(page, state.contactTab || 'suppliers');
    else if (name === 'finance') await financePage(page);
    else if (name === 'branches') await branchesPage(page);
    else if (name === 'reports') await reportsPage(page);
  } catch (error) { if (!background) page.innerHTML = `<div class="notice error">${esc(error.message || 'Gagal memuat data.')}</div>`; }
  finally { clearTimeout(loadTimer); if (background) delete page.dataset.refreshing; }
}

const branchStockSection = '<section class="owner-branch-stock" data-owner-branch-stock><h2>Stok siap jual per cabang</h2><p role="status">Memuat stok cabang.</p></section>';

async function showOwnerBranchStock(panel) {
  if (!panel || !canManage()) return;
  const branches = [...state.branches].sort((a, b) =>
    Number(Boolean(b.is_central)) - Number(Boolean(a.is_central)) || a.name.localeCompare(b.name, 'id'));
  if (!branches.length) {
    panel.querySelector('p').textContent = 'Belum ada cabang aktif.';
    return;
  }
  try {
    const stock = await fetchAllRows(supabase.from('stock_items').select('branch_id,quantity')
      .in('branch_id', branches.map(({ id }) => id)).eq('status', 'available').gt('quantity', 0)
      .abortSignal(AbortSignal.timeout(10000)));
    if (!panel.isConnected || !canManage()) return;
    const totals = new Map();
    for (const {branch_id, quantity} of stock) {
      totals.set(branch_id, (totals.get(branch_id) || 0) + Number(quantity));
    }
    panel.querySelector('p').remove();
    const colors = ['green', 'blue', 'amber', 'purple', 'teal', 'rose'];
    panel.insertAdjacentHTML('beforeend', `<div class="cards branch-stock-cards">${branches.map((branch, index) =>
      `<button type="button" class="card unit-summary-button branch-stock-card" data-stock-color="${colors[index % colors.length]}" data-stock-branch="${esc(branch.id)}">
        <span class="card-label">${esc(branch.name)}</span>
        <span class="card-value">${(totals.get(branch.id) || 0).toLocaleString('id-ID')} <small>unit</small></span>
        <span class="card-sub">${branch.is_central ? 'Siap dikirim' : 'Siap jual'} · Lihat detail &rarr;</span>
      </button>`).join('')}</div>`);
    panel.querySelectorAll('[data-stock-branch]').forEach((button) => button.addEventListener('click', () => {
      const branchId = button.dataset.stockBranch;
      if (!canManage() || !state.branches.some((branch) => branch.id === branchId)) return;
      window.scrollTo(0, 0);
      openBranchPage(branchId, 'inventory', { 'inventory-stock': 'available' });
    }));
  } catch {
    if (panel.isConnected) panel.querySelector('p').textContent = 'Stok cabang belum bisa dimuat.';
  }
}

async function centralDashboardPage(page) {
  const branchId = state.branchId;
  const [stock, intake, transfers] = await Promise.all([
    fetchAllRows(supabase.from('stock_items').select('status,quantity').eq('branch_id', branchId)
      .in('status', ['pending_qc','repair_needed','repairing','waiting_parts','available'])),
    fetchAllRows(supabase.from('intake_batches').select('unit_count').eq('branch_id', branchId).gte('created_at', dayStart())),
    fetchAllRows(supabase.from('stock_transfers').select('id,transfer_number,destination_branch_id,status,created_at,stock_transfer_items(quantity)')
      .eq('source_branch_id', branchId).in('status', ['in_transit','received']).order('created_at', { ascending: false })),
  ]);
  if (!page.isConnected || state.branchId !== branchId) return;
  const quantity = (...statuses) => stock.filter(row => statuses.includes(row.status)).reduce((total, row) => total + Number(row.quantity), 0);
  const cards = [
    ['Barang masuk hari ini', intake.reduce((total, row) => total + Number(row.unit_count), 0), 'receiving'],
    ['Menunggu QC', quantity('pending_qc'), 'quality'],
    ['Dalam repair', quantity('repair_needed','repairing','waiting_parts'), 'quality'],
    ['Siap dikirim', quantity('available'), 'transfers'],
  ];
  const pending = transfers.filter(row => row.status === 'in_transit');
  const received = new Map();
  for (const transfer of transfers) {
    if (transfer.status !== 'received') continue;
    received.set(transfer.destination_branch_id, (received.get(transfer.destination_branch_id) || 0) + 1);
  }
  const unitCount = row => (row.stock_transfer_items || []).reduce((total, item) => total + Number(item.quantity), 0);
  page.innerHTML = `${header('Operasional Cabang Pusat', 'Penerimaan, pemeriksaan, dan distribusi stok ke cabang penjualan.', '<button class="btn primary" data-open-transfer>Kirim ke cabang</button>')}
    <section class="cards laptop-unit-summary">${cards.map(([label, count, action]) => `<button type="button" class="card unit-summary-button" data-central-page="${action}"><span class="card-label">${label}</span><span class="card-value">${count} <small>unit</small></span></button>`).join('')}</section>
    ${canManage() ? branchStockSection : ''}
    <section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Distribusi per cabang</div><div class="panel-sub">Jumlah pengiriman dari Cabang Pusat</div></div></div><div class="table-wrap"><table><thead><tr><th>Cabang tujuan</th><th>Menunggu diterima</th><th>Sudah diterima</th></tr></thead><tbody>${state.branches.filter(branch => !branch.is_central).map(branch => `<tr><td>${esc(branch.name)}</td><td>${pending.filter(row => row.destination_branch_id === branch.id).length}</td><td>${received.get(branch.id) || 0}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="panel table-panel"><div class="panel-head"><div class="panel-title">Mutasi menunggu diterima</div></div><div class="table-wrap"><table><thead><tr><th>Nomor mutasi</th><th>Tujuan</th><th>Jumlah unit</th><th>Tanggal kirim</th></tr></thead><tbody>${pending.map(row => `<tr><td>${esc(row.transfer_number)}</td><td>${esc(branchName(row.destination_branch_id))}</td><td>${unitCount(row)}</td><td>${new Date(row.created_at).toLocaleString('id-ID')}</td></tr>`).join('') || '<tr><td colspan="4">Tidak ada mutasi dalam perjalanan.</td></tr>'}</tbody></table></div></section>`;
  showOwnerBranchStock(page.querySelector('[data-owner-branch-stock]'));
  page.querySelector('[data-open-transfer]').addEventListener('click', transferModal);
  page.querySelectorAll('[data-central-page]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.centralPage)));
}

async function dashboardPage(page) {
  if (canIntake()) return centralDashboardPage(page);
  let stockQuery = supabase.from('stock_items').select('quantity').eq('branch_id', state.branchId).eq('status', 'available');
  let laptopStockQuery = supabase.from('stock_items').select('quantity,products!inner(brand,category)').eq('branch_id', state.branchId).eq('status', 'available').eq('products.category', 'Laptop');
  let serviceQuery = supabase.from('service_tickets').select('id,status,ticket_number,device_name').eq('branch_id', state.branchId).not('status', 'in', '(handed_over,cancelled)');
  const ownerView = state.profile.role === 'owner';
  let salesQuery = supabase.from('sales').select('total,branch_id,receipt_number,branches(name)').gte('created_at', dayStart());
  if (!ownerView) salesQuery = salesQuery.eq('branch_id', state.branchId);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  let bestSellingQuery = supabase.from('sale_items').select('product_name,quantity,line_total,products(category),sales!inner(branch_id,created_at)').gte('sales.created_at', monthStart.toISOString());
  if (!ownerView) bestSellingQuery = bestSellingQuery.eq('sales.branch_id', state.branchId);
  let recentSalesQuery = supabase.from('sales').select('receipt_number,customer_name,total,created_at,branch_id,branches(name)').order('created_at', { ascending: false }).limit(ownerView ? 12 : 4);
  if (!ownerView) recentSalesQuery = recentSalesQuery.eq('branch_id', state.branchId);
  const [stock, laptopStock, services, sales, bestSelling, recentServices, recentSales, inventoryData] = await Promise.all([
    fetchAllRows(stockQuery), fetchAllRows(laptopStockQuery), fetchAllRows(serviceQuery), fetchAllRows(salesQuery), fetchAllRows(bestSellingQuery),
    supabase.from('service_tickets').select('ticket_number,customer_name,device_name,status,created_at').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(4),
    recentSalesQuery,
    fetchInventory(),
  ]);
  const unitCount = stock.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const activeServices = services.length;
  const salesTotal = sales.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const branchSales = new Map();
  sales.forEach((row) => { const id = row.branch_id; const item = branchSales.get(id) || { name: row.branches?.name || branchName(id), total: 0, count: 0 }; item.total += Number(row.total || 0); item.count += 1; branchSales.set(id, item); });
  const readyCount = services.filter((row) => row.status === 'ready').length || 0;
  const topProductsMap = new Map();
  bestSelling.filter((line) => line.products?.category === 'Laptop').forEach((line) => { const row = topProductsMap.get(line.product_name) || { name: line.product_name, quantity: 0, revenue: 0 }; row.quantity += Number(line.quantity || 0); row.revenue += Number(line.line_total || 0); topProductsMap.set(line.product_name, row); });
  const topProducts = [...topProductsMap.values()].sort((a,b) => b.quantity-a.quantity || b.revenue-a.revenue).slice(0,5);
  const topMax = Math.max(1, ...topProducts.map((item) => item.quantity));
  const laptopBrandCounts = new Map();
  laptopStock.forEach((row) => { const brand = row.products?.brand || 'Lainnya'; laptopBrandCounts.set(brand, (laptopBrandCounts.get(brand) || 0) + Number(row.quantity || 0)); });
  const laptopUnitCount = [...laptopBrandCounts.values()].reduce((sum,value) => sum+value,0);
  const finderStock = new Map();
  inventoryData.stock.forEach((item) => { const rows = finderStock.get(item.product_id) || []; rows.push(item); finderStock.set(item.product_id, rows); });
  const finderProducts = inventoryData.products.map((product) => {
    const rows = finderStock.get(product.id) || [];
    const available = rows.filter((item) => item.status === 'available').reduce((sum,item) => sum + Number(item.quantity || 0), 0);
    const searchableCodes = rows.flatMap((item) => [item.barcode, item.supplier_barcode, item.serial_number]).filter(Boolean).join(' ');
    return { ...product, available, searchableCodes };
  });
  const topProductRows = topProducts.map((item,index) => `<div class="rank-row"><span class="rank-number">${String(index+1).padStart(2,'0')}</span><div class="rank-body"><div class="rank-label"><b>${esc(item.name)}</b><span>${item.quantity} unit</span></div><div class="rank-track"><i style="width:${Math.max(4,item.quantity/topMax*100)}%"></i></div></div><strong>${money(item.revenue)}</strong></div>`).join('');
  const laptopBrandRows = [...laptopBrandCounts.entries()].sort((a,b) => b[1]-a[1]).slice(0,6).map(([brand,count]) => `<div class="brand-stock-row"><span>${esc(brand)}</span><b>${count}<small> unit</small></b></div>`).join('');
  const recent = [
    ...(recentSales.data || []).map((row) => ({ date: row.created_at, icon: '▣', title: `Penjualan · ${row.receipt_number}${ownerView ? ` · ${row.branches?.name || branchName(row.branch_id)}` : ''}`, detail: `${row.customer_name || 'Pelanggan'} · ${money(row.total)}` })),
    ...(recentServices.data || []).map((row) => ({ date: row.created_at, icon: '⌁', title: `Servis · ${row.ticket_number}`, detail: `${row.customer_name} · ${statusText[row.status]}` })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  const ownerBranchSales = ownerView ? `<section class="panel table-panel owner-branch-sales"><div class="panel-head"><div><div class="panel-title">Penjualan hari ini per cabang</div><div class="panel-sub">Omzet dan jumlah transaksi semua cabang · ${new Date().toLocaleDateString('id-ID')}</div></div><span class="insight-tag">${state.branches.length} CABANG</span></div><div class="table-wrap"><table><thead><tr><th>CABANG</th><th>TRANSAKSI</th><th>PENJUALAN HARI INI</th></tr></thead><tbody>${state.branches.map((branch) => { const item = branchSales.get(branch.id) || { total: 0, count: 0 }; return `<tr><td class="product-name">${esc(branch.name)}</td><td>${item.count}</td><td><b>${money(item.total)}</b></td></tr>`; }).join('')}<tr class="owner-sales-total"><td class="product-name">TOTAL SEMUA CABANG</td><td>${sales.length}</td><td><b>${money(salesTotal)}</b></td></tr></tbody></table></div></section>` : '';
  page.innerHTML = `<div class="page-head dashboard-slogan"><div><h1>Laptop pilihan untuk <em>kerja, belajar,</em> dan berkarya setiap hari.</h1></div>${state.profile.role === 'operator' ? '<button class="btn primary" data-go="cashier">＋ Transaksi baru</button>' : ''}</div>
    <section class="panel dashboard-finder"><div class="finder-controls"><input id="finder-search" type="search" placeholder="Cari produk, merek, SKU, barcode, atau nomor seri…" aria-label="Cari produk, merek, SKU, barcode, atau nomor seri" /></div><div id="finder-results" aria-live="polite"></div></section>
        <div class="cards"><button type="button" class="card dashboard-summary-button" data-dashboard-card="sales"><span class="card-label">${ownerView ? 'Penjualan semua cabang' : 'Penjualan hari ini'}<span class="card-icon">↗</span></span><span class="card-value">${money(salesTotal)}</span><span class="card-sub">${ownerView ? 'Akumulasi cabang hari ini' : 'Data transaksi tersimpan'}</span></button><button type="button" class="card dashboard-summary-button" data-dashboard-card="stock"><span class="card-label">Total unit siap jual<span class="card-icon">▤</span></span><span class="card-value">${unitCount} <small style="font-size:11px;font-weight:500">unit</small></span><span class="card-sub">${laptopUnitCount} laptop · ${esc(branchName(state.branchId))}</span></button><button type="button" class="card dashboard-summary-button" data-dashboard-card="service"><span class="card-label">Servis berjalan<span class="card-icon">⌁</span></span><span class="card-value">${activeServices}</span><span class="card-sub">${readyCount} siap diserahkan</span></button><button type="button" class="card dashboard-summary-button" data-dashboard-card="branches"><span class="card-label">Jumlah cabang<span class="card-icon">⌂</span></span><span class="card-value">${state.branches.length}</span><span class="card-sub">Terhubung ke database pusat</span></button></div>
    ${ownerView ? branchStockSection : ''}
    ${ownerBranchSales}
    <div class="dashboard-insights"><section class="panel insight-panel"><div class="panel-head"><div><div class="panel-title">Penjualan tertinggi</div><div class="panel-sub">Laptop paling banyak terjual · ${monthStart.toLocaleDateString('id-ID',{month:'long'})} ini</div></div><span class="insight-tag">TOP 5</span></div><div class="rank-list">${topProductRows || '<div class="empty"><b>Belum ada penjualan bulan ini</b>Produk akan muncul setelah transaksi tersimpan.</div>'}</div></section><section class="panel insight-panel"><div class="panel-head"><div><div class="panel-title">Stok laptop</div><div class="panel-sub">Unit siap dijual di ${esc(branchName(state.branchId))}</div></div><button class="link-button" data-go="inventory">Lihat stok →</button></div><div class="laptop-stock-total"><strong>${laptopUnitCount.toLocaleString('id-ID')}</strong><span>unit tersedia</span></div><div class="brand-stock-list">${laptopBrandRows || '<div class="empty"><b>Belum ada laptop siap jual</b>Unit laptop akan dihitung setelah lolos QC.</div>'}</div></section></div>
    <div class="grid"><section class="panel"><div class="panel-head"><div><div class="panel-title">Aktivitas terbaru</div><div class="panel-sub">Transaksi dan tiket servis cabang ini</div></div></div>${recent.length ? `<div class="table-wrap"><table><thead><tr><th>AKTIVITAS</th><th>DETAIL</th><th>WAKTU</th></tr></thead><tbody>${recent.map((row) => `<tr><td class="product-name">${esc(row.title)}</td><td>${esc(row.detail)}</td><td>${new Date(row.date).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>Belum ada aktivitas</b>Transaksi dan servis baru akan muncul di sini.</div>'}</section><section class="panel"><div class="panel-head"><div><div class="panel-title">Akses cepat</div><div class="panel-sub">${state.profile.role === 'owner' ? 'Pemantauan dan pengelolaan toko' : 'Pekerjaan sehari-hari'}</div></div></div><div class="quick-links">${(state.profile.role === 'owner' ? [['receiving','▤','Penerimaan & barcode','Buat batch dan cetak label unit'],['inventory','▧','Produk & stok','Pantau stok semua cabang'],['finance','Rp','Keuangan','Lihat pemasukan dan pengeluaran']] : [['receiving','▤','Penerimaan & barcode','Buat batch dan cetak label unit'],['inventory','▧','Produk & stok','Kelola stok cabang'],['cashier','▣','Buka kasir','Catat penjualan dan pembayaran'],['service','⌁','Servis pelanggan','Buat tiket dan foto kondisi']]).filter(([key]) => rolePages().includes(key)).map(([key,icon,label,description]) => `<button class="quick-link" data-go="${key}"><span>${icon}</span><div><b>${label}</b><small>${description}</small></div><span>→</span></button>`).join('')}</div></section></div>`;
  showOwnerBranchStock(page.querySelector('[data-owner-branch-stock]'));
  page.querySelector('[data-dashboard-card="sales"]').addEventListener('click', () => {
    if (ownerView) {
      page.querySelector('.owner-branch-sales').scrollIntoView({ block: 'start' });
      return;
    }
    openDashboardDetails('Penjualan hari ini', sales, (row) => `${esc(row.receipt_number)} · ${money(row.total)}`);
  });
  page.querySelector('[data-dashboard-card="stock"]').addEventListener('click', () => {
    state.inventorySearchQuery = '';
    state.inventoryFilters = { 'inventory-stock': 'available' };
    showPage('inventory');
  });
  page.querySelector('[data-dashboard-card="service"]').addEventListener('click', () =>
    openDashboardDetails('Servis berjalan', services, (row) =>
      `${esc(row.ticket_number)} · ${esc(row.device_name)} · ${esc(statusText[row.status] || row.status)}`));
  page.querySelector('[data-dashboard-card="branches"]').addEventListener('click', () => {
    if (ownerView) return showPage('branches');
    openDashboardDetails('Cabang yang dapat diakses', state.branches, (branch) => esc(branch.name));
  });

  function openDashboardDetails(title, rows, label) {
    const body = rows.length
      ? `<ul class="dashboard-detail-list">${rows.map((row) => `<li>${label(row)}</li>`).join('')}</ul>`
      : '<div class="empty">Belum ada data.</div>';
    openModal(title, esc(branchName(state.branchId)), body, null);
  }
  const finderSearch = page.querySelector('#finder-search');
  const finderResults = page.querySelector('#finder-results');
  finderSearch.addEventListener('input', () => {
    const query = finderSearch.value.trim().toLocaleLowerCase('id');
    if (!query) {
      finderResults.replaceChildren();
      return;
    }
    const matches = finderProducts.filter((product) =>
      [product.name, product.brand, product.model, product.sku, product.searchableCodes].join(' ').toLocaleLowerCase('id').includes(query)
    );
    finderResults.innerHTML = matches.slice(0, 5).map((product) => `<button class="finder-result" type="button" data-finder-product="${esc(product.id)}"><span class="finder-photo">${product.image_path ? `<img loading="lazy" src="${esc(productImageUrl(product.image_path))}" alt="" />` : 'DL'}</span><span class="finder-product"><b>${esc(product.name)}</b><small>${esc(product.sku)}</small></span><span class="finder-availability"><b>${product.available}</b><small>unit tersedia</small></span><span class="finder-price">${money(product.retail_price)}</span><span class="finder-open">Buka →</span></button>`).join('') || '<div class="empty">Produk tidak ditemukan.</div>';
    if (matches.length > 5) finderResults.insertAdjacentHTML('beforeend', '<div class="finder-footer"><button class="link-button" type="button" data-finder-all>Lihat semua hasil →</button></div>');
  });
  finderResults.addEventListener('click', (event) => {
    const button = event.target.closest('[data-finder-product], [data-finder-all]');
    if (!button) return;
    const product = finderProducts.find((item) => item.id === button.dataset.finderProduct);
    state.inventorySearchQuery = product?.sku || finderSearch.value.trim();
    state.inventoryFilters = { 'inventory-stock': 'all' };
    showPage('inventory');
  });
  page.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.go)));
}

async function qcResultsPanel() {
  const rows = await fetchAllRows(supabase.from('stock_items')
    .select('id,barcode,serial_number,branch_id,status,qc_stage,qc_at,qc_by,qc_notes,products(name),intake_batches(branch_id)')
    .not('qc_at', 'is', null).order('qc_at', { ascending: false }));
  const results = rows.filter((item) => item.intake_batches?.branch_id === state.branchId || (!item.intake_batches && item.branch_id === state.branchId));
  const labels = {
    available: 'OK · Siap didistribusikan', repair_needed: 'Perlu repair', repairing: 'Sedang diperbaiki',
    waiting_parts: 'Menunggu sparepart', not_sellable: 'Karantina / retur',
    scrap: 'Rusak parah / scrap', pending_qc: 'Menunggu QC akhir', sold: 'Terjual', transferred: 'Dalam mutasi'
  };
  const repairCosts = new Map();
  if (canManage()) {
    const jobs = await fetchAllRows(supabase.from('stock_repairs')
      .select('id,stock_item_id,labor_cost,stock_repair_parts(id,product_name,quantity,cost,external_supplier,purchased_on,invoice_number,paid_at)')
      .eq('branch_id', state.branchId));
    for (const job of jobs) {
      const costs = repairCosts.get(job.stock_item_id) || { total: 0, parts: [] };
      costs.total += Number(job.labor_cost || 0);
      for (const part of job.stock_repair_parts || []) {
        costs.total += Number(part.cost || 0);
        costs.parts.push({ ...part, repairId: job.id });
      }
      repairCosts.set(job.stock_item_id, costs);
    }
  }
  const names = new Map();
  if (canManage()) {
    const profiles = await fetchAllRows(supabase.from('profiles').select('id,full_name'));
    profiles.forEach((profile) => names.set(profile.id, profile.full_name));
  }
  return `<section class="panel table-panel" style="margin-top:14px">
    <div class="panel-head"><div><div class="panel-title">Hasil pemeriksaan QC</div><div class="panel-sub">Catatan pemeriksaan terakhir dan status terkini setiap unit.</div></div>
    <label>Status <select id="qc-result-status" class="status-select"><option value="">Semua status</option>${Object.entries(labels).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label></div>
    <div class="table-wrap"><table><thead><tr><th>UNIT / PRODUK</th><th>STATUS</th><th>CATATAN QC</th>${canManage() ? '<th>BIAYA REPAIR</th>' : ''}<th>PEMERIKSAAN TERAKHIR</th></tr></thead><tbody>
    ${results.map((item) => `<tr data-qc-result="${esc(item.status)}"><td><b>${esc(item.barcode)}</b><div class="field-hint">${esc(item.products?.name || 'Laptop')} · ${esc(item.serial_number || 'Tanpa serial')}</div></td><td><span class="pill">${esc(labels[item.status] || item.status)}</span></td><td>${esc(item.qc_notes || '—')}</td>${canManage() ? `<td><b>${money(repairCosts.get(item.id)?.total || 0)}</b>${(repairCosts.get(item.id)?.parts || []).map((part) => `<div class="field-hint">${esc(part.product_name)} × ${part.quantity} · ${money(part.cost)} · ${esc(part.external_supplier || 'Stok Pusat')}${part.external_supplier ? ` · ${esc(part.purchased_on)}${part.invoice_number ? ' · Nota ' + esc(part.invoice_number) : ''} · ${part.paid_at ? 'Dibayar' : 'Belum dibayar'}${!part.paid_at ? ` <button type="button" class="small-btn" data-pay-external="${part.id}" data-pay-repair="${part.repairId}">Catat pembayaran</button>` : ''}` : ''}</div>`).join('')}</td>` : ''}<td>${new Date(item.qc_at).toLocaleString('id-ID')}${canManage() ? `<div class="field-hint">${esc(names.get(item.qc_by) || 'Pemeriksa tidak tercatat')}</div>` : ''}</td></tr>`).join('')}
    <tr id="qc-result-empty" ${results.length ? 'hidden' : ''}><td colspan="${canManage() ? 5 : 4}"><div class="empty">Belum ada hasil QC untuk status ini.</div></td></tr></tbody></table></div>
  </section>`;
}

function bindQcResultFilter(page) {
  const filter = page.querySelector('#qc-result-status');
  filter.addEventListener('change', () => {
    let visible = 0;
    page.querySelectorAll('[data-qc-result]').forEach((row) => {
      row.hidden = Boolean(filter.value && row.dataset.qcResult !== filter.value);
      if (!row.hidden) visible++;
    });
    page.querySelector('#qc-result-empty').hidden = visible > 0;
  });
}

async function qualityPage(page) {
  if (!canStockQc()) throw new Error('QC stok hanya tersedia di Cabang Pusat.');
  const resultsPanel = await qcResultsPanel();
  if (!canTechnician()) {
    page.innerHTML = `${header('Laporan QC Teknisi', 'Pantau hasil pemeriksaan dan status unit Cabang Pusat.')}${resultsPanel}`;
    bindQcResultFilter(page);
    if (canManage()) bindExternalPartPayments(page);
    return;
  }
  const [queue, repairs] = await Promise.all([
    fetchAllRows(supabase.from('stock_items').select('id,barcode,supplier_barcode,serial_number,supplier,created_at,qc_stage,acquisition_cost,products(name,sku,brand,model)').eq('branch_id', state.branchId).eq('status', 'pending_qc').order('created_at')),
    fetchAllRows(supabase.from('stock_repairs').select('id,stock_item_id,issue,status,resolution,labor_cost,stock_repair_parts(id,product_name,quantity,cost,external_supplier,purchased_on,invoice_number,paid_at),updated_at,stock_items(barcode,serial_number,acquisition_cost,products(name,sku))').eq('branch_id', state.branchId).in('status', ['repair_needed','repairing','waiting_parts','pending_final_qc']).order('updated_at', { ascending: false })),
  ]);
  const statusLabel = { repair_needed: 'Perlu repair', repairing: 'Sedang diperbaiki', waiting_parts: 'Menunggu sparepart', pending_final_qc: 'Menunggu QC akhir' };
  page.innerHTML = `${header('QC & repair', 'Antrean teknisi untuk pemeriksaan laptop masuk, perbaikan, dan persetujuan stok jual.')}
    <div class="cards"><button type="button" class="card unit-summary-button" aria-pressed="false" aria-controls="qc-rows" data-qc-filter="initial"><span class="card-label">Antrean pemeriksaan<span class="card-icon">▤</span></span><span class="card-value">${queue.filter((item) => item.qc_stage === 'initial').length}</span><span class="card-sub">Unit baru menunggu QC</span></button><button type="button" class="card unit-summary-button" aria-pressed="false" aria-controls="qc-repair-rows" data-qc-filter="repair"><span class="card-label">Perlu repair<span class="card-icon">⌁</span></span><span class="card-value">${repairs.filter((item) => ['repair_needed','repairing'].includes(item.status)).length}</span><span class="card-sub">Belum dikembalikan ke stok jual</span></button><button type="button" class="card unit-summary-button" aria-pressed="false" aria-controls="qc-rows" data-qc-filter="final"><span class="card-label">QC akhir<span class="card-icon">✓</span></span><span class="card-value">${queue.filter((item) => item.qc_stage === 'final').length}</span><span class="card-sub">Periksa kembali setelah repair</span></button><button type="button" class="card unit-summary-button" aria-pressed="false" aria-controls="qc-repair-rows" data-qc-filter="parts"><span class="card-label">Menunggu sparepart</span><span class="card-value">${repairs.filter((item) => item.status === 'waiting_parts').length}</span><span class="card-sub">Lanjutkan repair setelah part tersedia</span></button></div>
    <div class="notice">Lulus QC awal → siap jual. Jika perlu perbaikan atau sparepart, lanjutkan repair lalu kirim ke QC akhir. Unit baru siap jual setelah lulus. Rusak parah → karantina atau scrap.</div>
    <section class="panel scan-panel" data-qc-panel="queue"><div><div class="panel-title">Mulai dari hasil scan</div><div class="panel-sub">Pindai barcode label dengan scanner atau kamera untuk membuka unitnya.</div></div><form id="qc-scan" class="scan-form"><input name="barcode" placeholder="Scan / ketik DL-…" autocomplete="off" required /><button class="btn" type="button" id="qc-camera">▧ Kamera</button><button class="btn primary" type="submit">Buka QC</button></form><div id="qc-scanner"></div></section>
    <section class="panel table-panel stock-unit-panel" tabindex="-1" data-qc-panel="queue"><div class="panel-head"><div><div class="panel-title">Unit menunggu QC</div><div class="panel-sub">Unit yang lulus langsung tersinkron sebagai stok tersedia untuk kasir dan katalog.</div></div><input class="search" id="qc-search" placeholder="Cari barcode, serial, produk" /></div><div class="table-wrap"><table><thead><tr><th>BARCODE / SERIAL</th><th>PRODUK</th><th>TAHAP</th><th>PEMASOK</th><th>DITERIMA</th><th>AKSI</th></tr></thead><tbody id="qc-rows">${queue.map((item) => `<tr data-qc-status="${esc(item.qc_stage)}"><td class="product-name">${esc(item.barcode)}<div class="field-hint">${esc(item.serial_number || 'Serial belum dicatat')}</div></td><td>${esc(item.products?.name || 'Produk')}<div class="field-hint">${esc(`${item.products?.brand || ''} ${item.products?.model || ''}`)}</div></td><td><span class="pill ${item.qc_stage === 'final' ? 'blue' : 'warn'}">${item.qc_stage === 'final' ? 'QC akhir' : 'QC awal'}</span></td><td>${esc(item.supplier || '—')}</td><td>${new Date(item.created_at).toLocaleDateString('id-ID')}</td><td><button class="small-btn" data-qc="${item.id}">Periksa unit</button></td></tr>`).join('')}<tr data-qc-empty hidden><td colspan="6"><div class="empty">Tidak ada unit yang cocok.</div></td></tr></tbody></table></div></section>
    <section class="panel table-panel stock-unit-panel" tabindex="-1" data-qc-panel="repair"><div class="panel-head"><div><div class="panel-title">Papan repair</div><div class="panel-sub">Catatan kerusakan, progres teknisi, sparepart, dan ongkos repair melekat pada barcode laptop.</div></div></div><div class="table-wrap"><table><thead><tr><th>UNIT</th><th>MASALAH / CATATAN</th><th>MODAL TERKUMPUL</th><th>STATUS</th><th>DIUBAH</th><th>AKSI TEKNISI</th></tr></thead><tbody id="qc-repair-rows">${repairs.map((repair) => {const partCost=(repair.stock_repair_parts||[]).reduce((sum,line)=>sum+Number(line.cost||0),0),unitCost=Number(repair.stock_items?.acquisition_cost||0)+partCost+Number(repair.labor_cost||0);return `<tr data-qc-status="${esc(repair.status)}"><td class="product-name">${esc(repair.stock_items?.barcode || 'Unit')}<div class="field-hint">${esc(repair.stock_items?.products?.name || 'Laptop')} · ${esc(repair.stock_items?.serial_number || 'tanpa serial')}</div></td><td>${esc(repair.issue)}${repair.resolution ? `<div class="field-hint">${esc(repair.resolution)}</div>` : ''}</td><td><b>${money(unitCost)}</b><div class="field-hint">Beli ${money(repair.stock_items?.acquisition_cost)} · part ${money(partCost)} · jasa ${money(repair.labor_cost)}</div>${(repair.stock_repair_parts || []).map((part) => `<div class="field-hint">${esc(part.product_name)} × ${part.quantity} · ${money(part.cost)}${part.external_supplier ? ` · ${esc(part.external_supplier)} · ${esc(part.purchased_on)}${part.invoice_number ? ' · Nota ' + esc(part.invoice_number) : ''} · ${part.paid_at ? 'Dibayar' : 'Belum dibayar'}${!part.paid_at ? ` <button type="button" class="small-btn" data-pay-external="${part.id}" data-pay-repair="${repair.id}">Catat pembayaran</button>` : ''}` : ' · Stok Pusat'}</div>`).join('')}</td><td><span class="pill warn">${statusLabel[repair.status] || repair.status}</span></td><td>${new Date(repair.updated_at).toLocaleDateString('id-ID')}</td><td><div class="actions-cell">${repair.status === 'repair_needed' || repair.status === 'waiting_parts' ? `<button class="small-btn" data-repair="${repair.id}" data-status="repairing">Mulai repair</button>` : ''}${repair.status === 'repairing' ? `<button class="small-btn" data-parts="${repair.id}">＋ Stok Pusat</button><button class="small-btn" data-external-part="${repair.id}">＋ Beli dari luar</button><button class="small-btn" data-repair="${repair.id}" data-status="waiting_parts">Tunggu part</button><button class="small-btn" data-finish-repair="${repair.id}">Kirim QC akhir</button>` : ''}</div></td></tr>`}).join('')}<tr data-qc-empty hidden><td colspan="6"><div class="empty">Tidak ada unit yang cocok.</div></td></tr></tbody></table></div></section>`;
  page.insertAdjacentHTML('beforeend', `<div data-qc-panel="results">${resultsPanel}</div>`);
  const views = [...page.querySelectorAll('[data-qc-panel]')];
  const setQcView = (view) => {
    state.qcView = view;
    views.forEach((panel) => panel.classList.toggle('hidden', panel.dataset.qcPanel !== view));
    document.querySelectorAll('[data-qc-view]').forEach((tab) => {
      const active = tab.dataset.qcView === view;
      tab.classList.toggle('active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
  };
  setQcView(state.qcView || 'queue');

  bindQcResultFilter(page);
  const filters = {
    initial: { table: 'qc-rows', matches: (status) => status === 'initial' },
    final: { table: 'qc-rows', matches: (status) => status === 'final' },
    repair: { table: 'qc-repair-rows', matches: (status) => ['repair_needed', 'repairing'].includes(status) },
    parts: { table: 'qc-repair-rows', matches: (status) => status === 'waiting_parts' },
  };
  const search = page.querySelector('#qc-search');
  const cards = [...page.querySelectorAll('[data-qc-filter]')];
  let selected = '';
  const applyFilter = () => {
    const filter = filters[selected];
    for (const id of ['qc-rows', 'qc-repair-rows']) {
      const table = page.querySelector('#' + id);
      const query = id === 'qc-rows' ? search.value.trim().toLowerCase() : '';
      let count = 0;
      table.querySelectorAll('[data-qc-status]').forEach((row) => {
        const matches = (filter?.table !== id || filter.matches(row.dataset.qcStatus)) &&
          row.textContent.toLowerCase().includes(query);
        row.hidden = !matches;
        if (matches) count++;
      });
      table.querySelector('[data-qc-empty]').hidden = count > 0;
    }
    cards.forEach((card) => card.setAttribute('aria-pressed', String(card.dataset.qcFilter === selected)));
  };
  search.addEventListener('input', applyFilter);
  cards.forEach((card) => card.addEventListener('click', () => {
    const key = card.dataset.qcFilter;
    selected = selected === key ? '' : key;
    if (filters[key].table === 'qc-rows') search.value = '';
    applyFilter();
    setQcView(filters[key].table === 'qc-rows' ? 'queue' : 'repair');
    const panel = page.querySelector('#' + filters[key].table).closest('section');
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'start' });
  }));
  applyFilter();
  page.querySelector('#qc-scan').addEventListener('submit', (event) => { event.preventDefault(); const code = String(new FormData(event.currentTarget).get('barcode')).trim(); const item = queue.find((row) => row.barcode.toLowerCase() === code.toLowerCase()); if (!item) return toast('Barcode tidak ditemukan di antrean QC cabang ini.', true); stockQcModal(item); });
  page.querySelector('#qc-camera').addEventListener('click', () => startScanner(page.querySelector('#qc-scanner'), page.querySelector('#qc-scan [name="barcode"]')));
  page.querySelectorAll('[data-qc]').forEach((button) => button.addEventListener('click', () => stockQcModal(queue.find((item) => item.id === button.dataset.qc))));
  page.querySelectorAll('[data-repair]').forEach((button) => button.addEventListener('click', async () => { const { error } = await supabase.rpc('update_stock_repair', { _repair_id: button.dataset.repair, _status: button.dataset.status, _resolution: '' }); if (error) toast(error.message, true); else { toast('Status repair tersinkron.'); await showPage('quality'); } }));
  page.querySelectorAll('[data-external-part]').forEach((button) => button.addEventListener('click', () => externalRepairPartModal(button.dataset.externalPart)));
  bindExternalPartPayments(page);
  page.querySelectorAll('[data-parts]').forEach((button) => button.addEventListener('click', () => repairPartModal(button.dataset.parts)));
  page.querySelectorAll('[data-finish-repair]').forEach((button) => button.addEventListener('click', () => openModal('Kirim ke QC akhir', 'Modal sparepart tercatat dari stok. Masukkan ongkos jasa atau biaya repair luar toko bila ada.', '<div class="form-grid"><div class="field full"><label>Hasil perbaikan</label><textarea name="resolution" rows="4" required placeholder="Contoh: ganti keyboard, uji fungsi normal"></textarea></div><div class="field full"><label>Ongkos jasa / repair luar (opsional)</label><input name="labor_cost" type="number" min="0" step="1000" value="0" /></div></div>', async (form) => { const { error } = await supabase.rpc('finish_stock_repair', { _repair_id: button.dataset.finishRepair, _resolution: String(form.get('resolution')).trim(), _labor_cost: Number(form.get('labor_cost')||0) }); if (error) throw error; toast('Biaya repair tersimpan. Unit masuk antrean QC akhir.'); await showPage('quality'); }, 'Kirim ke QC akhir')));
}

function bindExternalPartPayments(page) {
  page.querySelectorAll('[data-pay-external]').forEach((button) => button.addEventListener('click', () => {
    openModal('Catat pembayaran sparepart?', 'Konfirmasi hanya jika pembayaran sudah dilakukan.', '', async () => {
      checkError(await supabase.rpc('record_external_repair_part', {
        _id: button.dataset.payExternal, _repair: button.dataset.payRepair, _name: null, _quantity: null,
        _unit_cost: null, _supplier: null, _date: null, _invoice: null, _paid: true
      }));
      await showPage('quality');
    });
  }));
}

function stockQcModal(item) {
  if (!item) return;
  const finalQc = item.qc_stage === 'final';
  openModal(finalQc ? 'Pemeriksaan QC akhir' : 'Pemeriksaan laptop masuk', finalQc ? 'Luluskan unit ke stok jual, kembalikan untuk perbaikan, atau tandai sebagai scrap/retur.' : 'Pilih hasil sortir. Menunggu RAM/SSD masuk antrean tunggu part; laptop mati bisa dipisahkan sebagai kandidat scrap.', `<div class="notice">${esc(item.barcode)} · ${esc(item.products?.name || 'Laptop')} · modal beli ${money(item.acquisition_cost)}</div><div class="form-grid"><div class="field"><label>Barcode pemasok</label><input name="supplier_barcode" value="${esc(item.supplier_barcode || '')}" placeholder="Barcode bawaan supplier" /></div><div class="field"><label>Nomor seri laptop</label><input name="serial_number" value="${esc(item.serial_number || '')}" placeholder="SN / serial unit" /></div><div class="field full"><label>Hasil pemeriksaan</label><select name="decision"><option value="available">Lolos QC · siap dijual</option>${finalQc ? '' : '<option value="waiting_parts">Butuh RAM / HDD / SSD · tunggu part</option>'}<option value="repair_needed">Perlu repair teknisi</option><option value="not_sellable">Karantina / retur supplier</option><option value="scrap">Scrap / kanibal part · tidak dijual</option></select></div><div class="field full"><label>Catatan kondisi / kerusakan</label><textarea name="notes" rows="4" required placeholder="Contoh: hidup normal, tanpa RAM dan SSD; atau mati, casing retak berat"></textarea></div></div>`, async (form) => { const { error } = await supabase.rpc('decide_stock_qc', { _stock_item_id: item.id, _decision: form.get('decision'), _notes: String(form.get('notes')).trim(), _serial_number: String(form.get('serial_number')).trim(), _supplier_barcode: String(form.get('supplier_barcode')).trim() }); if (error) throw error; toast(form.get('decision') === 'available' ? 'Unit lolos QC dan masuk stok tersedia.' : 'Hasil sortir tersimpan pada unit ini.'); await showPage('quality'); }, 'Simpan hasil QC');
}

async function externalRepairPartModal(repairId) {
  const id = crypto.randomUUID();
  openModal('Catat sparepart dari luar', 'Biaya masuk ke modal repair. Centang pembayaran hanya jika sudah dibayar.', `<div class="form-grid">
    <div class="field full"><label>Nama dan spesifikasi part</label><input name="name" required maxlength="200" /></div>
    <div class="field"><label>Jumlah</label><input name="quantity" type="number" min="1" max="500" value="1" required /></div>
    <div class="field"><label>Harga beli per unit</label><input name="cost" type="number" min="1" required /></div>
    <div class="field"><label>Toko / supplier</label><input name="supplier" required maxlength="160" /></div>
    <div class="field"><label>Tanggal beli</label><input name="date" type="date" value="${new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta'}).format(new Date())}" required /></div>
    <div class="field"><label>Nomor nota (opsional)</label><input name="invoice" maxlength="100" /></div>
    <label><input name="paid" type="checkbox" /> Sudah dibayar</label>
  </div>`, async (form) => {
    checkError(await supabase.rpc('record_external_repair_part', {
      _id: id, _repair: repairId, _name: form.get('name'), _quantity: Number(form.get('quantity')),
      _unit_cost: Number(form.get('cost')), _supplier: form.get('supplier'), _date: form.get('date'),
      _invoice: form.get('invoice'), _paid: form.has('paid')
    }));
    await showPage('quality');
    toast('Sparepart luar tercatat.');
  });
}

async function repairPartModal(repairId) {
  const result = await supabase.from('stock_items').select('id,barcode,quantity,products(name,sku,category)').eq('branch_id', state.branchId).eq('status', 'available').gt('quantity', 0);
  if (result.error) return toast(result.error.message, true);
  const parts = (result.data || []).filter((item) => ['Sparepart','Aksesori','Lainnya'].includes(item.products?.category));
  if (!parts.length) return toast('Belum ada stok sparepart tersedia di cabang ini. Tambah melalui Penerimaan & Barcode.');
  openModal('Pakai sparepart', 'Pemakaian mengurangi stok cabang dan tercatat pada pekerjaan repair ini.', `<div class="form-grid"><div class="field full"><label>Sparepart</label><select name="part_stock_item_id" required>${parts.map((item) => `<option value="${item.id}">${esc(item.products?.name || 'Sparepart')} · ${item.quantity} unit · ${esc(item.barcode)}</option>`).join('')}</select></div><div class="field"><label>Jumlah terpakai</label><input name="quantity" type="number" min="1" value="1" required /></div></div>`, async (form) => { const { error } = await supabase.rpc('use_stock_repair_part', { _repair_id: repairId, _part_stock_item_id: form.get('part_stock_item_id'), _quantity: Number(form.get('quantity')) }); if (error) throw error; toast('Pemakaian sparepart tercatat dan stok diperbarui.'); await showPage('quality'); }, 'Catat pemakaian');
}

async function fetchInventory() {
  const [products, stock] = await Promise.all([
    fetchAllRows(supabase.from('products').select('*').order('name')),
    fetchAllRows(supabase.from('stock_items').select('id,product_id,branch_id,barcode,supplier_barcode,serial_number,supplier,quantity,status,acquisition_cost,warranty_until,warranty_code,opening_batch_id,created_at,qc_stage').eq('branch_id', state.branchId).order('created_at', { ascending: false })),
  ]);
  state.products = products;
  return { products: state.products, stock };
}

async function receivingPage(page) {
  if (!canIntake()) throw new Error('Halaman ini hanya untuk pemilik dan operator penerimaan.');
  const [products, batches, queue, suppliers] = await Promise.all([
    fetchAllRows(supabase.from('products').select('id,name,sku,category,cost_price,image_path').order('name')),
    supabase.from('intake_batches').select('id,product_id,supplier,supplier_id,invoice_number,total_amount,amount_paid,due_date,unit_count,created_at,products(name,sku,category),suppliers(name,initials),stock_items(status)').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(20),
    fetchAllRows(supabase.from('stock_items').select('id,barcode,serial_number,supplier_barcode,product_id,intake_batch_id,created_at,products(name)').eq('branch_id', state.branchId).eq('status', 'pending_qc').order('created_at', { ascending: false })),
    fetchAllRows(supabase.from('suppliers').select('id,name,initials,phone').order('name')),
  ]);
  if (batches.error) throw batches.error;
  const pending = queue;
  const batchRows = (batches.data || []).map((batch) => `<tr><td class="product-name">${esc(batch.id.slice(0, 8).toUpperCase())}<div class="field-hint">${new Date(batch.created_at).toLocaleString('id-ID')}</div></td><td>${esc(batch.products?.name || 'Barang')}</td><td>${esc(batch.suppliers?.name || batch.supplier || '—')} ${batch.suppliers?.initials ? `<span class="pill blue">${esc(batch.suppliers.initials)}</span>` : ''}<div class="field-hint">${esc(batch.invoice_number || '')}</div></td><td>${batch.unit_count} unit</td><td><span class="pill ${batch.stock_items?.some((item) => item.status === 'pending_qc') ? 'warn' : ''}">${batch.stock_items?.some((item) => item.status === 'pending_qc') ? 'Menunggu QC' : batch.stock_items?.every((item) => item.status === 'available') && batch.stock_items.length ? 'Siap di stok' : 'Lihat Produk & stok'}</span></td><td><button class="small-btn" data-print-batch="${batch.id}">Cetak label</button>${canManage() ? ` <button class="small-btn" data-edit-intake="${batch.id}">Edit</button> <button class="small-btn" data-delete-intake="${batch.id}">Hapus</button>` : ''}</td></tr>`).join('');
  page.innerHTML = `${header('Penerimaan & barcode', 'Catat supplier, jumlah, modal, dan pembayaran barang yang baru datang.', `<button class="btn primary" id="new-intake">＋ Buat penerimaan</button>`)}
    <div class="cards"><article class="card"><div class="card-label">Unit menunggu QC<span class="card-icon">▤</span></div><div class="card-value">${pending.length}</div><div class="card-sub">Cabang ${esc(branchName(state.branchId))}</div></article><article class="card"><div class="card-label">Penerimaan terbaru<span class="card-icon">▦</span></div><div class="card-value">${(batches.data || []).length}</div><div class="card-sub">20 penerimaan terakhir</div></article><article class="card"><div class="card-label">Alur berikutnya<span class="card-icon">→</span></div><div class="card-value" style="font-size:18px">Pindai & cek</div><div class="card-sub">Teknisi mengerjakan halaman QC & repair</div></article></div>
    <section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Riwayat penerimaan barang</div><div class="panel-sub">Label dicetak dari barcode setiap unit. Status belum menjadi stok jual sampai lolos QC.</div></div></div><div class="table-wrap"><table><thead><tr><th>KODE / WAKTU</th><th>PRODUK</th><th>PEMASOK</th><th>JUMLAH</th><th>STATUS UNIT</th><th>AKSI</th></tr></thead><tbody>${batchRows || '<tr><td colspan="6"><div class="empty"><b>Belum ada penerimaan</b>Catat barang datang untuk menghitung stok, modal, hutang supplier, dan membuat barcode.</div></td></tr>'}</tbody></table></div></section>
    <section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Unit menunggu pemeriksaan</div><div class="panel-sub">Cetak ulang label satuan jika ada yang rusak atau hilang.</div></div><input class="search" id="intake-search" placeholder="Cari barcode atau produk" /></div><div class="table-wrap"><table><thead><tr><th>BARCODE</th><th>PRODUK</th><th>BATCH</th><th>DITERIMA</th><th>AKSI</th></tr></thead><tbody id="intake-rows">${pending.map((item) => `<tr><td class="product-name">${esc(item.barcode)}</td><td>${esc(item.products?.name || 'Produk')}</td><td>${esc(item.intake_batch_id?.slice(0,8).toUpperCase() || '—')}</td><td>${new Date(item.created_at).toLocaleString('id-ID')}</td><td><button class="small-btn" data-print-one="${item.id}">Cetak label</button>${canManage() ? ` <button type="button" class="small-btn" data-edit-intake-unit="${item.id}">Edit</button> <button type="button" class="small-btn" data-delete-intake-unit="${item.id}">Hapus</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Tidak ada unit yang menunggu QC.</div></td></tr>'}</tbody></table></div></section>`;
  page.querySelector('#new-intake').addEventListener('click', () => intakeBatchModal(products, suppliers));
  page.querySelectorAll('[data-edit-intake]').forEach((button) => button.addEventListener('click', () => {
    const batch = batches.data.find((item) => item.id === button.dataset.editIntake);
    const due = Number(batch.amount_paid) < Number(batch.total_amount);
    openModal('Edit penerimaan', 'Ubah nomor nota dan tanggal jatuh tempo.', `<div class="form-grid"><div class="field"><label>Nomor nota</label><input name="invoice" value="${esc(batch.invoice_number || '')}" /></div>${due ? `<div class="field"><label>Jatuh tempo</label><input name="due" type="date" value="${esc(batch.due_date || '')}" required /></div>` : ''}</div>`, async (form) => {
      checkError(await supabase.rpc('manage_intake', { _id: batch.id, _delete: false, _invoice: form.get('invoice'), _due: form.get('due') || null }));
      toast('Penerimaan diperbarui.');
      await showPage('receiving');
    });
  }));
  page.querySelectorAll('[data-delete-intake]').forEach((button) => button.addEventListener('click', () => {
    openModal('Hapus penerimaan?', 'Unit dan barcode ikut dihapus. Penerimaan harus belum dibayar dan unitnya belum dipakai, dijual, atau dimutasi.', '', async () => {
      checkError(await supabase.rpc('manage_intake', { _id: button.dataset.deleteIntake, _delete: true, _invoice: null, _due: null }));
      toast('Penerimaan dihapus.');
      await showPage('receiving');
    }, 'Hapus penerimaan');
  }));
  page.querySelectorAll('[data-print-batch]').forEach((button) => button.addEventListener('click', async () => {
    const printWindow = window.open('', '_blank', 'width=760,height=720');
    if (!printWindow) return toast('Izinkan pop-up untuk mencetak label.', true);
    try { const { data, error } = await supabase.from('stock_items').select('barcode,supplier,quantity,suppliers(initials),products(name,sku,category)').eq('intake_batch_id', button.dataset.printBatch).order('created_at'); if (error) throw error; const labels=data||[];printBarcodeLabels(labels[0]?.products?.category==='Laptop'?labels:labels.slice(0,1), printWindow); } catch (error) { printWindow.close(); toast(error.message, true); }
  }));
  page.querySelectorAll('[data-edit-intake-unit], [data-delete-intake-unit]').forEach((button) => button.addEventListener('click', () => {
    const remove = Boolean(button.dataset.deleteIntakeUnit);
    const item = pending.find((row) => row.id === (button.dataset.editIntakeUnit || button.dataset.deleteIntakeUnit));
    if (!item) return;
    const fields = `<div class="form-grid"><div class="field"><label for="intake-unit-serial">Nomor seri</label><input id="intake-unit-serial" name="serial" maxlength="160" value="${esc(item.serial_number || '')}" /></div><div class="field"><label for="intake-unit-supplier-barcode">Barcode supplier</label><input id="intake-unit-supplier-barcode" name="supplier_barcode" maxlength="160" value="${esc(item.supplier_barcode || '')}" /></div></div>`;
    openModal(remove ? 'Hapus unit penerimaan?' : 'Edit unit penerimaan',
      remove ? `Unit ${esc(item.barcode)} akan dikeluarkan dari antrean QC dan jumlah penerimaan.` : `Barcode internal ${esc(item.barcode)}`,
      remove ? '' : fields, async (form) => {
        checkError(await supabase.rpc('manage_pending_intake_unit', {
          _id: item.id, _remove: remove, _serial: form.get('serial'), _supplier_barcode: form.get('supplier_barcode')
        }));
        await showPage('receiving');
        toast(remove ? 'Unit penerimaan dihapus.' : 'Unit penerimaan diperbarui.');
      }, remove ? 'Hapus unit' : 'Simpan unit');
  }));
  page.querySelectorAll('[data-print-one]').forEach((button) => button.addEventListener('click', async () => {
    const printWindow = window.open('', '_blank', 'width=500,height=400');
    if (!printWindow) return toast('Izinkan pop-up untuk mencetak label.', true);
    try { const { data, error } = await supabase.from('stock_items').select('barcode,supplier,suppliers(initials),products(name,sku,category)').eq('id', button.dataset.printOne).single(); if (error) throw error; printBarcodeLabels([data], printWindow); } catch (error) { printWindow.close(); toast(error.message, true); }
  }));
  page.querySelector('#intake-search').addEventListener('input', (event) => { const query = event.target.value.toLowerCase(); page.querySelectorAll('#intake-rows tr').forEach((row) => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(query))); });
}

function intakeBatchModal(products, suppliers) {
  const options = products.map((p) => `<option value="${p.id}" data-cost="${Number(p.cost_price || 0)}" data-image="${esc(p.image_path || '')}">${esc(p.name)} · ${esc(p.sku)}</option>`).join('');
  const supplierOptions = suppliers.map((supplier,index) => `<option value="${supplier.id}" data-name="${esc(supplier.name)}" data-phone="${esc(supplier.phone || '')}" ${index === 0 ? 'selected' : ''}>${esc(supplier.name)} · ${esc(supplier.initials)}</option>`).join('');
  const host = openModal('Catat barang masuk', 'Satu penerimaan mengelompokkan barang dari supplier/nota yang sama, menghitung modal dan hutangnya, serta menautkan barcode unit atau lot.', `<div class="intake-layout"><div class="form-grid">${branchField('branch_id', state.branchId, true)}<div class="field"><label>Produk / barang</label><select name="product_id" required>${options}<option value="__new__">＋ Barang baru, belum ada di produk</option></select></div><div class="field"><label>Jumlah unit masuk</label><input name="quantity" type="number" min="1" max="500" value="1" required /><small class="field-hint">Laptop: barcode unik tiap unit. Sparepart: satu stok lot sesuai jumlah.</small></div><div class="new-product-fields form-grid full" hidden><div class="field"><label>Nama barang baru</label><input name="new_name" placeholder="Contoh: Lenovo ThinkPad T14" /></div><div class="field"><label>SKU (opsional)</label><input name="new_sku" placeholder="Dibuat otomatis kalau kosong" /></div><div class="field"><label>Brand</label><input name="new_brand" /></div><div class="field"><label>Tipe</label><input name="new_model" /></div><div class="field"><label>Kategori</label><select name="new_category"><option>Laptop</option><option>Sparepart</option><option>Aksesori</option><option>Lainnya</option></select></div><div class="field intake-sale-price" hidden><label>Harga end user</label><input name="new_retail" ${isCentralAdmin() ? 'readonly' : ''} type="number" min="0" value="0" /></div><div class="field intake-sale-price" hidden><label>Harga reseller (opsional)</label><input name="new_reseller" ${isCentralAdmin() ? 'readonly' : ''} type="number" min="0" value="0" /></div></div>${productPhotoPicker(products[0]?.image_path || '', false)}</div><div class="form-grid"><div class="field full"><label>Supplier</label><select name="supplier_pick"><option value="__new__">＋ Supplier baru</option>${supplierOptions}</select></div><div class="new-supplier-fields form-grid full"><div class="field"><label>Nama supplier baru</label><input name="supplier_name" placeholder="Contoh: Asep" required /></div><div class="field"><label>Telepon supplier</label><input name="supplier_phone" placeholder="Opsional" /></div></div><div class="field"><label>No. invoice / nota</label><input name="invoice_number" placeholder="Opsional" /></div><div class="field"><label>Modal beli per unit</label><small class="field-hint">Dipakai untuk menghitung tagihan supplier dan modal stok.</small><input name="unit_cost" type="number" min="0" value="0" required /></div><div class="field"><label>Total tagihan supplier · jumlah × modal/unit</label><input name="total_amount" type="text" value="Rp 0" readonly /></div><div class="field"><label>Dibayar sekarang</label><input name="amount_paid" type="number" min="0" value="0" step="1" required /><small class="field-hint" data-intake-balance aria-live="polite"></small><button type="button" class="small-btn" data-pay-in-full>Bayar lunas</button></div><div class="field debt-date" hidden><label>Jatuh tempo hutang</label><input name="due_date" type="date" /></div></div></div><div class="notice" style="margin-top:12px">Sisa tagihan otomatis dihitung dari total penerimaan dikurangi pembayaran awal. Laptop masuk antrean QC. Harga jual dan reseller diatur di Produk & stok setelah pemeriksaan.</div>`, async (form) => {
    const printWindow = window.open('', '_blank', 'width=760,height=720');
    const isNew = form.get('product_id') === '__new__';
    const existingProduct = products.find((product) => product.id === form.get('product_id'));
    if (isNew && !String(form.get('new_name')).trim()) { printWindow?.close(); throw new Error('Nama barang baru wajib diisi.'); }
    const photoFile = selectedProductPhoto(form);
    let imagePath = existingProduct?.image_path || '';

    if (photoFile) { imagePath = await uploadProductPhoto(photoFile, crypto.randomUUID()); if (!isNew) { const photoResult = await supabase.rpc('set_product_image', { _product_id: existingProduct.id, _image_path: imagePath }); if (photoResult.error) { printWindow?.close(); throw photoResult.error; } } }
    const { data: batchId, error } = await supabase.rpc('receive_stock_batch_financial', {
      _branch_id: form.get('branch_id'), _product_id: isNew ? null : form.get('product_id'),
      _new_product: isNew ? { name: String(form.get('new_name')).trim(), sku: String(form.get('new_sku')).trim(), brand: String(form.get('new_brand')).trim(), model: String(form.get('new_model')).trim(), category: form.get('new_category'), cost_price: Number(form.get('unit_cost') || 0), retail_price: isCentralAdmin() || form.get('new_category') === 'Laptop' ? 0 : Number(form.get('new_retail') || 0), reseller_price: isCentralAdmin() || form.get('new_category') === 'Laptop' ? 0 : Number(form.get('new_reseller') || 0), image_path: imagePath } : null,
      _supplier_name: form.get('supplier_pick') === '__new__' ? String(form.get('supplier_name')).trim() : host.querySelector(`select[name="supplier_pick"] option[value="${CSS.escape(form.get('supplier_pick'))}"]`)?.dataset.name || '', _supplier_phone: form.get('supplier_pick') === '__new__' ? String(form.get('supplier_phone')).trim() : host.querySelector(`select[name="supplier_pick"] option[value="${CSS.escape(form.get('supplier_pick'))}"]`)?.dataset.phone || '', _invoice_number: String(form.get('invoice_number')).trim(),
      _quantity: Number(form.get('quantity')), _total_amount: Number(form.get('unit_cost')), _amount_paid: Number(form.get('amount_paid')), _due_date: form.get('due_date') || null,
    });
    if (error) { printWindow?.close(); throw error; }
    const { data, error: itemError } = await supabase.from('stock_items').select('barcode,supplier,quantity,suppliers(initials),products(name,sku,category)').eq('intake_batch_id', batchId).order('created_at');
    if (itemError) { printWindow?.close(); throw itemError; }
    const labels=data||[],serialized=labels[0]?.products?.category==='Laptop',toPrint=serialized?labels:labels.slice(0,1);
    if (printWindow) printBarcodeLabels(toPrint, printWindow); else toast('Stok tersimpan. Izinkan pop-up, lalu cetak label dari daftar batch.');
    const supplierLabel = form.get('supplier_pick') === '__new__' ? String(form.get('supplier_name') || '').trim() : host.querySelector(`select[name="supplier_pick"] option[value="${CSS.escape(form.get('supplier_pick'))}"]`)?.dataset.name;
    toast(serialized?`${labels.length} barcode unik laptop dibuat. Label supplier ${supplierLabel||'SUP'} siap dicetak.`:`${Number(labels[0]?.quantity||0)} unit sparepart masuk sebagai stok lot. Satu barcode lot dibuat; supplier ${supplierLabel||'SUP'}.`);
    await showPage('receiving');
  }, 'Simpan penerimaan & cetak label');
  const form = host.querySelector('#active-modal');
  form.classList.add('intake-modal');
  const syncTotal = () => { const total=Math.max(0,Number(form.quantity.value||0))*Math.max(0,Number(form.unit_cost.value||0));form.querySelector('[name="total_amount"]').value=money(total); };
  const syncSalePriceFields = () => {
    form.querySelectorAll('.intake-sale-price').forEach((field) => { field.hidden = form.new_category.value === 'Laptop'; });
  };
  form.new_category.addEventListener('change', syncSalePriceFields);
  syncSalePriceFields();
  const syncProductFields = () => { const isNew = form.product_id.value === '__new__'; const option = form.querySelector('select[name="product_id"] option:checked'); form.querySelector('.new-product-fields').hidden = !isNew; if (!isNew) form.unit_cost.value = option?.dataset.cost || 0; else form.unit_cost.value = 0; const hasFile = form.product_photo_file.files.length || form.product_photo_camera.files.length; if (!hasFile) { const imagePath = isNew ? '' : option?.dataset.image || ''; const preview = form.querySelector('[data-photo-preview]'); const url = productImageUrl(imagePath); preview.innerHTML = url ? `<img src="${url}" alt="Foto produk" />` : '<span>Foto belum tersedia · opsional</span>'; } syncTotal(); };
  const syncSupplierFields = () => { const fresh = form.supplier_pick.value === '__new__'; form.querySelector('.new-supplier-fields').hidden = !fresh; form.supplier_name.required = fresh; };
  const syncDebtFields = () => {
    const total = Number(form.quantity.value || 0) * Number(form.unit_cost.value || 0);
    const paid = Number(form.amount_paid.value || 0);
    const balance = total - paid;
    const due = form.querySelector('.debt-date');
    due.hidden = balance <= 0;
    due.querySelector('input').required = balance > 0;
    form.amount_paid.setCustomValidity(balance < 0 ? 'Pembayaran melebihi total tagihan.' : '');
    form.querySelector('[data-intake-balance]').textContent = balance < 0
      ? 'Pembayaran melebihi total tagihan.'
      : 'Dibayar ' + money(paid) + ' · Sisa tagihan ' + money(balance);
  };
  form.querySelector('[data-pay-in-full]').addEventListener('click', () => {
    form.amount_paid.value = Number(form.quantity.value || 0) * Number(form.unit_cost.value || 0);
    syncDebtFields();
  });
  bindProductPhotoPicker(form);
  form.product_id.addEventListener('change', () => { syncProductFields(); syncDebtFields(); });
  form.supplier_pick.addEventListener('change', syncSupplierFields);
  form.quantity.addEventListener('input', () => { syncTotal(); syncDebtFields(); });
  form.unit_cost.addEventListener('input', () => { syncTotal(); syncDebtFields(); });
  form.amount_paid.addEventListener('input', syncDebtFields);
  syncProductFields(); syncSupplierFields(); syncTotal(); syncDebtFields();
}

async function printBarcodeLabels(items, printable = null) {
  if (!printable) printable = window.open('', '_blank', 'width=980,height=820');
  if (!printable) return toast('Izinkan pop-up untuk membuka pratinjau barcode.', true);
  let JsBarcode;
  try { ({ default: JsBarcode } = await import('jsbarcode')); }
  catch { printable.close(); return toast('Modul cetak barcode gagal dimuat. Coba lagi.', true); }
  const labels = items.map((item) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, item.barcode, { format: 'CODE128', displayValue: false, font: 'Arial', fontSize: 9, height: 48, margin: 1, lineColor: '#17201b' });
    const supplier = barcodeSupplierInitials(item);
    return `<article class="label"><strong>DL${supplier ? ` · ${esc(supplier)}` : ''}</strong>${svg.outerHTML}<small class="barcode-value">${esc(item.barcode)}</small></article>`;
  }).join('');
  const prefs = JSON.parse(localStorage.getItem('digi-label-settings') || '{}');
  const isLaptopBatch=items.every((item)=>item.products?.category==='Laptop');
  printable.document.write(`<!doctype html><html><head><meta charset="utf-8">${printViewport}<title>Pratinjau barcode Digi-Laptop</title><style>
    *{box-sizing:border-box}body{font:14px Arial;color:#17201b;margin:0;background:#eef2ee}.toolbar{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid #ccd5cd;padding:14px 20px;display:flex;gap:12px;align-items:end;flex-wrap:wrap}.toolbar label{display:grid;gap:5px;font-size:12px}.toolbar input,.toolbar select,.toolbar button{height:36px;border:1px solid #aebcaf;border-radius:0;padding:0 9px;background:white}.toolbar button{background:#075c37;color:white;font-weight:bold;padding:0 16px;cursor:pointer}.toolbar .count{margin-right:auto;font-weight:bold}.sheets{padding:18px;overflow-x:auto;display:grid;justify-items:center;gap:18px}.sheet{background:white;box-shadow:0 3px 16px #0002;padding:8mm;display:grid;grid-template-columns:repeat(var(--cols),var(--lw));grid-auto-rows:var(--lh);gap:3mm;align-content:start;justify-content:start;overflow:hidden}.label{border:1px solid #59655d;padding:1mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;text-align:center;break-inside:avoid;overflow:hidden}.label strong{font-size:8px;line-height:1;letter-spacing:.04em}.label span{font-size:8px;margin-top:2px}.label svg{width:100%;height:var(--barcode-h);max-height:75%;margin:0}.label small{font-size:7px}.label .barcode-value{font-size:8px;line-height:1.1;font-weight:700;letter-spacing:.03em;white-space:nowrap}.status{font-size:12px;color:#66756a}@media screen and (max-width:760px){.sheets{justify-items:start}}@media print{body{background:#fff}.toolbar,.status{display:none!important}.sheets{padding:0;gap:0;overflow:visible}.sheet{box-shadow:none;margin:0;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}}
  </style></head><body><div class="toolbar"><strong class="count">${isLaptopBatch?`${items.length} barcode unik laptop`:`${items.length} barcode lot · ${Number(items[0]?.quantity||1)} unit stok`}</strong><label>Ukuran kertas<select id="paper"><option>A4</option><option>A5</option><option>Letter</option><option value="custom">Kustom</option></select></label><label>Lebar label (mm)<input id="lw" type="number" min="20" max="200" value="50"></label><label>Tinggi label (mm)<input id="lh" type="number" min="15" max="100" value="24"></label><label>Kolom per baris<input id="cols" type="number" min="1" max="8" value="3"></label><button id="print">Cetak barcode</button></div><div class="status" style="padding:0 20px 8px">Atur dimensi label dan kertas. Printer dipilih melalui dialog cetak perangkat. ${mobilePrintHint()}</div><main class="sheets" id="sheets">${labels}</main><script>
  const $=id=>document.getElementById(id),presets={A4:[210,297],A5:[148,210],Letter:[216,279]},saved=${JSON.stringify(prefs)};if(saved.paper)$('paper').value=saved.paper;if(saved.width)$('lw').value=saved.width;if(saved.height)$('lh').value=saved.height;if(saved.cols)$('cols').value=saved.cols;
  function layout(){const paper=$('paper').value,[presetW,ph]=presets[paper]||[210,297],w=+$('lw').value,h=+$('lh').value,c=+$('cols').value,pw=paper==='custom'?w*c+16:presetW,per=Math.max(1,Math.floor((ph-16+3)/(h+3))),all=[...document.querySelectorAll('.label')],wrap=$('sheets');wrap.innerHTML='';for(let i=0;i<all.length;i+=per*c){const sheet=document.createElement('section');sheet.className='sheet';sheet.style.setProperty('--cols',c);sheet.style.setProperty('--lw',w+'mm');sheet.style.setProperty('--lh',h+'mm');sheet.style.setProperty('--barcode-h',Math.max(9,h*.70)+'mm');sheet.style.width=pw+'mm';sheet.style.minHeight=ph+'mm';all.slice(i,i+per*c).forEach(x=>sheet.append(x));wrap.append(sheet)}const st=document.getElementById('dynamic')||document.head.appendChild(Object.assign(document.createElement('style'),{id:'dynamic'}));st.textContent='@page{size:'+(paper==='custom'?(w*c+16)+'mm '+ph+'mm':paper)+';margin:0}';localStorage.setItem('digi-label-settings',JSON.stringify({paper,width:w,height:h,cols:c}))}
  ['paper','lw','lh','cols'].forEach(id=>$(id).addEventListener('input',layout));$('paper').addEventListener('change',layout);$('print').onclick=()=>window.print();layout();</script></body></html>`);
  printable.document.close();
}

function barcodeSupplierInitials(item) {
  const registered = String(item.suppliers?.initials || '').trim();
  if (registered) return registered.toUpperCase();
  const supplier = String(item.supplier || '').trim();
  if (!supplier || supplier === '—' || /^stok awal$/i.test(supplier)) return '';
  const words = supplier.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0].slice(0, 2)).toUpperCase();
}

async function fetchAllRows(query) { const all=[],ordered=query.order('id');for(let from=0;;from+=1000){const {data,error}=await ordered.range(from,from+999);if(error)throw error;all.push(...(data||[]));if(!data||data.length<1000)break}return all;}
function downloadCsv(filename, rows) { const keys=Object.keys(rows[0]||{name:'',sku:'',category:''}); const cell=(v)=>`"${String(v??'').replaceAll('"','""')}"`; const csv=[keys.map(cell).join(','),...rows.map(row=>keys.map((key)=>cell(row[key])).join(','))].join('\r\n'); const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download=filename;a.click();URL.revokeObjectURL(a.href); }
function parseCsv(text) { const rows=[];let row=[],value='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++}else if(c==='"')quoted=false;else value+=c}else if(c==='"')quoted=true;else if(c===','){row.push(value);value=''}else if(c==='\n'){row.push(value.replace(/\r$/,''));rows.push(row);row=[];value=''}else value+=c}if(value||row.length){row.push(value.replace(/\r$/,''));rows.push(row)}const headers=(rows.shift()||[]).map((h)=>h.trim().replace(/^\ufeff/,''));return rows.filter((r)=>r.some((v)=>v.trim())).map((r)=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])));}

async function inventoryPage(page) {
  const branchId = state.branchId;
  const [{ products, stock }, openingBatches] = await Promise.all([
    fetchInventory(),
    canEditProducts()
      ? fetchAllRows(supabase.from('stock_opening_batches')
        .select('id,branch_id,product_id,unit_count,unit_cost,notes,created_at,products(name,sku,category,brand,model)')
        .eq('branch_id', branchId).order('created_at', { ascending: false }))
      : Promise.resolve([]),
  ]);
  if (!page.isConnected || state.branchId !== branchId) return;
  const totals = new Map(); stock.forEach((item) => totals.set(item.product_id, (totals.get(item.product_id) || 0) + (item.status === 'available' ? Number(item.quantity) : 0)));
  const branchProductIds = new Set(stock.map((item) => item.product_id));
  const branchProducts = products.filter((product) => branchProductIds.has(product.id));
  const stockByProduct = new Map();
  for (const item of stock) {
    const rows = stockByProduct.get(item.product_id) || [];
    rows.push(item);
    stockByProduct.set(item.product_id, rows);
  }
  const inventoryBranchName = esc(branchName(state.branchId));
  const branchPicker = canManage() ? `<label class="inventory-branch-picker">Cabang
    <select id="inventory-branch-picker" class="branch-select">${state.branches.map((branch) =>
      `<option value="${esc(branch.id)}"${branch.id === state.branchId ? ' selected' : ''}>${esc(branch.name)}</option>`
    ).join('')}</select></label>` : '';
  const normalizeBrand = (brand) => String(brand || '').trim().toLocaleLowerCase('id');
  const brandsByKey = new Map(products.filter((product) => normalizeBrand(product.brand)).map((product) => [normalizeBrand(product.brand), product.brand.trim()]));
  const productBrands = [...brandsByKey.values()].sort((a,b) => a.localeCompare(b, 'id'));
  const renderProductCards = (items) => items.map((product) => `
    <article class="inventory-product-card">
      <div class="inventory-product-image">${product.image_path ? `<img loading="lazy" src="${esc(productImageUrl(product.image_path))}" alt="${esc(product.name)}" />` : '<span>Foto belum ada</span>'}</div>
      <div class="inventory-product-body">
        <div class="field-hint">${esc(product.category)} · ${esc(product.sku)}</div>
        <h3>${esc(product.name)}</h3>
        <div class="field-hint">${esc([product.brand, product.model].filter(Boolean).join(' '))}</div>
        <div class="inventory-price-row">
          <strong class="inventory-product-price">${money(product.retail_price)}</strong>
          <span class="pill ${totals.get(product.id) > 0 ? '' : 'gray'}">${readyStockLabel()} <b>${totals.get(product.id) || 0} unit</b></span>
        </div>
        <div class="field-hint">Reseller ${money(product.reseller_price)}</div>
        <div class="field-hint">Menunggu QC: ${(stockByProduct.get(product.id) || []).filter((item) => item.status === 'pending_qc').length} · Repair: ${(stockByProduct.get(product.id) || []).filter((item) => repairStatuses.has(item.status)).length} · Terjual: ${(stockByProduct.get(product.id) || []).filter((item) => item.status === 'sold').length}</div>
        <div class="inventory-product-actions">
          <button class="small-btn" data-view-product="${product.id}">Detail</button>
          ${(canEditProducts() || (state.profile.role === 'operator' && branchProductIds.has(product.id))) ? `<button class="small-btn" data-product-photo="${product.id}">${product.image_path ? 'Ganti foto' : '＋ Foto'}</button>` : ''}
          ${canEditProducts() ? `<button class="small-btn" data-edit-product="${product.id}">Edit produk</button>` : ''}${canManage() ? `<button class="small-btn" data-delete-product="${product.id}">Hapus</button>` : ''}
        </div>
      </div>
    </article>`).join('');
  const action = canManage() ? '<button class="btn" id="export-products">Ekspor CSV</button><label class="btn">Impor CSV<input id="import-products" type="file" accept=".csv,text/csv" hidden /></label><button class="btn" id="open-opening-stock">＋ Stok awal</button><button class="btn primary" id="new-product">＋ Produk baru</button>' : isCentralAdmin() ? '<button class="btn" id="open-opening-stock">+ Stok awal</button><button class="btn primary" id="new-product">＋ Produk baru</button>' : '';
  const laptopUnits = stock.filter((item) => products.find((product) => product.id === item.product_id)?.category === 'Laptop');
  const componentLots = stock.filter((item) => products.find((product) => product.id === item.product_id)?.category !== 'Laptop');
  const unitCountFor = (status) => laptopUnits.filter((item) => item.status === status).reduce((sum, item) => sum + Number(item.quantity || 1), 0);
  const repairStatuses = new Set(['repair_needed','repairing','waiting_parts']);
  const renderLaptopUnits = (items) => items.map((item) => {
    const product = products.find((row) => row.id === item.product_id);
    const badge = item.status === 'available' ? '' : ['pending_qc','repair_needed','repairing','waiting_parts'].includes(item.status) ? 'warn' : 'gray';
    return `<tr data-unit-status="${esc(item.status)}"><td data-label="Barcode / unit" class="product-name">${esc(item.barcode)}<div class="field-hint">${esc(product?.name || 'Laptop')}</div></td><td data-label="Serial / supplier">${esc(item.serial_number || '—')}<div class="field-hint">Sumber: ${item.opening_batch_id ? 'Stok awal' : esc(item.supplier || 'Supplier tidak dicatat')}</div></td><td data-label="Status unit"><span class="pill ${badge}">${stockStatusText[item.status] || item.status}</span></td><td data-label="Modal per unit">${money(item.acquisition_cost)}</td><td data-label="Garansi">${item.warranty_until ? new Date(`${item.warranty_until}T00:00:00`).toLocaleDateString('id-ID') : 'Mulai setelah terjual'}</td><td><div class="actions-cell"><button class="small-btn" data-print-barcode="${esc(item.barcode)}">Cetak barcode stok</button>${item.warranty_code ? `<button class="small-btn" data-print-warranty-unit="${item.id}">Cetak QR garansi</button>` : ''}</div></td></tr>`;
  }).join('');
  const renderComponentLots = (items) => items.map((item) => {
    const product = products.find((row) => row.id === item.product_id);
    const badge = item.status === 'available' ? '' : ['pending_qc','repair_needed','repairing','waiting_parts'].includes(item.status) ? 'warn' : 'gray';
    return `<tr><td class="product-name">${esc(product?.name || 'Barang')}<div class="field-hint">${esc(product?.sku || '')} · ${esc(item.barcode)}</div></td><td>${item.opening_batch_id ? 'Stok awal' : esc(item.supplier || '—')}</td><td><b>${Number(item.quantity || 0)}</b> unit</td><td><span class="pill ${badge}">${stockStatusText[item.status] || item.status}</span></td><td>${money(item.acquisition_cost)}</td><td><button class="small-btn" data-print-barcode="${esc(item.barcode)}">Cetak barcode lot</button></td></tr>`;
  }).join('');
  const catalogSection = `<section class="panel inventory-catalog-panel" style="margin-top:13px"><div class="panel-head inventory-panel-head"><div><div class="panel-title">Produk · ${inventoryBranchName}</div><div class="panel-sub"><strong id="inventory-match-count" aria-live="polite"></strong> · ${products.length} model di katalog · ${branchProducts.length} model memiliki catatan stok di ${esc(branchName(state.branchId))} · stok siap jual mengikuti cabang yang dipilih.</div></div><div class="inventory-controls"><select id="inventory-category" aria-label="Filter kategori"><option value="all">Semua kategori</option><option value="Laptop">Laptop</option><option value="Sparepart">Sparepart</option><option value="Aksesori">Aksesori</option><option value="Lainnya">Lainnya</option></select><select id="inventory-brand" aria-label="Filter merek"><option value="all">Semua merek</option>${productBrands.map((brand) => `<option value="${esc(brand)}">${esc(brand)}</option>`).join('')}</select><select id="inventory-stock" aria-label="Filter status stok"><option value="branch" selected>Produk di cabang ini</option>${canEditProducts() ? '<option value="all">Katalog toko (semua model)</option>' : ''}<option value="available">Ada stok siap jual</option><option value="empty">Stok kosong</option><option value="pending_qc">Menunggu QC</option><option value="repair">Dalam repair</option><option value="sold">Pernah terjual</option></select><input class="price-filter" id="inventory-min-price" type="number" min="0" placeholder="Harga min" aria-label="Harga minimum" /><input class="price-filter" id="inventory-max-price" type="number" min="0" placeholder="Harga max" aria-label="Harga maksimum" /><select id="inventory-sort" aria-label="Urutkan harga"><option value="default">Urutkan harga</option><option value="asc">Harga terendah</option><option value="desc">Harga tertinggi</option></select><input class="search" id="inventory-search" value="${esc(state.inventorySearchQuery || '')}" placeholder="Cari nama, merek, model, SKU" /></div></div><div class="inventory-product-grid" id="inventory-rows"></div><nav id="inventory-pagination" class="inventory-pagination" aria-label="Halaman katalog" hidden><button type="button" class="btn" id="inventory-previous">Sebelumnya</button><span id="inventory-page-status" aria-live="polite"></span><button type="button" class="btn" id="inventory-next">Berikutnya</button></nav></section>`;
  page.innerHTML = `${header('Produk & stok', 'Pantau unit laptop per barcode dan stok sparepart per lot. Stok siap jual mencakup stok awal dan unit yang sudah tersedia setelah QC.', action)}
    <section class="panel inventory-branch-summary"><div><div class="panel-title">${inventoryBranchName}</div><div class="panel-sub">${branchProducts.length} model tercatat · ${[...totals.values()].reduce((sum, quantity) => sum + quantity, 0)} unit ${readyStockLabel().toLowerCase()}</div></div>${branchPicker}</section>
    <section class="cards laptop-unit-summary">
      <button type="button" class="card unit-summary-button" aria-controls="laptop-unit-rows" aria-pressed="false" data-unit-filter="pending_qc"><span class="card-label">Laptop menunggu QC<span aria-hidden="true">↗</span></span><span class="card-value">${unitCountFor('pending_qc')} <small>unit</small></span><span class="card-sub">Belum masuk stok jual</span></button>
      <button type="button" class="card unit-summary-button" aria-controls="laptop-unit-rows" aria-pressed="false" data-unit-filter="available"><span class="card-label">Laptop ${readyStockLabel().toLowerCase()}<span aria-hidden="true">↗</span></span><span class="card-value">${unitCountFor('available')} <small>unit</small></span><span class="card-sub">Stok awal dan unit siap dijual</span></button>
      <button type="button" class="card unit-summary-button" aria-controls="laptop-unit-rows" aria-pressed="false" data-unit-filter="repair"><span class="card-label">Laptop dalam repair<span aria-hidden="true">↗</span></span><span class="card-value">${[...repairStatuses].reduce((sum,status)=>sum+unitCountFor(status),0)} <small>unit</small></span><span class="card-sub">Repair atau menunggu sparepart</span></button>
      <button type="button" class="card unit-summary-button" aria-controls="laptop-unit-rows" aria-pressed="false" data-unit-filter="sold"><span class="card-label">Laptop terjual<span aria-hidden="true">↗</span></span><span class="card-value">${unitCountFor('sold')} <small>unit</small></span><span class="card-sub">QR garansi muncul bila unit bergaransi</span></button>
    </section>
    ${catalogSection}
    <section class="panel table-panel stock-unit-panel"><div class="panel-head inventory-panel-head"><div><div class="panel-title">Unit laptop · ${inventoryBranchName}</div><div class="panel-sub">Setiap laptop tercatat sendiri berdasarkan barcode, mulai dari diterima sampai terjual.</div></div><div class="inventory-controls"><select id="unit-status-filter" aria-label="Filter status unit"><option value="all">Semua status</option><option value="pending_qc">Menunggu QC</option><option value="available">${readyStockLabel()}</option><option value="repair">Semua repair</option><option value="repair_needed">Perlu repair</option><option value="repairing">Sedang repair</option><option value="waiting_parts">Menunggu sparepart</option><option value="sold">Terjual</option><option value="other">Scrap / retur / lainnya</option></select><input class="search" id="unit-search" placeholder="Cari barcode, serial, supplier, model" /></div></div><div class="table-wrap"><table class="laptop-unit-table" role="table"><thead><tr><th>BARCODE / UNIT</th><th>SERIAL / SUPPLIER</th><th>STATUS UNIT</th><th>MODAL PER UNIT</th><th>GARANSI</th><th>AKSI</th></tr></thead><tbody id="laptop-unit-rows">${renderLaptopUnits(laptopUnits)}<tr id="unit-filter-empty" hidden><td colspan="6"><div class="empty">Tidak ada unit laptop yang cocok dengan filter ini.</div></td></tr></tbody></table></div><nav class="inventory-pagination" id="unit-pagination" aria-label="Halaman unit laptop" hidden><button type="button" class="btn" id="unit-previous">Sebelumnya</button><span id="unit-page-status" aria-live="polite"></span><button type="button" class="btn" id="unit-next">Berikutnya</button></nav></section>
    <section class="panel table-panel" style="margin-top:13px"><div class="panel-head"><div><div class="panel-title">Stok sparepart & barang lot</div><div class="panel-sub">Kuantitas sparepart dicatat per lot dan berkurang saat dipakai servis atau dijual. ${componentLots.length} lot di cabang ini.</div></div></div><div class="table-wrap"><table><thead><tr><th>BARANG / BARCODE LOT</th><th>SUPPLIER</th><th>JUMLAH</th><th>STATUS</th><th>MODAL / UNIT</th><th>AKSI</th></tr></thead><tbody>${renderComponentLots(componentLots)||'<tr><td colspan="6"><div class="empty">Belum ada stok sparepart atau barang lot di cabang ini.</div></td></tr>'}</tbody></table></div></section>
    ${canEditProducts() ? `<section class="panel table-panel" id="opening-stock-history" style="margin-top:13px"><div class="panel-head"><div><div class="panel-title">Riwayat stok awal</div><div class="panel-sub">Cabang ${esc(branchName(branchId))}</div></div></div>
      <div class="panel-head opening-history-tools">
        <div class="form-grid">
          <div class="field"><label for="opening-brand">Merek laptop</label><select id="opening-brand"></select></div>
          <div class="field"><label for="opening-model">Tipe laptop</label><select id="opening-model"></select></div>
        </div>
        <button type="button" class="btn danger" id="cancel-opening-group" hidden>Batalkan semua batch tipe ini</button>
      </div>
      <div class="table-wrap"><table><thead><tr><th>TANGGAL / KODE</th><th>PRODUK</th><th>JUMLAH</th><th>MODAL / UNIT</th><th>CATATAN</th><th></th></tr></thead><tbody>${openingBatches.map((batch) => `<tr data-opening-row="${batch.id}"><td class="product-name">${new Date(batch.created_at).toLocaleString('id-ID')}<div class="field-hint">${esc(batch.id.slice(0,8).toUpperCase())}</div></td><td>${esc(batch.products?.name || 'Produk')}<div class="field-hint">${esc(batch.products?.sku || '')}</div></td><td>${Number(batch.unit_count)} unit</td><td>${money(batch.unit_cost)}</td><td>${esc(batch.notes || '—')}</td><td><button class="small-btn" data-print-opening="${batch.id}">Cetak barcode</button> <button class="small-btn" data-correct-opening="${batch.id}">Koreksi stok awal</button> ${canManage() ? `<button class="small-btn" data-cancel-opening="${batch.id}">Batalkan stok awal</button>` : ''}</td></tr>`).join('')}<tr data-opening-empty hidden><td colspan="6"><div class="empty">Tidak ada batch yang cocok.</div></td></tr></tbody></table></div>
      <div class="panel-head"><span data-opening-count role="status"></span><button type="button" class="btn" data-opening-more hidden>Tampilkan lagi</button></div></section>` : ''}
    <section class="panel table-panel" style="margin-top:13px"><div class="panel-head"><div><div class="panel-title">QR garansi unit terjual</div><div class="panel-sub">QR dibuat setelah laptop bergaransi terjual; cetak dari kolom aksi unit atau halaman Garansi.</div></div><button class="small-btn" id="open-warranty-qr">Buka halaman Garansi →</button></div></section>`;
  const unitSearch = page.querySelector('#unit-search');
  const unitStatus = page.querySelector('#unit-status-filter');
  const unitRows = [...page.querySelectorAll('#laptop-unit-rows tr[data-unit-status]')];
  const unitSummaryButtons = [...page.querySelectorAll('[data-unit-filter]')];
  const unitPagination = page.querySelector('#unit-pagination');
  const unitPrevious = page.querySelector('#unit-previous');
  const unitNext = page.querySelector('#unit-next');
  const unitPageStatus = page.querySelector('#unit-page-status');
  const unitsPerPage = 10;
  const savedUnits = state.inventoryUnitPage;
  let unitPage = savedUnits?.number || 1;
  unitSearch.value = savedUnits?.search || '';
  unitStatus.value = savedUnits?.filter || 'all';
  const filterUnits = () => {
    const query = unitSearch.value.trim().toLocaleLowerCase('id');
    const filter = unitStatus.value;
    const matches = unitRows.filter((row) => {
      const status = row.dataset.unitStatus;
      const matchesStatus = filter === 'all' || status === filter ||
        (filter === 'repair' && repairStatuses.has(status)) ||
        (filter === 'other' && !repairStatuses.has(status) && !['pending_qc', 'available', 'sold'].includes(status));
      return matchesStatus && row.textContent.toLocaleLowerCase('id').includes(query);
    });
    const pageCount = Math.max(1, Math.ceil(matches.length / unitsPerPage));
    unitPage = Math.max(1, Math.min(unitPage, pageCount));
    const start = (unitPage - 1) * unitsPerPage;
    const visible = new Set(matches.slice(start, start + unitsPerPage));
    unitRows.forEach(row => row.classList.toggle('hidden', !visible.has(row)));
    page.querySelector('#unit-filter-empty').hidden = matches.length > 0;
    unitPagination.hidden = pageCount === 1;
    unitPrevious.disabled = unitPage === 1;
    unitNext.disabled = unitPage === pageCount;
    unitPageStatus.textContent = `Halaman ${unitPage} / ${pageCount} · ${matches.length} unit`;
    state.inventoryUnitPage = { number: unitPage, search: unitSearch.value, filter };
    unitSummaryButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.unitFilter === filter)));
  };
  const resetUnitPage = () => { unitPage = 1; filterUnits(); };
  unitSearch.addEventListener('input', resetUnitPage);
  unitStatus.addEventListener('change', resetUnitPage);
  [[unitPrevious, -1], [unitNext, 1]].forEach(([button, direction]) => {
    button.addEventListener('click', () => {
      unitPage += direction;
      filterUnits();
      unitPagination.closest('.stock-unit-panel').scrollIntoView({ block: 'start' });
    });
  });
  unitSummaryButtons.forEach((button) => button.addEventListener('click', () => {
    unitSearch.value = '';
    unitStatus.value = button.dataset.unitFilter;
    resetUnitPage();
    unitStatus.focus({ preventScroll: true });
    page.querySelector('.stock-unit-panel').scrollIntoView({ block: 'start' });
  }));
  filterUnits();
  page.querySelector('#new-product')?.addEventListener('click', () => productModal());
  page.querySelector('#open-opening-stock')?.addEventListener('click', () => openingStockModal(products));
  page.querySelector('#export-products')?.addEventListener('click', () => downloadCsv('digi-laptop-produk.csv', products.map(({name,sku,brand,model,category,cost_price,retail_price,reseller_price,warranty_months,image_path}) => ({name,sku,brand,model,category,cost_price,retail_price,reseller_price,warranty_months,image_path}))));
  page.querySelector('#import-products')?.addEventListener('change', async (event) => { const file=event.target.files?.[0]; if(!file)return; try { const rows=parseCsv(await file.text()); const required=['name','sku','category']; if(!rows.length||required.some((key)=>!(key in rows[0]))) throw new Error('CSV wajib punya kolom name, sku, category. Gunakan Ekspor CSV sebagai contoh format.'); const seen=new Set();const productsToImport=rows.map((row)=>{const sku=String(row.sku||'').trim()||`DL-${crypto.randomUUID().slice(0,8).toUpperCase()}`;if(seen.has(sku))throw new Error(`SKU ${sku} muncul lebih dari sekali di file.`);seen.add(sku);return {id:products.find(p=>p.sku===sku)?.id||crypto.randomUUID(),organization_id:state.organization.id,name:String(row.name||'').trim(),sku,brand:row.brand||'',model:row.model||'',category:row.category||'Lainnya',cost_price:Number(row.cost_price||0),retail_price:Number(row.retail_price||0),reseller_price:Number(row.reseller_price||0),warranty_months:Number(row.warranty_months||0),image_path:row.image_path||products.find(p=>p.sku===sku)?.image_path||''}}); if(productsToImport.some((x)=>!x.name||![x.cost_price,x.retail_price,x.reseller_price,x.warranty_months].every(Number.isFinite)||[x.cost_price,x.retail_price,x.reseller_price,x.warranty_months].some(v=>v<0))) throw new Error('Nama produk atau nominal di CSV tidak valid.'); const result=await supabase.from('products').upsert(productsToImport,{onConflict:'id'}); if(result.error)throw result.error; toast(`${productsToImport.length} produk berhasil diimpor.`); await showPage('inventory'); } catch(error){toast(error.message||'CSV gagal diimpor.',true)} finally{event.target.value=''} });
  const productsPerPage = 8;
  let productPage = 1;
  const pagination = page.querySelector('#inventory-pagination');
  const previousPage = page.querySelector('#inventory-previous');
  const nextPage = page.querySelector('#inventory-next');
  const pageStatus = page.querySelector('#inventory-page-status');
  const applyProductFilters = () => {
    const category = page.querySelector('#inventory-category').value; const brand = page.querySelector('#inventory-brand').value; const stockFilter = page.querySelector('#inventory-stock').value; const sort = page.querySelector('#inventory-sort').value; const query = page.querySelector('#inventory-search').value.trim().toLowerCase(); const minPrice = Number(page.querySelector('#inventory-min-price').value || 0); const maxInput = page.querySelector('#inventory-max-price').value; const maxPrice = maxInput === '' ? Infinity : Number(maxInput);
    let filtered = (canEditProducts() ? products : branchProducts).filter((product) => {
      const items = stockByProduct.get(product.id) || [];
      const availableCount = totals.get(product.id) || 0;
      const hasStatus = (status) => items.some((item) => item.status === status);
      const statusMatch = (stockFilter === 'branch' && items.length > 0) || stockFilter === 'all' || (stockFilter === 'available' && availableCount > 0) || (stockFilter === 'empty' && availableCount === 0) || (stockFilter === 'pending_qc' && hasStatus('pending_qc')) || (stockFilter === 'repair' && items.some((item) => repairStatuses.has(item.status))) || (stockFilter === 'sold' && hasStatus('sold'));
      const price = Number(product.retail_price || 0);
      return (category === 'all' || product.category === category) && (brand === 'all' || normalizeBrand(product.brand) === normalizeBrand(brand)) && statusMatch && (!minPrice || price >= minPrice) && price <= maxPrice && `${product.name} ${product.brand} ${product.model} ${product.sku}`.toLowerCase().includes(query);
    });
    if (sort !== 'default') filtered = filtered.sort((a,b) => (Number(a.retail_price)-Number(b.retail_price)) * (sort === 'asc' ? 1 : -1));
    page.querySelector('#inventory-match-count').textContent = filtered.length + ' hasil';
    const pageCount = Math.max(1, Math.ceil(filtered.length / productsPerPage));
    productPage = Math.min(productPage, pageCount);
    const start = (productPage - 1) * productsPerPage;
    page.querySelector('#inventory-rows').innerHTML = renderProductCards(filtered.slice(start, start + productsPerPage)) || '<div class="empty"><b>Tidak ada produk yang cocok</b>Ubah filter merek, kategori, harga, atau kata pencarian.</div>';
    pagination.hidden = pageCount === 1;
    previousPage.disabled = productPage === 1;
    nextPage.disabled = productPage === pageCount;
    pageStatus.textContent = `Halaman ${productPage} / ${pageCount} · ${filtered.length} produk`;
  };
  ['#inventory-search','#inventory-category','#inventory-brand','#inventory-stock','#inventory-min-price','#inventory-max-price','#inventory-sort'].forEach((selector) => {
    page.querySelector(selector).addEventListener(selector === '#inventory-search' || selector.includes('price') ? 'input' : 'change', () => {
      productPage = 1;
      state.inventoryFilters = Object.fromEntries([...page.querySelectorAll('.inventory-catalog-panel .inventory-controls select, .inventory-catalog-panel .inventory-controls input')].map((field) => [field.id, field.value]));
      applyProductFilters();
    });
  });
  [[previousPage, -1], [nextPage, 1]].forEach(([button, direction]) => {
    button.addEventListener('click', () => {
      productPage += direction;
      applyProductFilters();
      pagination.closest('.inventory-catalog-panel').scrollIntoView({ block: 'start' });
    });
  });
  for (const [id, value] of Object.entries(state.inventoryFilters || {})) {
    const field = page.querySelector('#' + id);
    if (field && (field.tagName !== 'SELECT' || [...field.options].some((option) => option.value === value))) field.value = value;
  }
  page.querySelector('#inventory-branch-picker')?.addEventListener('change', (event) => {
    const selector = document.querySelector('#branch-select');
    selector.value = event.target.value;
    selector.dispatchEvent(new Event('change'));
  });
  applyProductFilters();
  page.querySelector('#inventory-rows').addEventListener('click', (event) => {
    const detailButton = event.target.closest('[data-view-product]');
    if (detailButton) {
      const id = detailButton.dataset.viewProduct;
      return productDetailModal(products.find((item) => item.id === id), totals.get(id) || 0, stockByProduct.get(id) || []);
    }
    const editButton = event.target.closest('[data-edit-product]');
    if (editButton) return productModal(products.find((item) => item.id === editButton.dataset.editProduct), totals.get(editButton.dataset.editProduct) || 0);
    const deleteButton = event.target.closest('[data-delete-product]');
    if (deleteButton && canManage()) {
      const product = products.find((item) => item.id === deleteButton.dataset.deleteProduct);
      if (!product) return;
      const organizationId = state.organization.id;
      const host = openModal('Hapus produk?', 'Produk akan dihapus dari katalog toko di semua cabang.', `<div class="notice"><strong>${esc(product.name)}</strong><br />Produk hanya bisa dihapus jika belum terhubung dengan stok atau riwayat transaksi.</div>
        <details class="product-form-photos">
          <summary>Cara menghapus data uji coba</summary>
          <p>Jika unit tes berasal dari stok awal dan batch masih utuh, buka <strong>Riwayat stok awal</strong> di cabang tempat batch dicatat. Pilih batch produk ini, klik <strong>Batalkan stok awal</strong>, lalu coba hapus produk lagi.</p>
          <p>Jika unit pernah dijual, dimutasi, atau dipakai, riwayatnya perlu diperiksa sebelum data tes bisa dibersihkan. Untuk menyembunyikan produk dari katalog publik, buka <strong>Edit produk</strong> lalu matikan <strong>Tampilkan di katalog publik</strong>.</p>
          <button type="button" class="btn" data-view-opening-history>Lihat riwayat stok awal</button>
          <button type="button" class="btn" data-edit-from-delete>Edit produk</button>
        </details>`, async () => {
        if (!canManage() || state.organization?.id !== organizationId) throw new Error('Hanya pemilik toko yang dapat menghapus produk.');
        const { data, error } = await supabase.from('products').delete()
          .eq('id', product.id).eq('organization_id', organizationId).select('id');
        if (error?.code === '23503') {
          host.querySelector('details').open = true;
          throw new Error('Produk masih terhubung dengan stok atau transaksi. Ikuti langkah di atas untuk meninjau data uji coba.');
        }
        if (error) throw error;
        if (!data?.length) throw new Error('Produk tidak ditemukan atau akses hapus ditolak.');
        toast('Produk berhasil dihapus.');
        if (state.page === 'inventory') await showPage('inventory');
      }, 'Hapus produk');
      host.querySelector('[data-view-opening-history]').addEventListener('click', () => {
        host.querySelector('[data-close-modal]').click();
        page.querySelector('#opening-stock-history')?.scrollIntoView({ block: 'center' });
      });
      host.querySelector('[data-edit-from-delete]').addEventListener('click', () => productModal(product, totals.get(product.id) || 0));
      return;
    }
    const photoButton = event.target.closest('[data-product-photo]');
    if (photoButton) productPhotoModal(products.find((item) => item.id === photoButton.dataset.productPhoto));
  });
  page.querySelector('#open-warranty-qr')?.addEventListener('click', () => showPage('warranty'));
  page.querySelectorAll('[data-print-barcode]').forEach((button) => button.addEventListener('click', () => {
    const printWindow = window.open('', '_blank', 'width=980,height=820');
    if (!printWindow) return toast('Izinkan pop-up untuk membuka pratinjau barcode.', true);
    printBarcode(button.dataset.printBarcode, printWindow);
  }));
  const openingHistory = page.querySelector('#opening-stock-history');
  if (openingHistory) bindOpeningHistory(openingHistory, openingBatches, branchId);
  page.querySelectorAll('[data-correct-opening]').forEach((button) => button.addEventListener('click', async () => {
    const batch = openingBatches.find((item) => item.id === button.dataset.correctOpening);
    const product = products.find((item) => item.id === batch?.product_id);
    if (!product || !canEditProducts()) return;
    try {
      const items = checkError(await supabase.from('stock_items')
        .select('serial_number,quantity,status,branch_id').eq('opening_batch_id', batch.id).order('created_at').order('id'));
      if (items.some((item) => item.status !== 'available' || item.branch_id !== batch.branch_id)
        || items.reduce((total, item) => total + Number(item.quantity), 0) !== Number(batch.unit_count)) {
        throw new Error('Koreksi hanya tersedia untuk batch stok awal yang masih utuh dan belum dipakai.');
      }
      if (page.isConnected && state.branchId === batch.branch_id) openingStockModal([product], { ...batch, items });
    } catch (error) { toast(error.message || 'Data stok awal gagal dimuat.', true); }
  }));
  page.querySelectorAll('[data-cancel-opening]').forEach((button) => button.addEventListener('click', () => {
    if (!canManage()) return;
    const batch = openingBatches.find((item) => item.id === button.dataset.cancelOpening);
    if (!batch) return;
    openModal('Batalkan stok awal?', 'Unit dan barcode dari batch salah input ini akan dihapus.', `<div class="notice"><strong>${esc(batch.products?.name || 'Produk')}</strong> · ${Number(batch.unit_count)} unit · ${esc(branchName(state.branchId))}<br />Batch harus masih utuh dan belum pernah dipakai.</div>`, async () => {
      checkError(await supabase.rpc('cancel_unused_opening_stock', { _batch_id: batch.id }));
      toast('Stok awal berhasil dibatalkan.');
      if (state.page === 'inventory') await showPage('inventory');
    }, 'Batalkan stok awal');
  }));
  page.querySelectorAll('[data-print-opening]').forEach((button) => button.addEventListener('click', async () => {
    const printWindow = window.open('', '_blank', 'width=980,height=820');
    if (!printWindow) return toast('Izinkan pop-up untuk membuka pratinjau barcode.', true);
    try {
      const { data, error } = await supabase.from('stock_items').select('barcode,supplier,quantity,serial_number,products(name,sku,category)').eq('opening_batch_id', button.dataset.printOpening).order('created_at');
      if (error) throw error;
      if (!data?.length) throw new Error('Unit untuk batch stok awal ini tidak ditemukan.');
      printBarcodeLabels(data.map((item) => ({ ...item, supplier: item.supplier || 'Stok awal' })), printWindow);
    } catch (error) { printWindow.close(); toast(error.message || 'Label stok awal gagal dimuat.', true); }
  }));
  page.querySelectorAll('[data-print-warranty-unit]').forEach((button) => button.addEventListener('click', () => { const unit=stock.find((item) => item.id===button.dataset.printWarrantyUnit); if (unit) printWarrantyQr({...unit,products:products.find((product) => product.id===unit.product_id)}); }));
}

function bindOpeningHistory(panel, batches, branchId) {
  const brand = panel.querySelector('#opening-brand');
  const model = panel.querySelector('#opening-model');
  const bulk = panel.querySelector('#cancel-opening-group');
  const more = panel.querySelector('[data-opening-more]');
  const rows = [...panel.querySelectorAll('[data-opening-row]')];
  const key = (value) => (value || '').trim().toLowerCase();
  const options = (select, choices, placeholder) => {
    const labels = new Map(choices.filter(key).map((value) => [key(value), value.trim()]));
    select.replaceChildren(new Option(placeholder, ''), ...[...labels]
      .sort((a, b) => a[1].localeCompare(b[1], 'id')).map(([value, label]) => new Option(label, value)));
  };
  const laptops = batches.filter((batch) => key(batch.products?.category) === 'laptop');
  options(brand, laptops.map((batch) => batch.products.brand), 'Semua merek');
  const brandMatches = () => laptops.filter((batch) => !brand.value || key(batch.products.brand) === brand.value);
  const matching = () => (!brand.value && !model.value ? batches : brandMatches()
    .filter((batch) => !model.value || key(batch.products.model) === model.value));
  let limit = 20;
  const render = () => {
    const matches = matching();
    const visible = new Set(matches.slice(0, limit).map((batch) => batch.id));
    rows.forEach((row) => { row.hidden = !visible.has(row.dataset.openingRow); });
    panel.querySelector('[data-opening-empty]').hidden = matches.length > 0;
    panel.querySelector('[data-opening-count]').textContent = `${visible.size} dari ${matches.length} batch`;
    more.hidden = visible.size === matches.length;
    bulk.hidden = !(brand.value && model.value && matches.length);
  };
  const updateModels = () => {
    options(model, brandMatches().map((batch) => batch.products.model), 'Semua tipe');
    limit = 20;
    render();
  };
  brand.addEventListener('change', updateModels);
  model.addEventListener('change', () => { limit = 20; render(); });
  more.addEventListener('click', () => { limit += 20; render(); });
  bulk.addEventListener('click', () => {
    if (!canEditProducts() || state.branchId !== branchId || !brand.value || !model.value) return;
    const matches = matching();
    const units = matches.reduce((sum, batch) => sum + Number(batch.unit_count), 0);
    const brandKey = brand.value;
    const modelKey = model.value;
    const label = `${brand.selectedOptions[0].text} ${model.selectedOptions[0].text}`;
    openModal('Batalkan stok awal tipe ini?', 'Unit dan barcode dari batch yang masih utuh akan dihapus.',
      `<div class="notice"><strong>${esc(label)}</strong><br />${esc(branchName(branchId))} · ${matches.length} batch · ${units} unit.
      Batch yang sudah dijual, dimutasi, atau dipakai akan dilewati.</div>`, async () => {
        const result = checkError(await supabase.rpc('bulk_cancel_opening_stock', {
          _branch_id: branchId, _brand: brandKey, _model: modelKey, _batch_ids: matches.map((batch) => batch.id),
        }));
        toast(`${result.cancelled_batches} batch (${result.cancelled_units} unit) dibatalkan. ${result.skipped_batches} batch dilewati.`);
        if (state.page === 'inventory') await showPage('inventory');
      }, 'Batalkan batch yang masih utuh');
  });
  updateModels();
}

async function transfersPage(page) {
  const { data: transfers, error } = await supabase.from('stock_transfers').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  const rows = transfers || [];
  const items = rows.length
    ? await fetchAllRows(supabase.from('stock_transfer_items').select('id,transfer_id,product_id,source_stock_item_id,received_stock_item_id,source_barcode,target_barcode,quantity,unit_cost,split_lot,products(name,sku,category)').in('transfer_id', rows.map((row) => row.id)).order('created_at'))
    : [];
  const itemsByTransfer = new Map();
  items.forEach((item) => itemsByTransfer.set(item.transfer_id, [...(itemsByTransfer.get(item.transfer_id) || []), item]));
  const inTransit = rows.filter((row) => row.status === 'in_transit').length;
  page.innerHTML = `${header('Mutasi stok antar cabang', 'Cabang tujuan mengonfirmasi barang yang dikirim dari Pusat.', canManage() || isCentralAdmin() ? '<button class="btn primary" id="new-stock-transfer">+ Kirim ke cabang</button>' : '')}
    <div class="cards"><article class="card"><div class="card-label">Menunggu diterima</div><div class="card-value">${inTransit}</div><div class="card-sub">Barang sedang dalam perjalanan</div></article><article class="card"><div class="card-label">Riwayat mutasi</div><div class="card-value">${rows.length}</div><div class="card-sub">Maksimal 200 catatan terbaru</div></article><article class="card"><div class="card-label">Aturan stok</div><div class="card-value" style="font-size:18px">Kirim → Terima</div><div class="card-sub">Stok tujuan bertambah setelah dikonfirmasi</div></article></div>
    <section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Riwayat mutasi barang</div><div class="panel-sub">Laptop mempertahankan barcode. Mutasi sebagian lot sparepart membuat barcode lot baru di cabang tujuan.</div></div></div><div class="table-wrap"><table><thead><tr><th>NO. / WAKTU</th><th>ASAL → TUJUAN</th><th>BARANG</th><th>STATUS</th><th>CATATAN</th><th>AKSI</th></tr></thead><tbody>${rows.map((transfer) => {
      const transferItems = itemsByTransfer.get(transfer.id) || [];
      const canReceive = transfer.status === 'in_transit' && (canManage() || state.profile.branch_id === transfer.destination_branch_id);
      const status = transfer.status === 'received' ? 'Diterima' : 'Dalam perjalanan';
      return `<tr><td class="product-name">${esc(transfer.transfer_number)}<div class="field-hint">${new Date(transfer.created_at).toLocaleString('id-ID')}</div></td><td>${esc(branchName(transfer.source_branch_id))}<div class="field-hint">→ ${esc(branchName(transfer.destination_branch_id))}</div></td><td>${transferItems.map((item) => `<div class="transfer-item-line"><b>${esc(item.products?.name || 'Barang')}</b> · ${Number(item.quantity)} unit<div class="field-hint">${esc(item.source_barcode)}${item.target_barcode && item.target_barcode !== item.source_barcode ? ` → ${esc(item.target_barcode)}` : ''}</div></div>`).join('') || '—'}</td><td><span class="pill ${transfer.status === 'received' ? '' : 'warn'}">${status}</span></td><td>${esc(transfer.note || '—')}</td><td>${canReceive ? `<button class="small-btn" data-receive-transfer="${transfer.id}">Serah terima barang</button>` : transfer.status === 'in_transit' ? '<span class="field-hint">Menunggu cabang tujuan</span>' : `<span class="field-hint">${transfer.received_at ? new Date(transfer.received_at).toLocaleString('id-ID') : ''}</span>`}</td></tr>`;
    }).join('') || '<tr><td colspan="6"><div class="empty"><b>Belum ada mutasi stok</b>Buat mutasi untuk memindahkan barang antar cabang.</div></td></tr>'}</tbody></table></div></section>`;
  page.querySelector('#new-stock-transfer')?.addEventListener('click', transferModal);
  page.querySelectorAll('[data-receive-transfer]').forEach((button) => button.addEventListener('click', () => {
    const transfer = rows.find((row) => row.id === button.dataset.receiveTransfer);
    receiveStockTransferModal(transfer, itemsByTransfer.get(transfer?.id) || []);
  }));
}

async function transferModal() {
  const owner = canManage();
  const sourceId = centralBranch()?.id;
  if ((!owner && !isCentralAdmin()) || !sourceId) return toast('Asal mutasi harus Cabang Pusat.', true);
  const sourceField = owner
    ? `<div class="field"><label>Cabang asal</label><select name="source_branch_id" id="transfer-source" required>${state.branches.filter((branch) => branch.is_central).map((branch) => `<option value="${branch.id}" ${branch.id === sourceId ? 'selected' : ''}>${esc(branch.name)}</option>`).join('')}</select></div>`
    : `<input type="hidden" name="source_branch_id" value="${sourceId}" /><div class="field"><label>Cabang asal</label><input value="${esc(branchName(sourceId))}" readonly /></div>`;
  const host = openModal('Kirim mutasi stok', 'Stok keluar dari cabang asal saat mutasi dikirim. Cabang tujuan perlu menghitung dan mengonfirmasi barang saat tiba.', `<div class="form-grid">${sourceField}<div class="field"><label>Cabang tujuan</label><select name="destination_branch_id" id="transfer-destination" required></select></div><div class="field full"><label>Catatan (opsional)</label><input name="note" maxlength="1000" placeholder="Contoh: pengiriman unit ke cabang Malang" /></div><div class="field full"><label for="transfer-barcode">Scan barcode stok</label><div class="transfer-scan-controls"><input id="transfer-barcode" type="text" autocomplete="off" spellcheck="false" placeholder="Scan barcode, atau ketik lalu tekan Enter" /><button class="btn" type="button" id="transfer-scan-add">Tambah barcode</button><button class="btn" type="button" id="transfer-camera">Kamera</button></div><div id="transfer-camera-preview"></div><small class="field-hint" id="transfer-scan-status" role="status">Gunakan barcode internal pada label stok.</small></div><div class="field full"><label>Daftar barang</label><div class="transfer-lines" id="transfer-lines"></div><button class="btn" type="button" id="add-transfer-line">＋ Tambah barang</button><small class="field-hint">Laptop dipindah per unit/barcode. Sparepart dapat dipindah sebagian dari satu lot.</small></div></div>`, async (form) => {
    const sourceBranchId = String(form.get('source_branch_id') || sourceId);
    const destinationBranchId = String(form.get('destination_branch_id') || '');
    if (!destinationBranchId || destinationBranchId === sourceBranchId) throw new Error('Cabang asal dan tujuan harus berbeda.');
    const stockIds = form.getAll('stock_item_id').map(String);
    const quantities = form.getAll('quantity').map(Number);
    const transferItems = stockIds.map((stock_item_id, index) => ({ stock_item_id, quantity: quantities[index] })).filter((item) => item.stock_item_id);
    if (!transferItems.length) throw new Error('Pilih setidaknya satu barang untuk dimutasi.');
    if (new Set(transferItems.map((item) => item.stock_item_id)).size !== transferItems.length) throw new Error('Barang yang sama hanya boleh muncul satu kali dalam satu mutasi.');
    if (transferItems.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) throw new Error('Jumlah mutasi harus berupa bilangan bulat minimal satu.');
    const result = checkError(await supabase.rpc('create_stock_transfer', {
      _source_branch_id: sourceBranchId,
      _destination_branch_id: destinationBranchId,
      _items: transferItems,
      _note: String(form.get('note') || '').trim(),
    }));
    toast(`Mutasi ${result.transfer_number} dikirim. Stok tujuan bertambah setelah diterima.`);
    await showPage('transfers');
  }, 'Kirim mutasi');

  const form = host.querySelector('#active-modal');
  const destinationSelect = form.querySelector('#transfer-destination');
  const linesHost = form.querySelector('#transfer-lines');
  const barcodeInput = form.querySelector('#transfer-barcode');
  const scanStatus = form.querySelector('#transfer-scan-status');
  const cameraPreview = form.querySelector('#transfer-camera-preview');
  const cameraButton = form.querySelector('#transfer-camera');
  let stockRows = [];
  let stockLoading = true;
  let lineValues = [{ stock_item_id: '', quantity: 1 }];
  const getSource = () => String(form.elements.namedItem('source_branch_id').value);
  const refreshDestinations = () => {
    const previous = destinationSelect.value;
    const options = state.branches.filter((branch) => branch.id !== getSource());
    destinationSelect.innerHTML = options.map((branch) => `<option value="${branch.id}" ${branch.id === previous ? 'selected' : ''}>${esc(branch.name)}</option>`).join('');
    if (!options.some((branch) => branch.id === previous)) destinationSelect.value = options[0]?.id || '';
  };
  const loadStock = async () => {
    stockLoading = true;
    try {
      stockRows = await fetchAllRows(supabase.from('stock_items').select('id,barcode,quantity,products(name,category)')
        .eq('branch_id', getSource()).eq('status', 'available').gt('quantity', 0).order('created_at', { ascending: false }));
    } finally {
      stockLoading = false;
    }
  };
  const renderLines = () => {
    linesHost.innerHTML = lineValues.map((line, index) => {
      const options = stockRows.map((item) => `<option value="${item.id}" data-quantity="${Number(item.quantity)}" data-category="${esc(item.products?.category || '')}" ${item.id === line.stock_item_id ? 'selected' : ''}>${esc(item.products?.name || 'Barang')} · ${esc(item.barcode)} · stok ${Number(item.quantity)}</option>`).join('');
      return `<div class="transfer-line-row"><select name="stock_item_id" data-transfer-index="${index}" aria-label="Pilih barang" required><option value="">${stockRows.length ? 'Pilih barang / barcode' : 'Tidak ada stok siap dimutasi'}</option>${options}</select><input name="quantity" data-quantity-index="${index}" aria-label="Jumlah mutasi" type="number" min="1" value="${Number(line.quantity) || 1}" required /><button class="small-btn" type="button" data-remove-transfer-line="${index}">Hapus</button></div>`;
    }).join('');
    linesHost.querySelectorAll('[data-transfer-index]').forEach((select) => select.addEventListener('change', () => {
      const index = Number(select.dataset.transferIndex), selected = select.selectedOptions[0];
      lineValues[index].stock_item_id = select.value;
      const input = linesHost.querySelector(`[data-quantity-index="${index}"]`);
      const laptop = selected?.dataset.category?.toLowerCase() === 'laptop';
      input.max = laptop ? '1' : selected?.dataset.quantity || '';
      input.value = laptop ? '1' : String(Math.min(Number(input.value) || 1, Number(input.max) || 1));
      lineValues[index].quantity = Number(input.value);
    }));
    linesHost.querySelectorAll('[data-quantity-index]').forEach((input) => input.addEventListener('input', () => { lineValues[Number(input.dataset.quantityIndex)].quantity = Number(input.value); }));
    linesHost.querySelectorAll('[data-remove-transfer-line]').forEach((button) => button.addEventListener('click', () => { lineValues.splice(Number(button.dataset.removeTransferLine), 1); renderLines(); }));
  };
  const addScannedUnit = () => {
    if (form.querySelector('[type="submit"]').disabled) return;
    const code = barcodeInput.value.trim().toUpperCase();
    if (!code) return;
    const item = stockRows.find(row => row.barcode.toUpperCase() === code);
    if (stockLoading) scanStatus.textContent = 'Daftar stok sedang dimuat. Coba lagi sebentar.';
    else if (!item) scanStatus.textContent = 'Barcode tidak ditemukan di stok Pusat yang siap dikirim.';
    else if (lineValues.some(line => line.stock_item_id === item.id)) scanStatus.textContent = 'Barcode ini sudah masuk daftar kirim.';
    else if (lineValues.filter(line => line.stock_item_id).length >= 100) scanStatus.textContent = 'Satu mutasi maksimal 100 baris barang.';
    else {
      const empty = lineValues.find(line => !line.stock_item_id);
      const picked = { stock_item_id: item.id, quantity: 1 };
      if (empty) Object.assign(empty, picked);
      else lineValues.push(picked);
      renderLines();
      barcodeInput.value = '';
      scanStatus.textContent = `${item.products?.name || 'Barang'} · ${item.barcode} ditambahkan.`;
    }
    barcodeInput.focus();
    barcodeInput.select();
  };
  barcodeInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    addScannedUnit();
  });
  form.querySelector('#transfer-scan-add').addEventListener('click', addScannedUnit);
  cameraButton.addEventListener('click', async () => {
    if (cameraPreview.querySelector('video')) return;
    cameraButton.disabled = true;
    await startScanner(cameraPreview, barcodeInput, ['code_128'], addScannedUnit);
    cameraButton.disabled = false;
  });
  form.querySelector('#add-transfer-line').addEventListener('click', () => { lineValues.push({ stock_item_id: '', quantity: 1 }); renderLines(); });
  form.elements.namedItem('source_branch_id').addEventListener('change', async () => {
    refreshDestinations();
    try { await loadStock(); lineValues = [{ stock_item_id: '', quantity: 1 }]; renderLines(); }
    catch (error) { toast(error.message, true); }
  });
  refreshDestinations();
  try { await loadStock(); renderLines(); if (form.isConnected) barcodeInput.focus(); }
  catch (error) { host.innerHTML = ''; toast(error.message, true); }
}

function receiveStockTransferModal(transfer, items) {
  if (!transfer) return;
  const detail = items.map((item) => `<div class="notice">${esc(item.products?.name || 'Barang')} · ${Number(item.quantity)} unit<br/>Barcode asal: ${esc(item.source_barcode)}${item.split_lot ? ' · lot sebagian, barcode baru dibuat saat diterima' : ''}</div>`).join('');
  openModal(`Serah terima mutasi ${esc(transfer.transfer_number)}`, `${branchName(transfer.source_branch_id)} → ${branchName(transfer.destination_branch_id)}. Hitung barang dan cocokkan barcode fisik sebelum konfirmasi.`, `${detail}<div class="field"><label><input type="checkbox" name="confirm_received" required /> Jumlah dan barang fisik sudah saya periksa.</label></div>`, async () => {
    const result = checkError(await supabase.rpc('receive_stock_transfer', { _transfer_id: transfer.id }));
    const newLotBarcodes = (result.items || []).filter((item) => item.source_barcode !== item.target_barcode).map((item) => item.target_barcode);
    toast(newLotBarcodes.length ? `Mutasi diterima. Barcode lot baru: ${newLotBarcodes.join(', ')}. Stok tersedia di cabang ini.` : 'Mutasi diterima. Stok sekarang tersedia di cabang ini.');
    await showPage('transfers');
  }, 'Konfirmasi serah terima');
}

function openingStockModal(products, batch = null) {
  if (!canEditProducts()) return toast('Akses pencatatan stok awal ditolak.', true);
  const productOptions = products.map((product) => `<option value="${product.id}" data-category="${esc(product.category)}" data-cost="${Number(product.cost_price || 0)}">${esc(product.name)} · ${esc(product.sku)} · ${esc(product.category)}</option>`).join('');
  const host = openModal(batch ? 'Koreksi stok awal' : 'Catat stok awal', batch ? 'Barcode batch lama akan diganti. Cetak ulang label setelah menyimpan.' : 'Catat barang lama yang sudah siap jual. Jika produknya belum ada, buat dari form ini dan otomatis masuk ke katalog produk.', `<div class="form-grid">${batch ? `<div class="field"><label>Cabang</label><input value="${esc(branchName(batch.branch_id))}" readonly /></div>` : branchField('branch_id', centralBranch()?.id, true)}<div class="field"><label>Produk</label><select name="product_id" required>${productOptions}${batch ? '' : `<option value="__new__" ${products.length ? '' : 'selected'}>＋ Produk belum ada · buat produk baru</option>`}</select></div><div class="opening-new-product-fields form-grid full" hidden><div class="field"><label>Merek</label><input name="new_brand" placeholder="Dell, Lenovo, HP..." /></div><div class="field"><label>Tipe</label><input name="new_model" /></div><div class="field"><label>Kategori</label><select name="new_category"><option>Laptop</option><option>Sparepart</option><option>Aksesori</option><option>Lainnya</option></select></div><div class="field"><label>Garansi produk (bulan)</label><input name="new_warranty" type="number" min="0" value="1" /></div><div class="field"><label>Harga end user</label><input name="new_retail" ${isCentralAdmin() ? 'readonly' : ''} type="number" min="0" value="0" /></div><div class="field"><label>Harga reseller</label><input name="new_reseller" ${isCentralAdmin() ? 'readonly' : ''} type="number" min="0" value="0" /></div>${productPromoField()}${productCopyFields()}</div><div class="opening-product-photo form-grid full" hidden>${productPhotoPicker('')}${galleryFields()}</div><div class="field"><label>Jumlah stok awal</label><input name="quantity" type="number" min="1" max="500" value="${Number(batch?.unit_count ?? 1)}" required /><small class="field-hint">Laptop mendapat barcode unik per unit. Sparepart dicatat sebagai satu lot.</small></div><div class="field"><label>Modal per unit</label><input name="unit_cost" type="number" min="0" step="0.01" value="${Number(batch?.unit_cost ?? products[0]?.cost_price ?? 0)}" required /><small class="field-hint">Isi 0 jika nilai modal lama tidak diketahui.</small></div><div class="field full opening-serial-field"><label>Nomor seri laptop (opsional, satu per baris)</label><textarea name="serial_numbers" rows="4" placeholder="SN pertama&#10;SN kedua&#10;SN ketiga">${esc(batch?.items.map((item) => item.serial_number).filter(Boolean).join('\n') || '')}</textarea><small class="field-hint">Jika diisi, jumlah nomor seri harus sama dengan jumlah unit.</small></div><div class="field full"><label>Catatan pembukaan stok (opsional)</label><textarea name="notes" rows="2" maxlength="1000" placeholder="Contoh: stok display awal CABANG A">${esc(batch?.notes || '')}</textarea></div></div><div class="notice" style="margin-top:12px">Stok awal langsung berstatus siap dijual. Pakai fitur ini hanya untuk unit yang sudah lolos pemeriksaan. Laptop baru datang dan belum QC harus dicatat lewat Penerimaan & barcode.</div>`, async (form) => {
    const isNewProduct = form.get('product_id') === '__new__';
    let product = products.find((item) => item.id === String(form.get('product_id')));
    const category = String(isNewProduct ? form.get('new_category') : product?.category || '').toLowerCase();
    const quantity = Number(form.get('quantity'));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw new Error('Jumlah stok awal harus 1 sampai 500.');
    const serials = String(form.get('serial_numbers') || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (category === 'laptop' && serials.length && serials.length !== quantity) throw new Error(`Masukkan ${quantity} nomor seri atau kosongkan semuanya.`);
    if (category !== 'laptop' && serials.length) throw new Error('Nomor seri per unit hanya tersedia untuk laptop.');
    if (new Set(serials.map((value) => value.toLowerCase())).size !== serials.length) throw new Error('Ada nomor seri yang tercatat lebih dari sekali.');
    if (isNewProduct) {
      const { name, sku, brand, model } = productIdentity(form, null, 'new_');
      const photo = selectedProductPhoto(form);
      if (!photo) throw new Error('Foto wajib dipilih untuk produk baru.');
      const retailPrice = Number(form.get('new_retail') || 0);
      const promo = productPromoValues(form, null, retailPrice);
      const imagePath = await uploadProductPhoto(photo, crypto.randomUUID());
      const values = { id: crypto.randomUUID(), organization_id: state.organization.id, name, sku, brand, model, category: String(form.get('new_category')), cost_price: Number(form.get('unit_cost') || 0), retail_price: retailPrice, ...promo, reseller_price: Number(form.get('new_reseller') || 0), warranty_months: Number(form.get('new_warranty') || 0), image_path: imagePath, ...productCopyValues(form), gallery_paths: await readGallery(form) };
      if ([values.cost_price, values.retail_price, values.reseller_price, values.warranty_months].some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Harga dan masa garansi harus berupa angka nol atau lebih.');
      const { data, error } = await supabase.from('products').insert(values).select('*').single();
      if (error) throw error;
      product = data;
      products.push(product);
      const option = document.createElement('option');
      option.value = product.id;
      option.dataset.category = product.category;
      option.dataset.cost = String(product.cost_price || 0);
      option.textContent = `${product.name} · ${product.sku} · ${product.category}`;
      const productSelect = host.querySelector('#active-modal [name="product_id"]');
      if (productSelect) {
        productSelect.add(option);
        productSelect.value = product.id;
        productSelect.dispatchEvent(new Event('change'));
      }
    }
    if (!product) throw new Error('Pilih produk yang valid.');
    const printWindow = window.open('', '_blank', 'width=980,height=820');
    const stockTarget = batch ? { _batch_id: batch.id } : { _branch_id: String(form.get('branch_id')), _product_id: product.id };
    const { data, error } = await supabase.rpc(batch ? 'correct_unused_opening_stock' : 'record_opening_stock', {
      ...stockTarget,
      _quantity: quantity,
      _unit_cost: Number(form.get('unit_cost')),
      _unit_details: serials.length ? serials.map((serial_number) => ({ serial_number })) : [],
      _notes: String(form.get('notes') || '').trim(),
    });
    if (error) { printWindow?.close(); throw new Error(isNewProduct ? `Produk berhasil ditambahkan ke katalog, tetapi pencatatan stok awal gagal: ${error.message}` : error.message); }
    const labels = (data?.items || []).map((item) => ({ ...item, supplier: 'Stok awal', products: product }));
    if (printWindow) printBarcodeLabels(labels, printWindow);
    if (batch) toast('Koreksi stok awal tersimpan. Gunakan barcode baru untuk batch ini.');
    else toast(product.category.toLowerCase() === 'laptop'
      ? `${labels.length} unit stok awal tercatat siap jual${printWindow ? ' · pratinjau barcode dibuka' : ' · izinkan pop-up untuk cetak barcode'}.`
      : `${quantity} unit stok awal tercatat siap dijual${printWindow ? ' · pratinjau barcode lot dibuka' : ' · barcode bisa dicetak dari tabel stok'}.`);
    if (isNewProduct) toast('Produk baru otomatis tersimpan di katalog Produk & stok.');
    await showPage('inventory');
  }, 'Simpan stok awal & cetak barcode');
  const form = host.querySelector('#active-modal');
  const syncNewProduct = () => {
    const isNew = form.product_id.value === '__new__';
    form.querySelector('.opening-new-product-fields').hidden = !isNew;
    form.querySelector('.opening-product-photo').hidden = !isNew;
    if (!isNew && !batch) form.unit_cost.value = form.product_id.selectedOptions[0]?.dataset.cost || 0;
  };
  const syncProduct = () => {
    const isNew = form.product_id.value === '__new__';
    const selected = form.querySelector('[name="product_id"] option:checked');
    const category = isNew ? form.new_category.value : selected?.dataset.category;
    form.querySelector('.opening-serial-field').hidden = category?.toLowerCase() !== 'laptop';
    syncNewProduct();
  };
  form.product_id.addEventListener('change', syncProduct);
  form.new_category.addEventListener('change', syncProduct);
  bindProductPhotoPicker(form);
  syncProduct();
}

function productDetailModal(product, available = 0, stock = []) {
  if (!product) return;
  const host=document.querySelector('#modal-root');
  host.innerHTML=`<div class="modal-backdrop"><section class="modal product-detail-modal"><div class="modal-head"><div><h2>${esc(product.name)}</h2><p>Detail produk dan harga saat ini</p></div><button class="modal-close" type="button" data-detail-close aria-label="Tutup">×</button></div><div class="product-detail-content"><div class="product-detail-photo">${product.image_path?`<img src="${esc(productImageUrl(product.image_path))}" alt="${esc(product.name)}" />`:'Foto belum tersedia'}</div><dl><dt>SKU</dt><dd>${esc(product.sku)}</dd><dt>Merek / model</dt><dd>${esc([product.brand,product.model].filter(Boolean).join(' · ')||'—')}</dd><dt>Kategori</dt><dd>${esc(product.category)}</dd><dt>Stok tersedia di cabang</dt><dd>${Number(available).toLocaleString('id-ID')} unit</dd><dt>Harga modal / unit</dt><dd>${money(product.cost_price)}</dd><dt>Harga end user</dt><dd>${money(product.retail_price)}</dd><dt>Harga reseller</dt><dd>${money(product.reseller_price)}</dd><dt>Garansi produk</dt><dd>${Number(product.warranty_months||0)} bulan</dd></dl></div><div class="modal-actions">${canManage()?'<button class="btn primary" type="button" data-detail-edit>Edit detail</button>':''}</div></section></div>`;
  host.querySelectorAll('[data-detail-close]').forEach(button=>button.addEventListener('click',()=>{host.innerHTML=''}));
  host.querySelector('[data-detail-edit]')?.addEventListener('click',()=>{host.innerHTML='';productModal(product, available)});
  const branchId = state.branchId;
  const units = product.category === 'Laptop'
    ? stock.filter((unit) => unit.branch_id === branchId && unit.status === 'available' && unit.quantity > 0 && unit.barcode)
    : [];
  const photos = (product.gallery_paths || []).filter(Boolean);
  const specs = pamphletSpecs.filter(([key]) => product.specifications?.[key]);
  const actions = host.querySelector('.modal-actions');
  actions.insertAdjacentHTML('beforebegin', `
    ${photos.length ? `<div class="product-gallery">${photos.map((photo, i) => `<a href="${esc(productImageUrl(photo))}" target="_blank" rel="noopener noreferrer"><img class="product-gallery-thumb" src="${esc(productImageUrl(photo))}" alt="Foto produk ${i + 2}" /></a>`).join('')}</div>` : ''}
    <section class="product-extra-details"><h3>Deskripsi produk</h3><p>${esc(product.description || 'Deskripsi belum diisi.')}</p>
      ${specs.length ? `<dl>${specs.map(([key, label]) => `<div><dt>${esc(label)}</dt><dd>${esc(product.specifications[key])}</dd></div>`).join('')}</dl>` : ''}
    </section>
    ${product.category === 'Laptop' ? `<section class="product-extra-details"><h3>Pamflet Katalog Modern</h3>
      ${units.length ? `<div class="field"><label for="pamphlet-unit">Kode unit siap jual · ${esc(branchName(branchId))}</label>
        <select id="pamphlet-unit">${units.map(unit => `<option value="${esc(unit.id)}">${esc(unit.barcode)}${unit.serial_number ? ` · SN ${esc(unit.serial_number)}` : ''}</option>`).join('')}</select></div>
        <div class="pamphlet-actions"><button type="button" class="btn" data-pamphlet="preview">Pratinjau</button>
        <button type="button" class="btn" data-pamphlet="print">Cetak pamflet</button>
        <button type="button" class="btn primary" data-pamphlet="download">Unduh PDF</button></div>
        <img class="pamphlet-preview" alt="Pratinjau pamflet produk" hidden />` : '<p>Belum ada unit siap jual di cabang ini.</p>'}
    </section>` : ''}`);
  const picker = host.querySelector('#pamphlet-unit');
  const preview = host.querySelector('.pamphlet-preview');
  picker?.addEventListener('change', () => { preview.hidden = true; });
  const pamphletButtons = [...host.querySelectorAll('[data-pamphlet]')];
  pamphletButtons.forEach((button) => button.addEventListener('click', async () => {
    const action = button.dataset.pamphlet;
    const unitId = picker.value;
    const printable = action === 'print' ? window.open('', '_blank', 'width=850,height=650') : null;
    if (action === 'print' && !printable) return toast('Izinkan pop-up untuk membuka pamflet.', true);
    pamphletButtons.forEach(control => { control.disabled = true; });
    picker.disabled = true;
    try {
      const unit = checkError(await supabase.from('stock_items')
        .select('barcode,products!inner(name,retail_price,specifications,warranty_months)')
        .eq('id', unitId).eq('product_id', product.id).eq('branch_id', branchId)
        .eq('status', 'available').gt('quantity', 0).maybeSingle());
      if (!unit?.barcode) throw new Error('Unit sudah tidak siap jual. Muat ulang daftar produk.');
      const current = unit.products;
      const image = await renderProductPamphlet({
        store: state.organization.name, name: current.name, price: money(current.retail_price),
        specifications: current.specifications, warranty: current.warranty_months, barcode: unit.barcode,
      });
      if (state.branchId !== branchId || !picker.isConnected) throw new Error('Detail produk sudah berubah. Buka kembali dari cabang yang dipilih.');
      if (action === 'download') {
        await downloadProductPamphlet(image, `Pamflet-${unit.barcode.replace(/[^\w-]/g, '-')}.pdf`);
      } else if (printable) {
        printable.document.write(`<!doctype html><html lang="id"><meta charset="utf-8"><title>Pamflet produk</title>
          <style>@page{size:A5 landscape;margin:0}body{margin:12px;font:14px Arial}img{display:block;width:min(100%,210mm);margin:10px auto}@media print{body{margin:0}button{display:none}img{width:210mm;margin:0}}</style>
          <button type="button" onclick="window.print()">Cetak pamflet</button><img src="${image}" alt="Pamflet produk"></html>`);
        printable.document.close();
      } else {
        preview.src = image;
        preview.hidden = false;
        preview.scrollIntoView({ block: 'nearest' });
      }
    } catch (error) {
      printable?.close();
      toast(error.message || 'Pamflet gagal dibuat.', true);
    } finally {
      picker.disabled = false;
      pamphletButtons.forEach(control => { control.disabled = false; });
    }
  }));
}

function productIdentity(form, product = null, prefix = '') {
  const brand = String(form.get(`${prefix}brand`) || '').trim();
  const model = String(form.get(`${prefix}model`) || '').trim();
  const renamed = !product || brand !== (product.brand || '').trim() || model !== (product.model || '').trim();
  const name = renamed ? [brand, model].filter(Boolean).join(' ') : product.name;
  if (!name) throw new Error('Isi Merek atau Tipe untuk membuat nama produk.');
  return { name, brand, model, sku: product?.sku || `DL-${crypto.randomUUID().slice(0, 8).toUpperCase()}` };
}

function productModal(product = null, available = 0) {
  const v=(key,fallback='')=>esc(product?.[key]??fallback);
  const host = openModal(product?'Edit produk':'Tambah produk', product?'Perbarui harga, spesifikasi, kategori, garansi, dan foto produk.':'Setiap produk dilengkapi foto dari file, galeri, atau kamera.', `${product ? `<div class="notice product-form-stock"><strong>${readyStockLabel()} di ${esc(branchName(state.branchId))}: ${Number(available).toLocaleString('id-ID')} unit</strong><button type="button" class="small-btn" data-add-opening-stock>＋ Catat stok awal</button></div>` : ''}<div class="form-grid"><div class="field"><label>Merek</label><input name="brand" value="${v('brand')}" /></div><div class="field"><label>Tipe</label><input name="model" value="${v('model')}" /></div><div class="field"><label>Kategori</label><select name="category" ${isCentralAdmin() && product ? 'disabled' : ''}>${['Laptop','Sparepart','Aksesori','Lainnya'].map(x=>`<option ${product?.category===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Garansi (bulan)</label><input name="warranty_months" type="number" min="0" value="${v('warranty_months',1)}" required /></div><div class="field"><label>Modal beli per unit</label><input name="cost_price" type="number" min="0" value="${v('cost_price',0)}" required /></div><div class="field"><label>Harga end user</label><input name="retail_price" ${isCentralAdmin() && !product ? 'readonly' : ''} type="number" min="0" value="${v('retail_price',0)}" required /></div><div class="field"><label>Harga reseller</label><input name="reseller_price" ${isCentralAdmin() && !product ? 'readonly' : ''} type="number" min="0" value="${v('reseller_price',0)}" required /></div><label class="product-public-toggle"><input type="checkbox" name="is_public" ${isCentralAdmin() ? 'disabled' : ''} ${product?.is_public ? 'checked' : ''} /> Tampilkan di katalog publik jika stok tersedia</label>${productPromoField(product)}${productCopyFields(product)}</div><details class="product-form-photos" ${product ? '' : 'open'}><summary>Foto produk</summary><div class="form-grid">${productPhotoPicker(product?.image_path||'')}${product ? '' : galleryFields()}</div></details>`, async (form) => {
    if (!canEditProducts()) throw new Error('Akses perubahan produk ditolak.');
    const { name, sku, brand, model } = productIdentity(form, product);
    const promo = productPromoValues(form, product, Number(form.get('retail_price')));
    const file=selectedProductPhoto(form);if(!product&&!file)throw new Error('Foto produk wajib dipilih.');
    const imagePath=file?await uploadProductPhoto(file,crypto.randomUUID()):product?.image_path||'';
    const values={name,sku,brand,model,category:form.get('category') || product?.category,cost_price:Number(form.get('cost_price')),retail_price:Number(form.get('retail_price')),reseller_price:Number(form.get('reseller_price')),warranty_months:Number(form.get('warranty_months')),image_path:imagePath,is_public:isCentralAdmin() ? Boolean(product?.is_public) : form.has('is_public'),...productCopyValues(form), ...promo};
    if(Object.values(values).some(value=>typeof value==='number'&&(!Number.isFinite(value)||value<0)))throw new Error('Harga dan masa garansi harus berupa angka nol atau lebih.');
    if (product) {
      const changes = isCentralAdmin()
        ? { name, brand, model, image_path: imagePath, warranty_months: values.warranty_months,
          ...Object.fromEntries(['cost_price', 'retail_price', 'reseller_price']
            .filter((key) => Number(product[key]) !== values[key]).map((key) => [key, values[key]])),
          ...productCopyValues(form), ...promo }
        : values;
      checkError(await supabase.from('products').update(changes).eq('id', product.id).select('id').single());
      toast('Detail produk diperbarui.');
    } else {
      checkError(await supabase.from('products').insert({
        id: crypto.randomUUID(), organization_id: state.organization.id,
        ...values, gallery_paths: await readGallery(form),
      }).select('id').single());
      state.inventoryFilters = { 'inventory-stock': 'all', 'inventory-search': sku };
      toast('Produk tersimpan di katalog toko. Tambahkan stok agar unit bisa dijual.');
    }
    await showPage('inventory');
  },product?'Simpan perubahan':'Simpan produk');
  host.querySelector('#active-modal').classList.add('compact-product-modal');
  host.querySelector('[data-add-opening-stock]')?.addEventListener('click', () => openingStockModal([product]));
  bindProductPhotoPicker(host.querySelector('#active-modal'));
}

async function printBarcode(value, printable) {
  try {
    const { data, error } = await supabase.from('stock_items').select('barcode,supplier,suppliers(initials),quantity,products(name,sku,category)').eq('barcode', value).single();
    if (error) throw error;
    printBarcodeLabels([data], printable);
  } catch (error) { printable?.close(); toast(error.message || 'Data barcode gagal dimuat.', true); }
}

const printFormats = {
  report: { A4: 'A4', A5: 'A5', Letter: 'Letter' },
  receipt: { '58': '58 mm', '80': '80 mm', A5: 'A5', A4: 'A4' },
};

function printPreferences() {
  const key = `digi-print:${state.organization.id}:${state.branchId}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
  return {
    key,
    report: Object.hasOwn(printFormats.report, saved.report) ? saved.report : 'A4',
    receipt: Object.hasOwn(printFormats.receipt, saved.receipt) ? saved.receipt : '80',
  };
}

function printerPlatform() {
  if (isAppleMobile()) return 'ios';
  if (/Android/i.test(navigator.userAgent)) return 'android';
  return 'desktop';
}

const printerSetup = {
  android: '<strong>Wi-Fi.</strong> Sambungkan HP dan printer ke Wi-Fi yang sama. Di Pengaturan HP, cari “Pencetakan”, lalu aktifkan Layanan cetak default atau pasang layanan cetak merek printer. <strong>Bluetooth.</strong> Pasangkan printer di Pengaturan Bluetooth. Jika printer thermal tetap tidak muncul saat uji cetak, periksa apakah produsennya menyediakan aplikasi atau layanan cetak untuk model itu.',
  ios: '<strong>Wi-Fi.</strong> Sambungkan iPhone dan printer yang mendukung AirPrint ke Wi-Fi yang sama. Pilih printer saat uji cetak. <strong>Bluetooth.</strong> Untuk printer thermal Bluetooth, periksa dukungan aplikasi resmi untuk model printer tersebut.',
  desktop: 'Tambahkan printer melalui pengaturan sistem komputer. Di Windows, buka Pengaturan, lalu Bluetooth & perangkat, Printer & pemindai, dan Tambahkan perangkat.',
};

function mobilePrintHint(platform = printerPlatform()) {
  if (platform === 'android') return 'Jika dialog cetak belum terbuka, di pratinjau Chrome pilih menu ⋮, Bagikan, lalu Cetak.';
  if (platform === 'ios') return 'Jika dialog cetak belum terbuka, di pratinjau pilih Bagikan, lalu Cetak.';
  return '';
}

const printViewport = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const printControlsStyle = `.print-controls{margin:12px 0;padding:10px;background:#edf4ee;color:#173b2c}
  .print-controls button{min-height:44px;padding:0 10px;border:1px solid #52705f;background:white;color:inherit;font:inherit;font-weight:bold}
  .print-controls small{display:block;margin-top:6px}
  @media print{.print-controls{display:none}}`;

function printControls() {
  const hint = mobilePrintHint();
  return `<div class="print-controls"><button type="button" onclick="window.print()">Pilih printer / Cetak</button>
    ${hint ? `<small>${hint}</small>` : ''}</div>`;
}

function printDocument(title, body, kind, documentStyles = '', size = printPreferences()[kind]) {
  const thermal = size === '58' || size === '80';
  const paper = thermal ? 'auto' : kind === 'report' ? `${size} landscape` : size;
  const width = thermal ? `${Number(size) - 8}mm` : '100%';
  const win = window.open('', '_blank', 'width=760,height=650');
  if (!win) return toast('Izinkan pop-up untuk membuka pratinjau cetak.', true);
  win.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8">${printViewport}<title>${esc(title)}</title><style>
    @page{size:${paper};margin:${thermal ? 4 : 10}mm}
    *{box-sizing:border-box}body{max-width:${width};margin:12px auto;padding:0 6px;color:#111;font:12px/1.4 Arial,sans-serif}
    table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:4px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}
    thead{display:table-header-group}tr{break-inside:avoid}
    ${documentStyles}
    ${printControlsStyle}
    @media print{button{display:none}body{margin:0 auto;padding:0}}
  </style></head><body>${printControls()}${body}</body></html>`);
  win.document.close();
}

function printerSettings() {
  const prefs = printPreferences();
  const options = (kind) => Object.entries(printFormats[kind]).map(([value, label]) =>
    `<option value="${value}" ${prefs[kind] === value ? 'selected' : ''}>${label}</option>`).join('');
  const host = openModal('Pengaturan printer', `${esc(branchName(state.branchId))} · tersimpan di browser ini`, `
    <div class="form-grid">
      <div class="field"><label for="report-paper">Kertas laporan</label><select id="report-paper" name="report">${options('report')}</select></div>
      <div class="field"><label for="receipt-paper">Kertas struk / nota</label><select id="receipt-paper" name="receipt">${options('receipt')}</select></div>
    </div>
    <p class="field-hint">Printer yang tersedia muncul di dialog cetak perangkat. Untuk struk thermal, sesuaikan ukuran kertas dengan rol printer.</p>
    <button type="button" class="btn" id="add-printer-help" aria-controls="printer-help" aria-expanded="false">Cara hubungkan printer</button>
    <button type="button" class="btn" id="choose-printer">Uji cetak struk</button>
    <p class="notice" id="printer-help" hidden>${printerSetup[printerPlatform()]}</p>`, (form) => {
    localStorage.setItem(prefs.key, JSON.stringify({ report: form.get('report'), receipt: form.get('receipt') }));
    toast('Ukuran kertas tersimpan untuk cabang ini.');
  }, 'Simpan ukuran kertas');
  host.querySelector('#add-printer-help').addEventListener('click', (event) => {
    const help = host.querySelector('#printer-help');
    help.hidden = !help.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!help.hidden));
  });
  host.querySelector('#choose-printer').addEventListener('click', () => {
    const size = host.querySelector('#receipt-paper').value;
    printDocument('Uji cetak', `<h1>${esc(state.organization.name)}</h1><p>Uji cetak • ${esc(branchName(state.branchId))}</p>
      <p>Ukuran struk ${esc(printFormats.receipt[size])}</p>`, 'receipt', '', size);
  });
}

function printSaleReceipt(sale) {
  const format = printPreferences().receipt;
  const thermal = format === '58' || format === '80';
  const paper = thermal ? 'auto' : format;
  const width = thermal ? (Number(format) - 8) + 'mm' : '100%';
  const win = window.open('', '_blank', 'width=420,height=700');
  if (!win) return toast('Izinkan pop-up untuk mencetak struk.', true);
  const mobile = printerPlatform() !== 'desktop';
  const lines = (sale.sale_items || []).map((line) => `<tr><td>${esc(line.product_name)} × ${Number(line.quantity)}</td><td>${money(line.line_total ?? Number(line.unit_price) * Number(line.quantity))}</td></tr>`).join('');
  const paid = Number(sale.paid_amount || 0), total = Number(sale.total || 0);
  win.document.write(`<!doctype html><html><head><meta charset="utf-8">${printViewport}<title>Struk ${esc(sale.receipt_number || '')}</title><style>
    @page{size:${paper};margin:${thermal ? 4 : 10}mm}*{box-sizing:border-box}body{max-width:${width};margin:0 auto;color:#111;font:12px/1.45 Arial,sans-serif}
    h1{margin:0 0 3px;text-align:center;font-size:15px}p{margin:2px 0;text-align:center}.meta{margin:10px 0;border-top:1px dashed #555;border-bottom:1px dashed #555;padding:6px 0}
    table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}.totals{margin-top:7px;border-top:1px dashed #555;padding-top:6px}
    .thanks{text-align:center;margin-top:12px}@media print{body{width:auto}}
    ${printControlsStyle}
  </style></head><body>${mobile ? printControls() : ''}<h1>${esc(state.organization.name || 'DIGITAL LAPTOP JOMBANG')}</h1><p>${esc(state.organization.phone || '')}</p><p>${esc(state.organization.address || '')}</p>
    <div class="meta">No: ${esc(sale.receipt_number || 'Transaksi')}<br>Waktu: ${new Date(sale.created_at || Date.now()).toLocaleString('id-ID')}<br>Pembeli: ${esc(sale.customer_name || 'Pembeli umum')}</div>
    <table>${lines || '<tr><td>Detail produk tidak tersedia</td></tr>'}</table><div class="totals">Total: <b>${money(total)}</b><br>Dibayar: ${money(paid)}${paid < total ? `<br>Sisa piutang: ${money(total - paid)}` : ''}<br>Metode: ${esc(sale.payment_method || '—')}</div><p class="thanks">Terima kasih telah berbelanja.</p>
    ${mobile ? '' : `<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150))<\/script>`}</body></html>`);
  win.document.close();
}

async function syncPendingOfflineSales() {
  if(!navigator.onLine||state.profile?.role!=='operator'||!state.organization)return;
  const prefix=`digi-sale-outbox:${state.organization.id}:`;let changed=false,anyChanged=false,submitted=0;
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;
    let rows;try{rows=JSON.parse(localStorage.getItem(key)||'[]')}catch{continue}
    for(const row of rows){
      if(row.status!=='queued'||row.organization_id!==state.organization.id||row.branch_id!==state.profile?.branch_id)continue;
      try{
        const {data,error}=await supabase.rpc('create_sale_with_request',{_request_id:row.request_id,_branch_id:row.branch_id,_customer_name:row.customer_name,_customer_type:row.customer_type,_payment_method:row.payment_method,_lines:row.lines,_customer_id:row.customer_id,_paid_amount:row.paid_amount,_due_date:row.due_date});
        if(error)throw error;
        const sale=checkError(await supabase.from('sales').select('receipt_number').eq('id',data).single());row.status='synced';row.receipt_number=sale.receipt_number;row.sale_id=data;row.synced_at=new Date().toISOString();row.error='';submitted++;changed=true;anyChanged=true;
      }catch(error){
        const transient=!navigator.onLine||/fetch|network|failed to connect|connection/i.test(error.message||'');row.status=transient?'queued':'attention';row.error=transient?'Koneksi terputus saat sinkron.':error.message||'Transaksi perlu diperiksa.';changed=true;anyChanged=true;if(!transient)continue;else break;
      }
    }
    if(changed)localStorage.setItem(key,JSON.stringify(rows));
    changed=false;
  }
  if(submitted)toast(`${submitted} transaksi offline berhasil disinkronkan.`);if(anyChanged&&state.page==='cashier')await showPage('cashier');
}

async function cashierPage(page) {
  if (atCentral()) throw new Error('Cabang Pusat tidak melayani penjualan.');
  const branchId = state.branchId;
  const cacheKey=`digi-offline-cashier:${state.organization.id}:${branchId}`;let products,customers,stock,sales=[];
  try { const [productRows,customerRows,stockRows,ar]=await Promise.all([loadCashierProducts(),fetchAllRows(supabase.from('customers').select('id,name,phone,customer_type').order('name')),fetchAllRows(supabase.from('stock_items').select('product_id,quantity,barcode,serial_number').eq('branch_id',branchId).eq('status','available')),supabase.from('sales').select('id,receipt_number,customer_name,total,paid_amount,payment_method,created_at,sale_items(product_name,quantity,unit_price,line_total)').eq('branch_id',branchId).order('created_at',{ascending:false}).limit(8)]);if(ar.error)throw ar.error;products=productRows;customers=customerRows;stock=stockRows;sales=ar.data||[];localStorage.setItem(cacheKey,JSON.stringify({products,customers,stock,cachedAt:new Date().toISOString()})); }
  catch(error){if(navigator.onLine)throw error;const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');if(!cached)throw new Error('Data kasir belum tersimpan di perangkat ini. Buka halaman kasir saat online dahulu.');({products,customers,stock}=cached);sales=[];}
  if (state.branchId !== branchId || state.page !== 'cashier') return;
  const available=new Map();stock.forEach(item=>available.set(item.product_id,(available.get(item.product_id)||0)+Number(item.quantity)));
  const availableProducts=products.filter(product=>(available.get(product.id)||0)>0);
  const queueKey=`digi-sale-outbox:${state.organization.id}:${branchId}`,readQueue=()=>JSON.parse(localStorage.getItem(queueKey)||'[]'),saveQueue=(q)=>localStorage.setItem(queueKey,JSON.stringify(q));
  let cart=[];
  page.innerHTML=`${header('Kasir',`Transaksi ${branchName(branchId)} · beberapa produk per struk${navigator.onLine?'':' · mode offline'}`)}<div class="cashier-pos"><section class="panel cashier-catalog"><div class="panel-head"><div><div class="panel-title">Produk siap jual · ${esc(branchName(branchId))}</div><div class="panel-sub">Klik produk untuk menambahkannya ke keranjang.</div></div><span class="pill" id="cashier-catalog-count" aria-live="polite"></span></div><div class="cashier-search"><input id="sale-product-search" aria-label="Cari produk, SKU, barcode, atau serial" placeholder="Cari nama, SKU, barcode, atau serial…" autocomplete="off" maxlength="160" /></div><div class="cashier-products" id="cashier-catalog-items"></div></section><section class="panel cashier-checkout"><div class="panel-head"><div><div class="panel-title">Transaksi baru</div><div class="panel-sub">Atur pelanggan dan pembayaran.</div></div><span class="pill ${navigator.onLine?'':'gray'}">${navigator.onLine?'Online':'Offline'}</span></div><form id="sale-form"><section class="panel table-panel cashier-cart"><div class="panel-head"><div><div class="panel-title">Keranjang</div><div class="panel-sub" id="cart-count">Belum ada barang</div></div><b id="cart-total">${money(0)}</b></div><ul class="cashier-cart-lines" id="cart-lines"></ul></section><div class="form-grid"><div class="field"><label>Pelanggan terdaftar</label><select name="customer_id"><option value="">Pembeli umum</option>${customers.map(customer=>`<option value="${customer.id}">${esc(customer.name)} · ${customer.customer_type==='reseller'?'Reseller':'End user'} · ${esc(customer.phone||'tanpa telepon')}</option>`).join('')}</select></div><div class="field"><label>Nama pembeli</label><input name="customer_name" placeholder="Nama pembeli umum" /></div><div class="field"><label>Harga pelanggan</label><select name="customer_type"><option value="end_user">End user</option><option value="reseller">Reseller</option></select><small class="field-hint" id="customer-price-hint">Pembeli umum memakai harga end user secara default. Pilih reseller jika transaksi menggunakan harga reseller.</small></div></div><div class="form-grid cashier-payment"><div class="field"><label>Metode pembayaran</label><select name="payment_method"><option value="cash">Tunai</option><option value="transfer">Transfer</option><option value="qris">QRIS</option><option value="debit">Kartu debit</option><option value="other">Lainnya</option></select></div><div class="field"><label>Pelunasan</label><select name="payment_mode"><option value="full">Lunas sekarang</option><option value="credit">Tempo / piutang</option></select></div><div class="credit-fields form-grid full" hidden><div class="field"><label>Dibayar sekarang</label><input name="paid_amount" type="number" min="0" value="0" /></div><div class="field"><label>Jatuh tempo</label><input name="due_date" type="date" /></div></div></div><div class="cashier-submit"><span>Total belanja <b id="checkout-total">${money(0)}</b></span><button class="btn primary" type="submit" disabled>Simpan transaksi</button></div></form><div id="sale-receipt"></div><section id="offline-queue"></section></section><section class="panel cashier-recent"><div class="panel-head"><div><div class="panel-title">Transaksi terbaru</div><div class="panel-sub">Cetak ulang struk dari transaksi tersimpan</div></div></div>${sales.length?`<div class="table-wrap"><table><thead><tr><th>NO. STRUK</th><th>TOTAL</th><th>AKSI</th></tr></thead><tbody>${sales.map(sale=>`<tr><td class="product-name">${esc(sale.receipt_number)}<div class="field-hint">${esc(sale.customer_name||'Pembeli umum')} · ${new Date(sale.created_at).toLocaleString('id-ID')}</div></td><td>${money(sale.total)}<div class="field-hint">Dibayar ${money(sale.paid_amount)}</div></td><td><button class="small-btn" type="button" data-print-sale="${sale.id}">Cetak</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><b>Belum ada transaksi</b>Transaksi tersimpan di cabang ini akan tampil di sini.</div>'}</section></div>`;
  const form = page.querySelector('#sale-form');
  const productSearch = page.querySelector('#sale-product-search');
  const priceFor = product => form.customer_type.value === 'reseller' ? Number(product.reseller_price) : publicRetailPrice(product);
  let saving = false;
  const catalog = page.querySelector('#cashier-catalog-items');
  const catalogCount = page.querySelector('#cashier-catalog-count');
  const remainingFor = (product) => Math.max(0, (available.get(product.id) || 0) -
    cart.reduce((total, line) => total + (line.product.id === product.id ? line.quantity : 0), 0));
  const matchesCatalog = (product, query) =>
    [product.name, product.sku, product.brand, product.model].join(' ').toLocaleLowerCase('id').includes(query) ||
    stock.some((row) => row.quantity > 0 && row.product_id === product.id && [row.barcode, row.serial_number].join(' ').toLocaleLowerCase('id').includes(query));
  const renderCatalog = () => {
    const query = productSearch.value.trim().toLocaleLowerCase('id');
    const matches = availableProducts.filter((product) => available.get(product.id) > 0 && matchesCatalog(product, query));
    catalogCount.textContent = matches.length + ' produk';
    catalog.innerHTML = matches.map((product) => {
      const price = priceFor(product);
      return `<button type="button" class="cashier-product-card" data-cashier-product="${esc(product.id)}" ${price > 0 && remainingFor(product) > 0 && !saving ? '' : 'disabled'}>
        <span class="cashier-product-image">${product.image_path ? `<img loading="lazy" src="${esc(productImageUrl(product.image_path))}" alt="" />` : 'Foto belum tersedia'}</span>
        <span class="cashier-product-info"><strong>${esc(product.name)}</strong><small>${esc(product.sku)} · ${remainingFor(product)} unit tersisa</small><b>${price > 0 ? money(price) : 'Harga belum diatur'}</b></span>
      </button>`;
    }).join('') || '<div class="empty">Tidak ada produk siap jual yang cocok.</div>';
  };
  const cartLines = page.querySelector('#cart-lines');
  const renderCart = () => {
    const total = cart.reduce((sum, item) => sum + priceFor(item.product) * item.quantity, 0);
    const units = cart.reduce((sum, item) => sum + item.quantity, 0);
    page.querySelector('#cart-count').textContent = units ? units + ' unit' : 'Belum ada barang';
    page.querySelector('#cart-total').textContent = money(total);
    page.querySelector('#checkout-total').textContent = money(total);
    form.querySelector('[type="submit"]').disabled = saving || !units || cart.some(item => !(priceFor(item.product) > 0));
    form.paid_amount.max = String(total);
    if (Number(form.paid_amount.value) > total) form.paid_amount.value = String(total);
    cartLines.innerHTML = cart.map(({product, quantity}, index) => `
      <li class="cashier-cart-line">
        <div class="cashier-cart-product">
          ${product.image_path ? `<img src="${esc(productImageUrl(product.image_path))}" alt="" />` : ''}
          <div><strong>${esc(product.name)}</strong><small>${priceFor(product) > 0 ? money(priceFor(product)) + ' / unit' : 'Harga belum diatur'}</small></div>
        </div>
        <b class="cashier-line-total">${money(priceFor(product) * quantity)}</b>
        <div class="cashier-quantity" data-index="${index}">
          <button class="small-btn" type="button" data-action="minus" aria-label="Kurangi ${esc(product.name)}" ${saving ? 'disabled' : ''}>−</button>
          <span>${quantity}</span>
          <button class="small-btn" type="button" data-action="plus" aria-label="Tambah ${esc(product.name)}" ${saving || !remainingFor(product) || !(priceFor(product) > 0) ? 'disabled' : ''}>+</button>
          <button class="small-btn" type="button" data-action="remove" ${saving ? 'disabled' : ''}>Hapus</button>
        </div>
      </li>`).join('') || '<li class="empty">Klik produk untuk menambahkannya ke keranjang.</li>';
    renderCatalog();
  };
  const addProduct = (product) => {
    if (saving || !product || !remainingFor(product) || !(priceFor(product) > 0)) return;
    const line = cart.find(item => item.product.id === product.id);
    if (line) line.quantity += 1;
    else cart.push({ product, quantity: 1 });
    renderCart();
  };
  catalog.addEventListener('click', event => {
    const card = event.target.closest('[data-cashier-product]');
    if (!card || card.disabled) return;
    addProduct(availableProducts.find(product => product.id === card.dataset.cashierProduct));
    const updated = catalog.querySelector(`[data-cashier-product="${CSS.escape(card.dataset.cashierProduct)}"]:enabled`);
    (updated || productSearch).focus({preventScroll: true});
  });
  cartLines.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled || saving) return;
    const index = Number(button.closest('[data-index]').dataset.index);
    const line = cart[index];
    if (button.dataset.action === 'plus') addProduct(line.product);
    else {
      if (button.dataset.action === 'remove' || line.quantity === 1) cart.splice(index, 1);
      else line.quantity -= 1;
      renderCart();
    }
    const row = cartLines.querySelector(`[data-index="${index}"]`);
    (row?.querySelector(`[data-action="${button.dataset.action}"]:enabled`) || row?.querySelector('button:enabled') || productSearch).focus({preventScroll: true});
  });
  productSearch.addEventListener('input', renderCatalog);
  form.customer_id.addEventListener('change', () => {
    const customer = customers.find(item => item.id === form.customer_id.value);
    form.customer_name.value = customer?.name || '';
    form.customer_name.readOnly = Boolean(customer);
    form.customer_type.value = customer?.customer_type === 'reseller' ? 'reseller' : 'end_user';
    form.customer_type.disabled = Boolean(customer);
    page.querySelector('#customer-price-hint').textContent = customer ? 'Harga mengikuti tipe pelanggan terdaftar.' : 'Pilih tipe harga untuk pembeli umum.';
    renderCart();
  });
  form.customer_type.addEventListener('change', renderCart);
  form.payment_mode.addEventListener('change', () => {
    const credit = form.payment_mode.value === 'credit';
    form.querySelector('.credit-fields').hidden = !credit;
    form.paid_amount.required = credit;
    form.due_date.required = credit;
  });
  page.querySelectorAll('[data-print-sale]').forEach(button => button.addEventListener('click', () => {
    const sale = sales.find(row => row.id === button.dataset.printSale);
    if (sale) printSaleReceipt(sale);
  }));
  renderCart();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    if (state.branchId !== branchId) return toast('Cabang telah berubah. Buka ulang kasir.', true);
    if (!cart.length) return toast('Keranjang masih kosong.', true);
    if (cart.some((item) => !(priceFor(item.product) > 0))) return toast('Ada produk yang belum memiliki harga untuk tipe pelanggan ini.', true);
    const total = cart.reduce((sum,item)=>sum+priceFor(item.product)*item.quantity,0);
    const paid = form.payment_mode.value === 'full' ? total : Number(form.paid_amount.value);
    if (!Number.isFinite(paid) || paid < 0 || paid > total) return toast('Nominal pembayaran tidak valid.', true);
    if (paid < total && !String(form.customer_name.value || '').trim()) return toast('Nama pembeli wajib diisi untuk transaksi piutang.', true);
    if (paid < total && !form.due_date.value) return toast('Tanggal jatuh tempo wajib untuk piutang.', true);
    const payload = {
      request_id: crypto.randomUUID(), organization_id: state.organization.id, branch_id: branchId,
      customer_name: customers.find(customer=>customer.id===form.customer_id.value)?.name || String(form.customer_name.value).trim(), customer_id: form.customer_id.value || null,
      customer_type: form.customer_type.value, payment_method: form.payment_method.value,
      lines: cart.map(item=>({product_id:item.product.id,quantity:item.quantity,expected_price:priceFor(item.product)})),
      paid_amount: paid, due_date: paid < total ? form.due_date.value : null,
      created_at: new Date().toISOString(), status: 'queued'
    };
    saving = true;
    renderCart();
    try {
      if (!navigator.onLine) {
        const q=readQueue(); q.push(payload);saveQueue(q);cart.forEach(line=>{let left=line.quantity;for(const item of stock){if(item.product_id!==line.product.id||left<=0)continue;const take=Math.min(Number(item.quantity),left);item.quantity=Number(item.quantity)-take;left-=take}available.set(line.product.id,Math.max(0,(available.get(line.product.id)||0)-line.quantity))});localStorage.setItem(cacheKey,JSON.stringify({products,customers,stock:stock.filter(item=>item.quantity>0),cachedAt:new Date().toISOString()}));cart=[]; renderCart();
        toast('Transaksi disimpan di antrean perangkat. Belum tercatat di database pusat.'); renderOfflineQueue(); return;
      }
      const {data,error}=await supabase.rpc('create_sale_with_request',{
        _request_id:payload.request_id,_branch_id:payload.branch_id,_customer_name:payload.customer_name,
        _customer_type:payload.customer_type,_payment_method:payload.payment_method,_lines:payload.lines,
        _customer_id:payload.customer_id,_paid_amount:payload.paid_amount,_due_date:payload.due_date
      });
      if(error) throw error;
      const sale=checkError(await supabase.from('sales').select('receipt_number,total,paid_amount,customer_name,customer_type,payment_method,created_at,sale_items(product_name,quantity,unit_price,line_total)').eq('id',data).single());
      toast(`Transaksi tersimpan. ${money(paid)} masuk ke kas.`);
      if (state.branchId !== branchId || state.page !== 'cashier') return;
      await showPage('cashier');
      if (state.branchId !== branchId || state.page !== 'cashier') return;
      const receipt=page.querySelector('#sale-receipt');
      if(receipt){
        receipt.innerHTML=`<div class="receipt cashier-receipt"><div><b>Transaksi tersimpan</b><span>${esc(sale.receipt_number)}</span></div><span>Total ${money(sale.total)} · Dibayar ${money(sale.paid_amount)}${sale.paid_amount<sale.total?` · Piutang ${money(sale.total-sale.paid_amount)}`:''}</span><button class="btn" id="print-receipt" type="button">Cetak struk</button></div>`;
        receipt.querySelector('#print-receipt').addEventListener('click',()=>printSaleReceipt(sale));
      }
    } catch(error) {
      if(!navigator.onLine||/fetch|network|failed to connect|connection/i.test(error.message||'')){
        const q=readQueue();q.push(payload);saveQueue(q);cart.forEach(line=>{let left=line.quantity;for(const item of stock){if(item.product_id!==line.product.id||left<=0)continue;const take=Math.min(Number(item.quantity),left);item.quantity=Number(item.quantity)-take;left-=take}available.set(line.product.id,Math.max(0,(available.get(line.product.id)||0)-line.quantity))});localStorage.setItem(cacheKey,JSON.stringify({products,customers,stock:stock.filter(item=>item.quantity>0),cachedAt:new Date().toISOString()}));cart=[];renderCart();
        toast('Jaringan terputus. Transaksi masuk antrean untuk dikirim ulang.',true);renderOfflineQueue();
      } else toast(error.message||'Transaksi gagal.',true);
    } finally {
      saving = false;
      if (form.isConnected) renderCart();
    }
  });
  function renderOfflineQueue() {
    const q=readQueue().filter(x=>x.status!=='cancelled'),host=form.parentElement?.querySelector('#offline-queue');
    if (!host || !form.isConnected) return;
    if(!q.length){host.innerHTML='';return;}
    host.innerHTML=`<section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Antrean perangkat</div><div class="panel-sub">${q.filter(x=>x.status==='queued').length} menunggu sinkron · ${q.filter(x=>x.status==='attention').length} perlu diperiksa</div></div>${navigator.onLine?'<button class="small-btn" id="sync-queue">Sinkronkan sekarang</button>':''}</div><div class="table-wrap"><table><thead><tr><th>WAKTU</th><th>ITEM</th><th>TOTAL PERKIRAAN</th><th>STATUS</th><th></th></tr></thead><tbody>${q.slice().reverse().map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('id-ID')}</td><td>${x.lines.length} produk · ${x.lines.reduce((n,l)=>n+l.quantity,0)} unit</td><td>${money(x.lines.reduce((sum,line)=>sum+Number(line.expected_price)*line.quantity,0))}</td><td><span class="pill ${x.status==='attention'?'warn':x.status==='synced'?'':'gray'}">${x.status==='synced'?`Tersinkron · ${esc(x.receipt_number||'')}`:x.status==='attention'?`Perlu ditinjau · ${esc(x.error||'')}`:'Menunggu jaringan'}</span></td><td>${x.status==='attention'?`<button class="small-btn" data-retry-offline="${x.request_id}">Coba lagi</button>`:''}${x.status!=='synced'?` <button class="small-btn" data-discard-offline="${x.request_id}">Batalkan antrean</button>`:''}</td></tr>`).join('')}</tbody></table></div></section>`;
    host.querySelector('#sync-queue')?.addEventListener('click',syncPendingOfflineSales);
    host.querySelectorAll('[data-discard-offline]').forEach(btn=>btn.addEventListener('click',()=>{if(!confirm('Batalkan transaksi yang belum tersinkron?'))return;const rows=readQueue(),item=rows.find(x=>x.request_id===btn.dataset.discardOffline);if(item){item.status='cancelled';saveQueue(rows);const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');if(cached){for(const line of item.lines){const stockRow=cached.stock.find(x=>x.product_id===line.product_id);if(stockRow)stockRow.quantity=Number(stockRow.quantity)+Number(line.quantity);else cached.stock.push({product_id:line.product_id,quantity:Number(line.quantity)});available.set(line.product_id,(available.get(line.product_id)||0)+Number(line.quantity))}localStorage.setItem(cacheKey,JSON.stringify(cached))}renderOfflineQueue();toast('Antrean dibatalkan dan estimasi stok lokal dipulihkan.')}}));
    host.querySelectorAll('[data-retry-offline]').forEach(btn=>btn.addEventListener('click',()=>{
      const rows=readQueue(),item=rows.find(x=>x.request_id===btn.dataset.retryOffline);
      if(item){item.status='queued';item.error='';saveQueue(rows);renderOfflineQueue();syncPendingOfflineSales();}
    }));
  }

  renderOfflineQueue();
}

async function servicePage(page) {
  const isTechnician = canTechnician();
  const branchId = state.branchId;
  let query = supabase.from('service_tickets').select('*,customers(id,name,phone)').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(100);
  if (isTechnician) query = query.not('status', 'in', '(ready,handed_over,cancelled)').or(`assigned_technician_id.is.null,assigned_technician_id.eq.${state.user.id}`);
  const [result, teamResult] = await Promise.all([
    query,
    supabase.from('profiles').select('id,full_name').eq('organization_id', state.organization.id).eq('branch_id', state.branchId).eq('role', 'technician'),
  ]);
  if (result.error) throw result.error;
  if (teamResult.error) throw teamResult.error;
  if (state.page !== 'service' || state.branchId !== branchId) return;
  const tickets = result.data || [];
  if (!isTechnician) tickets.sort((a, b) => Number(b.status === 'ready') - Number(a.status === 'ready'));
  const technicians = new Map((teamResult.data || []).map((person) => [person.id, person.full_name]));
  const headerActions = !isTechnician ? '<button class="btn primary" id="new-service">＋ Terima laptop</button>' : '';
  const summaryStatuses = isTechnician ? ['received', 'diagnosing', 'repairing', 'waiting_parts'] : ['received', 'repairing', 'ready', 'handed_over'];
  const summary = `<div class="cards service-summary">${summaryStatuses.map(status => `<article class="card" data-service-status="${status}"><div class="card-label">${statusText[status]}</div><div class="card-value">${tickets.filter(ticket => ticket.status === status).length}</div></article>`).join('')}</div>`;
  page.innerHTML = `${header(isTechnician ? 'Servis pelanggan' : 'Servis laptop', isTechnician ? `Antrean pelanggan untuk ${branchName(state.branchId)}. Catatan dan progres tersinkron ke operator.` : `Terima laptop pelanggan, pantau progres teknisi, lalu lakukan serah terima di ${branchName(state.branchId)}.`, headerActions)}${!isTechnician && !technicians.size ? `<div class="notice">Belum ada akun teknisi di ${esc(branchName(state.branchId))}. Tiket bisa dicatat, tetapi perlu teknisi cabang agar dapat dikerjakan. Tambahkan akun teknisi dari Pengaturan Aplikasi.</div>` : ''}${summary}<section class="panel table-panel service-table"><div class="panel-head"><div><div class="panel-title">${isTechnician ? 'Antrean teknisi' : 'Tiket servis'}</div><div class="panel-sub">${tickets.length} tiket · ${branchName(state.branchId)}${isTechnician ? ' · ditugaskan ke lo atau belum ditugaskan' : ''}</div></div><div class="service-filters"><input class="search" id="service-search" aria-label="Cari tiket servis" placeholder="Cari tiket, nama, nomor seri" /><select class="branch-select" id="service-status" aria-label="Filter status servis"><option value="">Semua status</option>${Object.entries(statusText).filter(([status]) => !isTechnician || !['ready', 'handed_over', 'cancelled'].includes(status)).map(([status,label]) => `<option value="${status}">${esc(label)}</option>`).join('')}</select></div></div><div class="table-wrap"><table><thead><tr><th>NO. TIKET</th><th>PELANGGAN / UNIT</th><th>KELUHAN / CATATAN TEKNISI</th><th>STATUS</th><th>BIAYA / TERBAYAR</th><th>AKSI</th></tr></thead><tbody id="service-rows">${tickets.map((ticket) => {
    const techName = ticket.assigned_technician_id ? technicians.get(ticket.assigned_technician_id) || ticket.technician_name : 'Belum ditugaskan';
    const photoButtons = `${ticket.intake_photo_path ? `<button class="small-btn" data-photo="${esc(ticket.intake_photo_path)}">Foto awal</button>` : ''}${ticket.handover_photo_path ? `<button class="small-btn" data-photo="${esc(ticket.handover_photo_path)}">Foto serah terima</button>` : ''}`;
    const whatsapp = serviceCustomerWhatsApp(ticket);
    const actions = isTechnician
      ? `${!['handed_over','cancelled'].includes(ticket.status) ? `<button class="small-btn" data-work-ticket="${ticket.id}">Perbarui progres</button>` : ''}${ticket.status === 'repairing' ? `<button class="small-btn" data-parts="${ticket.id}">＋ Sparepart</button>` : ''}${photoButtons}`
      : `<button class="small-btn" data-service-receipt="${ticket.id}">Bukti penerimaan</button> ${ticket.status === 'handed_over' ? `<button class="small-btn" data-service-receipt="${ticket.id}" data-receipt-kind="handover">Bukti penyerahan</button>` : ''} ${ticket.status === 'ready' ? `<button class="small-btn" data-handover="${ticket.id}">Serah terima</button>` : ''}${whatsapp && ['received', 'ready'].includes(ticket.status) ? `<button type="button" class="small-btn service-wa-button" data-service-receipt="${ticket.id}">Kirim PDF via WhatsApp</button>` : ''}${!['handed_over','cancelled','ready'].includes(ticket.status) ? `<button class="small-btn" data-cancel-ticket="${ticket.id}">Batalkan</button>` : ''}${photoButtons}`;
    return `<tr data-service-status="${esc(ticket.status)}"><td class="product-name">${esc(ticket.ticket_number)}<div class="field-hint">${new Date(ticket.created_at).toLocaleDateString('id-ID')}</div></td><td>${esc(ticket.customer_name)}<div class="field-hint">${esc(ticket.device_name)} · ${esc(ticket.serial_number || 'tanpa serial')}<br/>Teknisi: ${esc(techName)}</div></td><td>${esc(ticket.complaint)}${ticket.technician_note ? `<div class="field-hint"><b>Catatan teknisi:</b> ${esc(ticket.technician_note)}</div>` : ''}</td><td><span class="pill ${ticket.status === 'ready' ? 'blue' : ticket.status === 'handed_over' ? '' : 'warn'}">${esc(statusText[ticket.status] || ticket.status)}</span></td><td>${money(ticket.final_cost || ticket.estimated_cost)}<div class="field-hint">Dibayar ${money(ticket.paid_amount || 0)}</div></td><td><div class="actions-cell">${actions}</div></td></tr>`;
  }).join('') || `<tr><td colspan="6"><div class="empty"><b>${isTechnician ? 'Belum ada tiket di antrean teknisi' : 'Belum ada tiket servis'}</b>${isTechnician ? 'Tiket baru dari operator cabang ini akan muncul di sini.' : 'Buat tiket saat laptop diterima di toko.'}</div></td></tr>`}</tbody></table></div></section>`;
  page.querySelector('#new-service')?.addEventListener('click', () => serviceIntakeModal());
  page.querySelectorAll('[data-work-ticket]').forEach((button) => button.addEventListener('click', () => technicianServiceModal(tickets.find((ticket) => ticket.id === button.dataset.workTicket))));
  page.querySelectorAll('[data-handover]').forEach((button) => button.addEventListener('click', () => {
    finishService(tickets.find((ticket) => ticket.id === button.dataset.handover));
  }));
  page.querySelectorAll('[data-service-receipt]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const ticket = tickets.find((row) => row.id === button.dataset.serviceReceipt);
      await showServiceReceipt(ticket, button.dataset.receiptKind, technicians.get(ticket.assigned_technician_id));
    } catch (error) { toast(error.message, true); }
  }));
  page.querySelectorAll('[data-cancel-ticket]').forEach((button) => button.addEventListener('click', async () => { if (!confirm('Batalkan tiket servis ini?')) return; try { checkError(await supabase.rpc('update_customer_service', { _ticket_id: button.dataset.cancelTicket, _status: 'cancelled', _technician_note: '', _estimated_cost: 0 })); toast('Tiket servis dibatalkan.'); await showPage('service'); } catch (error) { toast(error.message, true); } }));
  page.querySelectorAll('[data-photo]').forEach((button) => button.addEventListener('click', async () => { const { data, error } = await supabase.storage.from('service-evidence').createSignedUrl(button.dataset.photo, 300); if (error) return toast(error.message, true); window.open(data.signedUrl, '_blank', 'noopener'); }));
  page.querySelectorAll('[data-parts]').forEach((button) => button.addEventListener('click', () => partsModal(button.dataset.parts)));
  const search = page.querySelector('#service-search');
  const status = page.querySelector('#service-status');
  const filterTickets = () => {
    const query = search.value.trim().toLowerCase();
    page.querySelectorAll('#service-rows tr[data-service-status]').forEach(row => {
      row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(query) || Boolean(status.value && row.dataset.serviceStatus !== status.value));
    });
  };
  search.addEventListener('input', filterTickets);
  status.addEventListener('change', filterTickets);
}

function technicianServiceModal(ticket) {
  if (!ticket) return;
  const nextStatuses = ['diagnosing', 'waiting_approval', 'waiting_parts', 'repairing', 'ready'];
  openModal('Perbarui pekerjaan servis', `${ticket.ticket_number} · ${ticket.customer_name} · ${ticket.device_name}`, `<div class="notice">Keluhan: ${esc(ticket.complaint)}</div><div class="form-grid"><div class="field"><label>Status pekerjaan</label><select name="status" required>${nextStatuses.map((status) => `<option value="${status}" ${ticket.status === status ? 'selected' : ''}>${statusText[status]}</option>`).join('')}</select></div><div class="field"><label>Estimasi biaya servis</label><input name="estimated_cost" type="number" min="0" step="1000" value="${Number(ticket.estimated_cost || 0)}" required /></div><div class="field full"><label>Catatan pemeriksaan / progres</label><textarea name="technician_note" rows="4" required>${esc(ticket.technician_note || '')}</textarea></div></div>`, async (form) => {
    checkError(await supabase.rpc('update_customer_service', { _ticket_id: ticket.id, _status: String(form.get('status')), _technician_note: String(form.get('technician_note')).trim(), _estimated_cost: Number(form.get('estimated_cost')) }));
    toast(form.get('status') === 'ready' ? 'Tiket siap diambil dan masuk antrean serah terima operator.' : 'Progres teknisi tersimpan dan terlihat oleh operator.'); await showPage('service');
  }, 'Simpan progres');
}

async function serviceIntakeModal() {
  const [technicianResult, customerResult] = await Promise.all([
    supabase.from('profiles').select('id,full_name').eq('organization_id', state.organization.id).eq('branch_id', state.branchId).eq('role', 'technician').order('full_name'),
    supabase.from('customers').select('id,name,phone,customer_type').eq('organization_id', state.organization.id).order('name'),
  ]);
  if (technicianResult.error) return toast(technicianResult.error.message, true);
  if (customerResult.error) return toast(customerResult.error.message, true);
  const technicianRows = technicianResult.data || [];
  const customerRows = customerResult.data || [];
  const technicians = technicianRows || [];
  const ticketId = crypto.randomUUID();
  const ticketNumber = `SRV-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const host = openModal('Terima laptop servis', 'Pilih pelanggan terdaftar atau buat data baru. Tiket dan riwayat pelanggan akan saling terhubung.', `<div class="form-grid">${branchField()}<div class="field full"><label>Pelanggan</label><select name="customer_id" required><option value="__new__">＋ Pelanggan baru · otomatis ditambahkan ke data pelanggan</option>${customerRows.map((customer) => `<option value="${customer.id}">${esc(customer.name)} · ${esc(customer.phone || 'tanpa telepon')} · ${customer.customer_type === 'reseller' ? 'Reseller' : 'End user'}</option>`).join('')}</select></div><div class="field"><label>Nama pelanggan</label><input name="customer_name" required /></div><div class="field"><label>No. telepon / WhatsApp</label><input name="customer_phone" /></div><div class="field full"><label>Teknisi cabang</label><select name="assigned_technician_id"><option value="">Belum ditugaskan</option>${technicians.map((person,index) => `<option value="${person.id}" ${index===0?'selected':''}>${esc(person.full_name)}</option>`).join('')}</select></div><div class="field"><label>Unit / model</label><input name="device_name" required placeholder="Contoh: Lenovo IdeaPad Slim 3" /></div><div class="field"><label>Nomor seri</label><input name="serial_number" /></div><div class="field full"><label>Keluhan pelanggan</label><textarea name="complaint" required></textarea></div><div class="field"><label>Estimasi awal (Rp)</label><input name="estimated_cost" type="number" min="0" value="0" /></div><div class="field"><label>Foto kondisi awal <span class="required">wajib</span></label><input name="intake_photo" type="file" accept="image/*" capture="environment" required /></div></div>`, async (form) => {
    const assignedTechnicianId = String(form.get('assigned_technician_id') || '') || null;
    const assignedTechnician = technicians.find((person) => person.id === assignedTechnicianId);
    const file = form.get('intake_photo');
    if (!(file instanceof File) || !file.size) throw new Error('Foto kondisi awal wajib dilampirkan.');
    const compressed = await compressPhoto(file);
    const branchId = String(form.get('branch_id'));
    const path = `${state.organization.id}/${branchId}/${ticketId}/intake.jpg`;
    const upload = await supabase.storage.from('service-evidence').upload(path, compressed, { contentType: 'image/jpeg', upsert: true });
    if (upload.error) throw upload.error;
    try {
      checkError(await supabase.rpc('create_customer_service_ticket', {
        _ticket_id: ticketId,
        _branch_id: branchId,
        _ticket_number: ticketNumber,
        _customer_id: String(form.get('customer_id')) === '__new__' ? null : String(form.get('customer_id')),
        _customer_name: String(form.get('customer_name')).trim(),
        _customer_phone: String(form.get('customer_phone')).trim(),
        _device_name: String(form.get('device_name')).trim(),
        _serial_number: String(form.get('serial_number')).trim(),
        _complaint: String(form.get('complaint')).trim(),
        _estimated_cost: Number(form.get('estimated_cost') || 0),
        _assigned_technician_id: assignedTechnicianId,
        _intake_photo_path: path,
      }));
    }
    catch (error) { await supabase.storage.from('service-evidence').remove([path]); throw error; }
    toast(`Tiket ${ticketNumber} tersimpan dan terhubung ke data pelanggan.`);
    if (state.page !== 'service' || state.branchId !== branchId) return;
    await showPage('service');
    if (!host.contains(modalForm) || state.page !== 'service' || state.branchId !== branchId) return;
    try {
      const ticket = checkError(await supabase.from('service_tickets').select('*,customers(id,name,phone)')
        .eq('id', ticketId).eq('branch_id', branchId).single());
      if (!host.contains(modalForm) || state.page !== 'service' || state.branchId !== branchId) return;
      await showServiceReceipt(ticket, 'intake', assignedTechnician?.full_name);
    } catch {
      toast('Tiket sudah tersimpan. Buka Bukti penerimaan dari daftar tiket untuk menyiapkan PDF.', true);
    }
  }, 'Simpan tiket');
  const modalForm = host.querySelector('#active-modal');
  const form = modalForm;
  const syncCustomer = () => {
    const customer = customerRows.find((row) => row.id === form.customer_id.value);
    const isNew = form.customer_id.value === '__new__';
    form.customer_name.value = customer?.name || '';
    form.customer_phone.value = customer?.phone || '';
    form.customer_name.readOnly = !isNew;
    form.customer_phone.readOnly = !isNew;
  };
  form.customer_id.addEventListener('change', syncCustomer);
  syncCustomer();
}

async function compressPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Gunakan foto JPG, PNG, atau WebP.');
  const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .82));
}

function serviceCustomerWhatsApp(ticket) {
  const phone = [ticket.customer_phone, ticket.customers?.phone].map((value) => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.replace(/^0/, '62').replace(/^8/, '628');
  }).find((number) => /^[1-9]\d{7,14}$/.test(number));
  return phone ? `https://wa.me/${phone}` : '';
}

function finishService(ticket) {
  if (!ticket || ticket.status !== 'ready') return;
  const estimate = Number(ticket.estimated_cost || 0);
  const path = `${ticket.organization_id}/${ticket.branch_id}/${ticket.id}/handover-${crypto.randomUUID()}.jpg`;
  let uploadedFile;
  const host = openModal('Serah terima dan pembayaran servis', 'Pembayaran masuk ke kas cabang. Sisa tagihan dicatat sebagai piutang.', `
    <div class="notice"><strong>${esc(ticket.ticket_number)}</strong> · ${esc(ticket.customer_name)} · ${esc(ticket.device_name)}</div>
    <div class="form-grid">
      <div class="field full"><label for="handover-evidence">Foto bukti penyerahan (wajib)</label><input id="handover-evidence" name="handover_photo" type="file" accept="image/jpeg,image/png,image/webp" required /></div>
      <div class="field"><label>Total biaya servis</label><input name="final_cost" type="number" min="0" value="${estimate}" required /></div>
      <div class="field"><label>Dibayar sekarang</label><input name="paid_amount" type="number" min="0" max="${estimate}" value="${estimate}" required /></div>
      <div class="field service-due" hidden><label>Jatuh tempo piutang</label><input name="due_date" type="date" /></div>
    </div>`, async (form) => {
    const file = form.get('handover_photo');
    if (!(file instanceof File) || !file.size) throw new Error('Foto bukti penyerahan wajib dilampirkan.');
    const fileKey = JSON.stringify([file.name, file.size, file.lastModified]);
    if (uploadedFile !== fileKey) {
      const compressed = await compressPhoto(file);
      if (!compressed) throw new Error('Foto bukti penyerahan gagal diproses.');
      checkError(await supabase.storage.from('service-evidence').upload(path, compressed, { contentType: 'image/jpeg', upsert: true }));
      uploadedFile = fileKey;
    }
    checkError(await supabase.rpc('complete_service_handover', {
      _ticket_id: ticket.id,
      _final_cost: Number(form.get('final_cost')),
      _paid_amount: Number(form.get('paid_amount')),
      _due_date: form.get('due_date') || null,
      _handover_photo_path: path
    }));
    toast('Serah terima tersimpan dan masuk laporan cabang.');
    if (state.page === 'service' && state.branchId === ticket.branch_id) await showPage('service');
  }, 'Simpan serah terima');
  const form = host.querySelector('#active-modal');
  const updateDue = () => {
    form.paid_amount.max = form.final_cost.value;
    const outstanding = Number(form.final_cost.value) > Number(form.paid_amount.value);
    form.querySelector('.service-due').hidden = !outstanding;
    form.due_date.required = outstanding;
  };
  form.final_cost.addEventListener('input', updateDue);
  form.paid_amount.addEventListener('input', updateDue);
  updateDue();
}

async function partsModal(ticketId) {
  const stock = checkError(await supabase.from('stock_items').select('id,product_id,barcode,quantity,products(name,sku,cost_price)').eq('branch_id', state.branchId).eq('status', 'available').gt('quantity', 0));
  const available = stock || [];
  if (!available.length) return toast('Tidak ada stok sparepart tersedia di cabang ini.', true);
  openModal('Pakai sparepart', 'Penggunaan sparepart akan mengurangi stok dan tercatat di tiket servis.', `<div class="form-grid"><div class="field full"><label>Sparepart</label><select name="stock_item_id" required>${available.map((item) => `<option value="${item.id}">${esc(item.products?.name || 'Produk')} · ${item.quantity} unit · ${esc(item.barcode)}</option>`).join('')}</select></div><div class="field"><label>Jumlah</label><input name="quantity" type="number" value="1" min="1" required /></div></div>`, async (form) => {
    const { error } = await supabase.rpc('use_service_part', { _ticket_id: ticketId, _stock_item_id: form.get('stock_item_id'), _quantity: Number(form.get('quantity')) });
    if (error) throw error; toast('Sparepart dicatat dan stok diperbarui.'); await showPage('service');
  }, 'Catat sparepart');
}

async function printWarrantyQr(item) {
  const printable = window.open('', '_blank', 'width=540,height=650');
  if (!printable) return toast('Izinkan pop-up untuk mencetak QR garansi.', true);
  try {
    const { default: QRCode } = await import('qrcode');
    const svg = await QRCode.toString(item.warranty_code, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 220 });
    const sold = item.sale_items?.[0]?.sales;
    printable.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR Garansi ${esc(item.warranty_code)}</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;font:14px Arial;color:#17271e}.card{width:340px;margin:0 auto;padding:22px;border:1px solid #b8c9b9;text-align:center}.card h1{margin:0 0 5px;font-size:18px}.card p{margin:5px 0;color:#53665a}.qr{width:190px;height:190px;margin:14px auto}.qr svg{width:100%;height:100%}.code{margin:10px 0;font:bold 18px monospace;letter-spacing:1px}.note{font-size:11px;color:#68786c}button{border:1px solid #175b39;border-radius:0;padding:10px 16px;background:#0d5a37;color:white;font-weight:bold;cursor:pointer}@media print{body{padding:0}.card{border:0}button{display:none}}</style></head><body><article class="card"><h1>DIGITAL LAPTOP JOMBANG</h1><p>Kartu garansi internal toko</p><div class="qr">${svg}</div><div class="code">${esc(item.warranty_code)}</div><p><b>${esc(item.products?.name || 'Laptop')}</b></p><p>${esc([item.products?.brand,item.products?.model].filter(Boolean).join(' · '))}</p><p>Serial: ${esc(item.serial_number || '—')}</p><p>Garansi sampai: ${item.warranty_until ? new Date(`${item.warranty_until}T00:00:00`).toLocaleDateString('id-ID') : '—'}</p>${sold ? `<p>No. nota: ${esc(sold.receipt_number || '—')}</p>` : ''}<p class="note">QR hanya untuk dipindai staf melalui menu Garansi Digi-Laptop.</p><button onclick="window.print()">Cetak QR garansi</button></article></body></html>`);
    printable.document.close();
  } catch (error) { printable.close(); toast(error.message || 'QR garansi gagal dibuat.', true); }
}

async function warrantyPage(page) {
  const [claims, units] = await Promise.all([
    fetchAllRows(supabase.from('warranty_claims').select('id,claim_number,customer_name,customer_phone,customer_email,issue,status,staff_note,created_at,stock_items(barcode,serial_number,products(name))').order('created_at',{ascending:false})),
    fetchAllRows(supabase.from('stock_items').select('id,warranty_code,barcode,supplier_barcode,serial_number,status,warranty_until,products(name,brand,model,category),sale_items(quantity,sales(receipt_number,customer_name,created_at))').eq('branch_id',state.branchId).eq('status','sold').not('warranty_code','is',null).order('warranty_until',{ascending:false})),
  ]);
  page.innerHTML=`${header('Garansi QR unit terjual','Garansi dicek staf toko memakai QR khusus yang dibuat setelah unit bergaransi terjual. Barcode stok tidak berlaku untuk pengecekan garansi.')}<div class="grid warranty-grid"><section class="panel"><div class="panel-head"><div><div class="panel-title">Cek garansi dengan QR</div><div class="panel-sub">Pindai QR garansi atau masukkan kode DLW. Barcode stok dan serial hanya identitas inventaris.</div></div></div><form id="warranty-form"><div class="field"><label>Kode QR garansi</label><input name="code" autocomplete="off" placeholder="DLW-…" required /></div><div class="modal-actions"><button class="btn" type="button" id="scan-code">▧ Pindai QR garansi</button><button class="btn primary" type="submit">Cek garansi</button></div></form><div id="warranty-result"></div><div id="scanner"></div><hr/><div class="panel-title">Catat klaim pelanggan</div><p class="panel-sub">Staf toko mencatat keluhan untuk unit terjual yang masih bergaransi.</p><form id="claim-form" class="form-grid"><div class="field full"><label>Kode QR garansi</label><input name="code" placeholder="Pindai QR atau cek unit di atas" required /></div><div class="field"><label>Nama pelanggan</label><input name="customer_name" required /></div><div class="field"><label>Nomor telepon</label><input name="customer_phone" required /></div><div class="field"><label>Email (opsional)</label><input name="customer_email" type="email" /></div><div class="field full"><label>Keluhan</label><textarea name="issue" minlength="10" maxlength="1200" required></textarea></div><button class="btn primary" type="submit">Simpan klaim</button></form><div id="claim-result"></div></section><div class="warranty-side"><section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">QR garansi unit terjual</div><div class="panel-sub">${units.length} unit bergaransi tercatat di ${esc(branchName(state.branchId))}. QR berbeda dari barcode stok.</div></div></div><div class="table-wrap"><table><thead><tr><th>UNIT / KODE QR</th><th>PELANGGAN / NOTA</th><th>BERLAKU SAMPAI</th><th>STATUS</th><th></th></tr></thead><tbody>${units.map(item=>{const sale=item.sale_items?.[0]?.sales,expired=item.warranty_until&&new Date(`${item.warranty_until}T23:59:59`)<new Date();return `<tr><td class="product-name">${esc(item.products?.name||'Laptop')}<div class="field-hint">QR ${esc(item.warranty_code)} · serial ${esc(item.serial_number||'—')}</div></td><td>${esc(sale?.customer_name||'—')}<div class="field-hint">${esc(sale?.receipt_number||'')}</div></td><td>${item.warranty_until?new Date(`${item.warranty_until}T00:00:00`).toLocaleDateString('id-ID'):'—'}</td><td><span class="pill ${expired?'warn':''}">${expired?'Berakhir':'Aktif'}</span></td><td><button class="small-btn" data-print-warranty-qr="${esc(item.id)}">Cetak QR</button></td></tr>`}).join('')||'<tr><td colspan="5"><div class="empty"><b>Belum ada QR garansi</b>Kode dan QR dibuat otomatis ketika laptop bergaransi berhasil terjual.</div></td></tr>'}</tbody></table></div></section><section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Klaim garansi</div><div class="panel-sub">Kelola status dan catatan klaim yang dicatat staf toko.</div></div></div><div class="table-wrap"><table><thead><tr><th>KLAIM / UNIT</th><th>PELANGGAN</th><th>KELUHAN</th><th>STATUS</th><th></th></tr></thead><tbody>${claims.map(claim=>`<tr><td class="product-name">${esc(claim.claim_number)}<div class="field-hint">${esc(claim.stock_items?.products?.name||'')}</div></td><td>${esc(claim.customer_name)}<div class="field-hint">${esc(claim.customer_phone)}</div></td><td>${esc(claim.issue)}</td><td><span class="pill ${claim.status==='rejected'?'warn':claim.status==='resolved'?'':'gray'}">${({submitted:'Diajukan',reviewing:'Ditinjau',approved:'Disetujui',rejected:'Ditolak',resolved:'Selesai'})[claim.status]||claim.status}</span></td><td><button class="small-btn" data-claim-detail="${claim.id}">Kelola</button></td></tr>`).join('')||'<tr><td colspan="5"><div class="empty">Belum ada klaim garansi.</div></td></tr>'}</tbody></table></div></section></div></div>`;
  const findWarrantyUnit = async (rawCode, target) => {
    const code=String(rawCode||'').trim().toUpperCase();
    target.innerHTML='<div class="empty">Mencari data garansi…</div>';
    if(!/^DLW-[a-zA-Z0-9_-]{8,80}$/.test(code)){target.innerHTML='<div class="notice error">Kode tidak valid. Gunakan QR garansi/kode yang diawali DLW-; barcode stok tidak bisa dipakai untuk cek garansi.</div>';return null}
    const result=await supabase.from('stock_items').select('id,warranty_code,barcode,supplier_barcode,serial_number,status,warranty_until,products(name,brand,model),sale_items(quantity,sales(receipt_number,customer_name,created_at))').eq('organization_id',state.organization.id).eq('warranty_code',code).maybeSingle();
    if(result.error){target.innerHTML=`<div class="notice error">${esc(result.error.message)}</div>`;return null}
    const item=result.data;
    if(!item){target.innerHTML='<div class="notice error">Unit dengan kode tersebut tidak ditemukan.</div>';return null}
    page.querySelector('#claim-form [name="code"]').value=item.warranty_code||'';
    const sale=item.sale_items?.[0]?.sales, expired=item.warranty_until&&new Date(`${item.warranty_until}T23:59:59`)<new Date(), covered=item.status==='sold'&&item.warranty_until&&!expired;
    target.innerHTML=`<div class="warranty-result"><span class="pill ${covered?'':item.status==='sold'?'warn':'gray'}">${item.status!=='sold'?'Belum terjual':!item.warranty_until?'Tidak ada garansi':expired?'Garansi berakhir':'Garansi aktif'}</span><h3>${esc(item.products?.name||'Produk')}</h3><p>${esc([item.products?.brand,item.products?.model].filter(Boolean).join(' · '))}</p><dl><dt>Kode QR garansi</dt><dd>${esc(item.warranty_code||'Belum dibuat')}</dd><dt>Nomor seri unit</dt><dd>${esc(item.serial_number||'—')}</dd><dt>Garansi sampai</dt><dd>${item.warranty_until?new Date(`${item.warranty_until}T00:00:00`).toLocaleDateString('id-ID'):'Tidak ada garansi'}</dd>${sale?`<dt>Pelanggan / nota</dt><dd>${esc(sale.customer_name||'—')} · ${esc(sale.receipt_number||'')}</dd><dt>Tanggal penjualan</dt><dd>${new Date(sale.created_at).toLocaleDateString('id-ID')}</dd>`:''}</dl>${item.warranty_code?'<button class="small-btn" type="button" data-print-lookup-qr>Cetak QR garansi</button>':''}</div>`;
    target.querySelector('[data-print-lookup-qr]')?.addEventListener('click',()=>printWarrantyQr(item));
    return item;
  };
  page.querySelector('#warranty-form').addEventListener('submit',async event=>{event.preventDefault();await findWarrantyUnit(new FormData(event.currentTarget).get('code'),page.querySelector('#warranty-result'))});
  page.querySelector('#scan-code').addEventListener('click',()=>startScanner(page.querySelector('#scanner'),page.querySelector('#warranty-form [name="code"]'),['qr_code']));
  page.querySelectorAll('[data-print-warranty-qr]').forEach(btn=>btn.addEventListener('click',()=>{const item=units.find(row=>row.id===btn.dataset.printWarrantyQr);if(item)printWarrantyQr(item)}));
  page.querySelector('#claim-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;try{const f=new FormData(event.currentTarget);const claim=checkError(await supabase.rpc('submit_warranty_claim',{_code:String(f.get('code')).trim(),_customer_name:String(f.get('customer_name')).trim(),_customer_phone:String(f.get('customer_phone')).trim(),_customer_email:String(f.get('customer_email')).trim(),_issue:String(f.get('issue')).trim()}));toast(`Klaim garansi tersimpan · ${claim}`);await showPage('warranty')}catch(error){page.querySelector('#claim-result').innerHTML=`<div class="notice error">${esc(error.message)}</div>`}finally{button.disabled=false}});
  page.querySelectorAll('[data-claim-detail]').forEach(btn=>btn.addEventListener('click',()=>{const claim=claims.find(c=>c.id===btn.dataset.claimDetail);openModal(`Kelola klaim ${claim.claim_number}`,'Catatan dan status hanya terlihat oleh tim toko.',`<div class="notice">${esc(claim.customer_name)} · ${esc(claim.customer_phone)}<br/>${esc(claim.issue)}</div><div class="form-grid"><div class="field"><label>Status klaim</label><select name="status">${[['submitted','Diajukan'],['reviewing','Ditinjau'],['approved','Disetujui'],['rejected','Ditolak'],['resolved','Selesai']].map(([v,l])=>`<option value="${v}" ${claim.status===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="field full"><label>Catatan tim</label><textarea name="staff_note" rows="3">${esc(claim.staff_note||'')}</textarea></div></div>`,async form=>{checkError(await supabase.from('warranty_claims').update({status:form.get('status'),staff_note:String(form.get('staff_note')).trim(),updated_at:new Date().toISOString()}).eq('id',claim.id));await showPage('warranty')},'Simpan status')}));
}

async function startScanner(host, input, formats = ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e', 'qr_code'], onDetected = () => input.form?.requestSubmit()) {
  if (!('BarcodeDetector' in window)) return toast('Browser ini belum mendukung scan barcode kamera. Masukkan kodenya manual.', true);
  let stream;
  try {
    const detector = new BarcodeDetector({ formats });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    if (!host.isConnected) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    host.innerHTML = '<div class="camera-wrap"><video autoplay playsinline muted></video></div><button class="small-btn" id="stop-scan">Tutup kamera</button>';
    const video = host.querySelector('video'); video.srcObject = stream;
    let active = true;
    const observer = new MutationObserver(() => { if (!video.isConnected) stop(); });
    const stop = () => {
      active = false;
      observer.disconnect();
      stream.getTracks().forEach(track => track.stop());
      host.innerHTML = '';
    };
    observer.observe(document.body, { childList: true, subtree: true });
    host.querySelector('#stop-scan').addEventListener('click', stop);
    const scan = async () => {
      if (!active) return;
      let values;
      try { values = await detector.detect(video); } catch {}
      if (!active) return;
      if (values?.length) {
        input.value = values[0].rawValue;
        stop();
        onDetected();
        return;
      }
      requestAnimationFrame(scan);
    };
    video.addEventListener('playing', scan, { once: true });
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    toast(error.message || 'Kamera tidak dapat dibuka.', true);
  }
}

function bindFinanceTablePages(table, rows, pageSize = 8) {
  if (rows.length <= pageSize) return;
  let current = 0;
  const pages = Math.ceil(rows.length / pageSize);
  const controls = document.createElement('nav');
  controls.className = 'finance-table-pages';
  controls.setAttribute('aria-label', 'Halaman rincian');
  controls.innerHTML = '<button type="button" class="small-btn">Sebelumnya</button><span role="status"></span><button type="button" class="small-btn">Berikutnya</button>';
  const [previous, next] = controls.querySelectorAll('button');
  const render = () => {
    rows.forEach((row, index) => { row.hidden = Math.floor(index / pageSize) !== current; });
    controls.querySelector('span').textContent = `Halaman ${current + 1} dari ${pages}`;
    previous.disabled = current === 0;
    next.disabled = current === pages - 1;
  };
  previous.addEventListener('click', () => { current--; render(); });
  next.addEventListener('click', () => { current++; render(); });
  table.after(controls);
  render();
}

function financeSummaryCard(key, label, amount, detail) {
  return `<button type="button" class="card unit-summary-button finance-summary-card" data-finance-metric="${key}">
    <span class="card-label">${label}<span aria-hidden="true">&rarr;</span></span>
    <span class="card-value">${amount}</span><span class="card-sub">${detail}</span>
  </button>`;
}

async function reportsPage(page) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const range = state.profile.role === 'operator' ? 'daily' : params.get('range') || 'daily';
  const requestedBranch = params.get('branch') || state.reportBranch;
  state.reportBranch = canManage() && state.branches.some((branch) => branch.id === requestedBranch) ? requestedBranch : 'all';
  const start = new Date();
  if (range === 'daily') { start.setDate(start.getDate() - 6); start.setHours(0,0,0,0); }
  else if (range === 'weekly') { start.setDate(start.getDate() - 55); start.setHours(0,0,0,0); }
  else if (range === 'monthly') { start.setMonth(start.getMonth() - 11, 1); start.setHours(0,0,0,0); }
  else { start.setFullYear(start.getFullYear() - 4, 0, 1); start.setHours(0,0,0,0); }

  let salesQuery = supabase.from('sales').select('id,branch_id,receipt_number,customer_name,total,paid_amount,payment_method,created_at,branches(name),sale_items(quantity,unit_price,line_total,products(cost_price),stock_items(acquisition_cost,stock_repairs(status,labor_cost,stock_repair_parts(cost))))').gte('created_at', start.toISOString()).order('created_at', { ascending: false });
  let cashQuery = supabase.from('cash_transactions').select('id,branch_id,direction,category,amount,description,source_type,created_at,branches(name)').gte('created_at', start.toISOString()).order('created_at', { ascending: false });
  let serviceQuery = supabase.from('service_tickets').select('id,branch_id,ticket_number,customer_name,final_cost,handed_over_at,branches(name),service_parts(cost)').eq('status','handed_over').gte('handed_over_at', start.toISOString()).order('handed_over_at', { ascending: false });
  if (canManage() && state.reportBranch && state.reportBranch !== 'all') {
    salesQuery = salesQuery.eq('branch_id', state.reportBranch); cashQuery = cashQuery.eq('branch_id', state.reportBranch); serviceQuery = serviceQuery.eq('branch_id', state.reportBranch);
  } else if (!canManage()) {
    salesQuery = salesQuery.eq('branch_id', state.profile.branch_id); cashQuery = cashQuery.eq('branch_id', state.profile.branch_id); serviceQuery = serviceQuery.eq('branch_id', state.profile.branch_id);
  }
  const [sales, cash, services] = await Promise.all([fetchAllRows(salesQuery), fetchAllRows(cashQuery), fetchAllRows(serviceQuery)]);
  let estimatedCostLines = 0, missingCostLines = 0;
  const saleRows = sales.map((sale) => {
    let cost = 0;
    for (const line of sale.sale_items || []) {
      const stock = line.stock_items;
      const unitCost = Number(stock?.acquisition_cost || 0) || Number(line.products?.cost_price || 0);
      if (Number(stock?.acquisition_cost || 0) <= 0 && unitCost > 0) estimatedCostLines++;
      if (unitCost <= 0) missingCostLines++;
      const repairCost = (stock?.stock_repairs || []).filter(repair => repair.status === 'completed').reduce((sum,repair) => sum + Number(repair.labor_cost || 0) + (repair.stock_repair_parts || []).reduce((partSum,part) => partSum + Number(part.cost || 0),0),0);
      cost += unitCost * Number(line.quantity || 0) + repairCost;
    }
    return { id:sale.id, branch_id:sale.branch_id, branch:sale.branches?.name, date:sale.created_at, kind:'Penjualan produk', label:sale.receipt_number, value:Number(sale.total), cost, profitImpact:Number(sale.total)-cost, direction:'income' };
  });
  const serviceRows = services.map((ticket) => {
    const cost = (ticket.service_parts || []).reduce((sum,part) => sum + Number(part.cost || 0),0);
    return { id:ticket.id, branch_id:ticket.branch_id, branch:ticket.branches?.name, date:ticket.handed_over_at, kind:'Servis selesai', label:ticket.ticket_number, value:Number(ticket.final_cost || 0), cost, profitImpact:Number(ticket.final_cost || 0)-cost, direction:'income' };
  });
  const otherIncomeCategory = 'Pemasukan lain';
  const excludedPurchasePayments = new Set(['Pembayaran pembelian','Pembayaran hutang supplier']);
  const cashRows = cash.map((entry) => {
    const purchasePayment = entry.direction === 'expense' && (excludedPurchasePayments.has(entry.category) || ['stock_repair_external_part','stock_repair'].includes(entry.source_type));
    const otherIncome = entry.direction === 'income' && entry.category === otherIncomeCategory;
    const operatingExpense = entry.direction === 'expense' && !purchasePayment;
    return { id:entry.id, branch_id:entry.branch_id, branch:entry.branches?.name, date:entry.created_at, kind:entry.category, label:entry.description || entry.category, value:Number(entry.amount), cost:0, profitImpact:otherIncome ? Number(entry.amount) : operatingExpense ? -Number(entry.amount) : 0, direction:entry.direction, purchasePayment };
  });
  const allRows = [...saleRows, ...serviceRows, ...cashRows];
  const periodKey = (dateValue) => {
    const date = new Date(dateValue);
    if (range === 'daily') return date.toLocaleDateString('sv-SE');
    if (range === 'weekly') {
      const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(utc.getUTCFullYear(),0,1));
      return `${utc.getUTCFullYear()}-W${String(Math.ceil((((utc-yearStart)/86400000)+1)/7)).padStart(2,'0')}`;
    }
    if (range === 'monthly') return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    return `${date.getFullYear()}`;
  };
  const buckets = new Map();
  for (const row of allRows) {
    const key = periodKey(row.date), bucket = buckets.get(key) || {key, sales:0, services:0, hpp:0, serviceCost:0, otherIncome:0, operatingExpense:0, cashIn:0, cashOut:0, count:0, rows:[]};
    if (row.kind === 'Penjualan produk') { bucket.sales += row.value; bucket.hpp += row.cost; }
    else if (row.kind === 'Servis selesai') { bucket.services += row.value; bucket.serviceCost += row.cost; }
    else if (row.direction === 'income') { bucket.cashIn += row.value; if (row.kind === otherIncomeCategory) bucket.otherIncome += row.value; }
    else { bucket.cashOut += row.value; if (!row.purchasePayment) bucket.operatingExpense += row.value; }
    bucket.count++; bucket.rows.push(row); buckets.set(key,bucket);
  }
  const sum = (key) => [...buckets.values()].reduce((total,bucket) => total + bucket[key],0);
  const salesTotal=sum('sales'), serviceTotal=sum('services'), hppTotal=sum('hpp')+sum('serviceCost'), expenseTotal=sum('operatingExpense'), otherIncomeTotal=sum('otherIncome');
  const grossProfit=salesTotal+serviceTotal-hppTotal, netProfit=grossProfit+otherIncomeTotal-expenseTotal;
  const rangeLabel = range === 'daily' ? '7 hari terakhir' : range === 'weekly' ? '8 minggu terakhir' : range === 'monthly' ? '12 bulan terakhir' : '5 tahun terakhir';
  const branchOptions = canManage() ? `<select id="report-branch" class="branch-select"><option value="all" ${state.reportBranch==='all'?'selected':''}>Semua cabang</option>${state.branches.map(branch=>`<option value="${branch.id}" ${state.reportBranch===branch.id?'selected':''}>${esc(branch.name)}</option>`).join('')}</select>` : '';
  page.innerHTML = `${header('Laporan laba & arus kas',`Rekap ${rangeLabel}. Laba memakai modal barang tersimpan dan belum memasukkan pembayaran hutang sebagai biaya baru.`,`<select id="report-range" class="branch-select"><option value="daily" ${range==='daily'?'selected':''}>Harian</option><option value="weekly" ${range==='weekly'?'selected':''}>Mingguan</option><option value="monthly" ${range==='monthly'?'selected':''}>Bulanan</option><option value="yearly" ${range==='yearly'?'selected':''}>Tahunan</option></select>${branchOptions}`)}
    <div class="cards report-summary">
      ${financeSummaryCard('sales', 'Omzet produk', money(salesTotal), `${sales.length} transaksi penjualan`)}
      ${financeSummaryCard('service', 'Omzet servis', money(serviceTotal), 'Servis yang sudah diserahkan')}
      ${financeSummaryCard('hpp', 'HPP terjual', money(hppTotal), 'Modal barang dan sparepart servis')}
      ${financeSummaryCard('net', 'Laba operasional (estimasi)', money(netProfit), `Biaya operasional ${money(expenseTotal)}`)}
    </div>
    <div class="cards cash-summary report-summary">
      ${financeSummaryCard('in', 'Kas masuk', money(sum('cashIn')), 'Uang diterima pada periode ini')}
      ${financeSummaryCard('out', 'Kas keluar', money(sum('cashOut')), 'Termasuk pembayaran pembelian stok')}
      ${financeSummaryCard('balance', 'Saldo kas bersih', money(sum('cashIn') - sum('cashOut')), 'Kas masuk dikurangi kas keluar')}
      ${financeSummaryCard('gross', 'Laba kotor', money(grossProfit), 'Sebelum biaya operasional')}
    </div>
    <details class="panel profit-note finance-profit-note"><summary>Perhitungan laba ${estimatedCostLines || missingCostLines ? '<span class="profit-warning">· Ada modal estimasi atau kosong</span>' : ''}</summary>
      <span>Laba kotor = omzet produk + omzet servis − HPP. Laba operasional = laba kotor + pemasukan lain − biaya operasional. Pembelian stok dan pembayaran hutang supplier tidak dihitung sebagai biaya sampai barangnya terjual.</span>
      ${estimatedCostLines || missingCostLines ? `<span class="profit-warning">${estimatedCostLines} baris memakai perkiraan modal katalog. ${missingCostLines} baris belum memiliki data modal.</span>` : '<span class="profit-ok">Seluruh barang terjual memiliki modal tercatat.</span>'}
    </details>
    <section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Rekap ${range==='daily'?'per hari':range==='weekly'?'per minggu':range==='monthly'?'per bulan':'per tahun'}</div><div class="panel-sub">Pilih periode untuk membuka transaksi, HPP, dan dampak labanya.</div></div></div><div class="table-wrap"><table><thead><tr><th>PERIODE</th><th>CATATAN</th><th>OMZET PRODUK</th><th>OMZET SERVIS</th><th>HPP</th><th>BIAYA OPERASIONAL</th><th>LABA OPERASIONAL</th><th>DETAIL</th></tr></thead><tbody>${[...buckets.values()].sort((a,b)=>b.key.localeCompare(a.key)).map(bucket=>`<tr><td class="product-name">${esc(bucket.key)}</td><td>${bucket.count}</td><td>${money(bucket.sales)}</td><td>${money(bucket.services)}</td><td>${money(bucket.hpp+bucket.serviceCost)}</td><td>${money(bucket.operatingExpense)}</td><td><b>${money(bucket.sales+bucket.services-bucket.hpp-bucket.serviceCost+bucket.otherIncome-bucket.operatingExpense)}</b></td><td><button class="small-btn" data-report-detail="${esc(bucket.key)}">Lihat detail</button></td></tr>`).join('')||'<tr><td colspan="8"><div class="empty">Belum ada transaksi pada periode ini.</div></td></tr>'}</tbody></table></div></section>`;
  let selectedPeriod = null;
  const printReport = document.createElement('button');
  printReport.type = 'button';
  printReport.className = 'btn';
  printReport.textContent = 'Cetak laporan';
  page.querySelector('.head-actions').append(printReport);
  printReport.addEventListener('click', () => {
    const branch = canManage() && state.reportBranch === 'all' ? 'Semua cabang' : branchName(canManage() ? state.reportBranch : state.profile.branch_id);
    const amounts = [salesTotal, serviceTotal, hppTotal, expenseTotal, netProfit];
    const tables = [...page.querySelectorAll('.table-panel')].map((panel, index) => {
      const copy = panel.querySelector('table').cloneNode(true);
      if (index === 0) {
        for (const row of copy.rows) {
          if (row.cells.length === 1) row.cells[0].colSpan = 7;
          else row.deleteCell(-1);
        }
        copy.classList.add('print-recap');
        if (buckets.size) {
          copy.createTFoot().innerHTML = `<tr><th scope="row">Total</th><td>${sum('count')}</td>${amounts.map(amount => `<td>${money(amount)}</td>`).join('')}</tr>`;
        }
      } else {
        copy.classList.add('print-detail');
      }
      return `<section><h3>${esc(panel.querySelector('.panel-title').textContent)}</h3>${copy.outerHTML}</section>`;
    }).join('') + (selectedPeriod ? `<section><h3>Rincian ${esc(selectedPeriod.key)}</h3>${reportFinanceTable(selectedPeriod.rows, 'detail', 'print-detail')}</section>` : '');
    const summary = [
      ['Kas masuk', sum('cashIn')],
      ['Kas keluar', sum('cashOut')],
      ['Saldo kas bersih', sum('cashIn') - sum('cashOut')],
      ['Laba operasional (estimasi)', netProfit],
    ];
    const costNote = estimatedCostLines || missingCostLines
      ? `<p class="print-note">${estimatedCostLines} baris memakai perkiraan modal katalog. ${missingCostLines} baris terjual belum memiliki data modal sehingga laba dapat terlihat lebih tinggi.</p>`
      : '';
    printDocument('Laporan laba & arus kas', `<main class="print-report">
      <header><img src="${esc(new URL('/store-logo-transparent.png', location.origin).href)}" width="48" height="48" alt="" />
        <div><strong>${esc(state.organization.name)}</strong><h1>Laporan laba &amp; arus kas</h1>
        <p>${esc(branch)} · ${esc(rangeLabel)} · Dicetak ${esc(new Date().toLocaleDateString('id-ID'))}</p></div>
      </header>
      <dl>${summary.map(([label, amount]) => `<div><dt>${label}</dt><dd>${money(amount)}</dd></div>`).join('')}</dl>
      ${tables}${costNote}
    </main>`, 'report', `
      .print-report{max-width:1100px;margin:14px auto}
      .print-report header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #214e3a;padding:0 0 9px}
      .print-report header img{flex:none;object-fit:contain}
      .print-report h1{font-size:20px;margin:0}
      .print-report header p,.print-note{margin:3px 0;color:#39463f}
      .print-report dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:12px 0}
      .print-report dl div{border:1px solid #aebdb2;padding:6px 8px;overflow-wrap:anywhere}
      .print-report dl div+div{border-left:0}
      .print-report dd{margin:2px 0 0;font-weight:700;font-variant-numeric:tabular-nums}
      .print-report h3{margin:12px 0 4px;font-size:13px;break-after:avoid}
      .print-report th,.print-report td{border:1px solid #aebdb2;padding:5px 6px}
      .print-report thead th{background:#e0ebe3;color:#183a2b;font-size:10px}
      .print-report tbody tr:nth-child(even){background:#f1f5f2}
      .print-recap :is(th,td):nth-child(n+2),.print-detail :is(th,td):nth-child(n+5){text-align:right;font-variant-numeric:tabular-nums}
      .print-recap tfoot{display:table-row-group;background:#e0ebe3;font-weight:700}
      .print-recap td[colspan]{text-align:center;padding:14px}
      .print-report header,.print-report dl{break-inside:avoid}
      .print-note{margin-top:8px;font-size:10px}
      @media print{.print-report{margin:0;max-width:none;font-size:10px;print-color-adjust:exact}.print-report th,.print-report td{padding:4px}}
    `);
  });
  if (state.profile.role === 'operator') page.querySelector('#report-range').disabled = true;
  page.querySelector('#report-range').addEventListener('change',event=>{location.hash=`reports?range=${event.target.value}&branch=${state.reportBranch||'all'}`;showPage('reports')});
  page.querySelector('#report-branch')?.addEventListener('change',event=>{state.reportBranch=event.target.value;location.hash=`reports?range=${range}&branch=${state.reportBranch}`;showPage('reports')});
  const cashIn = cashRows.filter((row) => row.direction === 'income');
  const cashOut = cashRows.filter((row) => row.direction === 'expense');
  const turnoverRows = [...saleRows, ...serviceRows];
  const metrics = {
    sales: ['Omzet produk', saleRows, 'turnover', [['Omzet produk', salesTotal]]],
    service: ['Omzet servis', serviceRows, 'turnover', [['Omzet servis', serviceTotal]]],
    hpp: ['HPP terjual', turnoverRows, 'cost', [['HPP produk', sum('hpp')], ['Biaya sparepart servis', sum('serviceCost')], ['Total HPP', hppTotal]]],
    net: ['Laba operasional (estimasi)', [...turnoverRows, ...cashRows.filter((row) => row.profitImpact !== 0)], 'detail',
      [['Laba kotor', grossProfit], ['Pemasukan lain', otherIncomeTotal], ['Biaya operasional', expenseTotal], ['Laba operasional', netProfit]]],
    in: ['Kas masuk', cashIn, 'cash', [['Total kas masuk', sum('cashIn')]]],
    out: ['Kas keluar', cashOut, 'cash', [['Total kas keluar', sum('cashOut')]]],
    balance: ['Saldo kas bersih', cashRows, 'cash', [['Kas masuk', sum('cashIn')], ['Kas keluar', sum('cashOut')], ['Saldo kas bersih', sum('cashIn') - sum('cashOut')]]],
    gross: ['Laba kotor', turnoverRows, 'detail', [['Omzet produk', salesTotal], ['Omzet servis', serviceTotal], ['HPP', hppTotal], ['Laba kotor', grossProfit]]],
  };
  const reportBranch = canManage() && state.reportBranch === 'all' ? 'Semua cabang' : branchName(canManage() ? state.reportBranch : state.profile.branch_id);
  page.querySelectorAll('[data-finance-metric]').forEach((button) => button.addEventListener('click', () => {
    const [title, rows, mode, totals] = metrics[button.dataset.financeMetric];
    openReportFinanceDetail(title, `${reportBranch} · ${rangeLabel}`, rows, mode, totals);
  }));
  page.querySelectorAll('[data-report-detail]').forEach((button) => button.addEventListener('click', () => {
    selectedPeriod = buckets.get(button.dataset.reportDetail);
    openReportFinanceDetail(`Rincian ${selectedPeriod.key}`, reportBranch, selectedPeriod.rows, 'detail');
  }));
}

function reportFinanceTable(rows, mode, tableClass = '') {
  const showValue = mode !== 'cost';
  const showCost = mode === 'cost' || mode === 'detail';
  const showImpact = mode === 'detail';
  const ordered = [...rows].sort((a, b) => new Date(b.date) - new Date(a.date));
  return `<table class="${tableClass}"><thead><tr><th>Waktu</th><th>Jenis</th><th>Nota / keterangan</th><th>Cabang</th>
    ${showValue ? '<th>Nominal</th>' : ''}${showCost ? '<th>HPP / biaya</th>' : ''}${showImpact ? '<th>Dampak laba</th>' : ''}</tr></thead>
    <tbody>${ordered.map((row) => `<tr><td>${new Date(row.date).toLocaleString('id-ID')}</td><td>${esc(row.kind)}</td>
      <td>${esc(row.label || '-')}${mode === 'cash' ? `<div class="field-hint">${row.direction === 'income' ? 'Masuk' : 'Keluar'}</div>` : ''}
      ${row.purchasePayment && mode === 'detail' ? '<div class="field-hint">Pembayaran stok tidak dihitung sebagai biaya laba.</div>' : ''}</td><td>${esc(row.branch || branchName(row.branch_id))}</td>
      ${showValue ? `<td>${money(row.value)}</td>` : ''}${showCost ? `<td>${money(row.cost)}</td>` : ''}
      ${showImpact ? `<td>${money(row.profitImpact)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}

function openReportFinanceDetail(title, context, rows, mode, totals = []) {
  const summary = totals.length ? `<dl class="finance-detail-totals">${totals.map(([label, amount]) =>
    `<div><dt>${label}</dt><dd>${money(amount)}</dd></div>`).join('')}</dl>` : '';
  const host = openModal(esc(title), esc(context), `${summary}${rows.length
    ? `<div class="table-wrap finance-detail-table">${reportFinanceTable(rows, mode)}</div>`
    : '<div class="empty">Belum ada catatan untuk pilihan ini.</div>'}`, null);
  const table = host.querySelector('.finance-detail-table');
  if (table) bindFinanceTablePages(table, [...table.querySelectorAll('tbody tr')]);
}

async function teamAdminRequest(payload) {
  const { data, error } = await supabase.functions.invoke('team-users', { body: payload });
  if (error) {
    let message = error.message || 'Permintaan pengelolaan akun gagal.';
    try { const response = await error.context?.json(); if (response?.error) message = response.error; } catch {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

function teamUserModal(user = null) {
  const editing = Boolean(user);
  openModal(editing ? 'Edit akun tim' : 'Tambah akun tim', editing ? 'Ubah role, cabang, email, atau password anggota.' : 'Buat akun Admin Pusat, Operator, Teknisi, atau Investor. Anggota bisa masuk memakai email dan password ini.', `<div class="form-grid"><div class="field"><label>Nama lengkap</label><input name="full_name" value="${esc(user?.full_name || '')}" required minlength="2" /></div><div class="field"><label>Email</label><input name="email" type="email" value="${esc(user?.email || '')}" required /></div><div class="field"><label>Role</label><select name="role" required><option value="central_admin" ${user?.role === 'central_admin' ? 'selected' : ''}>Admin Pusat</option><option value="operator" ${user?.role === 'operator' ? 'selected' : ''}>Operator · kasir + servis</option><option value="technician" ${user?.role === 'technician' ? 'selected' : ''}>Teknisi</option><option value="investor" ${user?.role === 'investor' ? 'selected' : ''}>Investor · baca saja</option></select></div>${branchField('branch_id', user?.branch_id || state.branchId)}<div class="field full"><label>Password ${editing ? '(kosongkan jika tidak diganti)' : ''}</label><input name="password" type="password" minlength="8" ${editing ? '' : 'required'} autocomplete="new-password" placeholder="Minimal 8 karakter" /></div></div>`, async (form) => {
    const payload = { action: editing ? 'update' : 'create', id: user?.id, full_name: String(form.get('full_name')).trim(), email: String(form.get('email')).trim().toLowerCase(), password: String(form.get('password')), role: String(form.get('role')), branch_id: String(form.get('branch_id')) };
    await teamAdminRequest(payload);
    toast(editing ? 'Akun tim berhasil diperbarui.' : 'Akun berhasil dibuat dan siap digunakan.');
    await showPage('branches');
  }, editing ? 'Simpan perubahan' : 'Buat akun');
}

async function branchesPage(page) {
  const users = canManage() ? (await teamAdminRequest({action:'list'})).users || [] : [];
  page.innerHTML = `${header('Pengaturan Aplikasi', 'Kelola identitas toko, cabang, operator, printer, dan cadangan data.', canManage() ? '<button class="btn" id="new-branch">＋ Cabang</button><button class="btn primary" id="add-team-member">＋ Tambah akun</button>' : '')}<section class="panel" style="margin-bottom:14px;padding:16px"><div class="panel-head"><div><div class="panel-title">Identitas toko untuk nota</div><div class="panel-sub">Informasi ini dipakai sebagai identitas default pada nota transaksi.</div></div><button class="btn primary" id="save-store-settings">Simpan identitas</button></div><div class="form-grid"><div class="field"><label>Nama toko</label><input id="store-name" value="${esc(state.organization.name||'')}" /></div><div class="field"><label>Nomor telepon</label><input id="store-phone" value="${esc(state.organization.phone||'')}" /></div><div class="field full"><label>Alamat toko</label><input id="store-address" value="${esc(state.organization.address||'')}" /></div></div><div class="form-grid" style="margin-top:14px"><div class="panel" style="padding:14px"><b>Printer barcode & nota</b><p class="field-hint">Simpan preferensi ukuran label di perangkat ini. Printer dipilih dan dipasangkan lewat pengaturan Windows, lalu dipilih pada dialog cetak.</p><button class="btn" id="printer-test">Pengaturan printer</button> <button class="btn" id="label-settings">Atur ukuran & pratinjau barcode</button></div><div class="panel" style="padding:14px"><b>Cadangan dan pemulihan data</b><p class="field-hint">Versi terbaru mencakup stok awal, penerimaan, servis, penjualan, keuangan, serta mutasi antar cabang. Foto dan lampiran tetap berupa tautan metadata, bukan salinan file. Pemulihan hanya ke organisasi ini dan menggabungkan data tanpa menghapus catatan yang sudah ada.</p><button class="btn" id="backup-download">Unduh cadangan</button> <label class="btn">Pulihkan cadangan<input id="backup-upload" type="file" accept="application/json,.json" hidden /></label></div></div></section><section class="panel" style="margin-bottom:14px;padding:16px"><div class="panel-head"><div><div class="panel-title">Akun pemilik</div><div class="panel-sub">Email admin utama: admin@digital.laptop</div></div></div><form id="owner-account-form" class="form-grid"><div class="field"><label>Email admin (tetap)</label><input name="email" type="email" value="admin@digital.laptop" readonly autocomplete="email" /></div><div class="field"><label>Password baru (opsional)</label><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Minimal 8 karakter" /></div><div class="field full"><button class="btn primary" type="submit">Simpan email admin & password</button></div></form><p class="field-hint">Email admin ditetapkan ke admin@digital.laptop dan diterapkan langsung tanpa konfirmasi email. Isi password baru untuk menggantinya; kosongkan jika tidak ingin mengubah password.</p></section><div class="settings-stack"><section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Cabang toko</div><div class="panel-sub">Cabang tersedia untuk pemilik dan operator terdaftar</div></div></div><div class="table-wrap"><table><thead><tr><th>NAMA CABANG</th><th>KOTA</th><th>ALAMAT</th><th>STATUS</th><th>AKSI</th></tr></thead><tbody>${state.branches.map((branch) => `<tr><td class="product-name">${esc(branch.name)}</td><td>${esc(branch.city || '—')}</td><td>${esc(branch.address || '—')}</td><td><span class="pill">Aktif</span></td><td><button type="button" class="small-btn" data-edit-branch="${branch.id}">Edit</button> <button type="button" class="small-btn" data-delete-branch="${branch.id}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="5">Belum ada cabang.</td></tr>'}</tbody></table></div></section><section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Anggota tim</div><div class="panel-sub">Setiap anggota hanya melihat data operasional cabangnya.</div></div></div><div class="table-wrap"><table class="team-table"><thead><tr><th>NAMA / EMAIL</th><th>ROLE</th><th>CABANG</th><th>AKSI</th></tr></thead><tbody>${users.map((user) => `<tr><td class="product-name">${esc(user.full_name || '—')}<div class="field-hint">${esc(user.email || 'Email tidak tersedia')}</div></td><td><span class="pill ${user.role === 'owner' ? 'blue' : ''}">${staffRoleLabel(user.role)}</span></td><td>${esc(branchName(user.branch_id))}</td><td>${user.role === 'owner' ? '<span class="field-hint">Atur dari kartu akun pemilik</span>' : `<button class="small-btn" data-edit-team-user="${user.id}">Edit</button> <button class="small-btn" data-delete-team-user="${user.id}">Hapus</button>`}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">Belum ada akun operator atau QC.</div></td></tr>'}</tbody></table></div></section></div>`;
  page.querySelector('#save-store-settings')?.addEventListener('click',async()=>{const button=page.querySelector('#save-store-settings');button.disabled=true;try{const result=await supabase.from('organizations').update({name:page.querySelector('#store-name').value.trim(),phone:page.querySelector('#store-phone').value.trim(),address:page.querySelector('#store-address').value.trim()}).eq('id',state.organization.id);if(result.error)throw result.error;state.organization={...state.organization,name:page.querySelector('#store-name').value.trim(),phone:page.querySelector('#store-phone').value.trim(),address:page.querySelector('#store-address').value.trim()};document.querySelector('.crumb').firstChild.textContent=state.organization.name+' / ';toast('Identitas toko disimpan.')}catch(error){toast(error.message,true)}finally{button.disabled=false}});
  page.querySelector('#owner-account-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const email = 'admin@digital.laptop'; const password = String(values.get('password')); if (email === String(state.user.email || '').toLowerCase() && !password) return toast('Email admin sudah tetap dan tidak ada password baru yang dimasukkan.', true); const button = form.querySelector('button[type="submit"]'); button.disabled = true; try { await teamAdminRequest({ action: 'update-owner-account', email, password }); state.user = { ...state.user, email }; toast('Email dan password akun pemilik berhasil diperbarui langsung.'); form.reset(); await showPage('branches'); } catch (error) { toast(error.message || 'Tidak bisa memperbarui akun pemilik.', true); } finally { button.disabled = false; } });
  page.querySelector('#label-settings')?.addEventListener('click',()=>printBarcodeLabels([{barcode:'DL-TEST-000001',supplier:'Contoh supplier',products:{name:'Laptop contoh',sku:'DL-TEST',category:'Laptop'}}]));
  page.querySelector('#printer-test')?.addEventListener('click', printerSettings);
  page.querySelector('#backup-download')?.addEventListener('click',async()=>{const btn=page.querySelector('#backup-download');btn.disabled=true;try{const names=['branches','products','suppliers','customers','intake_batches','stock_opening_batches','stock_items','stock_repairs','stock_repair_parts','sales','sale_items','stock_transfers','stock_transfer_items','service_tickets','service_parts','cash_transactions','stock_movements','warranty_claims'];const data={format:'digi-laptop-backup',version:2,organization_id:state.organization.id,organization:{name:state.organization.name,phone:state.organization.phone,address:state.organization.address},created_at:new Date().toISOString(),tables:{}};for(const name of names){let query=supabase.from(name).select('*');if(name==='sale_items'){const ids=(data.tables.sales||[]).map(r=>r.id);data.tables[name]=ids.length?await fetchAllRows(supabase.from(name).select('*').in('sale_id',ids)):[];continue}if(name==='stock_repair_parts'){const ids=(data.tables.stock_repairs||[]).map(r=>r.id);data.tables[name]=ids.length?await fetchAllRows(supabase.from(name).select('*').in('repair_id',ids)):[];continue}try{data.tables[name]=await fetchAllRows(query.eq('organization_id',state.organization.id))}catch(error){throw new Error(`${name}: ${error.message}`)}}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=`digi-laptop-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);toast('Cadangan operasional berhasil diunduh.')}catch(error){toast(`Cadangan gagal dibuat: ${error.message}`,true)}finally{btn.disabled=false}});
  page.querySelector('#backup-upload')?.addEventListener('change',async(event)=>{const file=event.target.files?.[0];if(!file)return;try{const backup=JSON.parse(await file.text());if(backup.format!=='digi-laptop-backup'||![1,2].includes(backup.version)||backup.organization_id!==state.organization.id)throw new Error('File bukan cadangan Digi-Laptop untuk organisasi ini.');const {data,error}=await supabase.rpc('restore_digi_laptop_backup',{_backup:backup});if(error)throw new Error(error.message);toast(`${Number(data)||0} baris dipulihkan. Data digabung tanpa menghapus catatan yang sudah ada.`);await afterAuth()}catch(error){toast(`Pemulihan berhenti: ${error.message}`,true)}finally{event.target.value=''}});
  const editBranch = (branch = null) => openModal(branch ? 'Edit cabang' : 'Tambah cabang', 'Isi identitas cabang toko.', `<div class="form-grid"><div class="field"><label>Nama cabang</label><input name="name" value="${esc(branch?.name || '')}" required /></div><div class="field"><label>Kota</label><input name="city" value="${esc(branch?.city || '')}" /></div><div class="field full"><label>Alamat</label><input name="address" value="${esc(branch?.address || '')}" /></div></div>`, async (form) => {
    const values = Object.fromEntries(['name', 'city', 'address'].map((key) => [key, String(form.get(key)).trim()]));
    if (!values.name) throw new Error('Nama cabang wajib diisi.');
    const table = supabase.from('branches');
    const query = branch
      ? table.update(values).eq('id', branch.id).eq('organization_id', state.organization.id).eq('is_active', true)
      : table.insert({ ...values, organization_id: state.organization.id });
    const result = await query.select('*').single();
    if (result.error?.code === '23505') throw new Error('Nama cabang sudah dipakai.');
    const saved = checkError(result);
    state.branches = [...state.branches.filter((item) => item.id !== saved.id), saved].sort((first, second) => first.name.localeCompare(second.name, 'id'));
    showShell();
    await showPage('branches');
    toast('Cabang disimpan.');
  }, 'Simpan cabang');
  page.querySelector('#new-branch')?.addEventListener('click', () => editBranch());
  page.querySelectorAll('[data-edit-branch]').forEach((button) => button.addEventListener('click', () => {
    editBranch(state.branches.find((branch) => branch.id === button.dataset.editBranch));
  }));
  page.querySelectorAll('[data-delete-branch]').forEach((button) => button.addEventListener('click', () => {
    const branch = state.branches.find((item) => item.id === button.dataset.deleteBranch);
    openModal('Hapus cabang dari daftar aktif?', `${esc(branch.name)} akan dinonaktifkan. Riwayat stok dan transaksi tetap tersimpan.`, '<div class="field"><label for="branch-access-code">Kode akses tambahan</label><input id="branch-access-code" name="access_code" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="off" required /></div>', async (form) => {
      checkError(await supabase.rpc('deactivate_branch', { _branch_id: branch.id, _code: form.get('access_code') }));
      await afterAuth();
      toast('Cabang dinonaktifkan.');
    }, 'Hapus cabang');
  }));
  page.querySelector('#add-team-member')?.addEventListener('click',()=>teamUserModal());
  page.querySelectorAll('[data-edit-team-user]').forEach(button=>button.addEventListener('click',()=>teamUserModal(users.find(user=>user.id===button.dataset.editTeamUser))));
  page.querySelectorAll('[data-delete-team-user]').forEach(button=>button.addEventListener('click',async()=>{const user=users.find(row=>row.id===button.dataset.deleteTeamUser);if(!user||user.role==='owner')return;if(!confirm(`Hapus akun ${user.full_name} (${user.email})? Akun ini tidak bisa masuk lagi.`))return;button.disabled=true;try{await teamAdminRequest({action:'delete',id:user.id});toast('Akun berhasil dihapus.');await showPage('branches')}catch(error){toast(error.message,true);button.disabled=false}}));
}

function supplierInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? `${words[0][0]}${words[1][0]}`.toUpperCase() : (words[0] || 'SUP').slice(0, 2).toUpperCase();
}

async function contactsPage(page, type) {
  const supplierMode = type === 'suppliers';
  const table = supplierMode ? 'suppliers' : 'customers';
  const visibleBranch = state.profile.role === 'owner' ? state.branchId : state.profile.branch_id;
  let batchesQuery = supabase.from('intake_batches').select('id,branch_id,supplier,supplier_id,invoice_number,total_amount,amount_paid,due_date,created_at,suppliers(name),branches(name)').order('created_at', { ascending: false });
  let salesQuery = supabase.from('sales').select('id,branch_id,customer_id,receipt_number,customer_name,total,paid_amount,due_date,customers(name),branches(name),created_at').order('created_at', { ascending: false });
  let serviceQuery = supabase.from('service_tickets').select('id,branch_id,customer_id,ticket_number,customer_name,customer_phone,final_cost,paid_amount,due_date,status,branches(name),created_at').order('created_at', { ascending: false });
  if (state.profile.role !== 'owner') { batchesQuery = batchesQuery.eq('branch_id', visibleBranch); salesQuery = salesQuery.eq('branch_id', visibleBranch); serviceQuery = serviceQuery.eq('branch_id', visibleBranch); }
  const [suppliers, customers, batches, sales, serviceTickets] = await Promise.all([
    fetchAllRows(supabase.from('suppliers').select('id,name,initials,phone,address,notes,created_at').order('name')),
    fetchAllRows(supabase.from('customers').select('id,name,phone,email,address,notes,customer_type,created_at').order('name')),
    fetchAllRows(batchesQuery), fetchAllRows(salesQuery), fetchAllRows(serviceQuery),
  ]);
  const rowsData = supplierMode ? suppliers : customers;
  const payables = batches.filter((batch) => Number(batch.total_amount) > Number(batch.amount_paid)).map((batch) => ({ ...batch, remaining: Number(batch.total_amount)-Number(batch.amount_paid) }));
  const matchesSupplier = (batch, supplier) => batch.supplier_id ? batch.supplier_id === supplier.id : String(batch.supplier || '').trim().toLowerCase() === supplier.name.trim().toLowerCase();
  const matchesCustomer = (entry, customer) => {
    if (entry.customer_id) return entry.customer_id === customer.id;
    if (String(entry.customer_name || '').trim().toLowerCase() === customer.name.trim().toLowerCase()) return true;
    const contactPhone = String(customer.phone || '').replace(/\D/g, '');
    const entryPhone = String(entry.customer_phone || '').replace(/\D/g, '');
    return contactPhone.length >= 8 && entryPhone.length >= 8 && (contactPhone.endsWith(entryPhone.slice(-8)) || entryPhone.endsWith(contactPhone.slice(-8)));
  };
  const receivables = [
    ...sales.filter((sale) => Number(sale.total) > Number(sale.paid_amount)).map((sale) => ({ ...sale, source_type: 'sale', label: sale.receipt_number, total_due: Number(sale.total), paid: Number(sale.paid_amount) })),
    ...serviceTickets.filter((ticket) => ticket.status === 'handed_over' && Number(ticket.final_cost) > Number(ticket.paid_amount)).map((ticket) => ({ ...ticket, source_type: 'service_ticket', label: ticket.ticket_number, total_due: Number(ticket.final_cost), paid: Number(ticket.paid_amount) })),
  ].map((entry) => ({ ...entry, remaining: entry.total_due-entry.paid }));
  const rows = (rowsData || []).map((item) => {
    const relatedDebt = supplierMode ? payables.filter((batch) => matchesSupplier(batch, item)) : receivables.filter((entry) => matchesCustomer(entry, item));
    const balance = relatedDebt.reduce((sum, entry) => sum + entry.remaining, 0);
    return `<tr class="contact-row" data-contact-detail="${item.id}"><td class="product-name">${supplierMode ? `<span class="pill blue">${esc(item.initials)}</span> ` : ''}<button class="contact-open" type="button" data-open-contact="${item.id}">${esc(item.name)}<span>Detail →</span></button></td><td>${esc(item.phone || '—')}</td>${supplierMode ? `<td>${esc(item.address || '—')}</td>` : `<td>${esc(item.email || '—')}</td>`}<td><b>${money(balance)}</b></td>${canManage() ? `<td><div class="actions-cell"><button class="small-btn" type="button" data-edit-contact="${item.id}">Edit</button><button class="small-btn" type="button" data-delete-contact="${item.id}">Hapus</button></div></td>` : ''}</tr>`;
  }).join('');
  const contactsTabs = `<div class="contact-tabs"><button class="contact-tab${supplierMode ? ' active' : ''}" data-contact-tab="suppliers">Supplier <span>${suppliers.length}</span></button><button class="contact-tab${!supplierMode ? ' active' : ''}" data-contact-tab="customers">Pelanggan <span>${customers.length}</span></button></div>`;
  const supplierDebt = supplierMode ? `<section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Hutang supplier</div><div class="panel-sub">Sisa tagihan dihitung dari total invoice dikurangi pembayaran yang sudah dicatat.</div></div></div><div class="table-wrap"><table><thead><tr><th>SUPPLIER / NOTA</th><th>CABANG</th><th>TOTAL TAGIHAN</th><th>DIBAYAR</th><th>SISA HUTANG</th><th>JATUH TEMPO</th><th></th></tr></thead><tbody>${payables.map((batch) => `<tr><td class="product-name">${esc(batch.suppliers?.name || batch.supplier || 'Supplier')}<div class="field-hint">${esc(batch.invoice_number || batch.id.slice(0,8).toUpperCase())}</div></td><td>${esc(batch.branches?.name || branchName(batch.branch_id))}</td><td>${money(batch.total_amount)}</td><td>${money(batch.amount_paid)}</td><td><b>${money(batch.remaining)}</b></td><td>${batch.due_date ? new Date(`${batch.due_date}T00:00:00`).toLocaleDateString('id-ID') : '—'}</td><td><button class="small-btn" data-pay-batch="${batch.id}">Bayar</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Belum ada hutang supplier terbuka.</div></td></tr>'}</tbody></table></div></section>` : `<section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Piutang pelanggan</div><div class="panel-sub">Sisa pembayaran penjualan dan servis untuk pelanggan.</div></div></div><div class="table-wrap"><table><thead><tr><th>PELANGGAN / NOTA</th><th>CABANG</th><th>TOTAL</th><th>DIBAYAR</th><th>SISA PIUTANG</th><th>JATUH TEMPO</th><th></th></tr></thead><tbody>${receivables.map((entry) => `<tr><td class="product-name">${esc(entry.customers?.name || entry.customer_name || 'Pelanggan')}<div class="field-hint">${esc(entry.label)} · ${entry.source_type === 'sale' ? 'Penjualan' : 'Servis'}</div></td><td>${esc(entry.branches?.name || branchName(entry.branch_id))}</td><td>${money(entry.total_due)}</td><td>${money(entry.paid)}</td><td><b>${money(entry.remaining)}</b></td><td>${entry.due_date ? new Date(`${entry.due_date}T00:00:00`).toLocaleDateString('id-ID') : '—'}</td><td><button class="small-btn" data-collect-contact="${entry.id}" data-source="${entry.source_type}">Terima</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Belum ada piutang pelanggan terbuka.</div></td></tr>'}</tbody></table></div></section>`;
  const totalDebt = supplierMode ? payables.reduce((sum, batch) => sum + batch.remaining, 0) : 0;
  const totalReceivable = supplierMode ? 0 : receivables.reduce((sum, entry) => sum + entry.remaining, 0);
  page.innerHTML = `${header('Pelanggan & supplier', 'Satu tempat untuk kontak, barcode supplier, dan saldo tagihan.', `<button class="btn primary" id="new-contact">＋ Tambah ${supplierMode ? 'supplier' : 'pelanggan'}</button>`)}${contactsTabs}<section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Daftar ${supplierMode ? 'supplier' : 'pelanggan'}</div><div class="panel-sub">${(rowsData || []).length} kontak tersimpan · ${supplierMode ? `total hutang terbuka ${money(totalDebt)}` : `total piutang terbuka ${money(totalReceivable)}`} · pilih nama untuk detail</div></div><input class="search" id="contact-search" placeholder="Cari nama atau telepon" /></div><div class="table-wrap"><table><thead><tr><th>NAMA</th><th>TELEPON</th><th>${supplierMode ? 'ALAMAT' : 'EMAIL'}</th><th>${supplierMode ? 'SISA HUTANG' : 'SISA PIUTANG'}</th>${canManage() ? '<th>AKSI</th>' : ''}</tr></thead><tbody id="contact-rows">${rows || `<tr><td colspan="${canManage() ? 5 : 4}"><div class="empty"><b>Belum ada ${supplierMode ? 'supplier' : 'pelanggan'}</b>Tambahkan kontak untuk menghubungkan transaksi dan tagihan.</div></td></tr>`}</tbody></table></div></section>${supplierDebt}`;
  page.querySelectorAll('[data-contact-tab]').forEach((button) => button.addEventListener('click', async () => { state.contactTab = button.dataset.contactTab; await contactsPage(page, state.contactTab); }));
  page.querySelector('#contact-search').addEventListener('input', (event) => { const query = event.target.value.toLowerCase(); page.querySelectorAll('#contact-rows tr').forEach((row) => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(query))); });
  page.querySelectorAll('[data-open-contact]').forEach((button) => button.addEventListener('click', () => {
    const contact = rowsData.find((row) => row.id === button.dataset.openContact);
    if (!contact) return;
    const relatedBatches = supplierMode ? batches.filter((batch) => matchesSupplier(batch, contact)) : [];
    const relatedSales = supplierMode ? [] : sales.filter((sale) => matchesCustomer(sale, contact));
    const contactPhoneDigits = String(contact.phone || '').replace(/\D/g, '');
    const relatedServices = supplierMode ? [] : serviceTickets.filter((ticket) => {
      if (ticket.customer_id === contact.id || ticket.customer_name.trim().toLowerCase() === contact.name.trim().toLowerCase()) return true;
      const ticketPhoneDigits = String(ticket.customer_phone || '').replace(/\D/g, '');
      return contactPhoneDigits.length >= 8 && ticketPhoneDigits.length >= 8 && (ticketPhoneDigits.endsWith(contactPhoneDigits.slice(-8)) || contactPhoneDigits.endsWith(ticketPhoneDigits.slice(-8)));
    });
    const relatedReceivables = receivables.filter((entry) => matchesCustomer(entry, contact) || relatedServices.some((ticket) => ticket.id === entry.id));
    const balance = supplierMode ? relatedBatches.reduce((sum, batch) => sum + Math.max(0, Number(batch.total_amount)-Number(batch.amount_paid)), 0) : relatedReceivables.reduce((sum, entry) => sum + entry.remaining, 0);
    const records = supplierMode
      ? relatedBatches.map((batch) => ({ id: batch.id, source: 'intake_batch', label: batch.invoice_number || `Batch ${batch.id.slice(0,8).toUpperCase()}`, branch: batch.branches?.name || branchName(batch.branch_id), date: batch.created_at, total: Number(batch.total_amount), paid: Number(batch.amount_paid), remaining: Math.max(0, Number(batch.total_amount)-Number(batch.amount_paid)), due: batch.due_date }))
      : [...relatedSales.map((sale) => ({ id: sale.id, source: 'sale', label: sale.receipt_number, branch: sale.branches?.name || branchName(sale.branch_id), date: sale.created_at, total: Number(sale.total), paid: Number(sale.paid_amount), remaining: Math.max(0, Number(sale.total)-Number(sale.paid_amount)), due: sale.due_date })), ...relatedServices.map((ticket) => ({ id: ticket.id, source: 'service_ticket', label: ticket.ticket_number, branch: ticket.branches?.name || branchName(ticket.branch_id), date: ticket.created_at, total: Number(ticket.final_cost), paid: Number(ticket.paid_amount), remaining: Math.max(0, Number(ticket.final_cost)-Number(ticket.paid_amount)), due: ticket.due_date, status: ticket.status }))].sort((a,b) => new Date(b.date)-new Date(a.date));
    const recordRows = records.map((record) => `<tr><td class="product-name">${esc(record.label)}<div class="field-hint">${new Date(record.date).toLocaleDateString('id-ID')} · ${esc(record.branch)}${record.status ? ` · ${esc(statusText[record.status] || record.status)}` : ''}</div></td><td>${money(record.total)}</td><td>${money(record.paid)}</td><td><b>${money(record.remaining)}</b></td><td>${record.due ? new Date(`${record.due}T00:00:00`).toLocaleDateString('id-ID') : '—'}</td><td>${record.remaining > 0 ? `<button class="small-btn" data-detail-pay="${record.id}" data-source="${record.source}">${supplierMode ? 'Bayar hutang' : 'Terima piutang'}</button>` : '<span class="pill">Lunas</span>'}</td></tr>`).join('');
    const host = openModal(`Detail ${supplierMode ? 'supplier' : 'pelanggan'}`, `${contact.name} · ${supplierMode ? 'Saldo hutang supplier' : 'Saldo piutang pelanggan'} ${money(balance)}`, `<div class="contact-detail-grid"><div><small>TELEPON</small><b>${esc(contact.phone || '—')}</b></div><div><small>${supplierMode ? 'KODE SUPPLIER' : 'EMAIL'}</small><b>${esc(supplierMode ? contact.initials : contact.email || '—')}</b></div><div class="full"><small>ALAMAT</small><b>${esc(contact.address || '—')}</b></div><div class="full"><small>CATATAN</small><b>${esc(contact.notes || '—')}</b></div></div><section class="contact-detail-ledger"><div class="panel-title">${supplierMode ? 'Riwayat tagihan pembelian' : 'Riwayat penjualan, servis & piutang'}</div><div class="table-wrap"><table><thead><tr><th>${supplierMode ? 'NOTA / BATCH' : 'STRUK / TIKET'}</th><th>TOTAL</th><th>DIBAYAR</th><th>SISA</th><th>JATUH TEMPO</th><th>AKSI</th></tr></thead><tbody>${recordRows || `<tr><td colspan="6"><div class="empty">Belum ada ${supplierMode ? 'penerimaan barang' : 'penjualan atau servis'} terkait kontak ini.</div></td></tr>`}</tbody></table></div></section>`, null);
    host.querySelectorAll('[data-detail-pay]').forEach((action) => action.addEventListener('click', () => {
      const record = records.find((entry) => entry.id === action.dataset.detailPay);
      if (!record) return;
      host.innerHTML = '';
      partyPaymentModal(record.source, { ...record, branch_id: (supplierMode ? relatedBatches : [...relatedSales,...relatedServices]).find((entry) => entry.id === record.id)?.branch_id, supplier: contact.name, suppliers: { name: contact.name }, customers: { name: contact.name }, customer_name: contact.name }, record.remaining, 'contacts');
    }));
  }));
  page.querySelectorAll('[data-pay-batch]').forEach((button) => button.addEventListener('click', () => { const batch = payables.find((item) => item.id === button.dataset.payBatch); partyPaymentModal('intake_batch', batch, batch.remaining, 'contacts'); }));
  page.querySelectorAll('[data-collect-contact]').forEach((button) => button.addEventListener('click', () => { const entry = receivables.find((item) => item.id === button.dataset.collectContact); partyPaymentModal(button.dataset.source, entry, entry.remaining, 'contacts'); }));
  const label = supplierMode ? 'supplier' : 'pelanggan';
  const organizationId = state.organization.id;
  const reloadContacts = async () => {
    state.contactTab = type;
    if (state.page === 'contacts') await showPage('contacts');
  };
  const contactForm = (contact) => openModal(`${contact ? 'Edit' : 'Tambah'} ${label}`, 'Data kontak berlaku untuk seluruh cabang.', `
    <div class="form-grid">
      <div class="field"><label>Nama</label><input name="name" value="${esc(contact?.name || '')}" required /></div>
      ${supplierMode ? '' : `<div class="field"><label>Tipe pelanggan</label><select name="customer_type"><option value="end_user">Pembeli umum / end user</option><option value="reseller" ${contact?.customer_type === 'reseller' ? 'selected' : ''}>Pelanggan reseller</option></select></div>`}
      <div class="field"><label>Nomor telepon</label><input name="phone" value="${esc(contact?.phone || '')}" /></div>
      ${supplierMode ? '' : `<div class="field"><label>Email</label><input name="email" type="email" value="${esc(contact?.email || '')}" /></div>`}
      <div class="field full"><label>Alamat</label><input name="address" value="${esc(contact?.address || '')}" /></div>
      <div class="field full"><label>Catatan</label><textarea name="notes" rows="3">${esc(contact?.notes || '')}</textarea></div>
    </div>${supplierMode && !contact ? '<div class="notice">Kode awal barcode supplier dibuat otomatis dari nama.</div>' : ''}`, async (form) => {
    const name = String(form.get('name')).trim();
    if (!name) throw new Error('Nama wajib diisi.');
    const values = { name, phone: String(form.get('phone')).trim(), address: String(form.get('address')).trim(), notes: String(form.get('notes')).trim() };
    if (!supplierMode) {
      values.email = String(form.get('email')).trim();
      values.customer_type = String(form.get('customer_type'));
    } else if (!contact) {
      values.initials = supplierInitials(name);
    }
    if (contact) {
      if (!canManage() || state.organization?.id !== organizationId) throw new Error('Akses edit ditolak.');
      checkError(await supabase.from(table).update(values).eq('id', contact.id).eq('organization_id', organizationId).select('id').single());
    } else {
      checkError(await supabase.from(table).insert({ ...values, organization_id: organizationId }));
    }
    toast('Kontak tersimpan.');
    await reloadContacts();
  }, 'Simpan kontak');
  page.querySelector('#new-contact').addEventListener('click', () => contactForm());
  page.querySelectorAll('[data-edit-contact]').forEach((button) => button.addEventListener('click', () => {
    const contact = rowsData.find((row) => row.id === button.dataset.editContact);
    if (contact && canManage()) contactForm(contact);
  }));
  page.querySelectorAll('[data-delete-contact]').forEach((button) => button.addEventListener('click', () => {
    const contact = rowsData.find((row) => row.id === button.dataset.deleteContact);
    if (!contact || !canManage()) return;
    openModal(`Hapus ${label}?`, 'Kontak ini akan dihapus dari daftar seluruh cabang.', `<div class="notice">${esc(contact.name)}</div>`, async () => {
      if (!canManage() || state.organization?.id !== organizationId) throw new Error('Akses hapus ditolak.');
      const { data, error } = await supabase.from(table).delete().eq('id', contact.id).eq('organization_id', organizationId).select('id');
      if (error?.code === '23503') throw new Error('Kontak masih terhubung dengan stok atau transaksi.');
      if (error) throw error;
      if (!data?.length) throw new Error('Kontak tidak ditemukan atau akses hapus ditolak.');
      toast('Kontak berhasil dihapus.');
      await reloadContacts();
    }, 'Hapus kontak');
  }));
}

function cashEntryModal(direction) {
  const income = direction === 'income';
  const categories = income ? ['Pemasukan lain'] : ['Operasional toko','Transportasi','Utilitas','Gaji','Perbaikan','Lainnya'];
  openModal(income ? 'Catat pemasukan lain' : 'Catat pengeluaran', income ? 'Pemasukan penjualan dan pembayaran piutang tercatat otomatis.' : 'Pengeluaran ini akan masuk ke laporan cabang dan total semua cabang.', `<div class="form-grid">${branchField()}<div class="field"><label>Kategori</label><select name="category">${categories.map((item) => `<option>${item}</option>`).join('')}</select></div><div class="field"><label>Nominal</label><input name="amount" type="number" min="1" required /></div><div class="field full"><label>Keterangan</label><input name="description" required placeholder="Contoh: listrik bulan ini" /></div></div>`, async (form) => { const { error } = await supabase.rpc('add_manual_cash_transaction', { _branch_id: form.get('branch_id'), _direction: direction, _category: form.get('category'), _amount: Number(form.get('amount')), _description: String(form.get('description')).trim() }); if (error) throw error; toast(income ? 'Pemasukan tercatat.' : 'Pengeluaran tercatat.'); await showPage('finance'); }, 'Simpan transaksi');
}

function partyPaymentModal(sourceType, entry, remaining, returnPage = 'finance') {
  const isSupplier = sourceType === 'intake_batch';
  const party = isSupplier ? (entry.suppliers?.name || entry.supplier || 'Supplier') : (entry.customers?.name || entry.customer_name || 'Pelanggan');
  openModal(isSupplier ? 'Bayar hutang supplier' : 'Terima pembayaran piutang', `${party} · sisa ${money(remaining)} · ${branchName(entry.branch_id)}`, `<div class="form-grid"><div class="field"><label>Nominal dibayar</label><input name="amount" type="number" min="1" max="${remaining}" value="${remaining}" required /></div></div>`, async (form) => { const { error } = await supabase.rpc('record_party_payment', { _source_type: sourceType, _source_id: entry.id, _amount: Number(form.get('amount')) }); if (error) throw error; toast('Pembayaran tercatat dan saldo tagihan diperbarui.'); await showPage(returnPage); }, 'Catat pembayaran');
}

async function financePage(page) {
  if (state.profile.role === 'technician') throw new Error('Keuangan hanya tersedia untuk pemilik dan operator.');
  const filter = canManage() ? state.financeBranch : state.profile.branch_id;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const monthIso = monthStart.toISOString();
  let cashQuery = supabase.from('cash_transactions').select('id,branch_id,direction,category,amount,description,source_type,source_id,created_at,branches(name),customers(name),suppliers(name)').gte('created_at', monthIso).order('created_at', { ascending: false });
  let salesQuery = supabase.from('sales').select('id,branch_id,receipt_number,customer_name,total,paid_amount,due_date,created_at,customers(name),branches(name)').order('created_at', { ascending: false });
  let serviceQuery = supabase.from('service_tickets').select('id,branch_id,ticket_number,customer_name,final_cost,paid_amount,due_date,created_at,branches(name)').eq('status','handed_over').order('created_at', { ascending: false });
  let purchasesQuery = supabase.from('intake_batches').select('id,branch_id,supplier,supplier_id,invoice_number,total_amount,amount_paid,due_date,created_at,suppliers(name),branches(name)').order('created_at', { ascending: false });
  if (filter !== 'all') { cashQuery = cashQuery.eq('branch_id', filter); salesQuery = salesQuery.eq('branch_id', filter); serviceQuery = serviceQuery.eq('branch_id', filter); purchasesQuery = purchasesQuery.eq('branch_id', filter); }
  const [cash,sales,services,purchases] = await Promise.all([fetchAllRows(cashQuery),fetchAllRows(salesQuery),fetchAllRows(serviceQuery),fetchAllRows(purchasesQuery)]);
  const incomes = cash.filter((entry) => entry.direction === 'income').reduce((sum, entry) => sum + Number(entry.amount), 0);
  const expenses = cash.filter((entry) => entry.direction === 'expense').reduce((sum, entry) => sum + Number(entry.amount), 0);
  const receivables = [...sales.filter((sale) => Number(sale.total) > Number(sale.paid_amount)).map((sale) => ({ ...sale, source_type: 'sale', label: sale.receipt_number, total_due: Number(sale.total), paid: Number(sale.paid_amount) })), ...services.filter((ticket) => Number(ticket.final_cost) > Number(ticket.paid_amount)).map((ticket) => ({ ...ticket, source_type: 'service_ticket', label: ticket.ticket_number, total_due: Number(ticket.final_cost), paid: Number(ticket.paid_amount) }))].map((entry) => ({ ...entry, remaining: entry.total_due-entry.paid }));
  const payables = purchases.filter((purchase) => Number(purchase.total_amount) > Number(purchase.amount_paid)).map((purchase) => ({ ...purchase, remaining: Number(purchase.total_amount)-Number(purchase.amount_paid) }));
  const receivableTotal = receivables.reduce((sum,item)=>sum+item.remaining,0); const payableTotal = payables.reduce((sum,item)=>sum+item.remaining,0);
  const branchTotals = new Map((filter === 'all' ? state.branches : []).map((branch) => [branch.id,{ name: branch.name, income: 0, expense: 0 }]));
  cash.forEach((entry) => { const id = entry.branch_id; const row = branchTotals.get(id) || { name: entry.branches?.name || branchName(id), income: 0, expense: 0 }; row[entry.direction] += Number(entry.amount); branchTotals.set(id,row); });
  const options = `<option value="all" ${filter === 'all' ? 'selected' : ''}>Semua cabang</option>${state.branches.map((branch) => `<option value="${branch.id}" ${filter === branch.id ? 'selected' : ''}>${esc(branch.name)}</option>`).join('')}`;
  const branchControl = canManage() ? `<select id="finance-branch" class="branch-select">${options}</select>` : '';
  const activityRows = cash.map((entry) => `<tr data-cash-direction="${esc(entry.direction)}"><td class="product-name">${new Date(entry.created_at).toLocaleDateString('id-ID')}<div class="field-hint">${esc(entry.branches?.name || branchName(entry.branch_id))}</div></td><td>${esc(entry.category)}</td><td>${esc(entry.description || entry.customers?.name || entry.suppliers?.name || '—')}</td><td><span class="pill ${entry.direction === 'income' ? 'blue' : 'warn'}">${entry.direction === 'income' ? 'Masuk' : 'Keluar'}</span></td><td>${money(entry.amount)}</td></tr>`).join('');
  page.innerHTML = `${header('Keuangan cabang', `Arus kas bulan ${monthStart.toLocaleDateString('id-ID',{month:'long',year:'numeric'})}. Pemasukan dan pengeluaran dihitung dari uang yang benar-benar dibayar.`, `${branchControl}<button class="btn" id="add-income">＋ Pemasukan</button><button class="btn primary" id="add-expense">− Pengeluaran</button>`)}
    <div class="cards finance-summary">
      ${financeSummaryCard('income', 'Kas masuk bulan ini', money(incomes), 'Penjualan dibayar, cicilan, dan pemasukan lain')}
      ${financeSummaryCard('expense', 'Kas keluar bulan ini', money(expenses), 'Pembelian, hutang supplier, dan operasional')}
      ${financeSummaryCard('balance', 'Sisa kas bersih', money(incomes-expenses), 'Kas masuk dikurangi kas keluar')}
      ${financeSummaryCard('debt', 'Piutang / hutang terbuka', `${money(receivableTotal)} / ${money(payableTotal)}`, `${receivables.length} piutang · ${payables.length} hutang`)}
    </div>
    <div class="finance-view-tabs" role="group" aria-label="Rincian keuangan">
      ${filter === 'all' ? '<button type="button" class="btn" data-finance-tab="branches">Ringkasan cabang</button>' : ''}
      <button type="button" class="btn" data-finance-tab="cash">Arus kas</button>
      <button type="button" class="btn" data-finance-tab="receivables">Piutang pelanggan</button>
      <button type="button" class="btn" data-finance-tab="payables">Hutang supplier</button>
    </div>
    ${filter === 'all' ? `<section class="panel table-panel" data-finance-view="branches"><div class="panel-head"><div><div class="panel-title">Ringkasan per cabang</div><div class="panel-sub">Angka bulan ini untuk semua cabang toko</div></div></div><div class="table-wrap"><table><thead><tr><th>CABANG</th><th>KAS MASUK</th><th>KAS KELUAR</th><th>BERSIH</th></tr></thead><tbody>${[...branchTotals.entries()].map(([id,row]) => `<tr><td class="product-name">${esc(row.name)}</td><td>${money(row.income)}</td><td>${money(row.expense)}</td><td>${money(row.income-row.expense)}</td></tr>`).join('') || '<tr><td colspan="4">Belum ada transaksi bulan ini.</td></tr>'}</tbody></table></div></section>` : ''}
    <section class="panel table-panel" data-finance-view="receivables" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Piutang pelanggan</div><div class="panel-sub">Sisa pembayaran penjualan dan servis</div></div></div><div class="table-wrap"><table><thead><tr><th>PELANGGAN / STRUK</th><th>CABANG</th><th>TOTAL</th><th>SUDAH DIBAYAR</th><th>SISA</th><th>JATUH TEMPO</th><th></th></tr></thead><tbody>${receivables.map((entry) => `<tr><td class="product-name">${esc(entry.customers?.name || entry.customer_name || 'Pelanggan')}<div class="field-hint">${esc(entry.label)} · ${entry.source_type === 'sale' ? 'Penjualan' : 'Servis'}</div></td><td>${esc(entry.branches?.name || branchName(entry.branch_id))}</td><td>${money(entry.total_due)}</td><td>${money(entry.paid)}</td><td><b>${money(entry.remaining)}</b></td><td>${entry.due_date ? new Date(`${entry.due_date}T00:00:00`).toLocaleDateString('id-ID') : '—'}</td><td><button class="small-btn" data-collect="${entry.id}" data-source="${entry.source_type}">Terima pembayaran</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Tidak ada piutang pelanggan terbuka.</div></td></tr>'}</tbody></table></div></section>
    <section class="panel table-panel" data-finance-view="payables" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Hutang supplier</div><div class="panel-sub">Sisa pembayaran untuk batch barang masuk</div></div></div><div class="table-wrap"><table><thead><tr><th>SUPPLIER / NOTA</th><th>CABANG</th><th>TOTAL</th><th>SUDAH DIBAYAR</th><th>SISA</th><th>JATUH TEMPO</th><th></th></tr></thead><tbody>${payables.map((batch) => `<tr><td class="product-name">${esc(batch.suppliers?.name || batch.supplier || 'Supplier')}<div class="field-hint">${esc(batch.invoice_number || batch.id.slice(0,8).toUpperCase())}</div></td><td>${esc(batch.branches?.name || branchName(batch.branch_id))}</td><td>${money(batch.total_amount)}</td><td>${money(batch.amount_paid)}</td><td><b>${money(batch.remaining)}</b></td><td>${batch.due_date ? new Date(`${batch.due_date}T00:00:00`).toLocaleDateString('id-ID') : '—'}</td><td><button class="small-btn" data-pay="${batch.id}">Bayar supplier</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Tidak ada hutang supplier terbuka.</div></td></tr>'}</tbody></table></div></section>
    <section class="panel table-panel" data-finance-view="cash" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Arus kas bulan ini</div><div class="panel-sub" data-cash-total></div></div><div class="finance-cash-filter" role="group" aria-label="Arah arus kas">
      <button type="button" class="small-btn" data-cash-filter="all">Semua</button><button type="button" class="small-btn" data-cash-filter="income">Masuk</button><button type="button" class="small-btn" data-cash-filter="expense">Keluar</button>
    </div></div><div class="table-wrap"><table><thead><tr><th>TANGGAL / CABANG</th><th>KATEGORI</th><th>KETERANGAN</th><th>ARAH</th><th>NOMINAL</th></tr></thead><tbody>${activityRows}<tr data-cash-empty hidden><td colspan="5"><div class="empty">Belum ada catatan kas untuk pilihan ini.</div></td></tr></tbody></table></div></section>`;
  const views = [...page.querySelectorAll('[data-finance-view]')];
  const viewTabs = [...page.querySelectorAll('[data-finance-tab]')];
  const cashView = page.querySelector('[data-finance-view="cash"]');
  const cashTable = cashView.querySelector('.table-wrap');
  const cashTableRows = [...cashTable.querySelectorAll('[data-cash-direction]')];
  const cashFilters = [...cashView.querySelectorAll('[data-cash-filter]')];
  const cachedView = state.financeView;
  const selectView = (name, direction = 'all') => {
    state.financeView = { name, direction };
    views.forEach((view) => { view.hidden = view.dataset.financeView !== name; });
    viewTabs.forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.financeTab === name)));
    if (name !== 'cash') return;
    cashView.querySelector('.finance-table-pages')?.remove();
    const matches = cashTableRows.filter((row) => direction === 'all' || row.dataset.cashDirection === direction);
    cashTableRows.forEach((row) => { row.hidden = direction !== 'all' && row.dataset.cashDirection !== direction; });
    cashView.querySelector('[data-cash-empty]').hidden = matches.length > 0;
    cashFilters.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.cashFilter === direction)));
    cashView.querySelector('[data-cash-total]').textContent = direction === 'income' ? `Total masuk ${money(incomes)}`
      : direction === 'expense' ? `Total keluar ${money(expenses)}`
      : `Masuk ${money(incomes)} · Keluar ${money(expenses)} · Bersih ${money(incomes-expenses)}`;
    bindFinanceTablePages(cashTable, matches);
  };
  views.filter((view) => view !== cashView).forEach((view) => {
    bindFinanceTablePages(view.querySelector('.table-wrap'), [...view.querySelectorAll('tbody tr')]);
  });
  viewTabs.forEach((tab) => tab.addEventListener('click', () => selectView(tab.dataset.financeTab)));
  cashFilters.forEach((button) => button.addEventListener('click', () => selectView('cash', button.dataset.cashFilter)));
  page.querySelectorAll('[data-finance-metric]').forEach((card) => card.addEventListener('click', () => {
    const metric = card.dataset.financeMetric;
    if (metric === 'debt') selectView(receivables.length || !payables.length ? 'receivables' : 'payables');
    else selectView('cash', metric === 'balance' ? 'all' : metric);
  }));
  const initialView = views.some((view) => view.dataset.financeView === cachedView?.name)
    ? cachedView.name : views[0].dataset.financeView;
  selectView(initialView, cachedView?.direction);
  page.querySelector('#finance-branch')?.addEventListener('change', async (event) => { state.financeBranch = event.target.value; await showPage('finance'); });
  page.querySelector('#add-expense').addEventListener('click', () => cashEntryModal('expense'));
  page.querySelector('#add-income').addEventListener('click', () => cashEntryModal('income'));
  page.querySelectorAll('[data-collect]').forEach((button) => button.addEventListener('click', () => { const entry = receivables.find((item) => item.id === button.dataset.collect); partyPaymentModal(button.dataset.source, entry, entry.remaining); }));
  page.querySelectorAll('[data-pay]').forEach((button) => button.addEventListener('click', () => partyPaymentModal('intake_batch', payables.find((batch) => batch.id === button.dataset.pay), payables.find((batch) => batch.id === button.dataset.pay).remaining)));
}

function startStorefrontSlides(hero) {
  const slides = [
    ['Temukan laptop pilihanmu.', 'Untuk kerja, kuliah, dan kebutuhan sehari-hari.', '#produk', 'Jelajahi produk'],
    ['Cari laptop sesuai budget.', 'Bandingkan harga dan merek, lalu tanyakan pilihanmu langsung ke toko.', '#produk', 'Lihat katalog'],
    ['Pantau servis laptopmu.', 'Cek progres dengan kode pelacakan dari bukti penerimaan.', '/lacak-servis', 'Lacak servis'],
  ];
  const content = hero.querySelector('[data-slide-content]');
  const position = hero.querySelector('[data-slide-position]');
  const toggle = hero.querySelector('[data-slide-toggle]');
  const video = hero.querySelector('video');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let paused = motion.matches;
  let timer;
  const syncVideo = () => {
    if (paused || motion.matches || document.hidden || !hero.isConnected) {
      video.pause();
      return;
    }
    const source = `/showroom-${index}.mp4`;
    if (video.getAttribute('src') !== source) {
      video.classList.remove('is-playing');
      video.src = source;
    }
    video.play().catch(() => {});
  };
  video.addEventListener('playing', () => video.classList.add('is-playing'));
  video.addEventListener('error', () => video.classList.remove('is-playing'));
  const show = (next) => {
    index = (next + slides.length) % slides.length;
    const [title, description, href, label] = slides[index];
    content.innerHTML = `<div class="storefront-slide-copy"><p>Digital Laptop Jombang</p><h1>${title}</h1><p>${description}</p><a href="${href}">${label}</a></div>`;
    position.textContent = `${index + 1} / ${slides.length}`;
    video.classList.remove('is-playing');
    syncVideo();
  };
  const schedule = () => {
    clearInterval(timer);
    toggle.textContent = paused ? 'Putar' : 'Jeda';
    toggle.disabled = motion.matches;
    syncVideo();
    if (paused || motion.matches) return;
    timer = setInterval(() => {
      if (!document.hidden && !hero.matches(':hover, :focus-within')) show(index + 1);
    }, 8000);
  };
  for (const [selector, step] of [['[data-slide-prev]', -1], ['[data-slide-next]', 1]]) {
    hero.querySelector(selector).addEventListener('click', () => { show(index + step); schedule(); });
  }
  toggle.addEventListener('click', () => { paused = !paused; schedule(); });
  const onMotionChange = () => { paused = motion.matches; schedule(); };
  motion.addEventListener('change', onMotionChange);
  document.addEventListener('visibilitychange', syncVideo);
  const cleanup = new MutationObserver(() => {
    if (hero.isConnected) return;
    clearInterval(timer);
    video.pause();
    document.removeEventListener('visibilitychange', syncVideo);
    motion.removeEventListener('change', onMotionChange);
    cleanup.disconnect();
  });
  cleanup.observe(root, { childList: true });
  show(0);
  schedule();
}

function catalogProcessorFamily(value) {
  const processor = String(value || '').trim();
  if (!processor) return '';
  const intelCore = processor.match(/\b(?:intel\s+)?(?:core\s+)?i\s*([3579])(?=\b|[-\d])/i);
  if (intelCore) return `Intel Core i${intelCore[1]}`;
  const intelSeries = processor.match(/\bcore\s+(ultra\s+)?([3579])(?=\b|[-\d])/i);
  if (intelSeries) return `Intel Core ${intelSeries[1] ? 'Ultra ' : ''}${intelSeries[2]}`;
  const ryzen = processor.match(/\bryzen\s*(?:ai\s*)?([3579])\b/i);
  if (ryzen) return `AMD Ryzen ${ryzen[1]}`;
  if (/\bceleron\b/i.test(processor)) return 'Intel Celeron';
  if (/\bpentium\b/i.test(processor)) return 'Intel Pentium';
  if (/\bathlon\b/i.test(processor)) return 'AMD Athlon';
  const apple = processor.match(/\b(?:apple\s+)?(m[1-5])\b/i);
  if (apple) return `Apple ${apple[1].toUpperCase()}`;
  return processor;
}

const catalogNeeds = [
  ['study', 'Kuliah & tugas'],
  ['office', 'Kerja kantoran'],
  ['design', 'Desain ringan'],
];
const catalogBudgets = [
  ['under-3', '< Rp3 juta', 0, 3000000],
  ['3-to-5', 'Rp3–5 juta', 3000000, 5000000.01],
  ['over-5', '> Rp5 juta', 5000000.01, Infinity],
];

function catalogNeedReason(product, need) {
  const specs = product.specifications || {};
  const ram = Number(String(specs.ram || '').match(/(\d+)\s*(?:gb|gib|g)\b/i)?.[1]);
  const ssd = /\b(?:ssd|nvme)\b/i.test(specs.storage || '');
  const capableProcessor = /(?:core (?:i[57]|(?:ultra )?[57])|ryzen [57]|apple m[1-5])\b/i
    .test(catalogProcessorFamily(specs.processor));
  if (need === 'study' && ram >= 4 && ssd) return `RAM ${ram} GB dan SSD untuk dokumen dan tugas.`;
  if (need === 'office' && ram >= 8 && ssd) return `RAM ${ram} GB dan SSD untuk aplikasi kerja harian.`;
  if (need === 'design' && ram >= 8 && ssd && capableProcessor) return 'Spek untuk Canva dan edit foto ringan.';
  return '';
}

function customerPortal(tracking) {
  root.innerHTML = `<main class="catalog-page storefront" id="storefront-top">
    <header class="storefront-header">
      <a class="storefront-brand" href="${tracking ? '/' : '#storefront-top'}"><img src="/store-logo-transparent.png" alt="" width="64" height="64" /><span>Digital Laptop <small>Jombang</small></span></a>
      <nav aria-label="Navigasi toko">
        <a href="/" ${tracking ? '' : 'aria-current="page"'}>Katalog</a>
        <a href="/lacak-servis" ${tracking ? 'aria-current="page"' : ''}>Lacak servis</a>
      </nav>
      <a class="storefront-staff" href="/petugas">Masuk petugas</a>
    </header>
    ${tracking ? '' : `<section class="storefront-hero" aria-label="Promosi Digital Laptop">
      <div class="storefront-slide">
        <div data-slide-content></div>
        <div class="storefront-slide-controls">
          <button type="button" data-slide-prev aria-label="Slide sebelumnya">←</button>
          <span data-slide-position></span>
          <button type="button" data-slide-next aria-label="Slide berikutnya">→</button>
          <button type="button" data-slide-toggle>Jeda</button>
        </div>
      </div>
      <div class="storefront-media" aria-hidden="true">
        <img src="/login-laptops.webp" alt="" fetchpriority="high" />
        <video muted playsinline loop preload="none"></video>
      </div>
    </section>`}
    <section class="storefront-content" id="customer-content"></section>
    <footer class="storefront-footer">
      <div class="storefront-footer-main">
        <div class="storefront-footer-brand"><img src="/store-logo-transparent.png" alt="" width="40" height="40" />
          <div><strong>Digital Laptop Jombang</strong><span>${tracking ? 'Lacak status servis laptop' : 'Katalog laptop dan layanan servis'}</span></div>
        </div>
        <nav aria-label="Tautan di bagian bawah"><a href="/catalog">Katalog laptop</a><a href="/lacak-servis">Lacak servis</a><a data-storefront-contact hidden target="_blank" rel="noopener noreferrer">WhatsApp toko</a></nav>
      </div>
      <div class="storefront-footer-bottom"><small>&copy; ${new Date().getFullYear()} Digital Laptop Jombang</small><a href="#storefront-top">Kembali ke atas &uarr;</a></div>
    </footer>
  </main>`;
  const panel = root.querySelector('#customer-content');
  if (tracking) {
    panel.innerHTML = '<h2>Lacak servis</h2><form class="form-grid"><div class="field"><label for="tracking-code">Kode pelacakan</label><input id="tracking-code" name="code" required /></div><div><button class="btn primary">Lacak</button></div></form><div id="tracking-result" aria-live="polite"></div>';
    const form = panel.querySelector('form');
    form.code.value = new URLSearchParams(location.hash.slice(1)).get('kode') || '';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const result = panel.querySelector('#tracking-result');
      const code = form.code.value.trim().toUpperCase();
      const short = /^DGL-[0-9A-F]{10}$/.test(code);
      if (!short && !/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(code)) {
        result.textContent = 'Masukkan kode dari bukti servis, misalnya DGL-83A7629F04.';
        return;
      }
      result.textContent = 'Memeriksa status…';
      const rpc = short ? 'customer_service_status_short' : 'customer_service_status';
      const {data, error} = await supabase.rpc(rpc, { _code: code });
      if (form.code.value.trim().toUpperCase() !== code) return;
      const ticket = data?.[0];
      result.innerHTML = error ? '<p>Status belum bisa dimuat. Coba lagi.</p>' : ticket
        ? `<div class="notice"><b>${esc(ticket.ticket_number)}</b> · ${esc(statusText[ticket.status] || ticket.status)}<br>${esc(ticket.branch)} · ${new Date(ticket.updated_at).toLocaleString('id-ID')}</div>`
        : '<p>Kode pelacakan tidak ditemukan.</p>';
    });
    if (form.code.value) form.requestSubmit();
    return;
  }
  startStorefrontSlides(root.querySelector('.storefront-hero'));
  panel.id = 'produk';
  panel.innerHTML = '<h2>Katalog produk</h2><p role="status">Memuat produk…</p>';
  const sharedParams = new URLSearchParams(location.search);
  const sharedProductId = sharedParams.get('produk') || location.pathname.match(/^\/produk\/([a-f0-9-]+)\/?$/i)?.[1];
  const sharedPrice = Number(sharedParams.get('harga'));

  const loadCatalog = async () => {
    const storefront = await supabase.rpc('customer_catalog_storefront');
    if (storefront.error?.code !== 'PGRST202') return storefront;
    const shareable = await supabase.rpc('customer_catalog_share');
    if (shareable.error?.code !== 'PGRST202') return shareable;
    const promotion = await supabase.rpc('customer_catalog_promotions');
    if (promotion.error?.code !== 'PGRST202') return promotion;
    const gallery = await supabase.rpc('customer_catalog_gallery');
    if (gallery.error?.code !== 'PGRST202') return gallery;
    const result = await supabase.rpc('customer_catalog_details');
    if (result.error?.code === 'PGRST202') return supabase.rpc('customer_catalog');
    return result;
  };
  loadCatalog().then(({data, error}) => {
    if (error) {
      panel.innerHTML = '<h2>Katalog produk</h2><p role="alert">Katalog belum bisa dimuat.</p><button class="btn" type="button">Coba lagi</button>';
      panel.querySelector('button').addEventListener('click', () => customerPortal(false));
      return;
    }
    const products = data || [];
    const storePhone = products.map((product) => String(product.phone || '').replace(/\D/g, '').replace(/^0/, '62')).find(Boolean);
    if (storePhone) {
      const contact = root.querySelector('[data-storefront-contact]');
      contact.href = `https://wa.me/${storePhone}`;
      contact.hidden = false;
    }
    const sharedProduct = sharedProductId && products.find((product) => product.product_id === sharedProductId);
    const unavailableNotice = sharedProductId && !sharedProduct
      ? '<p class="notice" role="status">Produk dari link ini sudah tidak tersedia di katalog.</p>' : '';
    if (!products.length) {
      panel.innerHTML = `<h2>Katalog produk</h2>${unavailableNotice}<p>Belum ada produk siap jual di katalog publik. Silakan cek kembali nanti.</p>`;
      if (unavailableNotice) panel.scrollIntoView();
      return;
    }
    const catalogOptions = (values) => [...new Map(values.filter(Boolean).map((value) =>
      [value.toLocaleLowerCase('id'), value])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'id', { numeric: true }));
    const brands = catalogOptions(products.map((product) => product.brand?.trim()));
    const processorByProduct = new Map(products.map((product) => [product, catalogProcessorFamily(product.specifications?.processor)]));
    const processors = catalogOptions([...processorByProduct.values()]);
    const quickFilterRow = (label, group, options) => options.length ? `<div class="storefront-quick-row" role="group" aria-label="${label}">
      <span>${label}</span><div class="storefront-quick-buttons">
        ${options.map(([value, name]) => `<button type="button" data-quick-${group}="${esc(value)}" aria-pressed="false">${esc(name)}</button>`).join('')}
      </div></div>` : '';
    const hasPromo = (product) => publicRetailPrice(product) < Number(product.retail_price);
    panel.innerHTML = `<h2>Katalog produk</h2>
      ${unavailableNotice}
      <div class="storefront-filter-panel">
        <div class="storefront-filters">
          <input type="search" aria-label="Cari laptop" placeholder="Cari laptop atau spek" />
        </div>
        <details class="storefront-filter-options" open>
          <summary>Filter <span data-filter-badge hidden></span></summary>
          <div class="storefront-sort">
            <select aria-label="Urutkan produk"><option value="">Urutan katalog</option><option value="asc">Harga terendah</option><option value="desc">Harga tertinggi</option></select>
          </div>
          <div class="storefront-quick">
            ${quickFilterRow('Merek', 'brand', brands)}
            ${quickFilterRow('Prosesor', 'processor', processors)}
          </div>
          <div class="storefront-quick storefront-quick-secondary">
            ${quickFilterRow('Kebutuhan', 'need', catalogNeeds)}
            ${quickFilterRow('Anggaran', 'budget', catalogBudgets)}
          </div>
        </details>
      </div>
      <div class="storefront-results-toolbar">
        <p class="storefront-count" role="status"></p>
        ${products.some(hasPromo) ? '<button type="button" data-quick-promo aria-pressed="false">Sedang promo</button>' : ''}
        <button type="button" data-reset-catalog hidden>Reset filter</button>
      </div>
      <div class="storefront-grid"></div>
      <nav class="storefront-pagination" aria-label="Halaman katalog" hidden>
        <button type="button" data-catalog-prev aria-label="Halaman produk sebelumnya">&larr; Sebelumnya</button>
        <span data-catalog-page aria-live="polite"></span>
        <button type="button" data-catalog-next aria-label="Halaman produk berikutnya">Berikutnya &rarr;</button>
      </nav>`;
    const search = panel.querySelector('input');
    const sort = panel.querySelector('select');
    const grid = panel.querySelector('.storefront-grid');
    const count = panel.querySelector('.storefront-count');
    const brandButtons = [...panel.querySelectorAll('[data-quick-brand]')];
    const processorButtons = [...panel.querySelectorAll('[data-quick-processor]')];
    const promoButton = panel.querySelector('[data-quick-promo]');
    const reset = panel.querySelector('[data-reset-catalog]');
    const needButtons = [...panel.querySelectorAll('[data-quick-need]')];
    const budgetButtons = [...panel.querySelectorAll('[data-quick-budget]')];
    const pagination = panel.querySelector('.storefront-pagination');
    const previous = pagination.querySelector('[data-catalog-prev]');
    const next = pagination.querySelector('[data-catalog-next]');
    const mobileCatalog = matchMedia('(max-width: 760px)');
    const filterOptions = panel.querySelector('.storefront-filter-options');
    const filterBadge = filterOptions.querySelector('[data-filter-badge]');
    filterOptions.open = !mobileCatalog.matches;
    let productsPerPage = mobileCatalog.matches ? 8 : 12;
    let currentPage = 1;
    let brand = '';
    let processor = '';
    let need = '';
    let budget = '';
    let promoOnly = false;
    const matchesSearch = (product, query) => {
      const text = [product.name, product.brand, product.model, processorByProduct.get(product),
        ...Object.values(product.specifications || {})].join(' ').toLocaleLowerCase('id');
      return query.split(/\s+/).every((term) => text.includes(term));
    };
    const render = () => {
      const query = search.value.trim().toLocaleLowerCase('id');
      const priceBand = catalogBudgets.find(([id]) => id === budget);
      const results = products.filter((product) =>
        (!brand || product.brand?.trim().toLocaleLowerCase('id') === brand) &&
        (!processor || processorByProduct.get(product).toLocaleLowerCase('id') === processor) &&
        (!need || catalogNeedReason(product, need)) &&
        (!priceBand || (publicRetailPrice(product) >= priceBand[2] && publicRetailPrice(product) < priceBand[3])) &&
        (!promoOnly || hasPromo(product)) &&
        (!query || matchesSearch(product, query)));
      brandButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.quickBrand === brand)));
      processorButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.quickProcessor === processor)));
      needButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.quickNeed === need)));
      budgetButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.quickBudget === budget)));
      promoButton?.setAttribute('aria-pressed', String(promoOnly));
      const activeFilters = [brand, processor, need, budget, sort.value].filter(Boolean).length;
      filterBadge.hidden = !activeFilters;
      filterBadge.textContent = activeFilters;
      reset.hidden = !(query || brand || processor || need || budget || promoOnly || sort.value);
      if (sort.value) results.sort((a, b) => (publicRetailPrice(a) - publicRetailPrice(b)) * (sort.value === 'asc' ? 1 : -1));
      else if (sharedProductId && !sharedProduct && Number.isFinite(sharedPrice) && sharedPrice > 0) {
        results.sort((a, b) => Math.abs(publicRetailPrice(a) - sharedPrice) - Math.abs(publicRetailPrice(b) - sharedPrice));
      }
      const totalPages = Math.max(1, Math.ceil(results.length / productsPerPage));
      currentPage = Math.min(currentPage, totalPages);
      const first = (currentPage - 1) * productsPerPage;
      const shown = results.slice(first, first + productsPerPage);
      count.textContent = results.length ? `${first + 1}–${first + shown.length} dari ${results.length} produk` : 'Produk yang cocok belum ditemukan.';
      pagination.hidden = totalPages === 1;
      previous.disabled = currentPage === 1;
      next.disabled = currentPage === totalPages;
      pagination.querySelector('[data-catalog-page]').textContent = `Halaman ${currentPage} dari ${totalPages}`;
      grid.innerHTML = shown.map(product => {
        const specs = pamphletSpecs.flatMap(([key, label]) => {
          const value = product.specifications?.[key]?.trim();
          return value && ['processor', 'ram', 'storage', 'display'].includes(key) ? [[label, value]] : [];
        });
        const reason = need && catalogNeedReason(product, need);
        const branches = product.available_branches || [];
        const location = branches.length === 1 ? branches[0] : branches.length ? `Tersedia di ${branches.length} cabang` : '';
        return `<button type="button" class="storefront-card" data-public-product>
          <span class="storefront-photo">${product.image_path ? `<img loading="lazy" src="${esc(productImageUrl(product.image_path))}" alt="" />` : '<span>Foto belum tersedia</span>'}</span>
          <span class="storefront-card-body">
            <span class="storefront-product-name">${esc(product.name)}</span>
            ${publicPriceMarkup(product)}
            ${location ? `<small class="storefront-stock-label">${esc(location)}</small>` : ''}
            ${reason ? `<small class="storefront-stock-label">${esc(reason)}</small>` : ''}
            ${specs.length ? `<span class="storefront-specs">
              ${specs.map(([label, value]) => `<span><b>${label}</b> ${esc(value)}</span>`).join('')}
            </span>` : ''}
          </span>
        </button>`;
      }).join('');
      grid.querySelectorAll('[data-public-product]').forEach((button, index) => {
        button.addEventListener('click', () => showPublicProduct(shown[index]));
      });
    };
    const renderFirstPage = () => { currentPage = 1; render(); };
    const movePage = (offset) => {
      currentPage += offset;
      render();
      count.scrollIntoView({ block: 'start' });
    };
    previous.addEventListener('click', () => movePage(-1));
    next.addEventListener('click', () => movePage(1));
    brandButtons.forEach((button) => button.addEventListener('click', () => {
      brand = brand === button.dataset.quickBrand ? '' : button.dataset.quickBrand;
      renderFirstPage();
    }));
    processorButtons.forEach((button) => button.addEventListener('click', () => {
      processor = processor === button.dataset.quickProcessor ? '' : button.dataset.quickProcessor;
      renderFirstPage();
    }));
    needButtons.forEach((button) => button.addEventListener('click', () => {
      need = need === button.dataset.quickNeed ? '' : button.dataset.quickNeed;
      renderFirstPage();
    }));
    budgetButtons.forEach((button) => button.addEventListener('click', () => {
      budget = budget === button.dataset.quickBudget ? '' : button.dataset.quickBudget;
      renderFirstPage();
    }));
    promoButton?.addEventListener('click', () => { promoOnly = !promoOnly; renderFirstPage(); });
    reset.addEventListener('click', () => {
      search.value = brand = sort.value = processor = need = budget = '';
      promoOnly = false;
      renderFirstPage();
      search.focus();
    });
    const viewportListener = new AbortController();
    mobileCatalog.addEventListener('change', (event) => {
      if (!panel.isConnected) { viewportListener.abort(); return; }
      filterOptions.open = !event.matches;
      const firstVisible = (currentPage - 1) * productsPerPage;
      productsPerPage = event.matches ? 8 : 12;
      currentPage = Math.floor(firstVisible / productsPerPage) + 1;
      render();
    }, { signal: viewportListener.signal });
    search.addEventListener('input', renderFirstPage);
    sort.addEventListener('change', renderFirstPage);
    renderFirstPage();
    if (sharedProductId) panel.scrollIntoView();
    if (sharedProduct) showPublicProduct(sharedProduct);
  });

}

function productWhatsAppShareUrl(product) {
  if (!product.product_id) return '';
  const url = new URL(`/produk/${encodeURIComponent(product.product_id)}`, location.origin);
  url.searchParams.set('harga', publicRetailPrice(product));
  const message = `Lihat ${product.name} di katalog Digital Laptop Jombang: ${url.href}`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function showPublicProduct(product) {
  const photos = [...new Set([product.image_path, ...(product.gallery_paths || [])].filter(Boolean))].slice(0, 4);
  const specs = pamphletSpecs.flatMap(([key, label]) => {
    const value = product.specifications?.[key]?.trim();
    return value ? [[label, value]] : [];
  });
  if (product.brand) specs.unshift(['Merek', product.brand]);
  if (product.model) specs.push(['Tipe', product.model]);
  if (Number(product.warranty_months) > 0) specs.push(['Garansi', `${Number(product.warranty_months)} bulan`]);
  const phone = String(product.phone || '').replace(/\D/g, '').replace(/^0/, '62');
  const availableBranches = product.available_branches || [];
  const inquiryUrl = (branch) => `https://wa.me/${phone}?text=${encodeURIComponent(
    `Halo, saya tertarik dengan ${product.name} di katalog${branch ? ` di ${branch}` : ''}. Apakah stoknya masih tersedia? Bisa kirim foto kondisi terbaru?`
  )}`;
  const shareUrl = productWhatsAppShareUrl(product);
  const dialog = document.createElement('dialog');
  dialog.className = 'public-product-dialog';
  dialog.setAttribute('aria-labelledby', 'public-product-title');
  dialog.innerHTML = `
    <header><h2 id="public-product-title">${esc(product.name)}</h2><button type="button" aria-label="Tutup detail">×</button></header>
    <div class="public-product-layout">
      <div class="public-product-media">
        <div class="public-product-photos" aria-label="Galeri foto produk">
          ${photos.map((path, index) => `<img src="${esc(productImageUrl(path))}" alt="${esc(product.name)} · Foto ${index + 1}" ${index ? 'loading="lazy"' : ''} />`).join('') || '<p>Foto belum tersedia.</p>'}
        </div>
        ${photos.length > 1 ? `<div class="public-product-thumbs" aria-label="Pilih foto">${photos.map((path, index) =>
          `<button type="button" aria-label="Foto ${index + 1}" aria-pressed="${index === 0}"><img src="${esc(productImageUrl(path))}" alt="" /></button>`).join('')}</div>` : ''}
      </div>
      <div>
        <div class="public-product-price">${publicPriceMarkup(product)}</div>
        ${availableBranches.length ? `<div class="public-product-availability">
          <label for="public-product-branch">Tersedia di cabang</label>
          <select id="public-product-branch">${availableBranches.map((branch) => `<option>${esc(branch)}</option>`).join('')}</select>
        </div>` : ''}
        <div class="public-product-tabs" aria-label="Informasi produk">
          <button type="button" data-product-info="specs" aria-pressed="true">Spesifikasi</button>
          <button type="button" data-product-info="description" aria-pressed="false">Deskripsi</button>
        </div>
        <section class="public-product-info" data-product-panel="specs" aria-label="Spesifikasi">
          ${specs.length ? `<dl>${specs.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : '<p>Spesifikasi belum tersedia.</p>'}
        </section>
        <section class="public-product-info" data-product-panel="description" aria-label="Deskripsi" hidden tabindex="0"><p>${esc(product.description?.trim() || 'Kondisi dan kelengkapan bisa ditanyakan ke toko.')}</p></section>
      </div>
    </div>
    ${phone || shareUrl ? `<footer>
      ${phone ? `<a class="btn primary" data-product-inquiry href="${esc(inquiryUrl(availableBranches[0]))}" target="_blank" rel="noopener noreferrer">Tanya stok unit ini</a>` : ''}
      ${shareUrl ? `<a class="btn" href="${esc(shareUrl)}" target="_blank" rel="noopener noreferrer">Bagikan link ke WhatsApp</a>` : ''}
    </footer>` : ''}`;
  const inquiryLink = dialog.querySelector('[data-product-inquiry]');
  if (inquiryLink) dialog.querySelector('#public-product-branch')?.addEventListener('change', (event) => {
    inquiryLink.href = inquiryUrl(event.target.value);
  });
  dialog.querySelector('header button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  const gallery = dialog.querySelector('.public-product-photos');
  const thumbs = [...dialog.querySelectorAll('.public-product-thumbs button')];
  thumbs.forEach((button, index) => button.addEventListener('click', () => {
    gallery.scrollTo({ left: index * gallery.clientWidth });
  }));
  gallery.addEventListener('scroll', () => {
    const active = Math.round(gallery.scrollLeft / gallery.clientWidth);
    thumbs.forEach((button, index) => button.setAttribute('aria-pressed', index === active));
  }, { passive: true });
  const tabs = dialog.querySelectorAll('[data-product-info]');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(button => button.setAttribute('aria-pressed', button === tab));
    dialog.querySelectorAll('[data-product-panel]').forEach(panel => {
      panel.hidden = panel.dataset.productPanel !== tab.dataset.productInfo;
    });
  }));
  document.body.append(dialog);
  dialog.showModal();
}

async function showServiceReceipt(ticket, kind, technicianName) {
  const handover = kind === 'handover';
  const shareReceipt = !handover;
  const whatsapp = serviceCustomerWhatsApp(ticket);
  if (handover && ticket.status !== 'handed_over') return;
  const title = handover ? 'Bukti penyerahan selesai servis' : 'Bukti penerimaan servis';
  const logo = new URL('/store-logo-transparent.png', location.origin).href;
  const date = (value) => value ? new Date(value).toLocaleString('id-ID') : '—';
  const trackingCode = ticket.short_tracking_code || ticket.tracking_code;
  const link = trackingCode ? new URL('/lacak-servis', location.origin) : null;
  let qr;
  if (link) {
    link.hash = new URLSearchParams({ kode: trackingCode });
    const { default: QRCode } = await import('qrcode');
    qr = await QRCode.toDataURL(link.href, { width: 320 });
  }
  const details = [
    ['Nama pelanggan', ticket.customer_name || ticket.customers?.name],
    ['No. HP / WhatsApp', ticket.customer_phone || ticket.customers?.phone],
    ['Unit / model', ticket.device_name],
    ['Nomor seri', ticket.serial_number],
    ['Diterima', date(ticket.created_at)],
    ['Teknisi', technicianName || ticket.technician_name],
    ['Keluhan pelanggan', ticket.complaint, true],
  ];
  if (handover) {
    details.push(
      ['Diserahkan', date(ticket.handed_over_at)],
      ['Catatan teknisi', ticket.technician_note, true],
      ['Biaya akhir', money(ticket.final_cost ?? 0)],
      ['Total pembayaran tercatat', money(ticket.paid_amount ?? 0)],
      ['Sisa tagihan', money(Math.max(0, Number(ticket.final_cost ?? 0) - Number(ticket.paid_amount ?? 0)))],
    );
  } else {
    details.push(['Estimasi biaya tercatat', money(ticket.estimated_cost ?? 0)]);
  }
  const documentBody = `<article class="service-receipt">
    <header class="service-receipt-brand">
      <img src="${esc(logo)}" width="48" height="48" alt="" />
      <div><strong>${esc(state.organization.name)}</strong><div>${esc(branchName(ticket.branch_id))}</div></div>
    </header>
    <h2>${esc(title)}</h2>
    <p class="service-receipt-ticket">No. tiket <strong>${esc(ticket.ticket_number)}</strong></p>
    <dl>${details.map(([label, value, fullWidth]) => `<div${fullWidth ? ' class="service-receipt-wide"' : ''}><dt>${esc(label)}</dt><dd>${esc(value || '—')}</dd></div>`).join('')}</dl>
    ${link ? `<section class="service-receipt-tracking">
      <img width="120" height="120" src="${qr}" alt="QR pelacakan servis" />
      <div><strong>Lacak servis</strong><p>Pindai QR atau gunakan kode pelacakan berikut.</p>
      <p>${esc(trackingCode)}</p><a href="${esc(link.href)}">${esc(link.origin + link.pathname)}</a></div>
    </section>` : '<p>Kode pelacakan belum tersedia untuk tiket ini.</p>'}
  </article>`;
  const host = openModal(title, ticket.ticket_number, `${documentBody}
    ${shareReceipt ? `<section class="service-share-panel" aria-label="Bagikan bukti servis">
      <strong>Kirim bukti servis sebagai PDF</strong>
      <p class="field-hint" data-pdf-status role="status">Menyiapkan PDF…</p>
      <div class="actions-cell">
        <button type="button" class="btn primary" data-share-pdf hidden>Bagikan PDF</button>
        <button type="button" class="btn" data-download-pdf disabled>Unduh PDF</button>
        ${whatsapp ? `<a class="btn" href="${esc(whatsapp)}" target="_blank" rel="noopener noreferrer">Buka chat pelanggan</a>` : ''}
      </div>
    </section>` : ''}
    ${link ? `<div class="field"><label for="service-tracking-link">Link pelacakan pelanggan</label><input id="service-tracking-link" value="${esc(link.href)}" readonly /></div>
    <button type="button" class="btn" id="copy-service-link">Salin link</button>` : ''}
    <button type="button" class="btn" id="print-service-receipt">Cetak bukti</button>`, null);
  host.querySelector('#print-service-receipt').addEventListener('click', () => {
    const narrow = printPreferences().receipt === '58';
    printDocument(title, documentBody, 'receipt', `
      .service-receipt{margin:12px auto;max-width:560px;line-height:1.35}
      .service-receipt-brand{display:grid;justify-items:center;gap:4px;text-align:center;border-bottom:1px solid #222;padding-bottom:9px;break-inside:avoid}
      .service-receipt-brand img{width:36px;height:36px;object-fit:contain}
      .service-receipt-brand strong{font-size:12px;letter-spacing:.025em}
      .service-receipt-brand strong + div{font-size:10px}
      .service-receipt h2{font-size:14px;margin:9px 0 3px;text-align:center}
      .service-receipt-ticket{margin:0;text-align:center;font-size:11px}
      .service-receipt dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 10px;margin:10px 0}
      .service-receipt dl div{border-bottom:1px solid #ccc;padding:5px 0;break-inside:avoid}
      .service-receipt-wide{grid-column:1 / -1}
      .service-receipt dt{font-size:10px;font-weight:700}
      .service-receipt dd{margin:1px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
      .service-receipt-tracking{display:grid;grid-template-columns:${narrow ? '1fr' : '96px minmax(0,1fr)'};align-items:center;justify-items:${narrow ? 'center' : 'start'};gap:6px;border:1px solid #ccc;padding:6px;break-inside:avoid;overflow-wrap:anywhere;text-align:${narrow ? 'center' : 'left'};font-size:10px}
      .service-receipt-tracking img{display:block;width:96px;max-width:100%;height:auto}
      .service-receipt-tracking p{margin:3px 0}
      .service-receipt-tracking a{color:inherit;text-decoration:none}
      @media print{.service-receipt{margin:0 auto}}
    `);
  });
  host.querySelector('#copy-service-link')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link.href); toast('Link pelacakan disalin.'); }
    catch { host.querySelector('#service-tracking-link').select(); }
  });
  if (shareReceipt) {
    const status = host.querySelector('[data-pdf-status]');
    const download = host.querySelector('[data-download-pdf]');
    const share = host.querySelector('[data-share-pdf]');
    try {
      const { createServiceReceiptPdf } = await import('./service-receipt-pdf.js');
      const data = await createServiceReceiptPdf({
        title, ticketNumber: ticket.ticket_number, organization: state.organization.name,
        branch: branchName(ticket.branch_id), details: [...details, ['Status servis', statusText[ticket.status]]],
        logo, qr, trackingCode, trackingUrl: link ? link.origin + link.pathname : '',
      });
      const filename = `Bukti-Servis-${ticket.ticket_number.replace(/[^\w-]/g, '-')}.pdf`;
      const file = new File([data], filename, { type: 'application/pdf' });
      const canShare = Boolean(navigator.share && navigator.canShare?.({ files: [file] }));
      status.textContent = canShare
        ? 'Pilih WhatsApp dan kontak pelanggan saat menu berbagi terbuka.'
        : whatsapp ? 'Unduh PDF, buka chat pelanggan, lalu lampirkan file sebagai dokumen.'
          : 'Nomor WhatsApp pelanggan belum tersedia atau tidak valid. PDF tetap bisa diunduh.';
      download.disabled = false;
      download.addEventListener('click', () => {
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      });
      share.hidden = !canShare;
      share.addEventListener('click', async () => {
        try { await navigator.share({ files: [file] }); }
        catch (error) {
          if (error.name !== 'AbortError') status.textContent = 'Berbagi tidak tersedia. Unduh PDF dan lampirkan di chat pelanggan.';
        }
      });
    } catch {
      status.textContent = 'PDF gagal dibuat. Tutup dan buka kembali bukti, atau gunakan Cetak bukti dan pilih Simpan sebagai PDF.';
    }
  }
}

async function start() {
  const route = location.pathname.replace(/\/$/, '');
  if (route === '' || route === '/catalog' || /^\/produk\/[a-f0-9-]+$/i.test(route) || route === '/lacak-servis') {
    if (!hasBackendConfig) return configurationScreen();
    return customerPortal(route === '/lacak-servis');
  }
  if (route === '/warranty') { location.replace('/'); return; }
  if (!hasBackendConfig) { configurationScreen(); return; }
  loading('Memeriksa sesi petugas.');
  let sessionTimeout;
  const { data, error } = await Promise.race([
    supabase.auth.getSession(),
    new Promise((_, reject) => {
      sessionTimeout = setTimeout(() => reject(new Error('Waktu pemeriksaan sesi habis.')), 10000);
    }),
  ]).finally(() => clearTimeout(sessionTimeout));
  if (error) { authScreen(error.message); return; }
  if (!data.session) { authScreen(); return; }
  state.user = data.session.user;
  await afterAuth();
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) { state.profile = null; state.user = null; authScreen(); }
  });
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch((error) => console.warn('PWA offline cache could not start', error)));
start().catch((error) => {
  console.error('Digi-Laptop startup failed', error);
  const loading = root.querySelector(':scope > .loading-screen');
  if (!loading) return;
  loading.innerHTML = '<p role="alert">Digi-Laptop belum bisa dibuka. Periksa koneksi lalu coba lagi.</p><button class="btn" type="button">Muat ulang</button>';
  loading.querySelector('button').addEventListener('click', () => location.reload());
});
window.setTimeout(showMobileInstall, 1800);
