import JsBarcode from 'jsbarcode';
import { hasBackendConfig, supabase } from './supabase.js';
import './style.css';

const root = document.querySelector('#app');
const state = { user: null, profile: null, organization: null, branches: [], branchId: '', page: 'dashboard', products: [], cart: [], authMode: 'login', realtimeChannel: null, refreshTimer: null };
const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
const esc = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const initials = (name = '') => name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'DL';
const branchName = (id) => state.branches.find((branch) => branch.id === id)?.name || 'Cabang';
const canManage = () => state.profile?.role === 'owner';
const canIntake = () => ['owner', 'operator'].includes(state.profile?.role);
const canTechnician = () => ['owner', 'technician'].includes(state.profile?.role);
const statusText = { received: 'Diterima', diagnosing: 'Diagnosa', waiting_approval: 'Menunggu persetujuan', waiting_parts: 'Menunggu sparepart', repairing: 'Sedang dikerjakan', ready: 'Siap diambil', handed_over: 'Diserahkan', cancelled: 'Dibatalkan' };
const stockStatusText = { pending_qc: 'Menunggu QC', repair_needed: 'Perlu repair', repairing: 'Sedang repair', waiting_parts: 'Menunggu sparepart', available: 'Tersedia', not_sellable: 'Tidak layak', sold: 'Terjual', used_for_service: 'Terpakai servis', transferred: 'Dipindahkan' };
const pages = { dashboard: ['Ringkasan', '▦'], receiving: ['Penerimaan & barcode', '▤'], quality: ['QC & repair', '⌁'], inventory: ['Produk & stok', '▧'], cashier: ['Kasir', '▣'], service: ['Servis pelanggan', '⌁'], warranty: ['Garansi', '◈'], branches: ['Cabang & operator', '⌂'] };

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
  root.innerHTML = `<div class="loading-screen"><span class="brand-mark">D</span><p>${esc(message)}</p></div>`;
}

function configurationScreen() {
  root.innerHTML = `<main class="login-page"><section class="login-art"><div class="login-art-inner"><span class="brand-mark">D</span><h1>Operasional toko, satu tempat.</h1><p>Digi-Laptop menghubungkan stok, transaksi, servis, dan garansi semua cabang DIGITAL LAPTOP JOMBANG.</p></div></section><section class="login-box-wrap"><div class="login-box"><div class="brand"><span class="brand-mark">D</span><span class="brand-text"><b>DIGI<span>-</span>LAPTOP</b><small>DIGITAL LAPTOP JOMBANG</small></span></div><h2>Hubungkan database toko</h2><p>Project Supabase belum terpasang di konfigurasi lokal.</p><div class="notice">Salin .env.example menjadi .env.local lalu isi URL dan publishable key project Digi-Laptop. Setelah itu jalankan kembali aplikasi.</div><p class="field-hint">Kunci publishable boleh dipakai di aplikasi web. Jangan masukkan secret key atau service_role ke sini.</p><div style="margin-top:20px"><a class="btn primary" href="/catalog">Buka katalog publik</a></div></div></section></main>`;
}

function authScreen(message = '') {
  const signup = state.authMode === 'signup';
  root.innerHTML = `<main class="login-page"><section class="login-art"><div class="login-art-inner"><span class="brand-mark">D</span><h1>Operasional toko, satu tempat.</h1><p>Digi-Laptop menghubungkan stok, transaksi, servis, dan garansi semua cabang DIGITAL LAPTOP JOMBANG.</p></div></section><section class="login-box-wrap"><form class="login-box" id="auth-form"><div class="brand"><span class="brand-mark">D</span><span class="brand-text"><b>DIGI<span>-</span>LAPTOP</b><small>DIGITAL LAPTOP JOMBANG</small></span></div><h2>${signup ? 'Buat akun Digi-Laptop' : 'Masuk ke Digi-Laptop'}</h2><p>${signup ? 'Akun operator harus memakai email undangan pemilik.' : 'Masuk dengan akun toko lo untuk melanjutkan.'}</p>${message ? `<div class="notice error">${esc(message)}</div>` : ''}${signup ? `<div class="field"><label>Nama lengkap</label><input name="full_name" autocomplete="name" required /></div>` : ''}<div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required /></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required /></div><button class="btn primary" type="submit">${signup ? 'Buat akun' : 'Masuk'}</button><div class="login-switch">${signup ? 'Sudah punya akun?' : 'Belum punya akun?'} <button class="text-button" type="button" id="auth-switch">${signup ? 'Masuk' : 'Buat akun'}</button></div></form></section></main>`;
  document.querySelector('#auth-switch').addEventListener('click', () => { state.authMode = signup ? 'login' : 'signup'; authScreen(); });
  document.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email')).trim().toLowerCase();
    const password = String(form.get('password'));
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (signup) {
        const fullName = String(form.get('full_name')).trim();
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: location.origin } });
        if (error) throw error;
        if (data.session) { state.user = data.user; await afterAuth(); }
        else authScreen('Akun dibuat. Cek email untuk konfirmasi, lalu masuk kembali.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        state.user = data.user;
        await afterAuth();
      }
    } catch (error) { authScreen(error.message || 'Tidak bisa masuk. Periksa email dan password.'); }
  });
}

