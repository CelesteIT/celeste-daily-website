/* Celeste Daily: Sep 30, 2026 milestone screen.
 * No sales arithmetic is independently sourced from the browser:
 * all figures come from the authenticated, governed celebration endpoint.
 */
(() => {
  'use strict';

  const API = '/celebration/api/sales';
  const REFRESH_MS = 30000;
  const REQUEST_TIMEOUT_MS = 75000;
  const MAX_CLIENT_SOURCE_AGE_MS = 180000;
  const EVENT_DATE = '2026-09-30';
  const ACHIEVEMENT_KEY = `celeste-celebration-${EVENT_DATE}-250m-seen`;
  const moneyFormat = new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const percentFormat = new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const $ = (id) => document.getElementById(id);
  const el = {
    monthly: $('monthly-total'), today: $('today-sales'), remaining: $('remaining-value'),
    remainingLabel: $('remaining-label'), remainingFoot: $('remaining-foot'),
    progress: $('progress-percent'), progressFill: $('progress-fill'),
    progressTrack: $('progress-track'), status: $('live-status'),
    statusLabel: $('status-label'), meta: $('total-meta'), lastSync: $('last-sync'),
    countdown: $('countdown'), achieved: $('achievement-banner'),
    overlay: $('celebration-overlay'), notice: $('notice'), noticeText: $('notice-text'),
    loginLink: $('login-link'), returnButton: $('return-button'),
    soundButton: $('sound-button'), soundLabel: $('sound-label'), canvas: $('fx-canvas'),
  };

  let lastSnapshot = null;
  let displayedMonthly = null;
  let numberAnimation = 0;
  let pollTimer = 0;
  let serverNowAtReceipt = null;
  let receivedAt = null;
  let disconnected = false;
  let soundEnabled = false;
  let audioContext = null;
  let confetti = [];
  let effectFrame = 0;
  let effectUntil = 0;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setStatus(label, state) {
    el.statusLabel.textContent = label;
    el.status.dataset.state = state;
  }

  function showNotice(message, allowLogin = false) {
    el.noticeText.textContent = message;
    el.loginLink.hidden = !allowLogin;
    el.notice.hidden = false;
  }

  function clearNotice() { el.notice.hidden = true; el.loginLink.hidden = true; }

  function currentServerNow() {
    return serverNowAtReceipt === null ? null : serverNowAtReceipt + (Date.now() - receivedAt);
  }

  function safeNumber(n) { return typeof n === 'number' && Number.isFinite(n) && n >= 0; }

  function fmtMoney(value) { return 'Rs. ' + moneyFormat.format(value); }

  function fmtTime(iso) {
    return new Intl.DateTimeFormat('en-LK', {
      timeZone: 'Asia/Colombo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    }).format(new Date(iso));
  }

  function animateMonthly(value) {
    cancelAnimationFrame(numberAnimation);
    if (reduceMotion) {
      displayedMonthly = value;
      el.monthly.textContent = moneyFormat.format(value);
      return;
    }
    const from = displayedMonthly === null ? value : displayedMonthly;
    const start = performance.now();
    const duration = displayedMonthly === null ? 0 : 1050;
    if (duration === 0) {
      displayedMonthly = value;
      el.monthly.textContent = moneyFormat.format(value);
      return;
    }
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 4);
      displayedMonthly = from + (value - from) * ease;
      el.monthly.textContent = moneyFormat.format(displayedMonthly);
      if (t < 1) numberAnimation = requestAnimationFrame(frame);
      else { displayedMonthly = value; el.monthly.textContent = moneyFormat.format(value); }
    }
    numberAnimation = requestAnimationFrame(frame);
  }

  function updateCountdown() {
    const deadline = Date.parse('2026-10-01T00:00:00+05:30');
    const now = currentServerNow();
    if (now === null) return;
    const remaining = Math.max(0, deadline - now);
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    el.countdown.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (remaining === 0) {
      el.countdown.textContent = '00:00:00';
      if (lastSnapshot) { setStatus('EVENT ENDED', 'error'); el.meta.textContent = 'SEPTEMBER 30 HAS ENDED · THIS DISPLAY IS A PREVIOUS SNAPSHOT'; }
    }
    if (lastSnapshot && now - Date.parse(lastSnapshot.live_read_at) > MAX_CLIENT_SOURCE_AGE_MS) {
      if (!disconnected) {
        disconnected = true;
        setStatus('DATA DELAYED', 'error');
        el.meta.textContent = 'LATEST VERIFIED SNAPSHOT · NOT CURRENTLY LIVE';
        showNotice('Live data is delayed. Displayed figures are the last verified snapshot.');
      }
    }
  }

  function clearPrivateData() {
    lastSnapshot = null;
    displayedMonthly = null;
    cancelAnimationFrame(numberAnimation);
    serverNowAtReceipt = null;
    receivedAt = null;
    el.monthly.textContent = '—';
    el.today.textContent = '—';
    el.remaining.textContent = '—';
    el.progress.textContent = '—';
    el.progressFill.style.width = '0%';
    el.progressTrack.setAttribute('aria-valuenow', '0');
    el.achieved.hidden = true;
    el.lastSync.textContent = 'VERIFIED LIVE DATA UNAVAILABLE';
    el.meta.textContent = 'PRIVATE LIVE SALES REQUIRE CELEBRATION ACCESS';
  }

  function validateSnapshot(data) {
    if (!data || data.event !== 'CELESTE_250_MILLION' || data.business_date !== EVENT_DATE || data.status !== 'LIVE') return false;
    for (const k of ['monthly_sales', 'today_sales', 'yesterday_closing', 'target', 'remaining', 'above_target', 'progress_percent']) {
      if (!safeNumber(data[k])) return false;
    }
    if (data.target !== 250000000 || Math.abs((data.yesterday_closing + data.today_sales) - data.monthly_sales) > 0.015) return false;
    if (typeof data.target_achieved !== 'boolean' || data.target_achieved !== (data.monthly_sales >= data.target)) return false;
    const source = Date.parse(data.live_read_at);
    const server = Date.parse(data.server_time);
    if (!Number.isFinite(source) || !Number.isFinite(server) || server - source > MAX_CLIENT_SOURCE_AGE_MS || source - server > 60000) return false;
    return true;
  }

  function seenAchievement() {
    try { return window.localStorage.getItem(ACHIEVEMENT_KEY) === 'yes'; }
    catch (_) { return window.__milestoneSeen === true; }
  }
  function markAchievementSeen() {
    window.__milestoneSeen = true;
    try { window.localStorage.setItem(ACHIEVEMENT_KEY, 'yes'); }
    catch (_) { /* private mode: suppress repeats for this tab */ }
  }

  function displaySnapshot(data) {
    const first = lastSnapshot === null;
    lastSnapshot = data;
    disconnected = false;
    serverNowAtReceipt = Date.parse(data.server_time);
    receivedAt = Date.now();
    clearNotice();
    setStatus('LIVE · AUTO UPDATING', 'live');
    animateMonthly(data.monthly_sales);
    el.today.textContent = fmtMoney(data.today_sales);
    el.progress.textContent = percentFormat.format(data.progress_percent) + '%';
    el.progressFill.style.width = Math.min(100, data.progress_percent) + '%';
    el.progressTrack.setAttribute('aria-valuenow', String(Math.min(100, data.progress_percent)));
    el.lastSync.textContent = 'ODOO VERIFIED · ' + fmtTime(data.live_read_at);
    el.meta.textContent = 'YESTERDAY’S CLOSING + TODAY’S VERIFIED LIVE PICKME & UBER SALES';
    if (data.target_achieved) {
      el.remainingLabel.innerHTML = 'ABOVE OUR GOAL <span>✦</span>';
      el.remaining.textContent = fmtMoney(data.above_target);
      el.remainingFoot.textContent = 'EVERY ADDITIONAL ORDER TAKES US FURTHER.';
      el.achieved.hidden = false;
      if (!seenAchievement()) {
        markAchievementSeen();
        // The first verified response already above target also triggers celebration.
        window.setTimeout(startCelebration, first ? 850 : 350);
      }
    } else {
      el.remainingLabel.innerHTML = 'REMAINING TO OUR GOAL <span>↗</span>';
      el.remaining.textContent = fmtMoney(data.remaining);
      el.remainingFoot.textContent = 'EVERY ORDER GETS US CLOSER.';
      el.achieved.hidden = true;
    }
    updateCountdown();
  }

  async function poll() {
    const startedAt = Date.now();
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(API, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: abort.signal,
      });
      if (response.status === 401 || response.status === 403) {
        clearPrivateData();
        setStatus('SIGN IN REQUIRED', 'error');
        showNotice('Your celebration access has expired. Sign in to continue.', true);
        return; // Do not continuously hammer the protected endpoint.
      }
      if (response.status === 409) {
        setStatus('EVENT ENDED', 'error');
        el.meta.textContent = 'THE SEPTEMBER 30 LIVE EVENT HAS ENDED';
        showNotice('The September 30 event has ended. A new verified closing balance is required for a new day.');
        return;
      }
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (!validateSnapshot(data)) throw new Error('Invalid or stale governed response');
      displaySnapshot(data);
    } catch (err) {
      disconnected = true;
      if (lastSnapshot) {
        setStatus('RECONNECTING', 'error');
        el.meta.textContent = 'LAST VERIFIED SNAPSHOT · LIVE SOURCE NOT CURRENTLY AVAILABLE';
        showNotice('Live data is temporarily unavailable. Figures shown are the last verified snapshot.');
      } else {
        setStatus('CONNECTION DELAYED', 'error');
        showNotice('Waiting for verified live sales. Retrying automatically.');
      }
    } finally {
      clearTimeout(timeout);
      if (el.statusLabel.textContent !== 'SIGN IN REQUIRED' && el.statusLabel.textContent !== 'EVENT ENDED') {
        pollTimer = window.setTimeout(poll, Math.max(0, REFRESH_MS - (Date.now() - startedAt)));
      }
    }
  }

  function playMilestoneSound() {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioContext = audioContext || new AudioCtx();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const now = audioContext.currentTime + .04;
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((frequency, index) => {
        const osc = audioContext.createOscillator();
        const volume = audioContext.createGain();
        osc.type = 'sine'; osc.frequency.value = frequency;
        volume.gain.setValueAtTime(0.0001, now + index * .13);
        volume.gain.exponentialRampToValueAtTime(.065, now + index * .13 + .045);
        volume.gain.exponentialRampToValueAtTime(.0001, now + index * .13 + .62);
        osc.connect(volume); volume.connect(audioContext.destination);
        osc.start(now + index * .13); osc.stop(now + index * .13 + .64);
      });
    } catch (_) { /* Browsers may refuse audio without interaction. */ }
  }

  const ctx = el.canvas.getContext('2d');
  const palette = ['#f3d798', '#d8ac5e', '#fff3d3', '#c79340', '#ffffff'];
  function resizeCanvas() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = Math.round(window.innerWidth * ratio);
    el.canvas.height = Math.round(window.innerHeight * ratio);
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas, { passive: true });
  resizeCanvas();

  function spawnBurst(x, y, count, spread = 1) {
    if (!ctx) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = (2 + Math.random() * 8) * spread;
      confetti.push({
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 2,
        angle: Math.random() * 6.28, spin: (Math.random() - .5) * .18,
        size: 3 + Math.random() * 6, color: palette[Math.floor(Math.random() * palette.length)],
        life: 1, decay: .006 + Math.random() * .004,
      });
    }
  }
  function tickFx() {
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const now = performance.now();
    if (now < effectUntil && Math.random() > .77) {
      const x = window.innerWidth * (.15 + Math.random() * .70);
      const y = window.innerHeight * (.12 + Math.random() * .48);
      spawnBurst(x, y, 22, .70);
    }
    confetti = confetti.filter(p => p.life > 0);
    for (const p of confetti) {
      p.x += p.vx; p.y += p.vy; p.vx *= .992; p.vy += .085;
      p.angle += p.spin; p.life -= p.decay;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
      ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .55);
      ctx.restore();
    }
    if (confetti.length || performance.now() < effectUntil) effectFrame = requestAnimationFrame(tickFx);
    else { effectFrame = 0; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
  }
  function startCelebration() {
    if (!lastSnapshot || !lastSnapshot.target_achieved || !el.overlay.hidden) return;
    el.overlay.hidden = false;
    el.returnButton.focus({ preventScroll: true });
    playMilestoneSound();
    if (!reduceMotion && ctx) {
      const w = window.innerWidth, h = window.innerHeight;
      spawnBurst(w * .20, h * .28, 180);
      spawnBurst(w * .80, h * .28, 180);
      spawnBurst(w * .50, h * .25, 100);
      effectUntil = performance.now() + 9500;
      if (!effectFrame) effectFrame = requestAnimationFrame(tickFx);
    }
  }
  el.returnButton.addEventListener('click', () => { el.overlay.hidden = true; });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.overlay.hidden) el.overlay.hidden = true;
  });
  el.soundButton.addEventListener('click', async () => {
    soundEnabled = !soundEnabled;
    el.soundButton.setAttribute('aria-pressed', String(soundEnabled));
    el.soundLabel.textContent = soundEnabled ? 'SOUND ENABLED' : 'ENABLE SOUND';
    if (soundEnabled) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) { audioContext = audioContext || new AudioCtx(); await audioContext.resume(); }
      } catch (_) { /* Visual celebration works regardless of audio permission. */ }
    }
  });

  // User-initiated replay is available after reaching the milestone, via double-click on the banner.
  el.achieved.title = 'Double-click to replay the celebration';
  el.achieved.addEventListener('dblclick', startCelebration);

  window.setInterval(updateCountdown, 1000);
  poll();
})();
