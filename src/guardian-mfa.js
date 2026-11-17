export async function verifyExistingMfa(supabase) {
  const {data, error} = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (data.nextLevel !== 'aal2' || data.currentLevel === 'aal2') return;
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  const factor = factors.data.totp.find(item => item.status === 'verified');
  if (!factor) throw new Error('Autentikator akun belum tersedia.');
  // Login replaces the app shell with a loading screen, so its modal host may not exist yet.
  const existingHost = document.querySelector('#modal-root');
  const host = existingHost || document.createElement('div');
  if (!existingHost) { host.id = 'guardian-login-modal'; document.body.append(host); }
  try {
    await new Promise((resolve, reject) => {
    host.innerHTML = '<div class="modal-backdrop"><form class="modal"><div class="modal-head"><h2>Verifikasi keamanan</h2></div><p>Masukkan kode dari aplikasi autentikator.</p><div class="field"><label for="guardian-code">Kode 6 digit</label><input id="guardian-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></div><p role="alert"></p><div class="modal-actions"><button class="btn" type="button" data-cancel>Keluar</button><button class="btn primary" type="submit">Verifikasi</button></div></form></div>';
    const form = host.querySelector('form');
    form.querySelector('input').focus();
    form.querySelector('[data-cancel]').addEventListener('click', async () => {
      await supabase.auth.signOut({scope:'local'});
      host.innerHTML = '';
      reject(new Error('Verifikasi dibatalkan. Masuk kembali untuk melanjutkan.'));
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const buttons = [...form.querySelectorAll('button')];
      buttons.forEach(button => {button.disabled = true;});
      try {
        const {error} = await supabase.auth.mfa.challengeAndVerify({factorId:factor.id, code:form.elements.code.value});
        if (error) throw error;
        host.innerHTML = '';
        resolve();
      } catch {
        form.querySelector('[role="alert"]').textContent = 'Kode belum valid. Coba kode terbaru.';
        buttons.forEach(button => {button.disabled = false;});
      }
    });
    });
  } finally {
    if (!existingHost) host.remove();
  }
}

export async function setupGuardianMfa(supabase, openModal, toast) {
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  if (factors.data.totp.some(factor => factor.status === 'verified')) {
    toast('Autentikator akun sudah aktif.');
    return;
  }
  // Remove abandoned enrollments owned by the signed-in user before restarting.
  for (const factor of factors.data.totp.filter(factor => factor.status !== 'verified')) {
    const result = await supabase.auth.mfa.unenroll({factorId:factor.id});
    if (result.error) throw result.error;
  }
  const enrollment = await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'Digi-Laptop Guardian'});
  if (enrollment.error) throw enrollment.error;
  const factor = enrollment.data;
  let verified = false;
  try {
    const {default: QRCode} = await import('qrcode');
    const qr = await QRCode.toDataURL(factor.totp.uri);
    const host = openModal('Aktifkan autentikator', 'Pindai QR dengan aplikasi autentikator milik Anda.',
      '<img data-guardian-qr alt="QR aktivasi autentikator akun" width="200" height="200" /><div class="field"><label for="guardian-enroll-code">Kode 6 digit</label><input id="guardian-enroll-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></div>',
      async form => {
        const {error} = await supabase.auth.mfa.challengeAndVerify({factorId:factor.id,code:form.get('code')});
        if (error) throw error;
        verified = true;
        toast('Autentikator aktif. Simpan akses aplikasi autentikator Anda.');
      }, 'Aktifkan');
    host.querySelector('[data-guardian-qr]').src = qr;
    host.querySelector('[data-close-modal]').addEventListener('click', () => {
      if (!verified) supabase.auth.mfa.unenroll({factorId:factor.id}).catch(() => {});
    });
  } catch (error) {
    await supabase.auth.mfa.unenroll({factorId:factor.id});
    throw error;
  }
}