function ownerSetupScreen(message = '') {
  root.innerHTML = `<main class="login-page"><section class="login-art"><div class="login-art-inner"><span class="brand-mark">D</span><h1>Mulai kelola toko.</h1><p>Buat ruang kerja untuk DIGITAL LAPTOP JOMBANG dan tambahkan cabang yang akan lo kelola.</p></div></section><section class="login-box-wrap"><form class="login-box" id="setup-form"><div class="brand"><span class="brand-mark">D</span><span class="brand-text"><b>DIGI<span>-</span>LAPTOP</b><small>DIGITAL LAPTOP JOMBANG</small></span></div><h2>Siapkan toko</h2><p>Akun pertama menjadi pemilik. Nama cabang bisa diedit lagi nanti.</p>${message ? `<div class="notice error">${esc(message)}</div>` : ''}<div class="field"><label>Nama toko</label><input name="store" value="DIGITAL LAPTOP JOMBANG" required /></div><div class="field"><label>Nama cabang 1</label><input name="branch1" placeholder="Contoh: Jombang" required /></div><div class="field"><label>Nama cabang 2</label><input name="branch2" placeholder="Nama cabang" /></div><div class="field"><label>Nama cabang 3</label><input name="branch3" placeholder="Nama cabang" /></div><div class="field"><label>Nama cabang 4</label><input name="branch4" placeholder="Nama cabang" /></div><button class="btn primary" type="submit">Buat ruang kerja</button></form></section></main>`;
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

async function afterAuth() {
  loading();
  const { data: profile, error } = await supabase.from('profiles').select('*, organizations(id,name)').eq('id', state.user.id).maybeSingle();
  if (error) { authScreen(error.message); return; }
  if (!profile) { ownerSetupScreen(); return; }
  state.profile = profile;
  state.organization = profile.organizations;
  const { data: branches, error: branchError } = await supabase.from('branches').select('*').eq('is_active', true).order('name');
  if (branchError) { authScreen(branchError.message); return; }
  state.branches = branches || [];
  if (profile.role === 'technician') state.page = 'quality';
  state.branchId = profile.role === 'owner' ? (state.branchId || state.branches[0]?.id || '') : profile.branch_id;
  if (!state.branchId) { authScreen('Akun operator belum terhubung ke cabang. Minta pemilik mengirim undangan yang sesuai.'); return; }
  subscribeOperationalUpdates();
  showShell();
  await showPage(state.page);
}

function showShell() {
  const permittedPages = Object.entries(pages).filter(([key]) => {
    if (key === 'receiving') return canIntake();
    if (key === 'branches') return canManage();
    if (['inventory', 'cashier', 'service', 'warranty'].includes(key)) return state.profile.role !== 'technician';
    if (key === 'quality') return canTechnician();
    return true;
  });
  const navHtml = permittedPages.map(([key, [label, icon]]) => `<button class="nav-button${state.page === key ? ' active' : ''}" data-page="${key}"><span class="nav-icon">${icon}</span>${label}</button>`).join('');
  const branchOptions = state.profile.role === 'owner' ? state.branches.map((branch) => `<option value="${branch.id}"${state.branchId === branch.id ? ' selected' : ''}>${esc(branch.name)}</option>`).join('') : `<option value="${state.profile.branch_id}">${esc(branchName(state.profile.branch_id))}</option>`;
  const roleLabel = state.profile.role === 'owner' ? 'Pemilik toko' : state.profile.role === 'technician' ? 'Teknisi · QC & repair' : 'Operator · kasir + servis';
  root.innerHTML = `<div class="app"><aside class="sidebar" id="sidebar"><a class="brand" href="#dashboard"><span class="brand-mark">D</span><span class="brand-text"><b>DIGI<span>-</span>LAPTOP</b><small>DIGITAL LAPTOP JOMBANG</small></span></a><div class="nav-label">MENU UTAMA</div><nav class="nav">${navHtml}</nav><div class="side-spacer"></div><div class="nav-label">TOKO & PELANGGAN</div><nav class="nav"><a class="nav-button" href="/catalog" target="_blank"><span class="nav-icon">↗</span>Portal publik</a></nav><div class="side-bottom"><div class="side-note"><b>${roleLabel}</b><p>${state.profile.role === 'owner' ? 'Kelola semua cabang dan aktivitas toko.' : state.profile.role === 'technician' ? 'Periksa unit baru dan kelola perbaikannya.' : 'Akses kasir, servis pelanggan, dan penerimaan.'}</p></div><div class="profile"><span class="avatar">${esc(initials(state.profile.full_name))}</span><span class="profile-meta"><b>${esc(state.profile.full_name || 'Pengguna')}</b><span>${roleLabel}</span></span><button class="logout" id="logout">Keluar</button></div></div></aside><main class="main"><header class="topbar"><button class="mobile-menu" id="mobile-menu" aria-label="Buka menu">☰</button><div class="crumb">${esc(state.organization.name)} <span style="color:#c4cbc4;padding:0 7px">/</span> <b id="crumb-label">${pages[state.page][0]}</b></div><div class="top-tools"><span class="online-label"><i></i><span id="connect-label">Online</span></span><select class="branch-select" id="branch-select" aria-label="Pilih cabang">${branchOptions}</select></div></header><section class="page" id="page"></section><footer class="footer"><span>© ${new Date().getFullYear()} Digi-Laptop</span><span>Operasional DIGITAL LAPTOP JOMBANG</span></footer></main><div id="modal-root"></div></div>`;
  document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', async () => { state.page = button.dataset.page; await showPage(state.page); }));
  document.querySelector('#logout').addEventListener('click', async () => { if (state.realtimeChannel) await supabase.removeChannel(state.realtimeChannel); state.realtimeChannel = null; await supabase.auth.signOut(); state.profile = null; state.user = null; authScreen(); });
  document.querySelector('#mobile-menu').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
  document.querySelector('#branch-select').addEventListener('change', async (event) => { state.branchId = event.target.value; subscribeOperationalUpdates(); await showPage(state.page); });
  window.addEventListener('online', updateConnection); window.addEventListener('offline', updateConnection); updateConnection();
}

function updateConnection() { const label = document.querySelector('#connect-label'); if (label) label.textContent = navigator.onLine ? 'Online' : 'Offline · perubahan perlu koneksi'; }
async function subscribeOperationalUpdates() {
  if (state.realtimeChannel) await supabase.removeChannel(state.realtimeChannel);
  if (!state.branchId || !state.profile) return;
  const refresh = () => {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      if (document.querySelector('#page') && !document.querySelector('.modal-backdrop')) showPage(state.page);
    }, 350);
  };
  const channel = supabase.channel(`digi-branch-${state.branchId}`);
  for (const table of ['stock_items','stock_repairs','intake_batches']) channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `branch_id=eq.${state.branchId}` }, refresh);
  state.realtimeChannel = channel.subscribe();
}
function header(title, subtitle, actions = '') { return `<div class="page-head"><div><div class="eyebrow">DIGITAL LAPTOP JOMBANG</div><h1>${title}</h1><p>${subtitle}</p></div><div class="head-actions">${actions}</div></div>`; }
function openModal(title, subtitle, body, onSubmit, submitLabel = 'Simpan') {
  const host = document.querySelector('#modal-root');
  host.innerHTML = `<div class="modal-backdrop"><form class="modal" id="active-modal"><div class="modal-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="modal-close" type="button" data-close-modal>×</button></div>${body}<div class="modal-actions"><button class="btn" type="button" data-close-modal>Batal</button><button class="btn primary" type="submit">${submitLabel}</button></div></form></div>`;
  host.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => { host.innerHTML = ''; }));
  host.querySelector('.modal-backdrop').addEventListener('click', (event) => { if (event.target.classList.contains('modal-backdrop')) host.innerHTML = ''; });
  host.querySelector('#active-modal').addEventListener('submit', async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true; try { await onSubmit(new FormData(event.currentTarget)); host.innerHTML = ''; } catch (error) { button.disabled = false; let notice = host.querySelector('.notice'); if (!notice) { notice = document.createElement('div'); notice.className = 'notice error'; event.currentTarget.insertBefore(notice, event.currentTarget.querySelector('.modal-actions')); } else notice.classList.add('error'); notice.textContent = error.message || 'Tidak bisa menyimpan data.'; } });
}
function branchField(name = 'branch_id', value = state.branchId) {
  const branches = state.profile.role === 'owner' ? state.branches : state.branches.filter((branch) => branch.id === state.profile.branch_id);
  return `<div class="field"><label>Cabang</label><select name="${name}" required>${branches.map((branch) => `<option value="${branch.id}" ${branch.id === value ? 'selected' : ''}>${esc(branch.name)}</option>`).join('')}</select></div>`;
}
function checkError(result) { if (result.error) throw result.error; return result.data; }

