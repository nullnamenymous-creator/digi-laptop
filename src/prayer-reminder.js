const prayers = [
  ['Fajr', 'Subuh'], ['Dhuhr', 'Zuhur'], ['Asr', 'Asar'],
  ['Maghrib', 'Magrib'], ['Isha', 'Isya'],
];
const locationKey = 'digi-laptop-prayer-location';
const defaultLocation = { city: 'Jombang', timeZone: 'Asia/Jakarta' };

function dateInZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
}

function nextDate(date) {
  const tomorrow = new Date(date + 'T00:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

function readLocation() {
  try { return JSON.parse(localStorage.getItem(locationKey)) || defaultLocation; }
  catch { return defaultLocation; }
}

async function fetchPrayerDay(place, date, signal) {
  const type = place.city ? 'timingsByCity' : 'timings';
  const url = new URL('https://api.aladhan.com/v1/' + type + '/' + date.split('-').reverse().join('-'));
  url.search = new URLSearchParams({
    method: '20', iso8601: 'true',
    ...(place.city ? { city: place.city, country: 'Indonesia' }
      : { latitude: place.latitude, longitude: place.longitude }),
  });
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Jadwal tidak tersedia');
  const { data } = await response.json();
  const timeZone = data?.meta?.timezone;
  if (typeof timeZone !== 'string') throw new Error('Zona waktu tidak tersedia');
  const timeFormat = new Intl.DateTimeFormat('id-ID', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const schedule = prayers.map(([key, label]) => {
    const instant = Date.parse(data.timings?.[key]);
    if (!Number.isFinite(instant)) throw new Error('Jam salat tidak tersedia');
    return { label, instant, time: timeFormat.format(instant) };
  });
  return { timeZone, schedule };
}

export function mountPrayerReminder() {
  const widget = document.createElement('aside');
  widget.className = 'prayer-widget';
  widget.setAttribute('aria-label', 'Pengingat waktu salat');
  widget.innerHTML = `
    <div class="prayer-panel" id="prayer-panel" hidden>
      <div class="prayer-header"><strong>Jadwal Salat</strong><button type="button" class="small-btn" data-prayer-close aria-label="Kecilkan jadwal">×</button></div>
      <div class="prayer-location"><span data-prayer-place></span><button type="button" class="small-btn" data-prayer-settings aria-expanded="false">Ganti lokasi</button></div>
      <form data-prayer-form hidden>
        <label for="prayer-city">Kota atau kabupaten di Indonesia</label>
        <div class="prayer-city"><input id="prayer-city" required maxlength="60" placeholder="Jombang" /><button class="small-btn" type="submit">Pakai</button></div>
        <button class="small-btn" type="button" data-prayer-gps>Gunakan lokasi perangkat</button>
        <p class="field-hint">Koordinat digunakan oleh AlAdhan untuk menghitung jadwal.</p>
      </form>
      <p class="field-hint" role="status" data-prayer-status></p>
      <ol class="prayer-times" data-prayer-times></ol>
    </div>
    <button type="button" class="prayer-toggle" aria-controls="prayer-panel" aria-expanded="false">
      <span class="prayer-moon" aria-hidden="true">☾</span><span data-prayer-label>Jadwal Salat</span>
    </button>`;
  document.body.append(widget);
  const panel = widget.querySelector('.prayer-panel');
  const toggle = widget.querySelector('.prayer-toggle');
  const settings = widget.querySelector('[data-prayer-settings]');
  const form = widget.querySelector('[data-prayer-form]');
  const input = form.querySelector('input');
  const gps = form.querySelector('[data-prayer-gps]');
  const status = widget.querySelector('[data-prayer-status]');
  const label = widget.querySelector('[data-prayer-label]');
  const times = widget.querySelector('[data-prayer-times]');
  const location = widget.querySelector('[data-prayer-place]');
  let place = readLocation();
  let activeRequest;
  let schedule = [];
  let tomorrowSchedule = [];
  let loadedDate;
  let retryAfter = 0;

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }
  function render() {
    const now = Date.now();
    const next = schedule.find(prayer => prayer.instant >= now) || tomorrowSchedule[0];
    label.textContent = next ? next.label + ' · ' + next.time : 'Jadwal Salat';
    times.innerHTML = schedule.map(prayer =>
      `<li${prayer === next ? ' class="prayer-next" aria-current="time"' : ''}><span>${prayer.label}</span><time datetime="${new Date(prayer.instant).toISOString()}">${prayer.time}</time></li>`).join('');
  }
  async function refresh(target = place) {
    activeRequest?.abort();
    const request = new AbortController();
    activeRequest = request;
    const timeout = setTimeout(() => request.abort(), 10000);
    const now = new Date();
    const locator = target.city || 'Lokasi perangkat';
    location.textContent = locator;
    status.textContent = 'Memuat jadwal salat…';
    try {
      let date = dateInZone(now, target.timeZone);
      let today = await fetchPrayerDay(target, date, request.signal);
      const localDate = dateInZone(now, today.timeZone);
      if (date !== localDate) {
        date = localDate;
        today = await fetchPrayerDay(target, date, request.signal);
      }
      if (request !== activeRequest) return;
      place = { ...target, timeZone: today.timeZone };
      loadedDate = date;
      schedule = today.schedule;
      tomorrowSchedule = [];
      try { localStorage.setItem(locationKey, JSON.stringify(place)); } catch {}
      status.textContent = '';
      render();
      const tomorrow = await fetchPrayerDay(place, nextDate(date), request.signal).catch(() => null);
      if (request !== activeRequest || !tomorrow) return;
      tomorrowSchedule = tomorrow.schedule;
      render();
    } catch {
      if (request !== activeRequest) return;
      retryAfter = Date.now() + 300000;
      location.textContent = place.city || 'Lokasi perangkat';
      if (loadedDate !== dateInZone(new Date(), place.timeZone)) {
        schedule = [];
        tomorrowSchedule = [];
        render();
      }
      status.textContent = 'Jadwal belum bisa dimuat. Coba lagi atau pilih lokasi lain.';
    } finally {
      clearTimeout(timeout);
      if (request === activeRequest) activeRequest = null;
    }
  }

  toggle.addEventListener('click', () => {
    setOpen(panel.hidden);
    if (!panel.hidden && !activeRequest && !schedule.length) refresh();
  });
  widget.querySelector('[data-prayer-close]').addEventListener('click', () => {
    setOpen(false);
    toggle.focus();
  });
  widget.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
  settings.addEventListener('click', () => {
    form.hidden = !form.hidden;
    settings.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) {
      input.value = place.city || '';
      input.focus();
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const city = input.value.trim();
    if (city) refresh({ city });
  });
  gps.addEventListener('click', () => {
    if (!navigator.geolocation) {
      status.textContent = 'Lokasi perangkat tidak tersedia. Masukkan nama kota.';
      return;
    }
    gps.disabled = true;
    status.textContent = 'Mencari lokasi perangkat…';
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      gps.disabled = false;
      refresh({ latitude: coords.latitude.toFixed(3), longitude: coords.longitude.toFixed(3) });
    }, () => {
      gps.disabled = false;
      status.textContent = 'Lokasi perangkat tidak tersedia. Masukkan nama kota.';
    }, { timeout: 8000, maximumAge: 300000 });
  });
  const tick = () => {
    if (!activeRequest && Date.now() >= retryAfter && loadedDate !== dateInZone(new Date(), place.timeZone)) refresh();
    else if (schedule.length) render();
  };
  window.addEventListener('online', () => refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(() => { if (!document.hidden) tick(); }, 15000);
  refresh();
}
