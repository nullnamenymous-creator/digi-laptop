import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { hasBackendConfig, supabase } from './supabase.js';
import './style.css';

const root = document.querySelector('#app');
const state = { user: null, profile: null, organization: null, branches: [], branchId: '', financeBranch: 'all', page: 'dashboard', products: [], cart: [], authMode: 'login', realtimeChannel: null, refreshTimer: null };
const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value || 0));
const productImageUrl = (path) => path ? supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl : '';
const esc = (value = '') => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const initials = (name = '') => name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'DL';
const branchName = (id) => state.branches.find((branch) => branch.id === id)?.name || 'Cabang';
const resolveOwnerBranch = (organizationId, branches, current = '') => {
  const valid = (id) => branches.some((branch) => branch.id === id);
  const saved = localStorage.getItem(`digi-selected-branch:${organizationId}`) || '';
  return valid(current) ? current : valid(saved) ? saved : branches[0]?.id || '';
};
const canManage = () => state.profile?.role === 'owner';
const canIntake = () => ['owner', 'operator'].includes(state.profile?.role);
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

function authScreen(message = '') {
  const signup = state.authMode === 'signup';
  root.innerHTML = `<main class="login-page"><section class="login-art"><img class="login-hero-photo" src="/login-laptops.webp" alt="Tiga laptop bisnis untuk DIGITAL LAPTOP JOMBANG" /><div class="login-art-inner"><div class="login-brand"><img class="brand-mark" src="/store-logo-transparent.png" alt="" /><span class="brand-text"><b class="login-brand-name">DIGITAL LAPTOP JOMBANG</b></span></div><h1>MANAJEMEN STOK &amp; OPERASIONAL TOKO<br />DIGITAL LAPTOP</h1><p class="login-contact">Jl. Raya Ceweng (timur SPBU Ceweng), Ceweng, Diwek, Jombang, Jawa Timur<br /><span>Tlp/WA: 082226666166</span></p></div></section><section class="login-box-wrap"><form class="login-box" id="auth-form"><div class="brand"><img class="brand-mark" src="/store-logo-transparent.png" alt="Logo DIGITAL LAPTOP JOMBANG" /><span class="brand-text"><b class="login-brand-name">DIGITAL LAPTOP JOMBANG</b></span></div>${signup ? '<h2>Buat akun Digi-Laptop</h2><p>Pembuatan akun pemilik pertama. Operator dan QC dibuat pemilik dari Pengaturan Aplikasi.</p>' : ''}${message ? `<div class="notice error">${esc(message)}</div>` : ''}${signup ? `<div class="field"><label>Nama lengkap</label><input name="full_name" autocomplete="name" required /></div>` : ''}<div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required /></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required /></div><button class="btn primary" type="submit">${signup ? 'Buat akun' : 'Masuk'}</button><div class="login-switch">${signup ? 'Sudah punya akun?' : 'Pemilik pertama kali?'} <button class="text-button" type="button" id="auth-switch">${signup ? 'Masuk' : 'Buat akun'}</button></div></form></section></main>`;
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

async function afterAuth() {
  loading();
  const sessionCacheKey=`digi-offline-session:${state.user.id}`;
  const {data:profile,error}=await supabase.from('profiles').select('*, organizations(*)').eq('id',state.user.id).maybeSingle();
  if(error){
    if(!navigator.onLine){const cached=JSON.parse(localStorage.getItem(sessionCacheKey)||'null');if(cached?.profile&&cached?.branches){state.profile=cached.profile;state.organization=cached.profile.organizations;state.branches=cached.branches;state.branchId=state.profile.role==='owner'?resolveOwnerBranch(state.organization.id,state.branches,state.branchId):state.profile.branch_id;if(['owner','operator'].includes(state.profile.role)&&localStorage.getItem(`digi-offline-cashier:${state.organization.id}:${state.branchId}`))state.page='cashier';subscribeOperationalUpdates();showShell();await showPage(state.page);return}}
    authScreen(error.message);return;
  }
  if(!profile){ownerSetupScreen();return;}
  state.profile=profile;state.organization=profile.organizations;
  const {data:branches,error:branchError}=await supabase.from('branches').select('*').eq('is_active',true).order('name');
  if(branchError){
    if(!navigator.onLine){const cached=JSON.parse(localStorage.getItem(sessionCacheKey)||'null');if(cached?.branches){state.branches=cached.branches;state.branchId=profile.role==='owner'?resolveOwnerBranch(state.organization.id,state.branches,state.branchId):profile.branch_id;if(['owner','operator'].includes(profile.role)&&localStorage.getItem(`digi-offline-cashier:${state.organization.id}:${state.branchId}`))state.page='cashier';subscribeOperationalUpdates();showShell();await showPage(state.page);return}}
    authScreen(branchError.message);return;
  }
  state.branches=branches||[];
  if(profile.role==='technician')state.page='quality';
  state.branchId=profile.role==='owner'?resolveOwnerBranch(state.organization.id,state.branches,state.branchId):profile.branch_id;
  if(!state.branchId){authScreen('Akun ini belum terhubung ke cabang. Minta pemilik toko mengatur cabangnya di Pengaturan Aplikasi.');return;}
  localStorage.setItem(sessionCacheKey,JSON.stringify({profile,branches:state.branches,cachedAt:new Date().toISOString()}));
  subscribeOperationalUpdates();showShell();await showPage(state.page);syncPendingOfflineSales();
}

function showShell() {
  const permittedPages = Object.entries(pages).filter(([key]) => {
    const role = state.profile.role;
    if (role === 'technician') return ['quality','service'].includes(key);
    if (key === 'quality') return false;
    if (key === 'branches') return role === 'owner';
    if (key === 'reports') return ['owner','operator'].includes(role);
    if (key === 'transfers') return ['owner','operator'].includes(role);
    if (['cashier', 'service'].includes(key)) return role === 'operator';
    if (key === 'receiving') return canIntake();
    return ['dashboard', 'inventory', 'warranty', 'contacts', 'finance'].includes(key) || role === 'owner';
  });
  const navHtml = permittedPages.map(([key, [label, icon]]) => `<button class="nav-button${state.page === key ? ' active' : ''}" data-page="${key}"><span class="nav-icon">${icon}</span>${label}</button>`).join('');
  const branchOptions = state.profile.role === 'owner' ? state.branches.map((branch) => `<option value="${branch.id}"${state.branchId === branch.id ? ' selected' : ''}>${esc(branch.name)}</option>`).join('') : `<option value="${state.profile.branch_id}">${esc(branchName(state.profile.branch_id))}</option>`;
  const roleLabel = state.profile.role === 'owner' ? 'Pemilik toko' : state.profile.role === 'technician' ? 'Teknisi · QC & repair' : 'Operator · kasir + servis';
  root.innerHTML = `<div class="app"><aside class="sidebar" id="sidebar"><a class="brand" href="#dashboard"><img class="brand-mark" src="/store-logo-transparent.png" alt="Logo DIGITAL LAPTOP JOMBANG" /><span class="brand-text"><b>DIGITAL LAPTOP</b><small>DIGITAL LAPTOP JOMBANG</small></span></a><div class="nav-label">MENU UTAMA</div><nav class="nav">${navHtml}</nav><div class="side-spacer"></div><div class="side-bottom"><div class="side-note"><b>${roleLabel}</b><p>${state.profile.role === 'owner' ? 'Kelola semua cabang dan aktivitas toko.' : state.profile.role === 'technician' ? 'Periksa unit baru dan kelola perbaikannya.' : 'Akses kasir, servis pelanggan, dan penerimaan.'}</p></div><div class="profile"><span class="avatar">${esc(initials(state.profile.full_name))}</span><span class="profile-meta"><b>${esc(state.profile.full_name || 'Pengguna')}</b><span>${roleLabel}</span></span><button class="logout" id="logout">Keluar</button></div></div></aside><main class="main"><header class="topbar"><button class="mobile-menu" id="mobile-menu" aria-label="Buka menu">☰</button><div class="crumb">${esc(state.organization.name)} <span style="color:#c4cbc4;padding:0 7px">/</span> <b id="crumb-label">${pages[state.page][0]}</b></div><div class="top-tools"><span class="online-label"><i></i><span id="connect-label">Online</span></span><select class="branch-select" id="branch-select" aria-label="Pilih cabang">${branchOptions}</select></div></header><section class="page" id="page"></section><footer class="footer"><span>© ${new Date().getFullYear()} Digital Laptop</span><span>Operasional DIGITAL LAPTOP JOMBANG</span></footer></main><div id="modal-root"></div></div>`;
  document.querySelectorAll('[data-page]').forEach((button) => button.addEventListener('click', async () => { state.page = button.dataset.page; await showPage(state.page); }));
  document.querySelector('#logout').addEventListener('click', async () => { if (state.realtimeChannel) await supabase.removeChannel(state.realtimeChannel); state.realtimeChannel = null; await supabase.auth.signOut(); state.profile = null; state.user = null; authScreen(); });
  document.querySelector('#mobile-menu').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
  document.querySelector('#branch-select').addEventListener('change', async (event) => { const selected=event.target.value;const allowed=state.profile.role==='owner'?state.branches.some((branch)=>branch.id===selected):selected===state.profile.branch_id;if(!allowed){event.target.value=state.branchId;toast('Cabang ini tidak tersedia untuk akun lo.',true);return}state.branchId=selected;if(state.profile.role==='owner')localStorage.setItem(`digi-selected-branch:${state.organization.id}`,selected);subscribeOperationalUpdates();await showPage(state.page); });
  window.addEventListener('online',()=>{updateConnection();syncPendingOfflineSales()}); window.addEventListener('offline',updateConnection); updateConnection();
}

function updateConnection() { const label=document.querySelector('#connect-label');if(label)label.textContent=navigator.onLine?'Online':'Offline · antrean kasir tersimpan di perangkat'; }
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
  host.innerHTML = `<div class="modal-backdrop"><form class="modal" id="active-modal"><div class="modal-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="modal-close" type="button" data-close-modal>×</button></div>${body}<div class="modal-actions"><button class="btn" type="button" data-close-modal>Batal</button><button class="btn primary" type="submit">${submitLabel}</button></div></form></div>`;
  host.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => { host.innerHTML = ''; }));
  host.querySelector('.modal-backdrop').addEventListener('click', (event) => { if (event.target.classList.contains('modal-backdrop')) host.innerHTML = ''; });
  host.querySelector('#active-modal').addEventListener('submit', async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true; try { await onSubmit(new FormData(event.currentTarget)); host.innerHTML = ''; } catch (error) { button.disabled = false; let notice = host.querySelector('.notice'); if (!notice) { notice = document.createElement('div'); notice.className = 'notice error'; event.currentTarget.insertBefore(notice, event.currentTarget.querySelector('.modal-actions')); } else notice.classList.add('error'); notice.textContent = error.message || 'Tidak bisa menyimpan data.'; } });
  return host;
}
function branchField(name = 'branch_id', value = state.branchId) {
  const branches = state.profile.role === 'owner' ? state.branches : state.branches.filter((branch) => branch.id === state.profile.branch_id);
  return `<div class="field"><label>Cabang</label><select name="${name}" required>${branches.map((branch) => `<option value="${branch.id}" ${branch.id === value ? 'selected' : ''}>${esc(branch.name)}</option>`).join('')}</select></div>`;
}
function checkError(result) { if (result.error) throw result.error; return result.data; }