async function showPage(name) {
  const allowed = name === 'dashboard' || (name === 'receiving' && canIntake()) || (name === 'quality' && canTechnician()) || (['inventory','cashier','service','warranty'].includes(name) && state.profile.role !== 'technician') || (name === 'branches' && canManage());
  if (!allowed) name = state.profile.role === 'technician' ? 'quality' : 'dashboard';
  state.page = name;
  if (!root.querySelector('.app')) showShell();
  document.querySelectorAll('.nav-button[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === name));
  document.querySelector('#crumb-label').textContent = pages[name]?.[0] || 'Ringkasan';
  document.querySelector('#sidebar').classList.remove('open');
  const page = document.querySelector('#page'); page.innerHTML = '<div class="empty">Memuat data…</div>';
  try {
    if (name === 'dashboard') await dashboardPage(page);
    else if (name === 'receiving') await receivingPage(page);
    else if (name === 'quality') await qualityPage(page);
    else if (name === 'inventory') await inventoryPage(page);
    else if (name === 'cashier') await cashierPage(page);
    else if (name === 'service') await servicePage(page);
    else if (name === 'warranty') warrantyPage(page);
    else if (name === 'branches') await branchesPage(page);
  } catch (error) { page.innerHTML = `<div class="notice error">${esc(error.message || 'Gagal memuat data.')}</div>`; }
}

async function dashboardPage(page) {
  let stockQuery = supabase.from('stock_items').select('quantity').eq('branch_id', state.branchId).eq('status', 'available');
  let serviceQuery = supabase.from('service_tickets').select('id,status').eq('branch_id', state.branchId).not('status', 'in', '(handed_over,cancelled)');
  let salesQuery = supabase.from('sales').select('total').eq('branch_id', state.branchId).gte('created_at', dayStart());
  const [stock, services, sales, recentServices, recentSales] = await Promise.all([
    stockQuery, serviceQuery, salesQuery,
    supabase.from('service_tickets').select('ticket_number,customer_name,device_name,status,created_at').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(4),
    supabase.from('sales').select('receipt_number,customer_name,total,created_at').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(4),
  ]);
  [stock, services, sales, recentServices, recentSales].forEach((item) => { if (item.error) throw item.error; });
  const unitCount = (stock.data || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const activeServices = services.data?.length || 0;
  const salesTotal = (sales.data || []).reduce((sum, row) => sum + Number(row.total || 0), 0);
  const readyCount = services.data?.filter((row) => row.status === 'ready').length || 0;
  const recent = [
    ...(recentSales.data || []).map((row) => ({ date: row.created_at, icon: '▣', title: `Penjualan · ${row.receipt_number}`, detail: `${row.customer_name || 'Pelanggan'} · ${money(row.total)}` })),
    ...(recentServices.data || []).map((row) => ({ date: row.created_at, icon: '⌁', title: `Servis · ${row.ticket_number}`, detail: `${row.customer_name} · ${statusText[row.status]}` })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  page.innerHTML = `${header('Ringkasan toko', `Aktivitas real ${branchName(state.branchId)} hari ini.`, '<button class="btn primary" data-go="cashier">＋ Transaksi baru</button>')}
    <div class="cards"><article class="card"><div class="card-label">Penjualan hari ini<span class="card-icon">↗</span></div><div class="card-value">${money(salesTotal)}</div><div class="card-sub">Data transaksi tersimpan</div></article><article class="card"><div class="card-label">Stok tersedia<span class="card-icon">▤</span></div><div class="card-value">${unitCount} <small style="font-size:11px;font-weight:500">unit</small></div><div class="card-sub">Semua produk di cabang ini</div></article><article class="card"><div class="card-label">Servis berjalan<span class="card-icon">⌁</span></div><div class="card-value">${activeServices}</div><div class="card-sub">${readyCount} siap diserahkan</div></article><article class="card"><div class="card-label">Jumlah cabang<span class="card-icon">⌂</span></div><div class="card-value">${state.branches.length}</div><div class="card-sub">Terhubung ke database pusat</div></article></div>
    <div class="grid"><section class="panel"><div class="panel-head"><div><div class="panel-title">Aktivitas terbaru</div><div class="panel-sub">Transaksi dan tiket servis cabang ini</div></div></div>${recent.length ? `<div class="table-wrap"><table><thead><tr><th>AKTIVITAS</th><th>DETAIL</th><th>WAKTU</th></tr></thead><tbody>${recent.map((row) => `<tr><td class="product-name">${esc(row.title)}</td><td>${esc(row.detail)}</td><td>${new Date(row.date).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>Belum ada aktivitas</b>Transaksi dan servis baru akan muncul di sini.</div>'}</section><section class="panel"><div class="panel-head"><div><div class="panel-title">Akses cepat</div><div class="panel-sub">Pekerjaan sehari-hari</div></div></div><div class="quick-links"><button class="quick-link" data-go="receiving"><span>▤</span><div><b>Penerimaan & barcode</b><small>Buat batch dan cetak label unit</small></div><span>→</span></button><button class="quick-link" data-go="quality"><span>⌁</span><div><b>QC & repair</b><small>Periksa laptop dan kelola perbaikan</small></div><span>→</span></button><button class="quick-link" data-go="cashier"><span>▣</span><div><b>Buka kasir</b><small>Catat penjualan dan pembayaran</small></div><span>→</span></button><button class="quick-link" data-go="service"><span>⌁</span><div><b>Servis pelanggan</b><small>Buat tiket dan foto kondisi</small></div><span>→</span></button></div></section></div>`;
  page.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.go)));
}

async function qualityPage(page) {
  if (!canTechnician()) throw new Error('Halaman QC hanya untuk pemilik dan teknisi.');
  const [queueResult, repairResult] = await Promise.all([
    supabase.from('stock_items').select('id,barcode,supplier_barcode,serial_number,supplier,created_at,qc_stage,products(name,sku,brand,model)').eq('branch_id', state.branchId).eq('status', 'pending_qc').order('created_at'),
    supabase.from('stock_repairs').select('id,stock_item_id,issue,status,resolution,updated_at,stock_items(barcode,serial_number,products(name,sku))').eq('branch_id', state.branchId).in('status', ['repair_needed','repairing','waiting_parts','pending_final_qc']).order('updated_at', { ascending: false }),
  ]);
  if (queueResult.error) throw queueResult.error; if (repairResult.error) throw repairResult.error;
  const queue = queueResult.data || []; const repairs = repairResult.data || [];
  const statusLabel = { repair_needed: 'Perlu repair', repairing: 'Sedang diperbaiki', waiting_parts: 'Menunggu sparepart', pending_final_qc: 'Menunggu QC akhir' };
  page.innerHTML = `${header('QC & repair', 'Antrean teknisi untuk pemeriksaan laptop masuk, perbaikan, dan persetujuan stok jual.')}
    <div class="cards"><article class="card"><div class="card-label">Antrean pemeriksaan<span class="card-icon">▤</span></div><div class="card-value">${queue.filter((item) => item.qc_stage === 'initial').length}</div><div class="card-sub">Unit baru menunggu QC</div></article><article class="card"><div class="card-label">Perlu repair<span class="card-icon">⌁</span></div><div class="card-value">${repairs.filter((item) => item.status !== 'pending_final_qc').length}</div><div class="card-sub">Belum dikembalikan ke stok jual</div></article><article class="card"><div class="card-label">QC akhir<span class="card-icon">✓</span></div><div class="card-value">${queue.filter((item) => item.qc_stage === 'final').length}</div><div class="card-sub">Periksa kembali setelah repair</div></article></div>
    <section class="panel scan-panel"><div><div class="panel-title">Mulai dari hasil scan</div><div class="panel-sub">Pindai barcode label dengan scanner atau kamera untuk membuka unitnya.</div></div><form id="qc-scan" class="scan-form"><input name="barcode" placeholder="Scan / ketik DL-…" autocomplete="off" required /><button class="btn" type="button" id="qc-camera">▧ Kamera</button><button class="btn primary" type="submit">Buka QC</button></form><div id="qc-scanner"></div></section>
    <section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Unit menunggu QC</div><div class="panel-sub">Unit yang lulus langsung tersinkron sebagai stok tersedia untuk kasir dan katalog.</div></div><input class="search" id="qc-search" placeholder="Cari barcode, serial, produk" /></div><div class="table-wrap"><table><thead><tr><th>BARCODE / SERIAL</th><th>PRODUK</th><th>TAHAP</th><th>PEMASOK</th><th>DITERIMA</th><th>AKSI</th></tr></thead><tbody id="qc-rows">${queue.map((item) => `<tr><td class="product-name">${esc(item.barcode)}<div class="field-hint">${esc(item.serial_number || 'Serial belum dicatat')}</div></td><td>${esc(item.products?.name || 'Produk')}<div class="field-hint">${esc(`${item.products?.brand || ''} ${item.products?.model || ''}`)}</div></td><td><span class="pill ${item.qc_stage === 'final' ? 'blue' : 'warn'}">${item.qc_stage === 'final' ? 'QC akhir' : 'QC awal'}</span></td><td>${esc(item.supplier || '—')}</td><td>${new Date(item.created_at).toLocaleDateString('id-ID')}</td><td><button class="small-btn" data-qc="${item.id}">Periksa unit</button></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty"><b>Antrean QC kosong</b>Unit yang baru diterima akan muncul di sini setelah barcode dicetak.</div></td></tr>'}</tbody></table></div></section>
    <section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Papan repair</div><div class="panel-sub">Catatan kerusakan, progres teknisi, dan sparepart tercatat pada unit yang sama.</div></div></div><div class="table-wrap"><table><thead><tr><th>UNIT</th><th>MASALAH / CATATAN</th><th>STATUS</th><th>DIUBAH</th><th>AKSI TEKNISI</th></tr></thead><tbody>${repairs.map((repair) => `<tr><td class="product-name">${esc(repair.stock_items?.barcode || 'Unit')}<div class="field-hint">${esc(repair.stock_items?.products?.name || 'Laptop')} · ${esc(repair.stock_items?.serial_number || 'tanpa serial')}</div></td><td>${esc(repair.issue)}${repair.resolution ? `<div class="field-hint">${esc(repair.resolution)}</div>` : ''}</td><td><span class="pill warn">${statusLabel[repair.status] || repair.status}</span></td><td>${new Date(repair.updated_at).toLocaleDateString('id-ID')}</td><td><div class="actions-cell">${repair.status === 'repair_needed' || repair.status === 'waiting_parts' ? `<button class="small-btn" data-repair="${repair.id}" data-status="repairing">Mulai repair</button>` : ''}${repair.status === 'repairing' ? `<button class="small-btn" data-parts="${repair.id}">＋ Sparepart</button><button class="small-btn" data-repair="${repair.id}" data-status="waiting_parts">Tunggu part</button><button class="small-btn" data-finish-repair="${repair.id}">Kirim QC akhir</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Belum ada unit dalam antrean repair.</div></td></tr>'}</tbody></table></div></section>`;
  page.querySelector('#qc-search').addEventListener('input', (event) => { const query = event.target.value.toLowerCase(); page.querySelectorAll('#qc-rows tr').forEach((row) => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(query))); });
  page.querySelector('#qc-scan').addEventListener('submit', (event) => { event.preventDefault(); const code = String(new FormData(event.currentTarget).get('barcode')).trim(); const item = queue.find((row) => row.barcode.toLowerCase() === code.toLowerCase()); if (!item) return toast('Barcode tidak ditemukan di antrean QC cabang ini.', true); stockQcModal(item); });
  page.querySelector('#qc-camera').addEventListener('click', () => startScanner(page.querySelector('#qc-scanner'), page.querySelector('#qc-scan [name="barcode"]')));
  page.querySelectorAll('[data-qc]').forEach((button) => button.addEventListener('click', () => stockQcModal(queue.find((item) => item.id === button.dataset.qc))));
  page.querySelectorAll('[data-repair]').forEach((button) => button.addEventListener('click', async () => { const { error } = await supabase.rpc('update_stock_repair', { _repair_id: button.dataset.repair, _status: button.dataset.status, _resolution: '' }); if (error) toast(error.message, true); else { toast('Status repair tersinkron.'); await showPage('quality'); } }));
  page.querySelectorAll('[data-parts]').forEach((button) => button.addEventListener('click', () => repairPartModal(button.dataset.parts)));
  page.querySelectorAll('[data-finish-repair]').forEach((button) => button.addEventListener('click', () => openModal('Kirim ke QC akhir', 'Unit belum masuk stok jual sampai teknisi meluluskan pemeriksaan akhir.', '<div class="field"><label>Hasil perbaikan</label><textarea name="resolution" rows="4" required placeholder="Contoh: ganti keyboard, uji fungsi normal"></textarea></div>', async (form) => { const { error } = await supabase.rpc('update_stock_repair', { _repair_id: button.dataset.finishRepair, _status: 'pending_final_qc', _resolution: String(form.get('resolution')).trim() }); if (error) throw error; toast('Unit masuk antrean QC akhir.'); await showPage('quality'); }, 'Kirim ke QC akhir')));
}

function stockQcModal(item) {
  if (!item) return;
  const finalQc = item.qc_stage === 'final';
  openModal(finalQc ? 'Pemeriksaan QC akhir' : 'Pemeriksaan laptop masuk', finalQc ? 'Luluskan unit ke stok jual, minta repair lanjutan, atau tandai tidak layak.' : 'Catat kondisi unit lalu tentukan kelayakannya untuk dijual.', `<div class="notice">${esc(item.barcode)} · ${esc(item.products?.name || 'Laptop')}</div><div class="form-grid"><div class="field"><label>Barcode pemasok</label><input name="supplier_barcode" value="${esc(item.supplier_barcode || '')}" placeholder="Barcode bawaan supplier" /></div><div class="field"><label>Nomor seri laptop</label><input name="serial_number" value="${esc(item.serial_number || '')}" placeholder="SN / serial unit" /></div><div class="field full"><label>Hasil pemeriksaan</label><select name="decision"><option value="available">Lolos QC · siap dijual</option><option value="repair_needed">Perlu repair</option><option value="not_sellable">Tidak layak / retur</option></select></div><div class="field full"><label>Catatan kondisi / kerusakan</label><textarea name="notes" rows="4" required placeholder="Catat kondisi fisik, fungsi yang diuji, atau kerusakan"></textarea></div></div>`, async (form) => { const { error } = await supabase.rpc('decide_stock_qc', { _stock_item_id: item.id, _decision: form.get('decision'), _notes: String(form.get('notes')).trim(), _serial_number: String(form.get('serial_number')).trim(), _supplier_barcode: String(form.get('supplier_barcode')).trim() }); if (error) throw error; toast(form.get('decision') === 'available' ? 'Unit lolos QC dan masuk stok tersedia.' : 'Hasil QC dan status unit tersimpan.'); await showPage('quality'); }, 'Simpan hasil QC');
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
    supabase.from('products').select('*').order('name'),
    supabase.from('stock_items').select('id,product_id,branch_id,barcode,supplier_barcode,serial_number,supplier,quantity,status,warranty_until,created_at,qc_stage').eq('branch_id', state.branchId).order('created_at', { ascending: false }),
  ]);
  if (products.error) throw products.error; if (stock.error) throw stock.error;
  state.products = products.data || [];
  return { products: state.products, stock: stock.data || [] };
}

async function receivingPage(page) {
  if (!canIntake()) throw new Error('Halaman ini hanya untuk pemilik dan operator penerimaan.');
  const [products, batches, queue] = await Promise.all([
    supabase.from('products').select('id,name,sku,category').order('name'),
    supabase.from('intake_batches').select('id,product_id,supplier,unit_count,created_at,products(name,sku,category)').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(20),
    supabase.from('stock_items').select('id,barcode,product_id,intake_batch_id,created_at,products(name)').eq('branch_id', state.branchId).eq('status', 'pending_qc').order('created_at', { ascending: false }).limit(300),
  ]);
  [products,batches,queue].forEach((result) => { if (result.error) throw result.error; });
  const pending = queue.data || [];
  const batchRows = (batches.data || []).map((batch) => `<tr><td class="product-name">${esc(batch.id.slice(0, 8).toUpperCase())}<div class="field-hint">${new Date(batch.created_at).toLocaleString('id-ID')}</div></td><td>${esc(batch.products?.name || 'Produk')}</td><td>${esc(batch.supplier || '—')}</td><td>${batch.unit_count} unit</td><td><span class="pill ${batch.products?.category === 'Laptop' ? 'warn' : ''}">${batch.products?.category === 'Laptop' ? 'Menunggu QC' : 'Siap di stok'}</span></td><td><button class="small-btn" data-print-batch="${batch.id}">Cetak ulang label</button></td></tr>`).join('');
  page.innerHTML = `${header('Penerimaan & barcode', 'Catat batch barang borongan dan cetak label sebelum unit masuk rak.', `<button class="btn primary" id="new-intake">＋ Buat penerimaan</button>`)}
    <div class="cards"><article class="card"><div class="card-label">Unit menunggu QC<span class="card-icon">▤</span></div><div class="card-value">${pending.length}</div><div class="card-sub">Cabang ${esc(branchName(state.branchId))}</div></article><article class="card"><div class="card-label">Batch terbaru<span class="card-icon">▦</span></div><div class="card-value">${(batches.data || []).length}</div><div class="card-sub">Penerimaan 20 batch terakhir</div></article><article class="card"><div class="card-label">Alur berikutnya<span class="card-icon">→</span></div><div class="card-value" style="font-size:18px">Pindai & cek</div><div class="card-sub">Teknisi mengerjakan halaman QC & repair</div></article></div>
    <section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Batch penerimaan</div><div class="panel-sub">Label dicetak dari barcode setiap unit. Status belum menjadi stok jual sampai lolos QC.</div></div></div><div class="table-wrap"><table><thead><tr><th>BATCH / WAKTU</th><th>PRODUK</th><th>PEMASOK</th><th>JUMLAH</th><th>STATUS UNIT</th><th>LABEL</th></tr></thead><tbody>${batchRows || '<tr><td colspan="6"><div class="empty"><b>Belum ada penerimaan</b>Buat batch baru untuk membuat barcode sebelum unit masuk ke rak.</div></td></tr>'}</tbody></table></div></section>
    <section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Unit menunggu pemeriksaan</div><div class="panel-sub">Cetak ulang label satuan jika ada yang rusak atau hilang.</div></div><input class="search" id="intake-search" placeholder="Cari barcode atau produk" /></div><div class="table-wrap"><table><thead><tr><th>BARCODE</th><th>PRODUK</th><th>BATCH</th><th>DITERIMA</th><th></th></tr></thead><tbody id="intake-rows">${pending.map((item) => `<tr><td class="product-name">${esc(item.barcode)}</td><td>${esc(item.products?.name || 'Produk')}</td><td>${esc(item.intake_batch_id?.slice(0,8).toUpperCase() || '—')}</td><td>${new Date(item.created_at).toLocaleString('id-ID')}</td><td><button class="small-btn" data-print-one="${item.id}">Cetak label</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Tidak ada unit yang menunggu QC.</div></td></tr>'}</tbody></table></div></section>`;
  page.querySelector('#new-intake').addEventListener('click', () => intakeBatchModal(products.data || []));
  page.querySelectorAll('[data-print-batch]').forEach((button) => button.addEventListener('click', async () => {
    const printWindow = window.open('', '_blank', 'width=760,height=720');
    if (!printWindow) return toast('Izinkan pop-up untuk mencetak label.', true);
    try { const { data, error } = await supabase.from('stock_items').select('barcode,products(name,sku,category)').eq('intake_batch_id', button.dataset.printBatch).order('created_at'); if (error) throw error; printBarcodeLabels(data || [], printWindow); } catch (error) { printWindow.close(); toast(error.message, true); }
  }));
  page.querySelectorAll('[data-print-one]').forEach((button) => button.addEventListener('click', async () => {
    const printWindow = window.open('', '_blank', 'width=500,height=400');
    if (!printWindow) return toast('Izinkan pop-up untuk mencetak label.', true);
    try { const { data, error } = await supabase.from('stock_items').select('barcode,products(name,sku,category)').eq('id', button.dataset.printOne).single(); if (error) throw error; printBarcodeLabels([data], printWindow); } catch (error) { printWindow.close(); toast(error.message, true); }
  }));
  page.querySelector('#intake-search').addEventListener('input', (event) => { const query = event.target.value.toLowerCase(); page.querySelectorAll('#intake-rows tr').forEach((row) => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(query))); });
}

function intakeBatchModal(products) {
  if (!products.length) return toast('Buat data produk dahulu sebelum penerimaan.', true);
  const options = products.map((p) => `<option value="${p.id}">${esc(p.name)} · ${esc(p.sku)}</option>`).join('');
  openModal('Buat batch penerimaan', 'Barcode unit dibuat dan siap dicetak. Unit masuk antrean QC, belum menjadi stok jual.', `<div class="form-grid">${branchField()}<div class="field"><label>Produk / model</label><select name="product_id" required>${options}</select></div><div class="field"><label>Nama pemasok</label><input name="supplier" placeholder="Nama pemasok / lot borongan" /></div><div class="field"><label>Jumlah unit</label><input name="quantity" type="number" min="1" max="500" value="1" required /></div></div><div class="notice" style="margin-top:12px">Setelah disimpan, aplikasi membuat satu barcode per laptop dan membuka lembar cetak label. Tempelkan label sebelum unit diserahkan ke teknisi.</div>`, async (form) => {
    const printWindow = window.open('', '_blank', 'width=760,height=720');
    const { data: batchId, error } = await supabase.rpc('receive_stock_batch', { _branch_id: form.get('branch_id'), _product_id: form.get('product_id'), _supplier: String(form.get('supplier')).trim(), _quantity: Number(form.get('quantity')) });
    if (error) { printWindow?.close(); throw error; }
    const { data, error: itemError } = await supabase.from('stock_items').select('barcode,products(name,sku)').eq('intake_batch_id', batchId).order('created_at');
    if (itemError) { printWindow?.close(); throw itemError; }
    if (printWindow) printBarcodeLabels(data || [], printWindow); else toast('Batch tersimpan. Izinkan pop-up, lalu cetak ulang label dari daftar batch.');
    toast(`${data?.length || 0} barcode dibuat. Tempel label sebelum proses QC.`);
    await showPage('receiving');
  }, 'Buat barcode & cetak');
}

function printBarcodeLabels(items, printable = null) {
  if (!printable) printable = window.open('', '_blank', 'width=760,height=720');
  if (!printable) return toast('Izinkan pop-up untuk mencetak label.', true);
  const labels = items.map((item) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, item.barcode, { format: 'CODE128', displayValue: true, font: 'Arial', fontSize: 11, height: 42, margin: 3, lineColor: '#17201b' });
    const instruction = item.products?.category === 'Laptop' ? 'Tempel pada unit · QC dahulu' : 'Tempel pada barang · barcode stok';
    return `<article class="label"><strong>DIGITAL LAPTOP JOMBANG</strong><span>${esc(item.products?.name || 'Barang')} · ${esc(item.products?.sku || '')}</span>${svg.outerHTML}<small>${instruction}</small></article>`;
  }).join('');
  printable.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Label unit Digi-Laptop</title><style>@page{size:A4;margin:8mm}*{box-sizing:border-box}body{font:10px Arial;color:#17201b;margin:0}.labels{display:grid;grid-template-columns:repeat(3,1fr);align-content:start;gap:5mm}.label{height:31mm;border:1px solid #444;padding:2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;break-inside:avoid}.label strong{font-size:8px;letter-spacing:.08em}.label span{font-size:8px;margin-top:2px}.label svg{width:100%;height:17mm}.label small{font-size:7px}@media screen{body{padding:12px}.label{height:130px}}</style></head><body><main class="labels">${labels}</main><script>window.onload=()=>window.print()<\/script></body></html>`);
  printable.document.close();
}

async function inventoryPage(page) {
  const { products, stock } = await fetchInventory();
  const totals = new Map(); stock.forEach((item) => totals.set(item.product_id, (totals.get(item.product_id) || 0) + (item.status === 'available' ? Number(item.quantity) : 0)));
  const rows = products.map((product) => `<tr><td><div class="product-name">${esc(product.name)}</div><div class="field-hint">${esc(product.brand)} ${esc(product.model)} · ${esc(product.sku)}</div></td><td>${esc(product.category)}</td><td><b>${totals.get(product.id) || 0}</b> unit</td><td>${money(product.retail_price)}</td><td>${money(product.reseller_price)}</td><td>${product.is_public ? '<span class="pill">Tampil</span>' : '<span class="pill gray">Disembunyikan</span>'}</td><td>${canManage() ? `<button class="small-btn" data-public="${product.id}" data-value="${product.is_public}">${product.is_public ? 'Sembunyikan' : 'Publikasikan'}</button>` : '—'}</td></tr>`).join('');
  const action = canManage() ? '<button class="btn primary" id="new-product">＋ Produk baru</button>' : '';
  page.innerHTML = `${header('Produk & stok', 'Kelola produk, stok per cabang, barcode unit, dan dua jenis harga.', action)}<section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Daftar produk</div><div class="panel-sub">${products.length} produk · stok hanya menampilkan cabang terpilih</div></div><input class="search" id="inventory-search" placeholder="Cari nama, SKU, atau brand" /></div><div class="table-wrap"><table><thead><tr><th>PRODUK / SKU</th><th>KATEGORI</th><th>STOK CABANG</th><th>HARGA END USER</th><th>HARGA RESELLER</th><th>KATALOG</th><th>AKSI</th></tr></thead><tbody id="inventory-rows">${rows || '<tr><td colspan="7"><div class="empty"><b>Belum ada produk</b>Tambah produk pertama untuk mulai mencatat stok.</div></td></tr>'}</tbody></table></div></section><section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Unit/barcode terbaru</div><div class="panel-sub">Barcode internal tetap terhubung ke barcode pemasok dan nomor seri</div></div></div><div class="table-wrap"><table><thead><tr><th>BARCODE DIGI-LAPTOP</th><th>BARCODE SUPPLIER</th><th>NOMOR SERI</th><th>PRODUK</th><th>STATUS</th><th>GARANSI</th><th></th></tr></thead><tbody>${stock.slice(0, 8).map((item) => { const product = products.find((p) => p.id === item.product_id); return `<tr><td class="product-name">${esc(item.barcode)}</td><td>${esc(item.supplier_barcode || '—')}</td><td>${esc(item.serial_number || '—')}</td><td>${esc(product?.name || 'Produk')}</td><td><span class="pill ${item.status === 'available' ? '' : ['pending_qc','repair_needed','repairing','waiting_parts'].includes(item.status) ? 'warn' : 'gray'}">${stockStatusText[item.status] || item.status}</span></td><td>${item.warranty_until ? new Date(`${item.warranty_until}T00:00:00`).toLocaleDateString('id-ID') : '—'}</td><td><button class="small-btn" data-print-barcode="${esc(item.barcode)}">Cetak label</button></td></tr>`; }).join('') || '<tr><td colspan="7"><div class="empty">Belum ada unit stok masuk.</div></td></tr>'}</tbody></table></div></section>`;
  page.querySelector('#new-product')?.addEventListener('click', () => productModal());
  page.querySelectorAll('[data-public]').forEach((button) => button.addEventListener('click', async () => {
    if (!canManage()) return toast('Hanya pemilik yang dapat mengubah katalog.', true);
    const { error } = await supabase.from('products').update({ is_public: button.dataset.value !== 'true' }).eq('id', button.dataset.public);
    if (error) toast(error.message, true); else showPage('inventory');
  }));
  page.querySelector('#inventory-search').addEventListener('input', (event) => {
    const query = event.target.value.toLowerCase(); page.querySelectorAll('#inventory-rows tr').forEach((row) => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(query)));
  });
  page.querySelectorAll('[data-print-barcode]').forEach((button) => button.addEventListener('click', () => printBarcode(button.dataset.printBarcode)));
}