function productPhotoPicker(existingPath = '') {
  const url = productImageUrl(existingPath);
  return `<div class="field full"><label>Foto produk <span class="required-note">wajib untuk produk baru</span></label><div class="photo-picker"><div class="photo-preview" data-photo-preview>${url ? `<img src="${esc(url)}" alt="Foto produk" />` : '<span>Pilih foto dari perangkat atau ambil langsung dari kamera</span>'}</div><div class="photo-actions"><label class="btn">Pilih file / galeri<input class="photo-input" name="product_photo_file" type="file" accept="image/*" /></label><label class="btn">Foto pakai kamera<input class="photo-input camera-input" name="product_photo_camera" type="file" accept="image/*" capture="environment" /></label><small>Foto disimpan untuk katalog dan semua cabang.</small></div></div></div>`;
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

async function uploadProductPhoto(file, key) {
  const path = `${state.organization.id}/products/${key}.jpg`;
  const compressed = await compressPhoto(file);
  const { error } = await supabase.storage.from('product-images').upload(path, compressed, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
  if (error) throw error;
  return path;
}

function productPhotoModal(product) {
  const host = openModal('Foto produk', `${product.name} · fotonya dipakai katalog dan daftar stok.`, `<div class="form-grid">${productPhotoPicker(product.image_path)}</div>`, async (form) => {
    const file = selectedProductPhoto(form);
    if (!file) throw new Error('Pilih foto dari file/galeri atau ambil langsung dengan kamera.');
    const imagePath = await uploadProductPhoto(file, product.id);
    const { error } = await supabase.rpc('set_product_image', { _product_id: product.id, _image_path: imagePath });
    if (error) throw error;
    toast('Foto produk tersimpan.'); await showPage('inventory');
  }, 'Simpan foto');
  bindProductPhotoPicker(host.querySelector('#active-modal'));
}

async function showPage(name) {
  const role = state.profile.role;
  const allowed = role === 'technician'
    ? ['quality','service'].includes(name)
    : role === 'operator'
      ? ['dashboard','receiving','inventory','transfers','cashier','service','warranty','contacts','finance','reports'].includes(name)
      : ['dashboard','receiving','inventory','transfers','warranty','contacts','finance','reports','branches'].includes(name);
  if (!allowed) name = state.profile.role === 'technician' ? 'quality' : 'dashboard';
  state.page = name;
  if (!root.querySelector('.app')) showShell();
  document.querySelectorAll('.nav-button[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === name));
  document.querySelector('#crumb-label').textContent = pages[name]?.[0] || 'Dashboard';
  document.querySelector('#sidebar').classList.remove('open');
  const page = document.querySelector('#page'); page.innerHTML = '<div class="empty">Memuat data…</div>';
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
  } catch (error) { page.innerHTML = `<div class="notice error">${esc(error.message || 'Gagal memuat data.')}</div>`; }
}

async function dashboardPage(page) {
  let stockQuery = supabase.from('stock_items').select('quantity').eq('branch_id', state.branchId).eq('status', 'available');
  let laptopStockQuery = supabase.from('stock_items').select('quantity,products!inner(brand,category)').eq('branch_id', state.branchId).eq('status', 'available').eq('products.category', 'Laptop');
  let serviceQuery = supabase.from('service_tickets').select('id,status').eq('branch_id', state.branchId).not('status', 'in', '(handed_over,cancelled)');
  const ownerView = state.profile.role === 'owner';
  let salesQuery = supabase.from('sales').select('total,branch_id,branches(name)').gte('created_at', dayStart());
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
  const finderBranchProducts = inventoryData.products.filter((product) => finderStock.has(product.id));
  const finderBrands = [...new Set(finderBranchProducts.map((item) => String(item.brand || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'id'));
  const finderCategories = [...new Set(finderBranchProducts.map((item) => item.category).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'id'));
  const finderProducts = finderBranchProducts.map((product) => {
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
  page.innerHTML = `${header('Dashboard Operasional', ownerView ? 'Pantau penjualan seluruh cabang dan operasional cabang terpilih.' : `Aktivitas real ${branchName(state.branchId)} hari ini.`, state.profile.role === 'operator' ? '<button class="btn primary" data-go="cashier">＋ Transaksi baru</button>' : '')}
    <section class="panel dashboard-finder"><div class="panel-head"><div><div class="panel-title">Cari produk & stok</div><div class="panel-sub">Cari nama, merek, model, SKU, barcode, atau nomor seri di ${esc(branchName(state.branchId))}.</div></div><span class="insight-tag" id="finder-count">${finderProducts.length} PRODUK</span></div><div class="finder-controls"><input id="finder-search" type="search" placeholder="Contoh: Dell 5310, DL-0001, barcode atau serial…" aria-label="Cari produk, SKU, barcode, atau serial" /><select id="finder-brand" aria-label="Filter merek"><option value="all">Semua merek</option>${finderBrands.map((brand) => `<option value="${esc(brand)}">${esc(brand)}</option>`).join('')}</select><select id="finder-category" aria-label="Filter kategori"><option value="all">Semua kategori</option>${finderCategories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('')}</select><select id="finder-stock" aria-label="Filter ketersediaan"><option value="all">Semua stok</option><option value="available">Stok tersedia</option><option value="empty">Stok kosong</option></select><select id="finder-sort" aria-label="Urutkan harga"><option value="relevance">Urutan nama</option><option value="low">Harga terendah</option><option value="high">Harga tertinggi</option></select></div><div class="finder-results" id="finder-results"></div><div class="finder-footer"><button class="link-button" data-go="inventory">Buka semua data produk & stok →</button></div></section>
        <div class="cards"><article class="card"><div class="card-label">${ownerView ? 'Penjualan semua cabang' : 'Penjualan hari ini'}<span class="card-icon">↗</span></div><div class="card-value">${money(salesTotal)}</div><div class="card-sub">${ownerView ? 'Akumulasi cabang hari ini' : 'Data transaksi tersimpan'}</div></article><article class="card"><div class="card-label">Stok tersedia<span class="card-icon">▤</span></div><div class="card-value">${unitCount} <small style="font-size:11px;font-weight:500">unit</small></div><div class="card-sub">Semua produk di cabang ini</div></article><article class="card"><div class="card-label">Servis berjalan<span class="card-icon">⌁</span></div><div class="card-value">${activeServices}</div><div class="card-sub">${readyCount} siap diserahkan</div></article><article class="card"><div class="card-label">Jumlah cabang<span class="card-icon">⌂</span></div><div class="card-value">${state.branches.length}</div><div class="card-sub">Terhubung ke database pusat</div></article></div>
    ${ownerBranchSales}
    <div class="dashboard-insights"><section class="panel insight-panel"><div class="panel-head"><div><div class="panel-title">Penjualan tertinggi</div><div class="panel-sub">Laptop paling banyak terjual · ${monthStart.toLocaleDateString('id-ID',{month:'long'})} ini</div></div><span class="insight-tag">TOP 5</span></div><div class="rank-list">${topProductRows || '<div class="empty"><b>Belum ada penjualan bulan ini</b>Produk akan muncul setelah transaksi tersimpan.</div>'}</div></section><section class="panel insight-panel"><div class="panel-head"><div><div class="panel-title">Stok laptop</div><div class="panel-sub">Unit siap dijual di ${esc(branchName(state.branchId))}</div></div><button class="link-button" data-go="inventory">Lihat stok →</button></div><div class="laptop-stock-total"><strong>${laptopUnitCount.toLocaleString('id-ID')}</strong><span>unit tersedia</span></div><div class="brand-stock-list">${laptopBrandRows || '<div class="empty"><b>Belum ada laptop siap jual</b>Unit laptop akan dihitung setelah lolos QC.</div>'}</div></section></div>
    <div class="grid"><section class="panel"><div class="panel-head"><div><div class="panel-title">Aktivitas terbaru</div><div class="panel-sub">Transaksi dan tiket servis cabang ini</div></div></div>${recent.length ? `<div class="table-wrap"><table><thead><tr><th>AKTIVITAS</th><th>DETAIL</th><th>WAKTU</th></tr></thead><tbody>${recent.map((row) => `<tr><td class="product-name">${esc(row.title)}</td><td>${esc(row.detail)}</td><td>${new Date(row.date).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>Belum ada aktivitas</b>Transaksi dan servis baru akan muncul di sini.</div>'}</section><section class="panel"><div class="panel-head"><div><div class="panel-title">Akses cepat</div><div class="panel-sub">${state.profile.role === 'owner' ? 'Pemantauan dan pengelolaan toko' : 'Pekerjaan sehari-hari'}</div></div></div><div class="quick-links">${(state.profile.role === 'owner' ? [['receiving','▤','Penerimaan & barcode','Buat batch dan cetak label unit'],['inventory','▧','Produk & stok','Pantau stok semua cabang'],['finance','Rp','Keuangan','Lihat pemasukan dan pengeluaran']] : [['receiving','▤','Penerimaan & barcode','Buat batch dan cetak label unit'],['inventory','▧','Produk & stok','Kelola stok cabang'],['cashier','▣','Buka kasir','Catat penjualan dan pembayaran'],['service','⌁','Servis pelanggan','Buat tiket dan foto kondisi']]).map(([key,icon,label,description]) => `<button class="quick-link" data-go="${key}"><span>${icon}</span><div><b>${label}</b><small>${description}</small></div><span>→</span></button>`).join('')}</div></section></div>`;
  const renderFinder = () => {
    const query = page.querySelector('#finder-search').value.trim().toLocaleLowerCase('id');
    const brand = page.querySelector('#finder-brand').value;
    const category = page.querySelector('#finder-category').value;
    const availability = page.querySelector('#finder-stock').value;
    const sort = page.querySelector('#finder-sort').value;
    let matches = finderProducts.filter((product) => {
      const text = `${product.name} ${product.brand || ''} ${product.model || ''} ${product.sku || ''} ${product.searchableCodes}`.toLocaleLowerCase('id');
      return (!query || text.includes(query)) && (brand === 'all' || product.brand === brand) && (category === 'all' || product.category === category) && (availability === 'all' || (availability === 'available' ? product.available > 0 : product.available <= 0));
    });
    if (sort === 'low') matches.sort((a,b) => Number(a.retail_price || 0) - Number(b.retail_price || 0));
    else if (sort === 'high') matches.sort((a,b) => Number(b.retail_price || 0) - Number(a.retail_price || 0));
    else matches.sort((a,b) => a.name.localeCompare(b.name, 'id'));
    page.querySelector('#finder-count').textContent = `${matches.length} PRODUK`;
    page.querySelector('#finder-results').innerHTML = matches.slice(0, 8).map((product) => `<button class="finder-result" type="button" data-finder-product="${esc(product.id)}"><span class="finder-photo">${product.image_path ? `<img loading="lazy" src="${esc(productImageUrl(product.image_path))}" alt="" />` : 'DL'}</span><span class="finder-product"><b>${esc(product.name)}</b><small>${esc([product.brand, product.model, product.sku].filter(Boolean).join(' · '))}</small><small>${esc(product.searchableCodes ? `Barcode/serial: ${product.searchableCodes.split(' ')[0]}` : product.category)}</small></span><span class="finder-availability"><b>${product.available.toLocaleString('id-ID')}</b><small>unit tersedia</small></span><span class="finder-price">${money(product.retail_price)}</span><span class="finder-open">Buka →</span></button>`).join('') || '<div class="empty"><b>Produk tidak ditemukan</b>Coba kata kunci, merek, kategori, atau filter stok yang berbeda.</div>';
    page.querySelectorAll('[data-finder-product]').forEach((button) => button.addEventListener('click', () => { const product = finderProducts.find((item) => item.id === button.dataset.finderProduct); state.inventorySearchQuery = product?.name || ''; showPage('inventory'); }));
  };
  ['#finder-search','#finder-brand','#finder-category','#finder-stock','#finder-sort'].forEach((selector) => page.querySelector(selector)?.addEventListener(selector === '#finder-search' ? 'input' : 'change', renderFinder));
  renderFinder();
  page.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.go)));
}

async function qualityPage(page) {
  if (!canTechnician()) throw new Error('Halaman QC hanya tersedia untuk teknisi.');
  const [queue, repairs] = await Promise.all([
    fetchAllRows(supabase.from('stock_items').select('id,barcode,supplier_barcode,serial_number,supplier,created_at,qc_stage,acquisition_cost,products(name,sku,brand,model)').eq('branch_id', state.branchId).eq('status', 'pending_qc').order('created_at')),
    fetchAllRows(supabase.from('stock_repairs').select('id,stock_item_id,issue,status,resolution,labor_cost,stock_repair_parts(cost),updated_at,stock_items(barcode,serial_number,acquisition_cost,products(name,sku))').eq('branch_id', state.branchId).in('status', ['repair_needed','repairing','waiting_parts','pending_final_qc']).order('updated_at', { ascending: false })),
  ]);
  const statusLabel = { repair_needed: 'Perlu repair', repairing: 'Sedang diperbaiki', waiting_parts: 'Menunggu sparepart', pending_final_qc: 'Menunggu QC akhir' };
  page.innerHTML = `${header('QC & repair', 'Antrean teknisi untuk pemeriksaan laptop masuk, perbaikan, dan persetujuan stok jual.')}
    <div class="cards"><article class="card"><div class="card-label">Antrean pemeriksaan<span class="card-icon">▤</span></div><div class="card-value">${queue.filter((item) => item.qc_stage === 'initial').length}</div><div class="card-sub">Unit baru menunggu QC</div></article><article class="card"><div class="card-label">Perlu repair<span class="card-icon">⌁</span></div><div class="card-value">${repairs.filter((item) => item.status !== 'pending_final_qc').length}</div><div class="card-sub">Belum dikembalikan ke stok jual</div></article><article class="card"><div class="card-label">QC akhir<span class="card-icon">✓</span></div><div class="card-value">${queue.filter((item) => item.qc_stage === 'final').length}</div><div class="card-sub">Periksa kembali setelah repair</div></article></div>
    <section class="panel scan-panel"><div><div class="panel-title">Mulai dari hasil scan</div><div class="panel-sub">Pindai barcode label dengan scanner atau kamera untuk membuka unitnya.</div></div><form id="qc-scan" class="scan-form"><input name="barcode" placeholder="Scan / ketik DL-…" autocomplete="off" required /><button class="btn" type="button" id="qc-camera">▧ Kamera</button><button class="btn primary" type="submit">Buka QC</button></form><div id="qc-scanner"></div></section>
    <section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Unit menunggu QC</div><div class="panel-sub">Unit yang lulus langsung tersinkron sebagai stok tersedia untuk kasir dan katalog.</div></div><input class="search" id="qc-search" placeholder="Cari barcode, serial, produk" /></div><div class="table-wrap"><table><thead><tr><th>BARCODE / SERIAL</th><th>PRODUK</th><th>TAHAP</th><th>PEMASOK</th><th>DITERIMA</th><th>AKSI</th></tr></thead><tbody id="qc-rows">${queue.map((item) => `<tr><td class="product-name">${esc(item.barcode)}<div class="field-hint">${esc(item.serial_number || 'Serial belum dicatat')}</div></td><td>${esc(item.products?.name || 'Produk')}<div class="field-hint">${esc(`${item.products?.brand || ''} ${item.products?.model || ''}`)}</div></td><td><span class="pill ${item.qc_stage === 'final' ? 'blue' : 'warn'}">${item.qc_stage === 'final' ? 'QC akhir' : 'QC awal'}</span></td><td>${esc(item.supplier || '—')}</td><td>${new Date(item.created_at).toLocaleDateString('id-ID')}</td><td><button class="small-btn" data-qc="${item.id}">Periksa unit</button></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty"><b>Antrean QC kosong</b>Unit yang baru diterima akan muncul di sini setelah barcode dicetak.</div></td></tr>'}</tbody></table></div></section>
    <section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Papan repair</div><div class="panel-sub">Catatan kerusakan, progres teknisi, sparepart, dan ongkos repair melekat pada barcode laptop.</div></div></div><div class="table-wrap"><table><thead><tr><th>UNIT</th><th>MASALAH / CATATAN</th><th>MODAL TERKUMPUL</th><th>STATUS</th><th>DIUBAH</th><th>AKSI TEKNISI</th></tr></thead><tbody>${repairs.map((repair) => {const partCost=(repair.stock_repair_parts||[]).reduce((sum,line)=>sum+Number(line.cost||0),0),unitCost=Number(repair.stock_items?.acquisition_cost||0)+partCost+Number(repair.labor_cost||0);return `<tr><td class="product-name">${esc(repair.stock_items?.barcode || 'Unit')}<div class="field-hint">${esc(repair.stock_items?.products?.name || 'Laptop')} · ${esc(repair.stock_items?.serial_number || 'tanpa serial')}</div></td><td>${esc(repair.issue)}${repair.resolution ? `<div class="field-hint">${esc(repair.resolution)}</div>` : ''}</td><td><b>${money(unitCost)}</b><div class="field-hint">Beli ${money(repair.stock_items?.acquisition_cost)} · part ${money(partCost)} · jasa ${money(repair.labor_cost)}</div></td><td><span class="pill warn">${statusLabel[repair.status] || repair.status}</span></td><td>${new Date(repair.updated_at).toLocaleDateString('id-ID')}</td><td><div class="actions-cell">${repair.status === 'repair_needed' || repair.status === 'waiting_parts' ? `<button class="small-btn" data-repair="${repair.id}" data-status="repairing">Mulai repair</button>` : ''}${repair.status === 'repairing' ? `<button class="small-btn" data-parts="${repair.id}">＋ Sparepart</button><button class="small-btn" data-repair="${repair.id}" data-status="waiting_parts">Tunggu part</button><button class="small-btn" data-finish-repair="${repair.id}">Kirim QC akhir</button>` : ''}</div></td></tr>`}).join('') || '<tr><td colspan="6"><div class="empty">Belum ada unit dalam antrean repair.</div></td></tr>'}</tbody></table></div></section>`;
  page.querySelector('#qc-search').addEventListener('input', (event) => { const query = event.target.value.toLowerCase(); page.querySelectorAll('#qc-rows tr').forEach((row) => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(query))); });
  page.querySelector('#qc-scan').addEventListener('submit', (event) => { event.preventDefault(); const code = String(new FormData(event.currentTarget).get('barcode')).trim(); const item = queue.find((row) => row.barcode.toLowerCase() === code.toLowerCase()); if (!item) return toast('Barcode tidak ditemukan di antrean QC cabang ini.', true); stockQcModal(item); });
  page.querySelector('#qc-camera').addEventListener('click', () => startScanner(page.querySelector('#qc-scanner'), page.querySelector('#qc-scan [name="barcode"]')));
  page.querySelectorAll('[data-qc]').forEach((button) => button.addEventListener('click', () => stockQcModal(queue.find((item) => item.id === button.dataset.qc))));
  page.querySelectorAll('[data-repair]').forEach((button) => button.addEventListener('click', async () => { const { error } = await supabase.rpc('update_stock_repair', { _repair_id: button.dataset.repair, _status: button.dataset.status, _resolution: '' }); if (error) toast(error.message, true); else { toast('Status repair tersinkron.'); await showPage('quality'); } }));
  page.querySelectorAll('[data-parts]').forEach((button) => button.addEventListener('click', () => repairPartModal(button.dataset.parts)));
  page.querySelectorAll('[data-finish-repair]').forEach((button) => button.addEventListener('click', () => openModal('Kirim ke QC akhir', 'Modal sparepart tercatat dari stok. Masukkan ongkos jasa atau biaya repair luar toko bila ada.', '<div class="form-grid"><div class="field full"><label>Hasil perbaikan</label><textarea name="resolution" rows="4" required placeholder="Contoh: ganti keyboard, uji fungsi normal"></textarea></div><div class="field full"><label>Ongkos jasa / repair luar (opsional)</label><input name="labor_cost" type="number" min="0" step="1000" value="0" /></div></div>', async (form) => { const { error } = await supabase.rpc('finish_stock_repair', { _repair_id: button.dataset.finishRepair, _resolution: String(form.get('resolution')).trim(), _labor_cost: Number(form.get('labor_cost')||0) }); if (error) throw error; toast('Biaya repair tersimpan. Unit masuk antrean QC akhir.'); await showPage('quality'); }, 'Kirim ke QC akhir')));
}

function stockQcModal(item) {
  if (!item) return;
  const finalQc = item.qc_stage === 'final';
  openModal(finalQc ? 'Pemeriksaan QC akhir' : 'Pemeriksaan laptop masuk', finalQc ? 'Luluskan unit ke stok jual, kembalikan untuk perbaikan, atau tandai sebagai scrap/retur.' : 'Pilih hasil sortir. Menunggu RAM/SSD masuk antrean tunggu part; laptop mati bisa dipisahkan sebagai kandidat scrap.', `<div class="notice">${esc(item.barcode)} · ${esc(item.products?.name || 'Laptop')} · modal beli ${money(item.acquisition_cost)}</div><div class="form-grid"><div class="field"><label>Barcode pemasok</label><input name="supplier_barcode" value="${esc(item.supplier_barcode || '')}" placeholder="Barcode bawaan supplier" /></div><div class="field"><label>Nomor seri laptop</label><input name="serial_number" value="${esc(item.serial_number || '')}" placeholder="SN / serial unit" /></div><div class="field full"><label>Hasil pemeriksaan</label><select name="decision"><option value="available">Lolos QC · siap dijual</option>${finalQc ? '' : '<option value="waiting_parts">Butuh RAM / HDD / SSD · tunggu part</option>'}<option value="repair_needed">Perlu repair teknisi</option><option value="not_sellable">Karantina / retur supplier</option><option value="scrap">Scrap / kanibal part · tidak dijual</option></select></div><div class="field full"><label>Catatan kondisi / kerusakan</label><textarea name="notes" rows="4" required placeholder="Contoh: hidup normal, tanpa RAM dan SSD; atau mati, casing retak berat"></textarea></div></div>`, async (form) => { const { error } = await supabase.rpc('decide_stock_qc', { _stock_item_id: item.id, _decision: form.get('decision'), _notes: String(form.get('notes')).trim(), _serial_number: String(form.get('serial_number')).trim(), _supplier_barcode: String(form.get('supplier_barcode')).trim() }); if (error) throw error; toast(form.get('decision') === 'available' ? 'Unit lolos QC dan masuk stok tersedia.' : 'Hasil sortir tersimpan pada unit ini.'); await showPage('quality'); }, 'Simpan hasil QC');
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
    supabase.from('intake_batches').select('id,product_id,supplier,supplier_id,invoice_number,total_amount,amount_paid,due_date,unit_count,created_at,products(name,sku,category),suppliers(name,initials)').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(20),
    fetchAllRows(supabase.from('stock_items').select('id,barcode,product_id,intake_batch_id,created_at,products(name)').eq('branch_id', state.branchId).eq('status', 'pending_qc').order('created_at', { ascending: false })),
    fetchAllRows(supabase.from('suppliers').select('id,name,initials,phone').order('name')),
  ]);
  if (batches.error) throw batches.error;
  const pending = queue;
  const batchRows = (batches.data || []).map((batch) => `<tr><td class="product-name">${esc(batch.id.slice(0, 8).toUpperCase())}<div class="field-hint">${new Date(batch.created_at).toLocaleString('id-ID')}</div></td><td>${esc(batch.products?.name || 'Barang')}</td><td>${esc(batch.suppliers?.name || batch.supplier || '—')} ${batch.suppliers?.initials ? `<span class="pill blue">${esc(batch.suppliers.initials)}</span>` : ''}<div class="field-hint">${esc(batch.invoice_number || '')}</div></td><td>${batch.unit_count} unit</td><td><span class="pill ${batch.products?.category === 'Laptop' ? 'warn' : ''}">${batch.products?.category === 'Laptop' ? 'Menunggu QC' : 'Siap di stok'}</span></td><td><button class="small-btn" data-print-batch="${batch.id}">Cetak label</button></td></tr>`).join('');
  page.innerHTML = `${header('Penerimaan & barcode', 'Catat supplier, jumlah, modal, dan pembayaran barang yang baru datang.', `<button class="btn primary" id="new-intake">＋ Buat penerimaan</button>`)}
    <div class="cards"><article class="card"><div class="card-label">Unit menunggu QC<span class="card-icon">▤</span></div><div class="card-value">${pending.length}</div><div class="card-sub">Cabang ${esc(branchName(state.branchId))}</div></article><article class="card"><div class="card-label">Penerimaan terbaru<span class="card-icon">▦</span></div><div class="card-value">${(batches.data || []).length}</div><div class="card-sub">20 penerimaan terakhir</div></article><article class="card"><div class="card-label">Alur berikutnya<span class="card-icon">→</span></div><div class="card-value" style="font-size:18px">Pindai & cek</div><div class="card-sub">Teknisi mengerjakan halaman QC & repair</div></article></div>
    <section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Riwayat penerimaan barang</div><div class="panel-sub">Label dicetak dari barcode setiap unit. Status belum menjadi stok jual sampai lolos QC.</div></div></div><div class="table-wrap"><table><thead><tr><th>KODE / WAKTU</th><th>PRODUK</th><th>PEMASOK</th><th>JUMLAH</th><th>STATUS UNIT</th><th>LABEL</th></tr></thead><tbody>${batchRows || '<tr><td colspan="6"><div class="empty"><b>Belum ada penerimaan</b>Catat barang datang untuk menghitung stok, modal, hutang supplier, dan membuat barcode.</div></td></tr>'}</tbody></table></div></section>
    <section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Unit menunggu pemeriksaan</div><div class="panel-sub">Cetak ulang label satuan jika ada yang rusak atau hilang.</div></div><input class="search" id="intake-search" placeholder="Cari barcode atau produk" /></div><div class="table-wrap"><table><thead><tr><th>BARCODE</th><th>PRODUK</th><th>BATCH</th><th>DITERIMA</th><th></th></tr></thead><tbody id="intake-rows">${pending.map((item) => `<tr><td class="product-name">${esc(item.barcode)}</td><td>${esc(item.products?.name || 'Produk')}</td><td>${esc(item.intake_batch_id?.slice(0,8).toUpperCase() || '—')}</td><td>${new Date(item.created_at).toLocaleString('id-ID')}</td><td><button class="small-btn" data-print-one="${item.id}">Cetak label</button></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Tidak ada unit yang menunggu QC.</div></td></tr>'}</tbody></table></div></section>`;
  page.querySelector('#new-intake').addEventListener('click', () => intakeBatchModal(products, suppliers));
  page.querySelectorAll('[data-print-batch]').forEach((button) => button.addEventListener('click', async () => {
    const printWindow = window.open('', '_blank', 'width=760,height=720');
    if (!printWindow) return toast('Izinkan pop-up untuk mencetak label.', true);
    try { const { data, error } = await supabase.from('stock_items').select('barcode,supplier,quantity,suppliers(initials),products(name,sku,category)').eq('intake_batch_id', button.dataset.printBatch).order('created_at'); if (error) throw error; const labels=data||[];printBarcodeLabels(labels[0]?.products?.category==='Laptop'?labels:labels.slice(0,1), printWindow); } catch (error) { printWindow.close(); toast(error.message, true); }
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
  const host = openModal('Catat barang masuk', 'Satu penerimaan mengelompokkan barang dari supplier/nota yang sama, menghitung modal dan hutangnya, serta menautkan barcode unit atau lot.', `<div class="form-grid">${branchField()}<div class="field"><label>Produk / barang</label><select name="product_id" required>${options}<option value="__new__">＋ Barang baru, belum ada di produk</option></select></div><div class="field"><label>Jumlah unit masuk</label><input name="quantity" type="number" min="1" max="500" value="1" required /><small class="field-hint">Laptop: barcode unik tiap unit. Sparepart: satu stok lot sesuai jumlah.</small></div><div class="new-product-fields form-grid full" hidden><div class="field"><label>Nama barang baru</label><input name="new_name" placeholder="Contoh: Lenovo ThinkPad T14" /></div><div class="field"><label>SKU (opsional)</label><input name="new_sku" placeholder="Dibuat otomatis kalau kosong" /></div><div class="field"><label>Brand</label><input name="new_brand" /></div><div class="field"><label>Model</label><input name="new_model" /></div><div class="field"><label>Kategori</label><select name="new_category"><option>Laptop</option><option>Sparepart</option><option>Aksesori</option><option>Lainnya</option></select></div><div class="field"><label>Harga end user</label><input name="new_retail" type="number" min="0" value="0" /></div><div class="field"><label>Harga reseller</label><input name="new_reseller" type="number" min="0" value="0" /></div></div>${productPhotoPicker(products[0]?.image_path || '')}<div class="field full"><label>Supplier</label><select name="supplier_pick"><option value="__new__">＋ Supplier baru</option>${supplierOptions}</select></div><div class="new-supplier-fields form-grid full"><div class="field"><label>Nama supplier baru</label><input name="supplier_name" placeholder="Contoh: Asep" required /></div><div class="field"><label>Telepon supplier</label><input name="supplier_phone" placeholder="Opsional" /></div></div><div class="field"><label>No. invoice / nota</label><input name="invoice_number" placeholder="Opsional" /></div><div class="field"><label>Modal beli per unit</label><input name="unit_cost" type="number" min="0" value="0" required /></div><div class="field"><label>Total tagihan supplier · jumlah × modal/unit</label><input name="total_amount" type="text" value="Rp 0" readonly /></div><div class="field"><label>Dibayar sekarang</label><input name="amount_paid" type="number" min="0" value="0" required /></div><div class="field debt-date" hidden><label>Jatuh tempo hutang</label><input name="due_date" type="date" /></div></div><div class="notice" style="margin-top:12px">Sisa tagihan otomatis dihitung dari total penerimaan dikurangi pembayaran awal. Laptop menunggu QC; stok sparepart langsung tersedia untuk pemakaian.</div>`, async (form) => {
    const printWindow = window.open('', '_blank', 'width=760,height=720');
    const isNew = form.get('product_id') === '__new__';
    const existingProduct = products.find((product) => product.id === form.get('product_id'));
    if (isNew && !String(form.get('new_name')).trim()) { printWindow?.close(); throw new Error('Nama barang baru wajib diisi.'); }
    const photoFile = selectedProductPhoto(form);
    let imagePath = existingProduct?.image_path || '';
    if ((isNew || !imagePath) && !photoFile) { printWindow?.close(); throw new Error('Foto wajib dipilih untuk produk baru atau produk yang belum punya foto.'); }
    if (photoFile) { imagePath = await uploadProductPhoto(photoFile, existingProduct?.id || crypto.randomUUID()); if (!isNew) { const photoResult = await supabase.rpc('set_product_image', { _product_id: existingProduct.id, _image_path: imagePath }); if (photoResult.error) { printWindow?.close(); throw photoResult.error; } } }
    const { data: batchId, error } = await supabase.rpc('receive_stock_batch_financial', {
      _branch_id: form.get('branch_id'), _product_id: isNew ? null : form.get('product_id'),
      _new_product: isNew ? { name: String(form.get('new_name')).trim(), sku: String(form.get('new_sku')).trim(), brand: String(form.get('new_brand')).trim(), model: String(form.get('new_model')).trim(), category: form.get('new_category'), cost_price: Number(form.get('unit_cost') || 0), retail_price: Number(form.get('new_retail') || 0), reseller_price: Number(form.get('new_reseller') || 0), image_path: imagePath } : null,
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
  const syncTotal = () => { const total=Math.max(0,Number(form.quantity.value||0))*Math.max(0,Number(form.unit_cost.value||0));form.querySelector('[name="total_amount"]').value=money(total); };
  const syncProductFields = () => { const isNew = form.product_id.value === '__new__'; const option = form.querySelector('select[name="product_id"] option:checked'); form.querySelector('.new-product-fields').hidden = !isNew; if (!isNew) form.unit_cost.value = option?.dataset.cost || 0; else form.unit_cost.value = 0; const hasFile = form.product_photo_file.files.length || form.product_photo_camera.files.length; if (!hasFile) { const imagePath = isNew ? '' : option?.dataset.image || ''; const preview = form.querySelector('[data-photo-preview]'); const url = productImageUrl(imagePath); preview.innerHTML = url ? `<img src="${url}" alt="Foto produk" />` : '<span>Foto wajib untuk produk baru atau yang belum memiliki foto</span>'; } syncTotal(); };
  const syncSupplierFields = () => { const fresh = form.supplier_pick.value === '__new__'; form.querySelector('.new-supplier-fields').hidden = !fresh; form.supplier_name.required = fresh; };
  const syncDebtFields = () => { const total=Number(form.quantity.value||0)*Number(form.unit_cost.value||0);const outstanding=total>Number(form.amount_paid.value||0);const due=form.querySelector('.debt-date');due.hidden=!outstanding;due.querySelector('input').required=outstanding; };
  bindProductPhotoPicker(form);
  form.product_id.addEventListener('change', () => { syncProductFields(); syncDebtFields(); });
  form.supplier_pick.addEventListener('change', syncSupplierFields);
  form.quantity.addEventListener('input', () => { syncTotal(); syncDebtFields(); });
  form.unit_cost.addEventListener('input', () => { syncTotal(); syncDebtFields(); });
  form.amount_paid.addEventListener('input', syncDebtFields);
  syncProductFields(); syncSupplierFields(); syncTotal(); syncDebtFields();
}

function printBarcodeLabels(items, printable = null) {
  if (!printable) printable = window.open('', '_blank', 'width=980,height=820');
  if (!printable) return toast('Izinkan pop-up untuk membuka pratinjau barcode.', true);
  const labels = items.map((item) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, item.barcode, { format: 'CODE128', displayValue: false, font: 'Arial', fontSize: 9, height: 48, margin: 1, lineColor: '#17201b' });
    const supplier = barcodeSupplierInitials(item);
    return `<article class="label"><strong>DL${supplier ? ` · ${esc(supplier)}` : ''}</strong>${svg.outerHTML}<small class="barcode-value">${esc(item.barcode)}</small></article>`;
  }).join('');
  const prefs = JSON.parse(localStorage.getItem('digi-label-settings') || '{}');
  const isLaptopBatch=items.every((item)=>item.products?.category==='Laptop');
  printable.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pratinjau barcode Digi-Laptop</title><style>
    *{box-sizing:border-box}body{font:14px Arial;color:#17201b;margin:0;background:#eef2ee}.toolbar{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid #ccd5cd;padding:14px 20px;display:flex;gap:12px;align-items:end;flex-wrap:wrap}.toolbar label{display:grid;gap:5px;font-size:12px}.toolbar input,.toolbar select,.toolbar button{height:36px;border:1px solid #aebcaf;border-radius:0;padding:0 9px;background:white}.toolbar button{background:#075c37;color:white;font-weight:bold;padding:0 16px;cursor:pointer}.toolbar .count{margin-right:auto;font-weight:bold}.sheets{padding:18px;display:grid;justify-items:center;gap:18px}.sheet{background:white;box-shadow:0 3px 16px #0002;padding:8mm;display:grid;grid-template-columns:repeat(var(--cols),var(--lw));grid-auto-rows:var(--lh);gap:3mm;align-content:start;justify-content:start;overflow:hidden}.label{border:1px solid #59655d;padding:1mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;text-align:center;break-inside:avoid;overflow:hidden}.label strong{font-size:8px;line-height:1;letter-spacing:.04em}.label span{font-size:8px;margin-top:2px}.label svg{width:100%;height:var(--barcode-h);max-height:75%;margin:0}.label small{font-size:7px}.label .barcode-value{font-size:8px;line-height:1.1;font-weight:700;letter-spacing:.03em;white-space:nowrap}.status{font-size:12px;color:#66756a}@media print{body{background:#fff}.toolbar,.status{display:none!important}.sheets{padding:0;gap:0}.sheet{box-shadow:none;margin:0;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}}
  </style></head><body><div class="toolbar"><strong class="count">${isLaptopBatch?`${items.length} barcode unik laptop`:`${items.length} barcode lot · ${Number(items[0]?.quantity||1)} unit stok`}</strong><label>Ukuran kertas<select id="paper"><option>A4</option><option>A5</option><option>Letter</option><option value="custom">Kustom</option></select></label><label>Lebar label (mm)<input id="lw" type="number" min="20" max="200" value="50"></label><label>Tinggi label (mm)<input id="lh" type="number" min="15" max="100" value="24"></label><label>Kolom per baris<input id="cols" type="number" min="1" max="8" value="3"></label><button id="print">Cetak barcode</button></div><div class="status" style="padding:0 20px 8px">Atur dimensi label dan kertas. Printer dipilih melalui dialog cetak Windows/browser.</div><main class="sheets" id="sheets">${labels}</main><script>
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
  const [{ products, stock }, openingResult] = await Promise.all([
    fetchInventory(),
    canManage()
      ? supabase.from('stock_opening_batches').select('id,product_id,unit_count,unit_cost,notes,created_at,products(name,sku,category)').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (openingResult.error) throw openingResult.error;
  const openingBatches = openingResult.data || [];
  const totals = new Map(); stock.forEach((item) => totals.set(item.product_id, (totals.get(item.product_id) || 0) + (item.status === 'available' ? Number(item.quantity) : 0)));
  const branchProductIds = new Set(stock.map((item) => item.product_id));
  const branchProducts = products.filter((product) => branchProductIds.has(product.id));
  const productBrands = [...new Set(products.map((product) => String(product.brand || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b));
  const renderRows = (items) => items.map((product) => `<tr><td><div class="product-photo-thumb">${product.image_path ? `<img loading="lazy" src="${esc(productImageUrl(product.image_path))}" alt="${esc(product.name)}" />` : '<span>Foto belum ada</span>'}</div></td><td><div class="product-name">${esc(product.name)}</div><div class="field-hint">${esc(product.brand)} ${esc(product.model)} · ${esc(product.sku)}</div></td><td>${esc(product.category)}</td><td><b>${totals.get(product.id) || 0}</b> unit</td><td>${money(product.retail_price)}</td><td>${money(product.reseller_price)}</td><td><div class="actions-cell"><button class="small-btn" data-view-product="${product.id}">Detail</button>${canIntake() ? `<button class="small-btn" data-product-photo="${product.id}">${product.image_path ? 'Ganti foto' : '＋ Foto'}</button>` : ''}${canManage() ? `<button class="small-btn" data-edit-product="${product.id}">Edit produk</button>` : ''}</div></td></tr>`).join('');
  const action = canManage() ? '<button class="btn" id="export-products">Ekspor CSV</button><label class="btn">Impor CSV<input id="import-products" type="file" accept=".csv,text/csv" hidden /></label><button class="btn" id="open-opening-stock">＋ Stok awal</button><button class="btn primary" id="new-product">＋ Produk baru</button>' : '';
  const laptopUnits = stock.filter((item) => products.find((product) => product.id === item.product_id)?.category === 'Laptop');
  const componentLots = stock.filter((item) => products.find((product) => product.id === item.product_id)?.category !== 'Laptop');
  const unitCountFor = (status) => laptopUnits.filter((item) => item.status === status).reduce((sum, item) => sum + Number(item.quantity || 1), 0);
  const repairStatuses = new Set(['repair_needed','repairing','waiting_parts']);
  const renderLaptopUnits = (items) => items.map((item) => {
    const product = products.find((row) => row.id === item.product_id);
    const badge = item.status === 'available' ? '' : ['pending_qc','repair_needed','repairing','waiting_parts'].includes(item.status) ? 'warn' : 'gray';
    return `<tr data-unit-status="${esc(item.status)}"><td class="product-name">${esc(item.barcode)}<div class="field-hint">${esc(product?.name || 'Laptop')} · ${esc([product?.brand,product?.model].filter(Boolean).join(' '))}</div></td><td>${esc(item.serial_number || '—')}<div class="field-hint">Sumber: ${item.opening_batch_id ? 'Stok awal' : esc(item.supplier || 'Supplier tidak dicatat')}</div></td><td><span class="pill ${badge}">${stockStatusText[item.status] || item.status}</span></td><td>${money(item.acquisition_cost)}</td><td>${item.warranty_until ? new Date(`${item.warranty_until}T00:00:00`).toLocaleDateString('id-ID') : 'Mulai setelah terjual'}</td><td><div class="actions-cell"><button class="small-btn" data-print-barcode="${esc(item.barcode)}">Cetak barcode stok</button>${item.warranty_code ? `<button class="small-btn" data-print-warranty-unit="${item.id}">Cetak QR garansi</button>` : ''}</div></td></tr>`;
  }).join('');
  const renderComponentLots = (items) => items.map((item) => {
    const product = products.find((row) => row.id === item.product_id);
    const badge = item.status === 'available' ? '' : ['pending_qc','repair_needed','repairing','waiting_parts'].includes(item.status) ? 'warn' : 'gray';
    return `<tr><td class="product-name">${esc(product?.name || 'Barang')}<div class="field-hint">${esc(product?.sku || '')} · ${esc(item.barcode)}</div></td><td>${item.opening_batch_id ? 'Stok awal' : esc(item.supplier || '—')}</td><td><b>${Number(item.quantity || 0)}</b> unit</td><td><span class="pill ${badge}">${stockStatusText[item.status] || item.status}</span></td><td>${money(item.acquisition_cost)}</td><td><button class="small-btn" data-print-barcode="${esc(item.barcode)}">Cetak barcode lot</button></td></tr>`;
  }).join('');
  const catalogSection = `<section class="panel table-panel inventory-catalog-panel" style="margin-top:13px"><div class="panel-head inventory-panel-head"><div><div class="panel-title">Stok produk & harga jual per cabang</div><div class="panel-sub">${branchProducts.length} produk tercatat di ${esc(branchName(state.branchId))} · kolom stok menunjukkan unit siap dijual. Klik Edit produk untuk mengubah data produk.</div></div><div class="inventory-controls"><select id="inventory-category" aria-label="Filter kategori"><option value="all">Semua kategori</option><option value="Laptop">Laptop</option><option value="Sparepart">Sparepart</option><option value="Aksesori">Aksesori</option><option value="Lainnya">Lainnya</option></select><select id="inventory-brand" aria-label="Filter merek"><option value="all">Semua merek</option>${productBrands.map((brand) => `<option value="${esc(brand)}">${esc(brand)}</option>`).join('')}</select><select id="inventory-stock" aria-label="Filter status stok"><option value="branch" selected>Data di cabang ini</option><option value="all">Semua katalog produk</option><option value="available">Ada stok siap jual</option><option value="empty">Stok kosong</option><option value="pending_qc">Menunggu QC</option><option value="repair">Dalam repair</option><option value="sold">Pernah terjual</option></select><input class="price-filter" id="inventory-min-price" type="number" min="0" placeholder="Harga min" aria-label="Harga minimum" /><input class="price-filter" id="inventory-max-price" type="number" min="0" placeholder="Harga max" aria-label="Harga maksimum" /><select id="inventory-sort" aria-label="Urutkan harga"><option value="default">Urutkan harga</option><option value="asc">Harga terendah</option><option value="desc">Harga tertinggi</option></select><input class="search" id="inventory-search" value="${esc(state.inventorySearchQuery || '')}" placeholder="Cari nama, merek, model, SKU" /></div></div><div class="table-wrap"><table><thead><tr><th>FOTO</th><th>PRODUK / SKU</th><th>KATEGORI</th><th>STOK SIAP JUAL</th><th>HARGA END USER</th><th>HARGA RESELLER</th><th>AKSI</th></tr></thead><tbody id="inventory-rows">${renderRows(branchProducts)||'<tr><td colspan="7"><div class="empty"><b>Belum ada produk tercatat di cabang ini</b>Catat penerimaan atau stok awal untuk menghubungkan produk ke cabang ini.</div></td></tr>'}</tbody></table></div></section>`;
  page.innerHTML = `${header('Produk & stok', 'Pantau unit laptop per barcode dan stok sparepart per lot. Stok siap jual hanya menghitung unit yang lolos QC.', action)}
    <section class="cards laptop-unit-summary">
      <article class="card"><div class="card-label">Laptop menunggu QC</div><div class="card-value">${unitCountFor('pending_qc')} <small>unit</small></div><div class="card-sub">Belum masuk stok jual</div></article>
      <article class="card"><div class="card-label">Laptop siap jual</div><div class="card-value">${unitCountFor('available')} <small>unit</small></div><div class="card-sub">Lolos QC dan tersedia di kasir</div></article>
      <article class="card"><div class="card-label">Laptop dalam repair</div><div class="card-value">${[...repairStatuses].reduce((sum,status)=>sum+unitCountFor(status),0)} <small>unit</small></div><div class="card-sub">Repair atau menunggu sparepart</div></article>
      <article class="card"><div class="card-label">Laptop terjual</div><div class="card-value">${unitCountFor('sold')} <small>unit</small></div><div class="card-sub">QR garansi muncul bila unit bergaransi</div></article>
    </section>
    ${catalogSection}
    <section class="panel table-panel stock-unit-panel"><div class="panel-head inventory-panel-head"><div><div class="panel-title">Unit laptop per cabang</div><div class="panel-sub">Setiap laptop tercatat sendiri berdasarkan barcode, mulai dari diterima sampai terjual.</div></div><div class="inventory-controls"><select id="unit-status-filter" aria-label="Filter status unit"><option value="all">Semua status</option><option value="pending_qc">Menunggu QC</option><option value="available">Siap dijual</option><option value="repair_needed">Perlu repair</option><option value="repairing">Sedang repair</option><option value="waiting_parts">Menunggu sparepart</option><option value="sold">Terjual</option><option value="other">Scrap / retur / lainnya</option></select><input class="search" id="unit-search" placeholder="Cari barcode, serial, supplier, model" /></div></div><div class="table-wrap"><table><thead><tr><th>BARCODE / UNIT</th><th>SERIAL / SUPPLIER</th><th>STATUS UNIT</th><th>MODAL PER UNIT</th><th>GARANSI</th><th>AKSI</th></tr></thead><tbody id="laptop-unit-rows">${renderLaptopUnits(laptopUnits)||'<tr><td colspan="6"><div class="empty"><b>Belum ada unit laptop di cabang ini</b>Catat penerimaan laptop untuk membuat barcode dan mulai antrean QC.</div></td></tr>'}</tbody></table></div></section>
    <section class="panel table-panel" style="margin-top:13px"><div class="panel-head"><div><div class="panel-title">Stok sparepart & barang lot</div><div class="panel-sub">Kuantitas sparepart dicatat per lot dan berkurang saat dipakai servis atau dijual. ${componentLots.length} lot di cabang ini.</div></div></div><div class="table-wrap"><table><thead><tr><th>BARANG / BARCODE LOT</th><th>SUPPLIER</th><th>JUMLAH</th><th>STATUS</th><th>MODAL / UNIT</th><th>AKSI</th></tr></thead><tbody>${renderComponentLots(componentLots)||'<tr><td colspan="6"><div class="empty">Belum ada stok sparepart atau barang lot di cabang ini.</div></td></tr>'}</tbody></table></div></section>
    ${canManage() ? `<section class="panel table-panel" style="margin-top:13px"><div class="panel-head"><div><div class="panel-title">Riwayat stok awal</div><div class="panel-sub">Batch pembukaan inventaris · 20 terbaru di ${esc(branchName(state.branchId))}. Barcode bisa dicetak ulang.</div></div></div><div class="table-wrap"><table><thead><tr><th>TANGGAL / KODE</th><th>PRODUK</th><th>JUMLAH</th><th>MODAL / UNIT</th><th>CATATAN</th><th></th></tr></thead><tbody>${openingBatches.map((batch) => `<tr><td class="product-name">${new Date(batch.created_at).toLocaleString('id-ID')}<div class="field-hint">${esc(batch.id.slice(0,8).toUpperCase())}</div></td><td>${esc(batch.products?.name || 'Produk')}<div class="field-hint">${esc(batch.products?.sku || '')}</div></td><td>${Number(batch.unit_count)} unit</td><td>${money(batch.unit_cost)}</td><td>${esc(batch.notes || '—')}</td><td><button class="small-btn" data-print-opening="${batch.id}">Cetak barcode</button></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Belum ada batch stok awal di cabang ini.</div></td></tr>'}</tbody></table></div></section>` : ''}
    <section class="panel table-panel" style="margin-top:13px"><div class="panel-head"><div><div class="panel-title">QR garansi unit terjual</div><div class="panel-sub">QR dibuat setelah laptop bergaransi terjual; cetak dari kolom aksi unit atau halaman Garansi.</div></div><button class="small-btn" id="open-warranty-qr">Buka halaman Garansi →</button></div></section>`;
  page.querySelector('#unit-search').addEventListener('input', (event) => { const query=event.target.value.toLocaleLowerCase('id'); page.querySelectorAll('#laptop-unit-rows tr[data-unit-status]').forEach((row)=>row.classList.toggle('hidden',!row.textContent.toLocaleLowerCase('id').includes(query))); });
  page.querySelector('#unit-status-filter').addEventListener('change', (event) => { const filter=event.target.value; page.querySelectorAll('#laptop-unit-rows tr[data-unit-status]').forEach((row)=>{ const status=row.dataset.unitStatus; const matches=filter==='all'||status===filter||(filter==='other'&&!['pending_qc','available','repair_needed','repairing','waiting_parts','sold'].includes(status)); row.classList.toggle('hidden',!matches); }); });
  page.querySelector('#new-product')?.addEventListener('click', () => productModal());
  page.querySelector('#open-opening-stock')?.addEventListener('click', () => openingStockModal(products));
  page.querySelector('#export-products')?.addEventListener('click', () => downloadCsv('digi-laptop-produk.csv', products.map(({name,sku,brand,model,category,cost_price,retail_price,reseller_price,warranty_months,image_path}) => ({name,sku,brand,model,category,cost_price,retail_price,reseller_price,warranty_months,image_path}))));
  page.querySelector('#import-products')?.addEventListener('change', async (event) => { const file=event.target.files?.[0]; if(!file)return; try { const rows=parseCsv(await file.text()); const required=['name','sku','category']; if(!rows.length||required.some((key)=>!(key in rows[0]))) throw new Error('CSV wajib punya kolom name, sku, category. Gunakan Ekspor CSV sebagai contoh format.'); const seen=new Set();const productsToImport=rows.map((row)=>{const sku=String(row.sku||'').trim()||`DL-${crypto.randomUUID().slice(0,8).toUpperCase()}`;if(seen.has(sku))throw new Error(`SKU ${sku} muncul lebih dari sekali di file.`);seen.add(sku);return {id:products.find(p=>p.sku===sku)?.id||crypto.randomUUID(),organization_id:state.organization.id,name:String(row.name||'').trim(),sku,brand:row.brand||'',model:row.model||'',category:row.category||'Lainnya',cost_price:Number(row.cost_price||0),retail_price:Number(row.retail_price||0),reseller_price:Number(row.reseller_price||0),warranty_months:Number(row.warranty_months||0),image_path:row.image_path||products.find(p=>p.sku===sku)?.image_path||null}}); if(productsToImport.some((x)=>!x.name||![x.cost_price,x.retail_price,x.reseller_price,x.warranty_months].every(Number.isFinite)||[x.cost_price,x.retail_price,x.reseller_price,x.warranty_months].some(v=>v<0))) throw new Error('Nama produk atau nominal di CSV tidak valid.'); const result=await supabase.from('products').upsert(productsToImport,{onConflict:'id'}); if(result.error)throw result.error; toast(`${productsToImport.length} produk berhasil diimpor.`); await showPage('inventory'); } catch(error){toast(error.message||'CSV gagal diimpor.',true)} finally{event.target.value=''} });
  const applyProductFilters = () => {
    const category = page.querySelector('#inventory-category').value; const brand = page.querySelector('#inventory-brand').value; const stockFilter = page.querySelector('#inventory-stock').value; const sort = page.querySelector('#inventory-sort').value; const query = page.querySelector('#inventory-search').value.toLowerCase(); const minPrice = Number(page.querySelector('#inventory-min-price').value || 0); const maxPrice = Number(page.querySelector('#inventory-max-price').value || 0);
    let filtered = products.filter((product) => {
      const items = stock.filter((item) => item.product_id === product.id);
      const availableCount = items.filter((item) => item.status === 'available').reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const hasStatus = (status) => items.some((item) => item.status === status);
      const statusMatch = (stockFilter === 'branch' && items.length > 0) || stockFilter === 'all' || (stockFilter === 'available' && availableCount > 0) || (stockFilter === 'empty' && items.length > 0 && availableCount === 0) || (stockFilter === 'pending_qc' && hasStatus('pending_qc')) || (stockFilter === 'repair' && items.some((item) => repairStatuses.has(item.status))) || (stockFilter === 'sold' && hasStatus('sold'));
      const price = Number(product.retail_price || 0);
      return (category === 'all' || product.category === category) && (brand === 'all' || product.brand === brand) && statusMatch && (!minPrice || price >= minPrice) && (!maxPrice || price <= maxPrice) && `${product.name} ${product.brand} ${product.model} ${product.sku}`.toLowerCase().includes(query);
    });
    if (sort !== 'default') filtered = filtered.sort((a,b) => (Number(a.retail_price)-Number(b.retail_price)) * (sort === 'asc' ? 1 : -1));
    page.querySelector('#inventory-rows').innerHTML = renderRows(filtered) || '<tr><td colspan="8"><div class="empty"><b>Tidak ada produk yang cocok</b>Ubah filter merek, kategori, harga, atau kata pencarian.</div></td></tr>';
    };
  ['#inventory-search','#inventory-category','#inventory-brand','#inventory-stock','#inventory-min-price','#inventory-max-price','#inventory-sort'].forEach((selector) => page.querySelector(selector).addEventListener(selector === '#inventory-search' || selector.includes('price') ? 'input' : 'change', applyProductFilters));
  applyProductFilters();
  page.querySelector('#inventory-rows').addEventListener('click', (event) => {
    const detailButton = event.target.closest('[data-view-product]');
    if (detailButton) return productDetailModal(products.find((item) => item.id === detailButton.dataset.viewProduct), totals.get(detailButton.dataset.viewProduct) || 0);
    const editButton = event.target.closest('[data-edit-product]');
    if (editButton) return productModal(products.find((item) => item.id === editButton.dataset.editProduct));
    const photoButton = event.target.closest('[data-product-photo]');
    if (photoButton) productPhotoModal(products.find((item) => item.id === photoButton.dataset.productPhoto));
  });
  page.querySelector('#open-warranty-qr')?.addEventListener('click', () => showPage('warranty'));
  page.querySelectorAll('[data-print-barcode]').forEach((button) => button.addEventListener('click', () => {
    const printWindow = window.open('', '_blank', 'width=980,height=820');
    if (!printWindow) return toast('Izinkan pop-up untuk membuka pratinjau barcode.', true);
    printBarcode(button.dataset.printBarcode, printWindow);
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
  page.innerHTML = `${header('Mutasi stok antar cabang', 'Kirim stok dari cabang asal, lalu cabang tujuan mengonfirmasi barang yang diterima.', '<button class="btn primary" id="new-stock-transfer">＋ Buat mutasi</button>')}
    <div class="cards"><article class="card"><div class="card-label">Menunggu diterima</div><div class="card-value">${inTransit}</div><div class="card-sub">Barang sedang dalam perjalanan</div></article><article class="card"><div class="card-label">Riwayat mutasi</div><div class="card-value">${rows.length}</div><div class="card-sub">Maksimal 200 catatan terbaru</div></article><article class="card"><div class="card-label">Aturan stok</div><div class="card-value" style="font-size:18px">Kirim → Terima</div><div class="card-sub">Stok tujuan bertambah setelah dikonfirmasi</div></article></div>
    <section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Riwayat mutasi barang</div><div class="panel-sub">Laptop mempertahankan barcode. Mutasi sebagian lot sparepart membuat barcode lot baru di cabang tujuan.</div></div></div><div class="table-wrap"><table><thead><tr><th>NO. / WAKTU</th><th>ASAL → TUJUAN</th><th>BARANG</th><th>STATUS</th><th>CATATAN</th><th>AKSI</th></tr></thead><tbody>${rows.map((transfer) => {
      const transferItems = itemsByTransfer.get(transfer.id) || [];
      const canReceive = transfer.status === 'in_transit' && (canManage() || state.profile.branch_id === transfer.destination_branch_id);
      const status = transfer.status === 'received' ? 'Diterima' : 'Dalam perjalanan';
      return `<tr><td class="product-name">${esc(transfer.transfer_number)}<div class="field-hint">${new Date(transfer.created_at).toLocaleString('id-ID')}</div></td><td>${esc(branchName(transfer.source_branch_id))}<div class="field-hint">→ ${esc(branchName(transfer.destination_branch_id))}</div></td><td>${transferItems.map((item) => `<div class="transfer-item-line"><b>${esc(item.products?.name || 'Barang')}</b> · ${Number(item.quantity)} unit<div class="field-hint">${esc(item.source_barcode)}${item.target_barcode && item.target_barcode !== item.source_barcode ? ` → ${esc(item.target_barcode)}` : ''}</div></div>`).join('') || '—'}</td><td><span class="pill ${transfer.status === 'received' ? '' : 'warn'}">${status}</span></td><td>${esc(transfer.note || '—')}</td><td>${canReceive ? `<button class="small-btn" data-receive-transfer="${transfer.id}">Konfirmasi diterima</button>` : transfer.status === 'in_transit' ? '<span class="field-hint">Menunggu cabang tujuan</span>' : `<span class="field-hint">${transfer.received_at ? new Date(transfer.received_at).toLocaleString('id-ID') : ''}</span>`}</td></tr>`;
    }).join('') || '<tr><td colspan="6"><div class="empty"><b>Belum ada mutasi stok</b>Buat mutasi untuk memindahkan barang antar cabang.</div></td></tr>'}</tbody></table></div></section>`;
  page.querySelector('#new-stock-transfer').addEventListener('click', transferModal);
  page.querySelectorAll('[data-receive-transfer]').forEach((button) => button.addEventListener('click', () => {
    const transfer = rows.find((row) => row.id === button.dataset.receiveTransfer);
    receiveStockTransferModal(transfer, itemsByTransfer.get(transfer?.id) || []);
  }));
}

async function transferModal() {
  const owner = canManage();
  const sourceId = owner ? state.branchId : state.profile.branch_id;
  const sourceField = owner
    ? `<div class="field"><label>Cabang asal</label><select name="source_branch_id" id="transfer-source" required>${state.branches.map((branch) => `<option value="${branch.id}" ${branch.id === sourceId ? 'selected' : ''}>${esc(branch.name)}</option>`).join('')}</select></div>`
    : `<input type="hidden" name="source_branch_id" value="${sourceId}" /><div class="field"><label>Cabang asal</label><input value="${esc(branchName(sourceId))}" readonly /></div>`;
  const host = openModal('Kirim mutasi stok', 'Stok keluar dari cabang asal saat mutasi dikirim. Cabang tujuan perlu menghitung dan mengonfirmasi barang saat tiba.', `<div class="form-grid">${sourceField}<div class="field"><label>Cabang tujuan</label><select name="destination_branch_id" id="transfer-destination" required></select></div><div class="field full"><label>Catatan (opsional)</label><input name="note" maxlength="1000" placeholder="Contoh: pengiriman unit ke cabang Malang" /></div><div class="field full"><label>Daftar barang</label><div class="transfer-lines" id="transfer-lines"></div><button class="btn" type="button" id="add-transfer-line">＋ Tambah barang</button><small class="field-hint">Laptop dipindah per unit/barcode. Sparepart dapat dipindah sebagian dari satu lot.</small></div></div>`, async (form) => {
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
  let stockRows = [];
  let lineValues = [{ stock_item_id: '', quantity: 1 }];
  const getSource = () => String(form.elements.namedItem('source_branch_id').value);
  const refreshDestinations = () => {
    const previous = destinationSelect.value;
    const options = state.branches.filter((branch) => branch.id !== getSource());
    destinationSelect.innerHTML = options.map((branch) => `<option value="${branch.id}" ${branch.id === previous ? 'selected' : ''}>${esc(branch.name)}</option>`).join('');
    if (!options.some((branch) => branch.id === previous)) destinationSelect.value = options[0]?.id || '';
  };
  const loadStock = async () => {
    const { data, error } = await supabase.from('stock_items').select('id,barcode,quantity,acquisition_cost,products(name,sku,category)').eq('branch_id', getSource()).eq('status', 'available').gt('quantity', 0).order('created_at', { ascending: false });
    if (error) throw error;
    stockRows = data || [];
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
  form.querySelector('#add-transfer-line').addEventListener('click', () => { lineValues.push({ stock_item_id: '', quantity: 1 }); renderLines(); });
  form.elements.namedItem('source_branch_id').addEventListener('change', async () => {
    refreshDestinations();
    try { await loadStock(); lineValues = [{ stock_item_id: '', quantity: 1 }]; renderLines(); }
    catch (error) { toast(error.message, true); }
  });
  refreshDestinations();
  try { await loadStock(); renderLines(); }
  catch (error) { host.innerHTML = ''; toast(error.message, true); }
}

function receiveStockTransferModal(transfer, items) {
  if (!transfer) return;
  const detail = items.map((item) => `<div class="notice">${esc(item.products?.name || 'Barang')} · ${Number(item.quantity)} unit<br/>Barcode asal: ${esc(item.source_barcode)}${item.split_lot ? ' · lot sebagian, barcode baru dibuat saat diterima' : ''}</div>`).join('');
  openModal(`Terima mutasi ${transfer.transfer_number}`, `${branchName(transfer.source_branch_id)} → ${branchName(transfer.destination_branch_id)}. Hitung barang dan cocokkan barcode fisik sebelum konfirmasi.`, `${detail}<div class="field"><label><input type="checkbox" name="confirm_received" required /> Jumlah dan barang fisik sudah saya periksa.</label></div>`, async () => {
    const result = checkError(await supabase.rpc('receive_stock_transfer', { _transfer_id: transfer.id }));
    const newLotBarcodes = (result.items || []).filter((item) => item.source_barcode !== item.target_barcode).map((item) => item.target_barcode);
    toast(newLotBarcodes.length ? `Mutasi diterima. Barcode lot baru: ${newLotBarcodes.join(', ')}. Stok tersedia di cabang ini.` : 'Mutasi diterima. Stok sekarang tersedia di cabang ini.');
    await showPage('transfers');
  }, 'Konfirmasi penerimaan');
}

function openingStockModal(products) {
  if (!canManage()) return toast('Stok awal hanya dapat dicatat oleh pemilik.', true);
  const productOptions = products.map((product) => `<option value="${product.id}" data-category="${esc(product.category)}" data-cost="${Number(product.cost_price || 0)}">${esc(product.name)} · ${esc(product.sku)} · ${esc(product.category)}</option>`).join('');
  const host = openModal('Catat stok awal', 'Catat barang lama yang sudah siap jual. Jika produknya belum ada, buat dari form ini dan otomatis masuk ke katalog produk.', `<div class="form-grid">${branchField()}<div class="field"><label>Produk</label><select name="product_id" required>${productOptions}<option value="__new__" ${products.length ? '' : 'selected'}>＋ Produk belum ada · buat produk baru</option></select></div><div class="opening-new-product-fields form-grid full" hidden><div class="field"><label>Nama produk</label><input name="new_name" placeholder="Contoh: Dell Latitude 5310" /></div><div class="field"><label>SKU (opsional)</label><input name="new_sku" placeholder="Dibuat otomatis jika kosong" /></div><div class="field"><label>Merek</label><input name="new_brand" placeholder="Dell, Lenovo, HP..." /></div><div class="field"><label>Model</label><input name="new_model" /></div><div class="field"><label>Kategori</label><select name="new_category"><option>Laptop</option><option>Sparepart</option><option>Aksesori</option><option>Lainnya</option></select></div><div class="field"><label>Garansi produk (bulan)</label><input name="new_warranty" type="number" min="0" value="12" /></div><div class="field"><label>Harga end user</label><input name="new_retail" type="number" min="0" value="0" /></div><div class="field"><label>Harga reseller</label><input name="new_reseller" type="number" min="0" value="0" /></div></div><div class="opening-product-photo" hidden>${productPhotoPicker('')}</div><div class="field"><label>Jumlah stok awal</label><input name="quantity" type="number" min="1" max="500" value="1" required /><small class="field-hint">Laptop mendapat barcode unik per unit. Sparepart dicatat sebagai satu lot.</small></div><div class="field"><label>Modal per unit</label><input name="unit_cost" type="number" min="0" step="1000" value="${Number(products[0]?.cost_price || 0)}" required /><small class="field-hint">Isi 0 jika nilai modal lama tidak diketahui.</small></div><div class="field full opening-serial-field"><label>Nomor seri laptop (opsional, satu per baris)</label><textarea name="serial_numbers" rows="4" placeholder="SN pertama&#10;SN kedua&#10;SN ketiga"></textarea><small class="field-hint">Jika diisi, jumlah nomor seri harus sama dengan jumlah unit.</small></div><div class="field full"><label>Catatan pembukaan stok (opsional)</label><textarea name="notes" rows="2" maxlength="1000" placeholder="Contoh: stok display awal CABANG A"></textarea></div></div><div class="notice" style="margin-top:12px">Stok awal langsung berstatus siap dijual. Pakai fitur ini hanya untuk unit yang sudah lolos pemeriksaan. Laptop baru datang dan belum QC harus dicatat lewat Penerimaan & barcode.</div>`, async (form) => {
    const isNewProduct = form.get('product_id') === '__new__';
    let product = products.find((item) => item.id === String(form.get('product_id')));
    if (isNewProduct) {
      const name = String(form.get('new_name') || '').trim();
      if (!name) throw new Error('Nama produk baru wajib diisi.');
      const photo = selectedProductPhoto(form);
      if (!photo) throw new Error('Foto wajib dipilih untuk produk baru.');
      const sku = String(form.get('new_sku') || '').trim() || `DL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const imagePath = await uploadProductPhoto(photo, crypto.randomUUID());
      const values = { id: crypto.randomUUID(), organization_id: state.organization.id, name, sku, brand: String(form.get('new_brand') || '').trim(), model: String(form.get('new_model') || '').trim(), category: String(form.get('new_category')), cost_price: Number(form.get('unit_cost') || 0), retail_price: Number(form.get('new_retail') || 0), reseller_price: Number(form.get('new_reseller') || 0), warranty_months: Number(form.get('new_warranty') || 0), image_path: imagePath };
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
      form.product_id.add(option);
      form.product_id.value = product.id;
      form.product_id.dispatchEvent(new Event('change'));
    }
    if (!product) throw new Error('Pilih produk yang valid.');
    const quantity = Number(form.get('quantity'));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) throw new Error('Jumlah stok awal harus 1 sampai 500.');
    const serials = String(form.get('serial_numbers') || '').split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (product.category.toLowerCase() === 'laptop' && serials.length && serials.length !== quantity) throw new Error(`Masukkan ${quantity} nomor seri atau kosongkan semuanya.`);
    if (product.category.toLowerCase() !== 'laptop' && serials.length) throw new Error('Nomor seri per unit hanya tersedia untuk laptop.');
    if (new Set(serials.map((value) => value.toLowerCase())).size !== serials.length) throw new Error('Ada nomor seri yang tercatat lebih dari sekali.');
    const printWindow = window.open('', '_blank', 'width=980,height=820');
    const { data, error } = await supabase.rpc('record_opening_stock', {
      _branch_id: String(form.get('branch_id')),
      _product_id: product.id,
      _quantity: quantity,
      _unit_cost: Number(form.get('unit_cost')),
      _unit_details: serials.length ? serials.map((serial_number) => ({ serial_number })) : [],
      _notes: String(form.get('notes') || '').trim(),
    });
    if (error) { printWindow?.close(); throw new Error(isNewProduct ? `Produk berhasil ditambahkan ke katalog, tetapi pencatatan stok awal gagal: ${error.message}` : error.message); }
    const labels = (data?.items || []).map((item) => ({ ...item, supplier: 'Stok awal', products: product }));
    if (printWindow) printBarcodeLabels(labels, printWindow);
    toast(product.category.toLowerCase() === 'laptop'
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
    form.querySelector('[name="new_name"]').required = isNew;
    if (!isNew) form.unit_cost.value = form.product_id.selectedOptions[0]?.dataset.cost || 0;
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

function productDetailModal(product, available = 0) {
  if (!product) return;
  const host=document.querySelector('#modal-root');
  host.innerHTML=`<div class="modal-backdrop"><section class="modal product-detail-modal"><div class="modal-head"><div><h2>${esc(product.name)}</h2><p>Detail produk dan harga saat ini</p></div><button class="modal-close" type="button" data-detail-close>×</button></div><div class="product-detail-content"><div class="product-detail-photo">${product.image_path?`<img src="${esc(productImageUrl(product.image_path))}" alt="${esc(product.name)}" />`:'Foto belum tersedia'}</div><dl><dt>SKU</dt><dd>${esc(product.sku)}</dd><dt>Merek / model</dt><dd>${esc([product.brand,product.model].filter(Boolean).join(' · ')||'—')}</dd><dt>Kategori</dt><dd>${esc(product.category)}</dd><dt>Stok tersedia di cabang</dt><dd>${Number(available).toLocaleString('id-ID')} unit</dd><dt>Harga modal / unit</dt><dd>${money(product.cost_price)}</dd><dt>Harga end user</dt><dd>${money(product.retail_price)}</dd><dt>Harga reseller</dt><dd>${money(product.reseller_price)}</dd><dt>Garansi produk</dt><dd>${Number(product.warranty_months||0)} bulan</dd></dl></div><div class="modal-actions"><button class="btn" type="button" data-detail-close>Tutup</button>${canManage()?'<button class="btn primary" type="button" data-detail-edit>Edit detail</button>':''}</div></section></div>`;
  host.querySelectorAll('[data-detail-close]').forEach(button=>button.addEventListener('click',()=>{host.innerHTML=''}));
  host.querySelector('.modal-backdrop').addEventListener('click',event=>{if(event.target.classList.contains('modal-backdrop'))host.innerHTML=''});
  host.querySelector('[data-detail-edit]')?.addEventListener('click',()=>{host.innerHTML='';productModal(product)});
}

function productModal(product = null) {
  const v=(key,fallback='')=>esc(product?.[key]??fallback);
  const host = openModal(product?'Edit produk':'Tambah produk', product?'Perbarui harga, spesifikasi, kategori, garansi, dan foto produk.':'Setiap produk dilengkapi foto dari file, galeri, atau kamera.', `<div class="form-grid"><div class="field"><label>Nama produk</label><input name="name" value="${v('name')}" required /></div><div class="field"><label>SKU internal</label><input name="sku" value="${v('sku')}" placeholder="Otomatis jika kosong" required /></div><div class="field"><label>Brand</label><input name="brand" value="${v('brand')}" /></div><div class="field"><label>Model</label><input name="model" value="${v('model')}" /></div><div class="field"><label>Kategori</label><select name="category">${['Laptop','Sparepart','Aksesori','Lainnya'].map(x=>`<option ${product?.category===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Garansi (bulan)</label><input name="warranty_months" type="number" min="0" value="${v('warranty_months',12)}" required /></div><div class="field"><label>Modal beli per unit</label><input name="cost_price" type="number" min="0" value="${v('cost_price',0)}" required /></div><div class="field"><label>Harga end user</label><input name="retail_price" type="number" min="0" value="${v('retail_price',0)}" required /></div><div class="field"><label>Harga reseller</label><input name="reseller_price" type="number" min="0" value="${v('reseller_price',0)}" required /></div></div><div class="form-grid" style="margin-top:12px">${productPhotoPicker(product?.image_path||'')}</div>`, async (form) => {
    if (!canManage()) throw new Error('Hanya pemilik yang dapat mengubah produk.');
    const name=String(form.get('name')).trim(),sku=String(form.get('sku')).trim()||`DL-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
    const file=selectedProductPhoto(form);if(!product&&!file)throw new Error('Foto produk wajib dipilih.');
    const imagePath=file?await uploadProductPhoto(file,product?.id||crypto.randomUUID()):product?.image_path||null;
    const values={name,sku,brand:String(form.get('brand')).trim(),model:String(form.get('model')).trim(),category:form.get('category'),cost_price:Number(form.get('cost_price')),retail_price:Number(form.get('retail_price')),reseller_price:Number(form.get('reseller_price')),warranty_months:Number(form.get('warranty_months')),image_path:imagePath};
    if(Object.values(values).some(value=>typeof value==='number'&&(!Number.isFinite(value)||value<0)))throw new Error('Harga dan masa garansi harus berupa angka nol atau lebih.');
    if(product)checkError(await supabase.from('products').update(values).eq('id',product.id));else checkError(await supabase.from('products').insert({id:crypto.randomUUID(),organization_id:state.organization.id,...values}));
    toast(product?'Detail produk diperbarui.':'Produk tersimpan.');await showPage('inventory');
  },product?'Simpan perubahan':'Simpan produk');
  bindProductPhotoPicker(host.querySelector('#active-modal'));
}

async function printBarcode(value, printable) {
  try {
    const { data, error } = await supabase.from('stock_items').select('barcode,supplier,suppliers(initials),quantity,products(name,sku,category)').eq('barcode', value).single();
    if (error) throw error;
    printBarcodeLabels([data], printable);
  } catch (error) { printable?.close(); toast(error.message || 'Data barcode gagal dimuat.', true); }
}

function printSaleReceipt(sale) {
  const win = window.open('', '_blank', 'width=420,height=700');
  if (!win) return toast('Izinkan pop-up untuk mencetak struk.', true);
  const lines = (sale.sale_items || []).map((line) => `<tr><td>${esc(line.product_name)} × ${Number(line.quantity)}</td><td>${money(line.line_total ?? Number(line.unit_price) * Number(line.quantity))}</td></tr>`).join('');
  const paid = Number(sale.paid_amount || 0), total = Number(sale.total || 0);
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Struk ${esc(sale.receipt_number || '')}</title><style>
    @page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0 auto;color:#111;font:12px/1.45 Arial,sans-serif}
    h1{margin:0 0 3px;text-align:center;font-size:15px}p{margin:2px 0;text-align:center}.meta{margin:10px 0;border-top:1px dashed #555;border-bottom:1px dashed #555;padding:6px 0}
    table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}.totals{margin-top:7px;border-top:1px dashed #555;padding-top:6px}
    .thanks{text-align:center;margin-top:12px}@media print{body{width:auto}}
  </style></head><body><h1>${esc(state.organization.name || 'DIGITAL LAPTOP JOMBANG')}</h1><p>${esc(state.organization.phone || '')}</p><p>${esc(state.organization.address || '')}</p>
    <div class="meta">No: ${esc(sale.receipt_number || 'Transaksi')}<br>Waktu: ${new Date(sale.created_at || Date.now()).toLocaleString('id-ID')}<br>Pembeli: ${esc(sale.customer_name || 'Pembeli umum')}</div>
    <table>${lines || '<tr><td>Detail produk tidak tersedia</td></tr>'}</table><div class="totals">Total: <b>${money(total)}</b><br>Dibayar: ${money(paid)}${paid < total ? `<br>Sisa piutang: ${money(total - paid)}` : ''}<br>Metode: ${esc(sale.payment_method || '—')}</div><p class="thanks">Terima kasih telah berbelanja.</p>
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150))<\/script></body></html>`);
  win.document.close();
}

async function syncPendingOfflineSales() {
  if(!navigator.onLine||!state.profile||!state.organization)return;
  const prefix=`digi-sale-outbox:${state.organization.id}:`;let changed=false,anyChanged=false,submitted=0;
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;
    let rows;try{rows=JSON.parse(localStorage.getItem(key)||'[]')}catch{continue}
    for(const row of rows){
      if(row.status!=='queued'||row.organization_id!==state.organization.id)continue;
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
  const cacheKey=`digi-offline-cashier:${state.organization.id}:${state.branchId}`;let products,customers,stock,sales=[];
  try { const [productRows,customerRows,stockRows,ar]=await Promise.all([fetchAllRows(supabase.from('products').select('id,name,sku,brand,model,retail_price,reseller_price,image_path').order('name')),fetchAllRows(supabase.from('customers').select('id,name,phone,customer_type').order('name')),fetchAllRows(supabase.from('stock_items').select('product_id,quantity,barcode,serial_number').eq('branch_id',state.branchId).eq('status','available')),supabase.from('sales').select('id,receipt_number,customer_name,total,paid_amount,payment_method,created_at,sale_items(product_name,quantity,unit_price,line_total)').eq('branch_id',state.branchId).order('created_at',{ascending:false}).limit(8)]);if(ar.error)throw ar.error;products=productRows;customers=customerRows;stock=stockRows;sales=ar.data||[];localStorage.setItem(cacheKey,JSON.stringify({products,customers,stock,cachedAt:new Date().toISOString()})); }
  catch(error){if(navigator.onLine)throw error;const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');if(!cached)throw new Error('Data kasir belum tersimpan di perangkat ini. Buka halaman kasir saat online dahulu.');({products,customers,stock}=cached);sales=[];}
  const available=new Map();stock.forEach(item=>available.set(item.product_id,(available.get(item.product_id)||0)+Number(item.quantity)));
  const availableProducts=products.filter(product=>(available.get(product.id)||0)>0);
  const productOptions=availableProducts.map(product=>`<option value="${product.id}">${esc(product.name)} · stok ${available.get(product.id)}</option>`).join('');
  const queueKey=`digi-sale-outbox:${state.organization.id}:${state.branchId}`,readQueue=()=>JSON.parse(localStorage.getItem(queueKey)||'[]'),saveQueue=(q)=>localStorage.setItem(queueKey,JSON.stringify(q));
  let cart=[];
  page.innerHTML=`${header('Kasir',`Transaksi ${branchName(state.branchId)} · beberapa produk per struk${navigator.onLine?'':' · mode offline'}`)}<div class="grid cashier-grid"><section class="panel cashier-checkout"><div class="panel-head"><div><div class="panel-title">Transaksi baru</div><div class="panel-sub">Pilih pelanggan, masukkan barang ke keranjang, lalu simpan pembayaran.</div></div><span class="pill ${navigator.onLine?'':'gray'}">${navigator.onLine?'Online':'Offline'}</span></div><form id="sale-form"><div class="form-grid"><div class="field"><label>Pelanggan terdaftar</label><select name="customer_id"><option value="">Pembeli umum</option>${customers.map(customer=>`<option value="${customer.id}">${esc(customer.name)} · ${customer.customer_type==='reseller'?'Reseller':'End user'} · ${esc(customer.phone||'tanpa telepon')}</option>`).join('')}</select></div><div class="field"><label>Nama pembeli</label><input name="customer_name" placeholder="Nama pembeli umum" /></div><div class="field"><label>Harga pelanggan</label><select name="customer_type"><option value="end_user">End user</option><option value="reseller">Reseller</option></select><small class="field-hint" id="customer-price-hint">Pembeli umum memakai harga end user secara default. Pilih reseller jika transaksi menggunakan harga reseller.</small></div><div class="field"><label>Cari produk / barcode / serial</label><input id="sale-product-search" placeholder="Ketik nama, SKU, barcode, atau serial…" autocomplete="off" /></div><div class="field"><label>Produk tersedia</label><select name="product_id" ${productOptions?'required':''}>${productOptions||'<option value="">Tidak ada stok tersedia</option>'}</select></div><div class="sale-photo-preview full" id="sale-photo-preview"><span>Pilih produk untuk melihat fotonya.</span></div><div class="field"><label>Jumlah</label><input name="quantity" type="number" min="1" value="1" required /></div><div class="field"><label>Harga satuan</label><input id="sale-price" readonly /></div><div class="field full"><button class="btn" type="button" id="add-cart-line" ${productOptions?'':'disabled'}>＋ Tambahkan ke keranjang</button></div></div><section class="panel table-panel cashier-cart"><div class="panel-head"><div><div class="panel-title">Keranjang</div><div class="panel-sub" id="cart-count">Belum ada barang</div></div><b id="cart-total">${money(0)}</b></div><div class="table-wrap"><table><thead><tr><th>PRODUK</th><th>HARGA</th><th>QTY</th><th>SUBTOTAL</th><th></th></tr></thead><tbody id="cart-lines"><tr><td colspan="5"><div class="empty">Pilih produk lalu tambahkan ke keranjang.</div></td></tr></tbody></table></div></section><div class="form-grid cashier-payment"><div class="field"><label>Metode pembayaran</label><select name="payment_method"><option value="cash">Tunai</option><option value="transfer">Transfer</option><option value="qris">QRIS</option><option value="debit">Kartu debit</option><option value="other">Lainnya</option></select></div><div class="field"><label>Pelunasan</label><select name="payment_mode"><option value="full">Lunas sekarang</option><option value="credit">Tempo / piutang</option></select></div><div class="credit-fields form-grid full" hidden><div class="field"><label>Dibayar sekarang</label><input name="paid_amount" type="number" min="0" value="0" /></div><div class="field"><label>Jatuh tempo</label><input name="due_date" type="date" /></div></div></div><div class="cashier-submit"><span>Total belanja <b id="checkout-total">${money(0)}</b></span><button class="btn primary" type="submit" disabled>Simpan transaksi</button></div></form><div id="sale-receipt"></div><section id="offline-queue"></section></section><section class="panel cashier-recent"><div class="panel-head"><div><div class="panel-title">Transaksi terbaru</div><div class="panel-sub">Cetak ulang struk dari transaksi tersimpan</div></div></div>${sales.length?`<div class="table-wrap"><table><thead><tr><th>NO. STRUK</th><th>TOTAL</th><th>AKSI</th></tr></thead><tbody>${sales.map(sale=>`<tr><td class="product-name">${esc(sale.receipt_number)}<div class="field-hint">${esc(sale.customer_name||'Pembeli umum')} · ${new Date(sale.created_at).toLocaleString('id-ID')}</div></td><td>${money(sale.total)}<div class="field-hint">Dibayar ${money(sale.paid_amount)}</div></td><td><button class="small-btn" type="button" data-print-sale="${sale.id}">Cetak</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><b>Belum ada transaksi</b>Transaksi tersimpan di cabang ini akan tampil di sini.</div>'}</section></div>`;
  const form=page.querySelector('#sale-form'),productSelect=form.product_id,productSearch=page.querySelector('#sale-product-search'),priceFor=product=>Number(form.customer_type.value==='reseller'?product.reseller_price:product.retail_price),updateSelected=()=>{const product=products.find(p=>p.id===productSelect.value),inCart=cart.filter(line=>line.product.id===product?.id).reduce((sum,line)=>sum+line.quantity,0),remaining=product?Math.max(0,(available.get(product.id)||0)-inCart):0;page.querySelector('#sale-price').value=product?money(priceFor(product)):money(0);page.querySelector('#sale-photo-preview').innerHTML=product?.image_path?`<img src="${productImageUrl(product.image_path)}" alt="${esc(product.name)}"/><span>${esc(product.name)}</span>`:product?`<span>${esc(product.name)} · stok tersisa ${remaining} unit</span>`:'<span>Pilih produk untuk melihat fotonya.</span>';form.quantity.max=String(Math.max(1,remaining));if(Number(form.quantity.value)>remaining)form.quantity.value=String(Math.max(1,remaining));page.querySelector('#add-cart-line').disabled=!product||remaining<1;};
  const renderCart=()=>{const total=cart.reduce((sum,item)=>sum+priceFor(item.product)*item.quantity,0);page.querySelector('#cart-count').textContent=cart.length?`${cart.length} jenis produk · ${cart.reduce((sum,item)=>sum+item.quantity,0)} unit`:'Belum ada barang';page.querySelector('#cart-total').textContent=money(total);page.querySelector('#checkout-total').textContent=money(total);form.querySelector('[type="submit"]').disabled=!cart.length;form.paid_amount.max=String(total);if(Number(form.paid_amount.value)>total)form.paid_amount.value=String(total);page.querySelector('#cart-lines').innerHTML=cart.length?cart.map((item,i)=>`<tr><td class="product-name">${esc(item.product.name)}<div class="field-hint">${esc(item.product.sku)}</div></td><td>${money(priceFor(item.product))}</td><td>${item.quantity}</td><td>${money(priceFor(item.product)*item.quantity)}</td><td><button class="small-btn" type="button" data-remove-line="${i}">Hapus</button></td></tr>`).join(''):'<tr><td colspan="5"><div class="empty">Pilih produk lalu tambahkan ke keranjang.</div></td></tr>';page.querySelectorAll('[data-remove-line]').forEach(btn=>btn.addEventListener('click',()=>{cart.splice(Number(btn.dataset.removeLine),1);renderCart();updateSelected()}));};
  form.customer_id.addEventListener('change',()=>{const customer=customers.find(item=>item.id===form.customer_id.value);if(customer){form.customer_name.value=customer.name;form.customer_name.readOnly=true;form.customer_type.value=customer.customer_type==='reseller'?'reseller':'end_user';page.querySelector('#customer-price-hint').textContent=`Harga awal mengikuti data pelanggan (${customer.customer_type==='reseller'?'reseller':'end user'}). Pilihan harga bisa diubah untuk transaksi ini saja.`}else{form.customer_name.value='';form.customer_name.readOnly=false;form.customer_type.value='end_user';page.querySelector('#customer-price-hint').textContent='Pembeli umum memakai harga end user secara default. Pilih reseller jika transaksi menggunakan harga reseller.'}updateSelected();renderCart()});productSelect.addEventListener('change',updateSelected);form.customer_type.addEventListener('change',()=>{page.querySelector('#customer-price-hint').textContent='Harga '+(form.customer_type.value==='reseller'?'reseller':'end user')+' dipakai pada transaksi ini saja; tipe pelanggan tersimpan tidak berubah.';updateSelected();renderCart()});form.payment_mode.addEventListener('change',()=>{form.querySelector('.credit-fields').hidden=form.payment_mode.value!=='credit';form.paid_amount.required=form.payment_mode.value==='credit';form.due_date.required=form.payment_mode.value==='credit';form.paid_amount.max=String(cart.reduce((sum,line)=>sum+priceFor(line.product)*line.quantity,0))});productSearch.addEventListener('input',()=>{productSearch.value=productSearch.value.slice(0,160);const query=productSearch.value.trim().toLocaleLowerCase('id');const matches=availableProducts.filter(product=>`${product.name} ${product.sku} ${product.brand||''} ${product.model||''}`.toLocaleLowerCase('id').includes(query)||stock.some(row=>row.product_id===product.id&&`${row.barcode||''} ${row.serial_number||''}`.toLocaleLowerCase('id').includes(query)));const selected=productSelect.value;productSelect.innerHTML=`<option value="">${matches.length?'Pilih produk tersedia':'Produk tidak ditemukan'}</option>${matches.map(product=>`<option value="${product.id}">${esc(product.name)} · stok ${available.get(product.id)}</option>`).join('')}`;if(matches.some(product=>product.id===selected))productSelect.value=selected;updateSelected()});productSearch.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(productSelect.options.length>1){productSelect.selectedIndex=1;updateSelected()}}});page.querySelectorAll('[data-print-sale]').forEach(button=>button.addEventListener('click',()=>{const sale=sales.find(row=>row.id===button.dataset.printSale);if(sale)printSaleReceipt(sale)}));updateSelected();renderCart();
  page.querySelector('#add-cart-line').addEventListener('click',()=>{const product=products.find(p=>p.id===productSelect.value),quantity=Number(form.quantity.value);if(!product||!Number.isInteger(quantity)||quantity<1)return toast('Pilih produk dan jumlah yang benar.',true);const already=cart.filter(x=>x.product.id===product.id).reduce((n,x)=>n+x.quantity,0);if(already+quantity>(available.get(product.id)||0))return toast(`Stok ${product.name} tidak cukup. Tersedia ${Math.max(0,(available.get(product.id)||0)-already)} unit lagi.`,true);const line=cart.find(x=>x.product.id===product.id);if(line)line.quantity+=quantity;else cart.push({product,quantity});form.quantity.value='1';renderCart();updateSelected()});
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!cart.length) return toast('Keranjang masih kosong.', true);
    const total = cart.reduce((sum,item)=>sum+priceFor(item.product)*item.quantity,0);
    const paid = form.payment_mode.value === 'full' ? total : Number(form.paid_amount.value);
    if (!Number.isFinite(paid) || paid < 0 || paid > total) return toast('Nominal pembayaran tidak valid.', true);
    if (paid < total && !String(form.customer_name.value || '').trim()) return toast('Nama pembeli wajib diisi untuk transaksi piutang.', true);
    if (paid < total && !form.due_date.value) return toast('Tanggal jatuh tempo wajib untuk piutang.', true);
    const payload = {
      request_id: crypto.randomUUID(), organization_id: state.organization.id, branch_id: state.branchId,
      customer_name: customers.find(customer=>customer.id===form.customer_id.value)?.name || String(form.customer_name.value).trim(), customer_id: form.customer_id.value || null,
      customer_type: form.customer_type.value, payment_method: form.payment_method.value,
      lines: cart.map(item=>({product_id:item.product.id,quantity:item.quantity,expected_price:priceFor(item.product)})),
      paid_amount: paid, due_date: paid < total ? form.due_date.value : null,
      created_at: new Date().toISOString(), status: 'queued'
    };
    const button = form.querySelector('[type="submit"]'); button.disabled = true;
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
      await showPage('cashier');
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
    } finally { button.disabled=false; }
  });
  function renderOfflineQueue() {
    const q=readQueue().filter(x=>x.status!=='cancelled'),host=page.querySelector('#offline-queue');
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
  let query = supabase.from('service_tickets').select('*,customers(id,name,phone)').eq('branch_id', state.branchId).order('created_at', { ascending: false }).limit(100);
  if (isTechnician) query = query.or(`assigned_technician_id.is.null,assigned_technician_id.eq.${state.user.id}`);
  const [result, teamResult] = await Promise.all([
    query,
    supabase.from('profiles').select('id,full_name').eq('organization_id', state.organization.id).eq('branch_id', state.branchId).eq('role', 'technician'),
  ]);
  if (result.error) throw result.error;
  if (teamResult.error) throw teamResult.error;
  const tickets = result.data || [];
  const technicians = new Map((teamResult.data || []).map((person) => [person.id, person.full_name]));
  const headerActions = !isTechnician ? '<button class="btn primary" id="new-service">＋ Terima laptop</button>' : '';
  page.innerHTML = `${header(isTechnician ? 'Servis pelanggan' : 'Servis laptop', isTechnician ? `Antrean pelanggan untuk ${branchName(state.branchId)}. Catatan dan progres tersinkron ke operator.` : `Terima laptop pelanggan, pantau progres teknisi, lalu lakukan serah terima di ${branchName(state.branchId)}.`, headerActions)}${!isTechnician && !technicians.size ? `<div class="notice">Belum ada akun teknisi di ${esc(branchName(state.branchId))}. Tiket bisa dicatat, tetapi perlu teknisi cabang agar dapat dikerjakan. Tambahkan akun teknisi dari Pengaturan Aplikasi.</div>` : ''}<section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">${isTechnician ? 'Antrean teknisi' : 'Tiket servis'}</div><div class="panel-sub">${tickets.length} tiket · ${branchName(state.branchId)}${isTechnician ? ' · ditugaskan ke lo atau belum ditugaskan' : ''}</div></div><input class="search" id="service-search" placeholder="Cari tiket, nama, nomor seri" /></div><div class="table-wrap"><table><thead><tr><th>NO. TIKET</th><th>PELANGGAN / UNIT</th><th>KELUHAN / CATATAN TEKNISI</th><th>STATUS</th><th>BIAYA / TERBAYAR</th><th>AKSI</th></tr></thead><tbody id="service-rows">${tickets.map((ticket) => {
    const techName = ticket.assigned_technician_id ? technicians.get(ticket.assigned_technician_id) || ticket.technician_name : 'Belum ditugaskan';
    const photoButtons = `${ticket.intake_photo_path ? `<button class="small-btn" data-photo="${esc(ticket.intake_photo_path)}">Foto awal</button>` : ''}${ticket.handover_photo_path ? `<button class="small-btn" data-photo="${esc(ticket.handover_photo_path)}">Foto serah terima</button>` : ''}`;
    const actions = isTechnician
      ? `${!['handed_over','cancelled'].includes(ticket.status) ? `<button class="small-btn" data-work-ticket="${ticket.id}">Perbarui progres</button>` : ''}${ticket.status === 'repairing' ? `<button class="small-btn" data-parts="${ticket.id}">＋ Sparepart</button>` : ''}${photoButtons}`
      : `${ticket.status === 'ready' ? `<button class="small-btn" data-handover="${ticket.id}">Serah terima</button>` : ''}${!['handed_over','cancelled','ready'].includes(ticket.status) ? `<button class="small-btn" data-cancel-ticket="${ticket.id}">Batalkan</button>` : ''}${photoButtons}`;
    return `<tr><td class="product-name">${esc(ticket.ticket_number)}<div class="field-hint">${new Date(ticket.created_at).toLocaleDateString('id-ID')}</div></td><td>${esc(ticket.customer_name)}<div class="field-hint">${esc(ticket.device_name)} · ${esc(ticket.serial_number || 'tanpa serial')}<br/>Teknisi: ${esc(techName)}</div></td><td>${esc(ticket.complaint)}${ticket.technician_note ? `<div class="field-hint"><b>Catatan teknisi:</b> ${esc(ticket.technician_note)}</div>` : ''}</td><td><span class="pill ${ticket.status === 'ready' ? 'blue' : ticket.status === 'handed_over' ? '' : 'warn'}">${esc(statusText[ticket.status] || ticket.status)}</span></td><td>${money(ticket.final_cost || ticket.estimated_cost)}<div class="field-hint">Dibayar ${money(ticket.paid_amount || 0)}</div></td><td><div class="actions-cell">${actions}</div></td></tr>`;
  }).join('') || `<tr><td colspan="6"><div class="empty"><b>${isTechnician ? 'Belum ada tiket di antrean teknisi' : 'Belum ada tiket servis'}</b>${isTechnician ? 'Tiket baru dari operator cabang ini akan muncul di sini.' : 'Buat tiket saat laptop diterima di toko.'}</div></td></tr>`}</tbody></table></div></section>`;
  page.querySelector('#new-service')?.addEventListener('click', () => serviceIntakeModal());
  page.querySelectorAll('[data-work-ticket]').forEach((button) => button.addEventListener('click', () => technicianServiceModal(tickets.find((ticket) => ticket.id === button.dataset.workTicket))));
  page.querySelectorAll('[data-handover]').forEach((button) => button.addEventListener('click', () => { const form = document.createElement('input'); form.type = 'file'; form.accept = 'image/*'; form.capture = 'environment'; form.addEventListener('change', () => finishService(button.dataset.handover, form.files?.[0])); form.click(); }));
  page.querySelectorAll('[data-cancel-ticket]').forEach((button) => button.addEventListener('click', async () => { if (!confirm('Batalkan tiket servis ini?')) return; try { checkError(await supabase.rpc('update_customer_service', { _ticket_id: button.dataset.cancelTicket, _status: 'cancelled', _technician_note: '', _estimated_cost: 0 })); toast('Tiket servis dibatalkan.'); await showPage('service'); } catch (error) { toast(error.message, true); } }));
  page.querySelectorAll('[data-photo]').forEach((button) => button.addEventListener('click', async () => { const { data, error } = await supabase.storage.from('service-evidence').createSignedUrl(button.dataset.photo, 300); if (error) return toast(error.message, true); window.open(data.signedUrl, '_blank', 'noopener'); }));
  page.querySelectorAll('[data-parts]').forEach((button) => button.addEventListener('click', () => partsModal(button.dataset.parts)));
  page.querySelector('#service-search').addEventListener('input', (event) => { const value = event.target.value.toLowerCase(); page.querySelectorAll('#service-rows tr').forEach((row) => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(value))); });
}

function technicianServiceModal(ticket) {
  if (!ticket) return;
  const nextStatuses = ['diagnosing','waiting_approval','waiting_parts','repairing','ready'];
  openModal('Perbarui pekerjaan servis', `${ticket.ticket_number} · ${ticket.customer_name} · ${ticket.device_name}`, `<div class="notice">Keluhan: ${esc(ticket.complaint)}</div><div class="form-grid"><div class="field"><label>Status pekerjaan</label><select name="status" required>${nextStatuses.map((status) => `<option value="${status}" ${ticket.status === status ? 'selected' : ''}>${statusText[status]}</option>`).join('')}</select></div><div class="field"><label>Estimasi biaya servis</label><input name="estimated_cost" type="number" min="0" step="1000" value="${Number(ticket.estimated_cost || 0)}" required /></div><div class="field full"><label>Catatan pemeriksaan / progres</label><textarea name="technician_note" rows="4" required>${esc(ticket.technician_note || '')}</textarea></div></div>`, async (form) => {
    checkError(await supabase.rpc('update_customer_service', { _ticket_id: ticket.id, _status: String(form.get('status')), _technician_note: String(form.get('technician_note')).trim(), _estimated_cost: Number(form.get('estimated_cost')) }));
    toast('Progres teknisi tersimpan dan terlihat oleh operator.'); await showPage('service');
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
    await showPage('service');
  }, 'Simpan tiket');
  const form = host.querySelector('#active-modal');
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

async function finishService(ticketId, file) {
  if (!file) { toast('Pilih foto penyerahan untuk menyelesaikan tiket.', true); return showPage('service'); }
  try {
    const ticket = checkError(await supabase.from('service_tickets').select('organization_id,branch_id').eq('id', ticketId).single());
    const compressed = await compressPhoto(file); const path = `${ticket.organization_id}/${ticket.branch_id}/${ticketId}/handover.jpg`;
    checkError(await supabase.storage.from('service-evidence').upload(path, compressed, { contentType: 'image/jpeg', upsert: true }));
    const current = checkError(await supabase.from('service_tickets').select('estimated_cost').eq('id', ticketId).single());
    openModal('Serah terima dan pembayaran servis', 'Pembayaran langsung masuk ke kas cabang. Sisa tempo akan muncul sebagai piutang.', `<div class="form-grid"><div class="field"><label>Total biaya servis</label><input name="final_cost" type="number" min="0" value="${Number(current.estimated_cost || 0)}" required /></div><div class="field"><label>Dibayar sekarang</label><input name="paid_amount" type="number" min="0" value="${Number(current.estimated_cost || 0)}" required /></div><div class="field service-due" hidden><label>Jatuh tempo piutang</label><input name="due_date" type="date" /></div></div>`, async (form) => {
      const { error } = await supabase.rpc('complete_service_handover', { _ticket_id: ticketId, _final_cost: Number(form.get('final_cost')), _paid_amount: Number(form.get('paid_amount')), _due_date: form.get('due_date') || null, _handover_photo_path: path });
      if (error) throw error; toast('Serah terima tersimpan; kas dan piutang diperbarui.'); await showPage('service');
    }, 'Simpan serah terima');
    const modalForm = document.querySelector('#active-modal');
    const updateDue = () => { const outstanding = Number(modalForm.final_cost.value) > Number(modalForm.paid_amount.value); modalForm.querySelector('.service-due').hidden = !outstanding; modalForm.due_date.required = outstanding; };
    modalForm.final_cost.addEventListener('input', updateDue); modalForm.paid_amount.addEventListener('input', updateDue); updateDue();
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

async function printWarrantyQr(item) {
  const printable = window.open('', '_blank', 'width=540,height=650');
  if (!printable) return toast('Izinkan pop-up untuk mencetak QR garansi.', true);
  try {
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

async function startScanner(host, input, formats = ['code_128', 'ean_13', 'ean_8', 'code_39', 'upc_a', 'upc_e', 'qr_code']) {
  if (!('BarcodeDetector' in window)) return toast('Browser ini belum mendukung scan barcode kamera. Masukkan kodenya manual.', true);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    host.innerHTML = '<div class="camera-wrap"><video autoplay playsinline muted></video></div><button class="small-btn" id="stop-scan">Tutup kamera</button>';
    const video = host.querySelector('video'); video.srcObject = stream;
    const detector = new BarcodeDetector({ formats });
    let active = true;
    host.querySelector('#stop-scan').addEventListener('click', () => { active = false; stream.getTracks().forEach((track) => track.stop()); host.innerHTML = ''; });
    const scan = async () => { if (!active) return; try { const values = await detector.detect(video); if (values.length) { input.value = values[0].rawValue; active = false; stream.getTracks().forEach((track) => track.stop()); host.innerHTML = ''; input.form.requestSubmit(); return; } } catch {} requestAnimationFrame(scan); };
    video.addEventListener('playing', scan, { once: true });
  } catch (error) { toast(error.message || 'Kamera tidak dapat dibuka.', true); }
}

async function reportsPage(page) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const range = params.get('range') || 'daily';
  state.reportBranch = params.get('branch') || state.reportBranch || 'all';
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
    const purchasePayment = entry.direction === 'expense' && excludedPurchasePayments.has(entry.category);
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
    <div class="cards"><article class="card"><div class="card-label">Omzet produk</div><div class="card-value">${money(salesTotal)}</div><div class="card-sub">${sales.length} transaksi penjualan</div></article><article class="card"><div class="card-label">Omzet servis</div><div class="card-value">${money(serviceTotal)}</div><div class="card-sub">Servis yang sudah diserahkan</div></article><article class="card"><div class="card-label">HPP terjual</div><div class="card-value">${money(hppTotal)}</div><div class="card-sub">Modal barang dan sparepart servis</div></article><article class="card"><div class="card-label">Laba operasional · estimasi</div><div class="card-value">${money(netProfit)}</div><div class="card-sub">Setelah biaya operasional ${money(expenseTotal)}</div></article></div>
    <section class="panel profit-note"><b>Perhitungan laba</b><span>Laba kotor = omzet produk + omzet servis − HPP. Laba operasional = laba kotor + pemasukan lain − biaya operasional. Pembelian stok dan pembayaran hutang supplier tidak dihitung sebagai biaya sampai barangnya terjual.</span>${estimatedCostLines||missingCostLines?`<span class="profit-warning">${estimatedCostLines} baris memakai modal katalog sebagai perkiraan · ${missingCostLines} baris terjual belum memiliki data modal, sehingga laba dapat terlihat lebih tinggi.</span>`:'<span class="profit-ok">Seluruh barang terjual memiliki modal tercatat.</span>'}</section>
    <div class="cards cash-summary"><article class="card"><div class="card-label">Kas masuk</div><div class="card-value">${money(sum('cashIn'))}</div><div class="card-sub">Uang diterima pada periode ini</div></article><article class="card"><div class="card-label">Kas keluar</div><div class="card-value">${money(sum('cashOut'))}</div><div class="card-sub">Termasuk pembayaran pembelian stok</div></article><article class="card"><div class="card-label">Saldo kas bersih</div><div class="card-value">${money(sum('cashIn')-sum('cashOut'))}</div><div class="card-sub">Kas masuk dikurangi kas keluar</div></article><article class="card"><div class="card-label">Laba kotor</div><div class="card-value">${money(grossProfit)}</div><div class="card-sub">Sebelum biaya operasional</div></article></div>
    <section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Rekap ${range==='daily'?'per hari':range==='weekly'?'per minggu':range==='monthly'?'per bulan':'per tahun'}</div><div class="panel-sub">Pilih periode untuk membuka transaksi, HPP, dan dampak labanya.</div></div></div><div class="table-wrap"><table><thead><tr><th>PERIODE</th><th>CATATAN</th><th>OMZET PRODUK</th><th>OMZET SERVIS</th><th>HPP</th><th>BIAYA OPERASIONAL</th><th>LABA OPERASIONAL</th><th>DETAIL</th></tr></thead><tbody>${[...buckets.values()].sort((a,b)=>b.key.localeCompare(a.key)).map(bucket=>`<tr><td class="product-name">${esc(bucket.key)}</td><td>${bucket.count}</td><td>${money(bucket.sales)}</td><td>${money(bucket.services)}</td><td>${money(bucket.hpp+bucket.serviceCost)}</td><td>${money(bucket.operatingExpense)}</td><td><b>${money(bucket.sales+bucket.services-bucket.hpp-bucket.serviceCost+bucket.otherIncome-bucket.operatingExpense)}</b></td><td><button class="small-btn" data-report-detail="${esc(bucket.key)}">Lihat detail</button></td></tr>`).join('')||'<tr><td colspan="8"><div class="empty">Belum ada transaksi pada periode ini.</div></td></tr>'}</tbody></table></div></section><section id="report-detail"></section>`;
  page.querySelector('#report-range').addEventListener('change',event=>{location.hash=`reports?range=${event.target.value}&branch=${state.reportBranch||'all'}`;showPage('reports')});
  page.querySelector('#report-branch')?.addEventListener('change',event=>{state.reportBranch=event.target.value;location.hash=`reports?range=${range}&branch=${state.reportBranch}`;showPage('reports')});
  page.querySelectorAll('[data-report-detail]').forEach(button=>button.addEventListener('click',()=>{
    const bucket=buckets.get(button.dataset.reportDetail),detail=page.querySelector('#report-detail');
    detail.innerHTML=`<section class="panel table-panel report-detail-panel"><div class="panel-head"><div><div class="panel-title">Rincian ${esc(bucket.key)}</div><div class="panel-sub">${bucket.rows.length} catatan · dampak laba tidak menghitung pembayaran hutang supplier sebagai biaya stok.</div></div><button class="small-btn" id="close-report-detail">Tutup</button></div><div class="table-wrap"><table><thead><tr><th>WAKTU</th><th>JENIS</th><th>NOTA / KETERANGAN</th><th>CABANG</th><th>NOMINAL</th><th>HPP / BIAYA</th><th>DAMPAK LABA</th></tr></thead><tbody>${bucket.rows.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).map(row=>`<tr><td>${new Date(row.date).toLocaleString('id-ID')}</td><td>${esc(row.kind)}</td><td>${esc(row.label||'—')}${row.purchasePayment?'<div class="field-hint">Pembayaran stok · dikeluarkan dari biaya laba</div>':''}</td><td>${esc(row.branch||branchName(row.branch_id))}</td><td>${money(row.value)}</td><td>${money(row.cost)}</td><td><b>${money(row.profitImpact)}</b></td></tr>`).join('')}</tbody></table></div></section>`;
    detail.querySelector('#close-report-detail').onclick=()=>detail.innerHTML='';
  }));
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
  openModal(editing ? 'Edit akun tim' : 'Tambah akun tim', editing ? 'Ubah role, cabang, email, atau password anggota.' : 'Buat akun Operator atau QC langsung. Anggota bisa masuk memakai email dan password ini.', `<div class="form-grid"><div class="field"><label>Nama lengkap</label><input name="full_name" value="${esc(user?.full_name || '')}" required minlength="2" /></div><div class="field"><label>Email</label><input name="email" type="email" value="${esc(user?.email || '')}" required /></div><div class="field"><label>Role</label><select name="role" required><option value="operator" ${user?.role === 'operator' ? 'selected' : ''}>Operator · kasir + servis</option><option value="technician" ${user?.role === 'technician' ? 'selected' : ''}>QC · pemeriksaan & repair</option></select></div>${branchField('branch_id', user?.branch_id || state.branchId)}<div class="field full"><label>Password ${editing ? '(kosongkan jika tidak diganti)' : ''}</label><input name="password" type="password" minlength="8" ${editing ? '' : 'required'} autocomplete="new-password" placeholder="Minimal 8 karakter" /></div></div>`, async (form) => {
    const payload = { action: editing ? 'update' : 'create', id: user?.id, full_name: String(form.get('full_name')).trim(), email: String(form.get('email')).trim().toLowerCase(), password: String(form.get('password')), role: String(form.get('role')), branch_id: String(form.get('branch_id')) };
    await teamAdminRequest(payload);
    toast(editing ? 'Akun tim berhasil diperbarui.' : 'Akun berhasil dibuat dan siap digunakan.');
    await showPage('branches');
  }, editing ? 'Simpan perubahan' : 'Buat akun');
}

async function branchesPage(page) {
  const users = canManage() ? (await teamAdminRequest({action:'list'})).users || [] : [];
  page.innerHTML = `${header('Pengaturan Aplikasi', 'Kelola identitas toko, cabang, operator, printer, dan cadangan data.', canManage() ? '<button class="btn" id="new-branch">＋ Cabang</button><button class="btn primary" id="add-team-member">＋ Tambah akun</button>' : '')}<section class="panel" style="margin-bottom:14px;padding:16px"><div class="panel-head"><div><div class="panel-title">Identitas toko untuk nota</div><div class="panel-sub">Informasi ini dipakai sebagai identitas default pada nota transaksi.</div></div><button class="btn primary" id="save-store-settings">Simpan identitas</button></div><div class="form-grid"><div class="field"><label>Nama toko</label><input id="store-name" value="${esc(state.organization.name||'')}" /></div><div class="field"><label>Nomor telepon</label><input id="store-phone" value="${esc(state.organization.phone||'')}" /></div><div class="field full"><label>Alamat toko</label><input id="store-address" value="${esc(state.organization.address||'')}" /></div></div><div class="form-grid" style="margin-top:14px"><div class="panel" style="padding:14px"><b>Printer barcode & nota</b><p class="field-hint">Simpan preferensi ukuran label di perangkat ini. Printer dipilih dan dipasangkan lewat pengaturan Windows, lalu dipilih pada dialog cetak.</p><button class="btn" id="printer-test">Uji cetak nota</button> <button class="btn" id="label-settings">Atur ukuran & pratinjau barcode</button></div><div class="panel" style="padding:14px"><b>Cadangan dan pemulihan data</b><p class="field-hint">Versi terbaru mencakup stok awal, penerimaan, servis, penjualan, keuangan, serta mutasi antar cabang. Foto dan lampiran tetap berupa tautan metadata, bukan salinan file. Pemulihan hanya ke organisasi ini dan menggabungkan data tanpa menghapus catatan yang sudah ada.</p><button class="btn" id="backup-download">Unduh cadangan</button> <label class="btn">Pulihkan cadangan<input id="backup-upload" type="file" accept="application/json,.json" hidden /></label></div></div></section><section class="panel" style="margin-bottom:14px;padding:16px"><div class="panel-head"><div><div class="panel-title">Akun pemilik</div><div class="panel-sub">Email admin utama: admin@digital.laptop</div></div></div><form id="owner-account-form" class="form-grid"><div class="field"><label>Email admin (tetap)</label><input name="email" type="email" value="admin@digital.laptop" readonly autocomplete="email" /></div><div class="field"><label>Password baru (opsional)</label><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Minimal 8 karakter" /></div><div class="field full"><button class="btn primary" type="submit">Simpan email admin & password</button></div></form><p class="field-hint">Email admin ditetapkan ke admin@digital.laptop dan diterapkan langsung tanpa konfirmasi email. Isi password baru untuk menggantinya; kosongkan jika tidak ingin mengubah password.</p></section><div class="settings-stack"><section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Cabang toko</div><div class="panel-sub">Cabang tersedia untuk pemilik dan operator terdaftar</div></div></div><div class="table-wrap"><table><thead><tr><th>NAMA CABANG</th><th>KOTA</th><th>ALAMAT</th><th>STATUS</th></tr></thead><tbody>${state.branches.map((branch) => `<tr><td class="product-name">${esc(branch.name)}</td><td>${esc(branch.city || '—')}</td><td>${esc(branch.address || '—')}</td><td><span class="pill">Aktif</span></td></tr>`).join('') || '<tr><td colspan="4">Belum ada cabang.</td></tr>'}</tbody></table></div></section><section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Anggota tim</div><div class="panel-sub">Setiap anggota hanya melihat data operasional cabangnya.</div></div></div><div class="table-wrap"><table class="team-table"><thead><tr><th>NAMA / EMAIL</th><th>ROLE</th><th>CABANG</th><th>AKSI</th></tr></thead><tbody>${users.map((user) => `<tr><td class="product-name">${esc(user.full_name || '—')}<div class="field-hint">${esc(user.email || 'Email tidak tersedia')}</div></td><td><span class="pill ${user.role === 'owner' ? 'blue' : ''}">${user.role === 'owner' ? 'Pemilik' : user.role === 'technician' ? 'QC · pemeriksaan & repair' : 'Operator · kasir + servis'}</span></td><td>${esc(branchName(user.branch_id))}</td><td>${user.role === 'owner' ? '<span class="field-hint">Atur dari kartu akun pemilik</span>' : `<button class="small-btn" data-edit-team-user="${user.id}">Edit</button> <button class="small-btn" data-delete-team-user="${user.id}">Hapus</button>`}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">Belum ada akun operator atau QC.</div></td></tr>'}</tbody></table></div></section></div>`;
  page.querySelector('#save-store-settings')?.addEventListener('click',async()=>{const button=page.querySelector('#save-store-settings');button.disabled=true;try{const result=await supabase.from('organizations').update({name:page.querySelector('#store-name').value.trim(),phone:page.querySelector('#store-phone').value.trim(),address:page.querySelector('#store-address').value.trim()}).eq('id',state.organization.id);if(result.error)throw result.error;state.organization={...state.organization,name:page.querySelector('#store-name').value.trim(),phone:page.querySelector('#store-phone').value.trim(),address:page.querySelector('#store-address').value.trim()};document.querySelector('.crumb').firstChild.textContent=state.organization.name+' / ';toast('Identitas toko disimpan.')}catch(error){toast(error.message,true)}finally{button.disabled=false}});
  page.querySelector('#owner-account-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const email = 'admin@digital.laptop'; const password = String(values.get('password')); if (email === String(state.user.email || '').toLowerCase() && !password) return toast('Email admin sudah tetap dan tidak ada password baru yang dimasukkan.', true); const button = form.querySelector('button[type="submit"]'); button.disabled = true; try { await teamAdminRequest({ action: 'update-owner-account', email, password }); state.user = { ...state.user, email }; toast('Email dan password akun pemilik berhasil diperbarui langsung.'); form.reset(); await showPage('branches'); } catch (error) { toast(error.message || 'Tidak bisa memperbarui akun pemilik.', true); } finally { button.disabled = false; } });
  page.querySelector('#label-settings')?.addEventListener('click',()=>printBarcodeLabels([{barcode:'DL-TEST-000001',supplier:'Contoh supplier',products:{name:'Laptop contoh',sku:'DL-TEST',category:'Laptop'}}]));
  page.querySelector('#printer-test')?.addEventListener('click',()=>{const w=window.open('','_blank','width=700,height=550');if(!w)return toast('Izinkan pop-up untuk pratinjau cetak.',true);w.document.write(`<title>Uji cetak Digi-Laptop</title><style>body{font:14px Arial;padding:18mm;color:#18261c}button{border:1px solid #aaa;border-radius:0;padding:10px 16px;background:#075c37;color:white}@media print{button{display:none}}</style><h1>${esc(state.organization.name||'DIGITAL LAPTOP JOMBANG')}</h1><p>${esc(state.organization.phone||'Nomor telepon belum diatur')}</p><p>${esc(state.organization.address||'Alamat belum diatur')}</p><hr><p>Ini halaman uji cetak. Pilih printer di dialog cetak.</p><button onclick="window.print()">Cetak / pilih printer</button>`);w.document.close()});
  page.querySelector('#backup-download')?.addEventListener('click',async()=>{const btn=page.querySelector('#backup-download');btn.disabled=true;try{const names=['branches','products','suppliers','customers','intake_batches','stock_opening_batches','stock_items','stock_repairs','stock_repair_parts','sales','sale_items','stock_transfers','stock_transfer_items','service_tickets','service_parts','cash_transactions','stock_movements','warranty_claims'];const data={format:'digi-laptop-backup',version:2,organization_id:state.organization.id,organization:{name:state.organization.name,phone:state.organization.phone,address:state.organization.address},created_at:new Date().toISOString(),tables:{}};for(const name of names){let query=supabase.from(name).select('*');if(name==='sale_items'){const ids=(data.tables.sales||[]).map(r=>r.id);data.tables[name]=ids.length?await fetchAllRows(supabase.from(name).select('*').in('sale_id',ids)):[];continue}if(name==='stock_repair_parts'){const ids=(data.tables.stock_repairs||[]).map(r=>r.id);data.tables[name]=ids.length?await fetchAllRows(supabase.from(name).select('*').in('repair_id',ids)):[];continue}try{data.tables[name]=await fetchAllRows(query.eq('organization_id',state.organization.id))}catch(error){throw new Error(`${name}: ${error.message}`)}}const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=`digi-laptop-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);toast('Cadangan operasional berhasil diunduh.')}catch(error){toast(`Cadangan gagal dibuat: ${error.message}`,true)}finally{btn.disabled=false}});
  page.querySelector('#backup-upload')?.addEventListener('change',async(event)=>{const file=event.target.files?.[0];if(!file)return;try{const backup=JSON.parse(await file.text());if(backup.format!=='digi-laptop-backup'||![1,2].includes(backup.version)||backup.organization_id!==state.organization.id)throw new Error('File bukan cadangan Digi-Laptop untuk organisasi ini.');const {data,error}=await supabase.rpc('restore_digi_laptop_backup',{_backup:backup});if(error)throw new Error(error.message);toast(`${Number(data)||0} baris dipulihkan. Data digabung tanpa menghapus catatan yang sudah ada.`);await afterAuth()}catch(error){toast(`Pemulihan berhenti: ${error.message}`,true)}finally{event.target.value=''}});
  page.querySelector('#new-branch')?.addEventListener('click', () => openModal('Tambah cabang', 'Cabang baru langsung muncul pada pilihan operasional.', `<div class="form-grid"><div class="field"><label>Nama cabang</label><input name="name" required /></div><div class="field"><label>Kota</label><input name="city" /></div><div class="field full"><label>Alamat</label><input name="address" /></div></div>`, async (form) => { checkError(await supabase.from('branches').insert({ organization_id: state.organization.id, name: String(form.get('name')).trim(), city: String(form.get('city')).trim(), address: String(form.get('address')).trim() })); await afterAuth(); }, 'Simpan cabang'));
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
    return `<tr class="contact-row" data-contact-detail="${item.id}"><td class="product-name">${supplierMode ? `<span class="pill blue">${esc(item.initials)}</span> ` : ''}<button class="contact-open" type="button" data-open-contact="${item.id}">${esc(item.name)}<span>Detail →</span></button></td><td>${esc(item.phone || '—')}</td>${supplierMode ? `<td>${esc(item.address || '—')}</td>` : `<td>${esc(item.email || '—')}</td>`}<td><b>${money(balance)}</b></td></tr>`;
  }).join('');
  const contactsTabs = `<div class="contact-tabs"><button class="contact-tab${supplierMode ? ' active' : ''}" data-contact-tab="suppliers">Supplier <span>${suppliers.length}</span></button><button class="contact-tab${!supplierMode ? ' active' : ''}" data-contact-tab="customers">Pelanggan <span>${customers.length}</span></button></div>`;
  const supplierDebt = supplierMode ? `<section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Hutang supplier</div><div class="panel-sub">Sisa tagihan dihitung dari total invoice dikurangi pembayaran yang sudah dicatat.</div></div></div><div class="table-wrap"><table><thead><tr><th>SUPPLIER / NOTA</th><th>CABANG</th><th>TOTAL TAGIHAN</th><th>DIBAYAR</th><th>SISA HUTANG</th><th>JATUH TEMPO</th><th></th></tr></thead><tbody>${payables.map((batch) => `<tr><td class="product-name">${esc(batch.suppliers?.name || batch.supplier || 'Supplier')}<div class="field-hint">${esc(batch.invoice_number || batch.id.slice(0,8).toUpperCase())}</div></td><td>${esc(batch.branches?.name || branchName(batch.branch_id))}</td><td>${money(batch.total_amount)}</td><td>${money(batch.amount_paid)}</td><td><b>${money(batch.remaining)}</b></td><td>${batch.due_date ? new Date(`${batch.due_date}T00:00:00`).toLocaleDateString('id-ID') : '—'}</td><td><button class="small-btn" data-pay-batch="${batch.id}">Bayar</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Belum ada hutang supplier terbuka.</div></td></tr>'}</tbody></table></div></section>` : `<section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Piutang pelanggan</div><div class="panel-sub">Sisa pembayaran penjualan dan servis untuk pelanggan.</div></div></div><div class="table-wrap"><table><thead><tr><th>PELANGGAN / NOTA</th><th>CABANG</th><th>TOTAL</th><th>DIBAYAR</th><th>SISA PIUTANG</th><th>JATUH TEMPO</th><th></th></tr></thead><tbody>${receivables.map((entry) => `<tr><td class="product-name">${esc(entry.customers?.name || entry.customer_name || 'Pelanggan')}<div class="field-hint">${esc(entry.label)} · ${entry.source_type === 'sale' ? 'Penjualan' : 'Servis'}</div></td><td>${esc(entry.branches?.name || branchName(entry.branch_id))}</td><td>${money(entry.total_due)}</td><td>${money(entry.paid)}</td><td><b>${money(entry.remaining)}</b></td><td>${entry.due_date ? new Date(`${entry.due_date}T00:00:00`).toLocaleDateString('id-ID') : '—'}</td><td><button class="small-btn" data-collect-contact="${entry.id}" data-source="${entry.source_type}">Terima</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Belum ada piutang pelanggan terbuka.</div></td></tr>'}</tbody></table></div></section>`;
  const totalDebt = supplierMode ? payables.reduce((sum, batch) => sum + batch.remaining, 0) : 0;
  const totalReceivable = supplierMode ? 0 : receivables.reduce((sum, entry) => sum + entry.remaining, 0);
  page.innerHTML = `${header('Pelanggan & supplier', 'Satu tempat untuk kontak, barcode supplier, dan saldo tagihan.', `<button class="btn primary" id="new-contact">＋ Tambah ${supplierMode ? 'supplier' : 'pelanggan'}</button>`)}${contactsTabs}<section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Daftar ${supplierMode ? 'supplier' : 'pelanggan'}</div><div class="panel-sub">${(rowsData || []).length} kontak tersimpan · ${supplierMode ? `total hutang terbuka ${money(totalDebt)}` : `total piutang terbuka ${money(totalReceivable)}`} · pilih nama untuk detail</div></div><input class="search" id="contact-search" placeholder="Cari nama atau telepon" /></div><div class="table-wrap"><table><thead><tr><th>NAMA</th><th>TELEPON</th><th>${supplierMode ? 'ALAMAT' : 'EMAIL'}</th><th>${supplierMode ? 'SISA HUTANG' : 'SISA PIUTANG'}</th></tr></thead><tbody id="contact-rows">${rows || `<tr><td colspan="4"><div class="empty"><b>Belum ada ${supplierMode ? 'supplier' : 'pelanggan'}</b>Tambahkan kontak untuk menghubungkan transaksi dan tagihan.</div></td></tr>`}</tbody></table></div></section>${supplierDebt}`;
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
    const host = openModal(`Detail ${supplierMode ? 'supplier' : 'pelanggan'}`, `${contact.name} · ${supplierMode ? 'Saldo hutang supplier' : 'Saldo piutang pelanggan'} ${money(balance)}`, `<div class="contact-detail-grid"><div><small>TELEPON</small><b>${esc(contact.phone || '—')}</b></div><div><small>${supplierMode ? 'KODE SUPPLIER' : 'EMAIL'}</small><b>${esc(supplierMode ? contact.initials : contact.email || '—')}</b></div><div class="full"><small>ALAMAT</small><b>${esc(contact.address || '—')}</b></div><div class="full"><small>CATATAN</small><b>${esc(contact.notes || '—')}</b></div></div><section class="contact-detail-ledger"><div class="panel-title">${supplierMode ? 'Riwayat tagihan pembelian' : 'Riwayat penjualan, servis & piutang'}</div><div class="table-wrap"><table><thead><tr><th>${supplierMode ? 'NOTA / BATCH' : 'STRUK / TIKET'}</th><th>TOTAL</th><th>DIBAYAR</th><th>SISA</th><th>JATUH TEMPO</th><th>AKSI</th></tr></thead><tbody>${recordRows || `<tr><td colspan="6"><div class="empty">Belum ada ${supplierMode ? 'penerimaan barang' : 'penjualan atau servis'} terkait kontak ini.</div></td></tr>`}</tbody></table></div></section>`, async () => {}, 'Tutup');
    host.querySelector('#active-modal [type="submit"]').hidden = true;
    host.querySelector('#active-modal [data-close-modal]:not(.modal-close)').textContent = 'Tutup';
    host.querySelectorAll('[data-detail-pay]').forEach((action) => action.addEventListener('click', () => {
      const record = records.find((entry) => entry.id === action.dataset.detailPay);
      if (!record) return;
      host.innerHTML = '';
      partyPaymentModal(record.source, { ...record, branch_id: (supplierMode ? relatedBatches : [...relatedSales,...relatedServices]).find((entry) => entry.id === record.id)?.branch_id, supplier: contact.name, suppliers: { name: contact.name }, customers: { name: contact.name }, customer_name: contact.name }, record.remaining, 'contacts');
    }));
  }));
  page.querySelectorAll('[data-pay-batch]').forEach((button) => button.addEventListener('click', () => { const batch = payables.find((item) => item.id === button.dataset.payBatch); partyPaymentModal('intake_batch', batch, batch.remaining, 'contacts'); }));
  page.querySelectorAll('[data-collect-contact]').forEach((button) => button.addEventListener('click', () => { const entry = receivables.find((item) => item.id === button.dataset.collectContact); partyPaymentModal(button.dataset.source, entry, entry.remaining, 'contacts'); }));
  page.querySelector('#new-contact').addEventListener('click', () => openModal(`Tambah ${supplierMode ? 'supplier' : 'pelanggan'}`, 'Data kontak tersimpan untuk seluruh cabang.', `<div class="form-grid"><div class="field"><label>Nama</label><input name="name" required /></div>${supplierMode ? '' : '<div class="field"><label>Tipe pelanggan</label><select name="customer_type"><option value="end_user">Pembeli umum / end user</option><option value="reseller">Pelanggan reseller</option></select></div>'}<div class="field"><label>Nomor telepon</label><input name="phone" /></div>${supplierMode ? '' : '<div class="field"><label>Email</label><input name="email" type="email" /></div>'}<div class="field full"><label>Alamat</label><input name="address" /></div><div class="field full"><label>Catatan</label><textarea name="notes" rows="3"></textarea></div></div>${supplierMode ? '<div class="notice">Kode awal barcode dibuat otomatis. Supplier “Asep” menggunakan awalan AS.</div>' : ''}`, async (form) => {
    const name = String(form.get('name')).trim();
    const values = { organization_id: state.organization.id, name, phone: String(form.get('phone')).trim(), address: String(form.get('address')).trim(), notes: String(form.get('notes')).trim() };
    if (supplierMode) values.initials = supplierInitials(name); else { values.email = String(form.get('email')).trim(); values.customer_type = String(form.get('customer_type') || 'end_user'); }
    checkError(await supabase.from(table).insert(values));
    toast(`${supplierMode ? 'Supplier' : 'Pelanggan'} tersimpan.`); state.contactTab = type; await showPage('contacts');
  }, 'Simpan kontak'));
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
  const activityRows = cash.map((entry) => `<tr><td class="product-name">${new Date(entry.created_at).toLocaleDateString('id-ID')}<div class="field-hint">${esc(entry.branches?.name || branchName(entry.branch_id))}</div></td><td>${esc(entry.category)}</td><td>${esc(entry.description || entry.customers?.name || entry.suppliers?.name || '—')}</td><td><span class="pill ${entry.direction === 'income' ? 'blue' : 'warn'}">${entry.direction === 'income' ? 'Masuk' : 'Keluar'}</span></td><td>${money(entry.amount)}</td></tr>`).join('');
  page.innerHTML = `${header('Keuangan cabang', `Arus kas bulan ${monthStart.toLocaleDateString('id-ID',{month:'long',year:'numeric'})}. Pemasukan dan pengeluaran dihitung dari uang yang benar-benar dibayar.`, `${branchControl}<button class="btn" id="add-income">＋ Pemasukan</button><button class="btn primary" id="add-expense">− Pengeluaran</button>`)}
    <div class="cards"><article class="card"><div class="card-label">Kas masuk bulan ini<span class="card-icon">↗</span></div><div class="card-value">${money(incomes)}</div><div class="card-sub">Penjualan dibayar, cicilan, dan pemasukan lain</div></article><article class="card"><div class="card-label">Kas keluar bulan ini<span class="card-icon">↘</span></div><div class="card-value">${money(expenses)}</div><div class="card-sub">Pembelian barang, hutang supplier, dan operasional</div></article><article class="card"><div class="card-label">Sisa kas bersih<span class="card-icon">＝</span></div><div class="card-value">${money(incomes-expenses)}</div><div class="card-sub">Kas masuk dikurangi kas keluar</div></article><article class="card"><div class="card-label">Piutang / hutang terbuka<span class="card-icon">≡</span></div><div class="card-value" style="font-size:17px">${money(receivableTotal)} / ${money(payableTotal)}</div><div class="card-sub">${receivables.length} pelanggan · ${payables.length} supplier</div></article></div>
    ${filter === 'all' ? `<section class="panel table-panel"><div class="panel-head"><div><div class="panel-title">Ringkasan per cabang</div><div class="panel-sub">Angka bulan ini untuk semua cabang toko</div></div></div><div class="table-wrap"><table><thead><tr><th>CABANG</th><th>KAS MASUK</th><th>KAS KELUAR</th><th>BERSIH</th></tr></thead><tbody>${[...branchTotals.entries()].map(([id,row]) => `<tr><td class="product-name">${esc(row.name)}</td><td>${money(row.income)}</td><td>${money(row.expense)}</td><td>${money(row.income-row.expense)}</td></tr>`).join('') || '<tr><td colspan="4">Belum ada transaksi bulan ini.</td></tr>'}</tbody></table></div></section>` : ''}
    <section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Piutang pelanggan</div><div class="panel-sub">Sisa pembayaran penjualan dan servis</div></div></div><div class="table-wrap"><table><thead><tr><th>PELANGGAN / STRUK</th><th>CABANG</th><th>TOTAL</th><th>SUDAH DIBAYAR</th><th>SISA</th><th>JATUH TEMPO</th><th></th></tr></thead><tbody>${receivables.map((entry) => `<tr><td class="product-name">${esc(entry.customers?.name || entry.customer_name || 'Pelanggan')}<div class="field-hint">${esc(entry.label)} · ${entry.source_type === 'sale' ? 'Penjualan' : 'Servis'}</div></td><td>${esc(entry.branches?.name || branchName(entry.branch_id))}</td><td>${money(entry.total_due)}</td><td>${money(entry.paid)}</td><td><b>${money(entry.remaining)}</b></td><td>${entry.due_date ? new Date(`${entry.due_date}T00:00:00`).toLocaleDateString('id-ID') : '—'}</td><td><button class="small-btn" data-collect="${entry.id}" data-source="${entry.source_type}">Terima pembayaran</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Tidak ada piutang pelanggan terbuka.</div></td></tr>'}</tbody></table></div></section>
    <section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Hutang supplier</div><div class="panel-sub">Sisa pembayaran untuk batch barang masuk</div></div></div><div class="table-wrap"><table><thead><tr><th>SUPPLIER / NOTA</th><th>CABANG</th><th>TOTAL</th><th>SUDAH DIBAYAR</th><th>SISA</th><th>JATUH TEMPO</th><th></th></tr></thead><tbody>${payables.map((batch) => `<tr><td class="product-name">${esc(batch.suppliers?.name || batch.supplier || 'Supplier')}<div class="field-hint">${esc(batch.invoice_number || batch.id.slice(0,8).toUpperCase())}</div></td><td>${esc(batch.branches?.name || branchName(batch.branch_id))}</td><td>${money(batch.total_amount)}</td><td>${money(batch.amount_paid)}</td><td><b>${money(batch.remaining)}</b></td><td>${batch.due_date ? new Date(`${batch.due_date}T00:00:00`).toLocaleDateString('id-ID') : '—'}</td><td><button class="small-btn" data-pay="${batch.id}">Bayar supplier</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Tidak ada hutang supplier terbuka.</div></td></tr>'}</tbody></table></div></section>
    <section class="panel table-panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">Arus kas bulan ini</div><div class="panel-sub">Pemasukan dan pengeluaran tercatat untuk cabang yang dipilih</div></div></div><div class="table-wrap"><table><thead><tr><th>TANGGAL / CABANG</th><th>KATEGORI</th><th>KETERANGAN</th><th>ARAH</th><th>NOMINAL</th></tr></thead><tbody>${activityRows || '<tr><td colspan="5"><div class="empty">Belum ada pemasukan atau pengeluaran bulan ini.</div></td></tr>'}</tbody></table></div></section>`;
  page.querySelector('#finance-branch')?.addEventListener('change', async (event) => { state.financeBranch = event.target.value; await showPage('finance'); });
  page.querySelector('#add-expense').addEventListener('click', () => cashEntryModal('expense'));
  page.querySelector('#add-income').addEventListener('click', () => cashEntryModal('income'));
  page.querySelectorAll('[data-collect]').forEach((button) => button.addEventListener('click', () => { const entry = receivables.find((item) => item.id === button.dataset.collect); partyPaymentModal(button.dataset.source, entry, entry.remaining); }));
  page.querySelectorAll('[data-pay]').forEach((button) => button.addEventListener('click', () => partyPaymentModal('intake_batch', payables.find((batch) => batch.id === button.dataset.pay), payables.find((batch) => batch.id === button.dataset.pay).remaining)));
}

async function start() {
  if (['/catalog','/catalog/','/warranty','/warranty/'].includes(location.pathname)) { location.replace('/'); return; }
  if (!hasBackendConfig) { configurationScreen(); return; }
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