function productModal() {
  openModal('Tambah produk', 'Simpan data produk dan harga jual. Stok dicatat terpisah saat barang diterima.', `<div class="form-grid"><div class="field"><label>Nama produk</label><input name="name" required /></div><div class="field"><label>SKU internal</label><input name="sku" placeholder="Otomatis jika kosong" /></div><div class="field"><label>Brand</label><input name="brand" /></div><div class="field"><label>Model</label><input name="model" /></div><div class="field"><label>Kategori</label><select name="category"><option>Laptop</option><option>Sparepart</option><option>Aksesori</option><option>Lainnya</option></select></div><div class="field"><label>Garansi (bulan)</label><input name="warranty_months" type="number" min="0" value="12" /></div><div class="field"><label>Harga modal per unit</label><input name="cost_price" type="number" min="0" value="0" required /></div><div class="field"><label>Harga end user</label><input name="retail_price" type="number" min="0" value="0" required /></div><div class="field"><label>Harga reseller</label><input name="reseller_price" type="number" min="0" value="0" required /></div></div>`, async (form) => {
    if (!canManage()) throw new Error('Hanya pemilik yang dapat menambah produk.');
    const name = String(form.get('name')).trim();
    const sku = String(form.get('sku')).trim() || `DL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    checkError(await supabase.from('products').insert({ organization_id: state.organization.id, name, sku, brand: String(form.get('brand')).trim(), model: String(form.get('model')).trim(), category: form.get('category'), cost_price: Number(form.get('cost_price')), retail_price: Number(form.get('retail_price')), reseller_price: Number(form.get('reseller_price')), warranty_months: Number(form.get('warranty_months')) }));
    await showPage('inventory');
  });
}

function printBarcode(value) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try { JsBarcode(svg, value, { format: 'CODE128', displayValue: true, font: 'Arial', fontSize: 13, height: 48, margin: 8, lineColor: '#17201b' }); }
  catch { return toast('Barcode tidak bisa dibuat.', true); }
  const printable = window.open('', '_blank', 'width=420,height=260');
  if (!printable) return toast('Izinkan pop-up untuk mencetak barcode.', true);
  printable.document.write(`<html><head><title>Barcode ${esc(value)}</title><style>body{font:12px Arial;display:grid;place-items:center;height:90vh}.label{text-align:center;border:1px dashed #aaa;padding:16px}</style></head><body><div class="label"><b>DIGITAL LAPTOP JOMBANG</b><br/>${svg.outerHTML}</div><script>window.onload=()=>window.print()<\/script></body></html>`);
  printable.document.close();
}

async function cashierPage(page) {
  const products = checkError(await supabase.from('products').select('id,name,sku,retail_price,reseller_price').order('name')) || [];
  const stock = checkError(await supabase.from('stock_items').select('product_id,quantity').eq('branch_id', state.branchId).eq('status', 'available')) || [];
  const available = new Map(); stock.forEach((item) => available.set(item.product_id, (available.get(item.product_id) || 0) + Number(item.quantity)));
  const saleResult = await supabase.from('sales').select('receipt_number,customer_name,customer_type,total,payment_method,created_at').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(8);
  if (saleResult.error) throw saleResult.error;
  const productOptions = products.filter((product) => (available.get(product.id) || 0) > 0).map((product) => `<option value="${product.id}">${esc(product.name)} · stok ${available.get(product.id)}</option>`).join('');
  page.innerHTML = `${header('Kasir', `Penjualan ${branchName(state.branchId)} · harga end user dan reseller otomatis ikut pilihan pelanggan.`)}<div class="grid cashier-grid"><section class="panel"><div class="panel-head"><div><div class="panel-title">Transaksi baru</div><div class="panel-sub">Stok berkurang otomatis setelah transaksi disimpan.</div></div></div><form id="sale-form"><div class="form-grid"><div class="field"><label>Nama pelanggan</label><input name="customer_name" placeholder="Opsional" /></div><div class="field"><label>Jenis harga</label><select name="customer_type"><option value="end_user">End user</option><option value="reseller">Reseller</option></select></div><div class="field"><label>Produk</label><select name="product_id" required>${productOptions || '<option value="">Belum ada stok tersedia</option>'}</select></div><div class="field"><label>Jumlah</label><input name="quantity" type="number" min="1" value="1" required /></div><div class="field"><label>Pembayaran</label><select name="payment_method"><option value="cash">Tunai</option><option value="transfer">Transfer</option><option value="qris">QRIS</option><option value="debit">Kartu debit</option><option value="other">Lainnya</option></select></div><div class="field"><label>Harga per unit</label><input id="sale-price" readonly /></div></div><div class="modal-actions"><button class="btn primary" type="submit" ${products.length && productOptions ? '' : 'disabled'}>Simpan transaksi</button></div></form><div id="sale-receipt"></div></section><section class="panel"><div class="panel-head"><div><div class="panel-title">Transaksi terbaru</div><div class="panel-sub">Struk tersimpan di database toko</div></div></div>${saleResult.data?.length ? `<div class="table-wrap"><table><thead><tr><th>NO. STRUK</th><th>PELANGGAN</th><th>TOTAL</th></tr></thead><tbody>${saleResult.data.map((sale) => `<tr><td class="product-name">${esc(sale.receipt_number)}</td><td>${esc(sale.customer_name || 'Pelanggan')}</td><td>${money(sale.total)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>Belum ada transaksi</b>Transaksi tersimpan akan muncul di sini.</div>'}</section></div>`;
  const form = page.querySelector('#sale-form');
  const updatePrice = () => { const product = products.find((item) => item.id === form.product_id.value); const type = form.customer_type.value; const price = product ? Number(type === 'reseller' ? product.reseller_price : product.retail_price) : 0; page.querySelector('#sale-price').value = money(price); };
  form.product_id.addEventListener('change', updatePrice); form.customer_type.addEventListener('change', updatePrice); updatePrice();
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true;
    const product = products.find((item) => item.id === form.product_id.value);
    const { data, error } = await supabase.rpc('create_sale', { _branch_id: state.branchId, _customer_name: String(form.customer_name.value).trim(), _customer_type: form.customer_type.value, _payment_method: form.payment_method.value, _lines: [{ product_id: product.id, quantity: Number(form.quantity.value) }] });
    if (error) { button.disabled = false; toast(error.message, true); return; }
    const sale = checkError(await supabase.from('sales').select('receipt_number,total,customer_name,customer_type,payment_method,created_at,sale_items(product_name,quantity,unit_price,line_total)').eq('id', data).single());
    const receiptHtml = `<div class="receipt" id="receipt-print"><b>DIGITAL LAPTOP JOMBANG</b><br/>${esc(sale.receipt_number)} · ${new Date(sale.created_at).toLocaleString('id-ID')}<hr/><div>${esc(product.name)} × ${Number(form.quantity.value)} · ${sale.customer_type === 'reseller' ? 'Reseller' : 'End user'}</div><b>Total ${money(sale.total)}</b><br/>Pembayaran: ${esc(sale.payment_method)}<br/><button class="small-btn" id="print-receipt">Cetak struk</button></div>`;
    toast('Transaksi tersimpan dan stok sudah berkurang.'); button.disabled = false; await showPage('cashier');
    const receipt = document.querySelector('#sale-receipt'); receipt.innerHTML = receiptHtml;
    receipt.querySelector('#print-receipt').addEventListener('click', () => { const win = window.open('', '_blank', 'width=360,height=500'); if (!win) return; win.document.write(`<html><body style="font:13px monospace;padding:18px">${receipt.querySelector('#receipt-print').innerHTML}<script>window.onload=()=>window.print()<\/script></body></html>`); win.document.close(); });
  });
}

async function servicePage(page) {
  const result = await supabase.from('service_tickets').select('*').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(100);
  if (result.error) throw result.error;
  const tickets = result.data || [];
  page.innerHTML = `${header('Servis laptop', 'Kelola penerimaan, pengerjaan, pemakaian sparepart, dan serah terima.', '<button class="btn primary" id="new-service">＋ Terima laptop</button>')}<section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Tiket servis</div><div class="panel-sub">${tickets.length} tiket terbaru · ${branchName(state.branchId)}</div></div><input class="search" id="service-search" placeholder="Cari tiket, nama, nomor seri" /></div><div class="table-wrap"><table><thead><tr><th>NO. TIKET</th><th>PELANGGAN / UNIT</th><th>KELUHAN</th><th>STATUS</th><th>BIAYA</th><th>AKSI</th></tr></thead><tbody id="service-rows">${tickets.map((ticket) => `<tr><td class="product-name">${esc(ticket.ticket_number)}<div class="field-hint">${new Date(ticket.created_at).toLocaleDateString('id-ID')}</div></td><td>${esc(ticket.customer_name)}<div class="field-hint">${esc(ticket.device_name)} · ${esc(ticket.serial_number || 'tanpa serial')}</div></td><td>${esc(ticket.complaint)}</td><td><select class="status-select" data-status="${ticket.id}">${Object.entries(statusText).map(([value, label]) => `<option value="${value}" ${value === ticket.status ? 'selected' : ''}>${label}</option>`).join('')}</select></td><td>${money(ticket.final_cost || ticket.estimated_cost)}</td><td><div class="actions-cell"><button class="small-btn" data-parts="${ticket.id}">Pakai sparepart</button>${ticket.intake_photo_path ? `<button class="small-btn" data-photo="${esc(ticket.intake_photo_path)}">Foto awal</button>` : ''}${ticket.handover_photo_path ? `<button class="small-btn" data-photo="${esc(ticket.handover_photo_path)}">Foto serah terima</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty"><b>Belum ada tiket servis</b>Buat tiket saat laptop diterima di toko.</div></td></tr>'}</tbody></table></div></section>`;
  page.querySelector('#new-service').addEventListener('click', () => serviceIntakeModal());
  page.querySelectorAll('[data-status]').forEach((select) => select.addEventListener('change', async () => {
    const update = { status: select.value, updated_at: new Date().toISOString() };
    if (select.value === 'handed_over') {
      const form = document.createElement('input'); form.type = 'file'; form.accept = 'image/*'; form.capture = 'environment';
      form.addEventListener('change', async () => finishService(select.dataset.status, select.value, form.files?.[0])); form.click(); return;
    }
    const { error } = await supabase.from('service_tickets').update(update).eq('id', select.dataset.status);
    if (error) { toast(error.message, true); return; } toast('Status tiket diperbarui.');
  }));
  page.querySelectorAll('[data-photo]').forEach((button) => button.addEventListener('click', async () => { const { data, error } = await supabase.storage.from('service-evidence').createSignedUrl(button.dataset.photo, 300); if (error) return toast(error.message, true); window.open(data.signedUrl, '_blank', 'noopener'); }));
  page.querySelectorAll('[data-parts]').forEach((button) => button.addEventListener('click', () => partsModal(button.dataset.parts)));
  page.querySelector('#service-search').addEventListener('input', (event) => { const value = event.target.value.toLowerCase(); page.querySelectorAll('#service-rows tr').forEach((row) => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(value))); });
}

async function serviceIntakeModal() {
  const ticketId = crypto.randomUUID();
  const ticketNumber = `SRV-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  openModal('Terima laptop servis', 'Catat keluhan dan foto kondisi laptop saat diterima.', `<div class="form-grid">${branchField()}<div class="field"><label>Nama pelanggan</label><input name="customer_name" required /></div><div class="field"><label>No. telepon / WhatsApp</label><input name="customer_phone" /></div><div class="field"><label>Unit / model</label><input name="device_name" required placeholder="Contoh: Lenovo IdeaPad Slim 3" /></div><div class="field"><label>Nomor seri</label><input name="serial_number" /></div><div class="field full"><label>Keluhan pelanggan</label><textarea name="complaint" required></textarea></div><div class="field"><label>Estimasi biaya (Rp)</label><input name="estimated_cost" type="number" min="0" value="0" /></div><div class="field"><label>Foto kondisi awal</label><input name="intake_photo" type="file" accept="image/*" capture="environment" /></div></div>`, async (form) => {
    const ticket = { id: ticketId, organization_id: state.organization.id, branch_id: form.get('branch_id'), ticket_number: ticketNumber, customer_name: String(form.get('customer_name')).trim(), customer_phone: String(form.get('customer_phone')).trim(), device_name: String(form.get('device_name')).trim(), serial_number: String(form.get('serial_number')).trim(), complaint: String(form.get('complaint')).trim(), estimated_cost: Number(form.get('estimated_cost') || 0), created_by: state.user.id };
    checkError(await supabase.from('service_tickets').insert(ticket));
    const file = form.get('intake_photo');
    if (file && file.size) {
      const compressed = await compressPhoto(file);
      const path = `${state.organization.id}/${ticket.branch_id}/${ticketId}/intake.jpg`;
      const upload = await supabase.storage.from('service-evidence').upload(path, compressed, { contentType: 'image/jpeg', upsert: true });
      if (upload.error) throw upload.error;
      checkError(await supabase.from('service_tickets').update({ intake_photo_path: path }).eq('id', ticketId));
    }
    toast(`Tiket ${ticketNumber} berhasil dibuat.`);
    await showPage('service');
  }, 'Simpan tiket');
}

async function compressPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Gunakan foto JPG, PNG, atau WebP.');
  const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .82));
}

async function finishService(ticketId, status, file) {
  if (!file) { toast('Pilih foto penyerahan untuk menyelesaikan tiket.', true); return showPage('service'); }
  try {
    const ticket = checkError(await supabase.from('service_tickets').select('organization_id,branch_id').eq('id', ticketId).single());
    const compressed = await compressPhoto(file); const path = `${ticket.organization_id}/${ticket.branch_id}/${ticketId}/handover.jpg`;
    checkError(await supabase.storage.from('service-evidence').upload(path, compressed, { contentType: 'image/jpeg', upsert: true }));
    const current = checkError(await supabase.from('service_tickets').select('estimated_cost').eq('id', ticketId).single());
    const enteredCost = window.prompt('Total biaya service yang disepakati pelanggan (Rp):', String(current.estimated_cost || 0));
    if (enteredCost === null) { await showPage('service'); return; }
    const finalCost = Number(enteredCost);
    if (!Number.isFinite(finalCost) || finalCost < 0) throw new Error('Total biaya harus angka nol atau lebih.');
    checkError(await supabase.from('service_tickets').update({ status, final_cost: finalCost, handover_photo_path: path, updated_at: new Date().toISOString() }).eq('id', ticketId));
    toast('Foto penyerahan tersimpan, tiket ditandai diserahkan.'); await showPage('service');
  } catch (error) { toast(error.message, true); }
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

function warrantyPage(page) {
  page.innerHTML = `${header('Cek garansi', 'Cari barcode Digi-Laptop, barcode pemasok, atau nomor seri unit.')}
    <div class="grid warranty-grid"><section class="panel"><div class="panel-head"><div><div class="panel-title">Pencarian garansi</div><div class="panel-sub">Gunakan pemindai barcode atau masukkan kode secara manual.</div></div></div><form id="warranty-form"><div class="field"><label>Barcode / nomor seri</label><input name="code" autocomplete="off" placeholder="DL-… atau nomor seri" required /></div><div class="modal-actions"><button class="btn" type="button" id="scan-code">▧ Scan kamera</button><button class="btn primary" type="submit">Cari garansi</button></div></form><div id="warranty-result"></div><div id="scanner"></div></section><section class="panel"><div class="panel-title">Data garansi</div><div class="panel-sub" style="line-height:1.7;margin-top:10px">Hasil pencarian menampilkan identitas produk, barcode unit, tanggal berakhir, dan status garansi. Detail kontak pelanggan hanya tersedia untuk tim toko.</div></section></div>`;
  page.querySelector('#warranty-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const code = String(new FormData(event.currentTarget).get('code')).trim(); const target = page.querySelector('#warranty-result'); target.innerHTML = '<div class="empty">Mencari…</div>';
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(code)) { target.innerHTML = '<div class="notice error">Kode barcode atau nomor seri tidak valid.</div>'; return; }
    const result = await supabase.from('stock_items').select('id,barcode,supplier_barcode,serial_number,status,warranty_until,products(name,brand,model),sale_items(quantity,sales(customer_name,created_at))').eq('organization_id', state.organization.id).or(`barcode.eq.${code},supplier_barcode.eq.${code},serial_number.eq.${code}`).maybeSingle();
    if (result.error) { target.innerHTML = `<div class="notice error">${esc(result.error.message)}</div>`; return; }
    if (!result.data) { target.innerHTML = '<div class="notice error">Barcode atau nomor seri tidak ditemukan.</div>'; return; }
    const item = result.data; const expired = item.warranty_until && new Date(`${item.warranty_until}T23:59:59`) < new Date(); const sale = item.sale_items?.[0]?.sales;
    target.innerHTML = `<div class="warranty-result"><span class="pill ${expired ? 'warn' : item.status === 'sold' ? '' : 'gray'}">${item.status !== 'sold' ? 'Belum terjual' : expired ? 'Garansi berakhir' : 'Garansi aktif'}</span><h3>${esc(item.products?.name || 'Produk')}</h3><p>${esc(item.products?.brand || '')} ${esc(item.products?.model || '')}</p><dl><dt>Barcode Digi-Laptop</dt><dd>${esc(item.barcode)}</dd><dt>Barcode pemasok</dt><dd>${esc(item.supplier_barcode || '—')}</dd><dt>Nomor seri</dt><dd>${esc(item.serial_number || '—')}</dd><dt>Garansi sampai</dt><dd>${item.warranty_until ? new Date(`${item.warranty_until}T00:00:00`).toLocaleDateString('id-ID') : 'Tidak ada garansi'}</dd>${sale ? `<dt>Pelanggan</dt><dd>${esc(sale.customer_name || '—')}</dd>` : ''}</dl></div>`;
  });
  page.querySelector('#scan-code').addEventListener('click', () => startScanner(page.querySelector('#scanner'), page.querySelector('[name="code"]')));
}

async function startScanner(host, input) {
  if (!('BarcodeDetector' in window)) return toast('Browser ini belum mendukung scan barcode kamera. Masukkan kodenya manual.', true);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    host.innerHTML = '<div class="camera-wrap"><video autoplay playsinline muted></video></div><button class="small-btn" id="stop-scan">Tutup kamera</button>';
    const video = host.querySelector('video'); video.srcObject = stream;
    const detector = new BarcodeDetector({ formats: ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e'] });
    let active = true;
    host.querySelector('#stop-scan').addEventListener('click', () => { active = false; stream.getTracks().forEach((track) => track.stop()); host.innerHTML = ''; });
    const scan = async () => { if (!active) return; try { const values = await detector.detect(video); if (values.length) { input.value = values[0].rawValue; active = false; stream.getTracks().forEach((track) => track.stop()); host.innerHTML = ''; input.form.requestSubmit(); return; } } catch {} requestAnimationFrame(scan); };
    video.addEventListener('playing', scan, { once: true });
  } catch (error) { toast(error.message || 'Kamera tidak dapat dibuka.', true); }
}

async function branchesPage(page) {
  const invites = canManage() ? checkError(await supabase.from('team_invites').select('id,email,full_name,branch_id,role,created_at').order('created_at', { ascending: false })) || [] : [];
  const users = canManage() ? checkError(await supabase.from('profiles').select('id,full_name,role,branch_id').order('full_name')) || [] : [];
  page.innerHTML = `${header('Cabang & operator', 'Atur akses tim sesuai pekerjaan dan cabangnya.', canManage() ? '<button class="btn" id="new-branch">＋ Cabang</button><button class="btn primary" id="invite-operator">＋ Undang anggota</button>' : '')}<div class="grid"><section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Cabang toko</div><div class="panel-sub">Cabang tersedia untuk pemilik dan operator terdaftar</div></div></div><div class="table-wrap"><table><thead><tr><th>NAMA CABANG</th><th>KOTA</th><th>ALAMAT</th><th>STATUS</th></tr></thead><tbody>${state.branches.map((branch) => `<tr><td class="product-name">${esc(branch.name)}</td><td>${esc(branch.city || '—')}</td><td>${esc(branch.address || '—')}</td><td><span class="pill">Aktif</span></td></tr>`).join('') || '<tr><td colspan="4">Belum ada cabang.</td></tr>'}</tbody></table></div></section><section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Anggota tim</div><div class="panel-sub">Setiap anggota hanya melihat data operasional cabangnya.</div></div></div><div class="table-wrap"><table><thead><tr><th>NAMA</th><th>ROLE</th><th>CABANG</th></tr></thead><tbody>${users.map((user) => `<tr><td>${esc(user.full_name || '—')}</td><td><span class="pill ${user.role === 'owner' ? 'blue' : ''}">${user.role === 'owner' ? 'Pemilik' : user.role === 'technician' ? 'Teknisi · QC & repair' : 'Operator · kasir + servis'}</span></td><td>${esc(branchName(user.branch_id))}</td></tr>`).join('')}</tbody></table></div></section></div>${canManage() ? `<section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Undangan tim</div><div class="panel-sub">Pilih akses operator kasir/servis atau teknisi QC/repair untuk cabang tertentu.</div></div></div><div class="table-wrap"><table><thead><tr><th>NAMA</th><th>EMAIL</th><th>ROLE</th><th>CABANG</th><th>DIBUAT</th></tr></thead><tbody>${invites.map((invite) => `<tr><td>${esc(invite.full_name)}</td><td>${esc(invite.email)}</td><td>${invite.role === 'technician' ? 'Teknisi · QC & repair' : 'Operator · kasir + servis'}</td><td>${esc(branchName(invite.branch_id))}</td><td>${new Date(invite.created_at).toLocaleDateString('id-ID')}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Belum ada undangan.</div></td></tr>'}</tbody></table></div></section>` : ''}`;
  page.querySelector('#new-branch')?.addEventListener('click', () => openModal('Tambah cabang', 'Cabang baru langsung muncul pada pilihan operasional.', `<div class="form-grid"><div class="field"><label>Nama cabang</label><input name="name" required /></div><div class="field"><label>Kota</label><input name="city" /></div><div class="field full"><label>Alamat</label><input name="address" /></div></div>`, async (form) => { checkError(await supabase.from('branches').insert({ organization_id: state.organization.id, name: String(form.get('name')).trim(), city: String(form.get('city')).trim(), address: String(form.get('address')).trim() })); await afterAuth(); }, 'Simpan cabang'));
  page.querySelector('#invite-operator')?.addEventListener('click', () => openModal('Undang anggota tim', 'Tentukan ruang kerja yang tampil setelah akun diaktifkan.', `<div class="form-grid"><div class="field"><label>Nama lengkap</label><input name="full_name" required /></div><div class="field"><label>Email</label><input name="email" type="email" required /></div><div class="field"><label>Role</label><select name="role"><option value="operator">Operator · kasir + servis + penerimaan</option><option value="technician">Teknisi · QC + repair</option></select></div>${branchField()}</div><div class="notice" style="margin-top:12px">Pemilik tetap dapat membuka semua halaman. Teknisi hanya mendapat menu QC & repair untuk cabang yang dipilih.</div>`, async (form) => { checkError(await supabase.from('team_invites').insert({ organization_id: state.organization.id, branch_id: form.get('branch_id'), role: form.get('role'), full_name: String(form.get('full_name')).trim(), email: String(form.get('email')).trim().toLowerCase(), created_by: state.user.id })); await showPage('branches'); }, 'Buat undangan'));
}

function publicCatalog() {
  root.innerHTML = `<main class="catalog-page"><header class="catalog-header"><a class="brand" href="/"><span class="brand-mark">D</span><span class="brand-text"><b>DIGI<span>-</span>LAPTOP</b><small>DIGITAL LAPTOP JOMBANG</small></span></a><a class="btn" href="/">Portal toko →</a></header><section class="catalog-hero"><p class="eyebrow">DIGITAL LAPTOP JOMBANG</p><h1>Temukan laptop<br/><span>yang cocok buat lo.</span></h1><p>Laptop pilihan untuk kebutuhan kerja, belajar, dan usaha.</p></section><section class="catalog-products"><div class="panel-head"><div><div class="panel-title">Katalog produk</div><div class="panel-sub">Tanya ketersediaan dan promo langsung ke toko.</div></div></div><div id="catalog-grid" class="catalog-grid"><div class="empty">Memuat katalog…</div></div></section><footer class="footer"><span>© ${new Date().getFullYear()} DIGITAL LAPTOP JOMBANG</span><span>Harga dapat berubah · hubungi toko untuk stok terkini</span></footer></main>`;
  supabase.from('public_catalog').select('id,name,brand,model,category,retail_price').order('name').then(({ data, error }) => {
    const grid = document.querySelector('#catalog-grid');
    if (error) { grid.innerHTML = `<div class="notice error">Katalog belum bisa dimuat. Coba lagi sebentar.</div>`; return; }
    grid.innerHTML = data?.length ? data.map((product) => `<article class="catalog-card"><div class="catalog-art">▱</div><div class="eyebrow">${esc(product.brand || product.category)}</div><h2>${esc(product.name)}</h2><p>${esc(product.model)}</p><b>${money(product.retail_price)}</b><a href="https://wa.me/?text=${encodeURIComponent(`Halo DIGITAL LAPTOP JOMBANG, saya tertarik dengan ${product.name}`)}" target="_blank" rel="noreferrer">Tanya ketersediaan →</a></article>`).join('') : '<div class="empty"><b>Produk segera hadir</b>Tim toko sedang menyiapkan katalog.</div>';
  });
}

async function start() {
  if (!hasBackendConfig) { configurationScreen(); return; }
  if (location.pathname === '/catalog' || location.pathname === '/catalog/') { publicCatalog(); return; }
  const { data, error } = await supabase.auth.getSession();
  if (error) { authScreen(error.message); return; }
  if (!data.session) { authScreen(); return; }
  state.user = data.session.user;
  await afterAuth();
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) { state.profile = null; state.user = null; authScreen(); }
  });
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch((error) => console.warn('PWA offline cache could not start', error)));
start();
