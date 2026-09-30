/* Celeste Daily: October 2026 milestone screen.
 * No sales arithmetic is independently sourced from the browser:
 * all figures come from the authenticated, governed celebration endpoint.
 */
(() => {
  'use strict';

  const API = '/celebration/api/sales';
  const REFRESH_MS = 30000;
  const REQUEST_TIMEOUT_MS = 75000;
  const MAX_CLIENT_SOURCE_AGE_MS = 180000;
  const EVENT_START = '2026-10-01';
  const EVENT_LAST_DAY = '2026-10-31';
  const DEADLINE = Date.parse('2026-11-01T00:00:00+05:30');
  const ACHIEVEMENT_KEY = 'celeste-celebration-october-2026-265m-seen';
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
    countdown: $('countdown'), achieved: $('achievement-banner'), historySync: $('history-sync'),
    overlay: $('celebration-overlay'), overlayBanknotes: $('overlay-banknotes'), notice: $('notice'), noticeText: $('notice-text'),
    loginLink: $('login-link'), returnButton: $('return-button'),
    soundButton: $('sound-button'), soundLabel: $('sound-label'), canvas: $('fx-canvas'),
    changeChip: $('sales-change-chip'), totalPanel: document.querySelector('.total-panel'),
    cashBurst: $('cash-burst'), dashboard: $('dashboard'),
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
  let lastCashPlayedAt = 0;
  let cashNoiseBuffer = null;
  let burstCleanup = 0;
  let changeTimer = 0;
  let glowTimer = 0;
  let confetti = [];
  let effectFrame = 0;
  let effectUntil = 0;
  let celebrationTimer = 0;
  let celebrationStartedAt = 0;
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
    const deadline = DEADLINE;
    const now = currentServerNow();
    if (now === null) return;
    const remaining = Math.max(0, deadline - now);
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    el.countdown.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (remaining === 0) {
      el.countdown.textContent = '00:00:00';
      if (lastSnapshot) { setStatus('EVENT ENDED', 'error'); el.meta.textContent = 'OCTOBER HAS ENDED · THIS DISPLAY IS A PREVIOUS SNAPSHOT'; }
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
    el.historySync.textContent = 'OCTOBER HISTORY UNAVAILABLE';
    window.clearTimeout(changeTimer);
    el.changeChip.hidden = true;
    el.totalPanel.classList.remove('sales-changed');
    el.today.classList.remove('sales-changed');
    el.dashboard.classList.remove('verified-money-event');
    el.cashBurst.replaceChildren();
    window.clearTimeout(burstCleanup);
  }

  function validateSnapshot(data) {
    if (!data || data.event !== 'CELESTE_OCTOBER_265_MILLION' || data.status !== 'LIVE') return false;
    if (typeof data.business_date !== 'string' || data.business_date < EVENT_START || data.business_date > EVENT_LAST_DAY) return false;
    if (typeof data.server_time !== 'string' || data.server_time.slice(0, 10) !== data.business_date) return false;
    for (const k of ['monthly_sales', 'today_sales', 'historical_sales', 'target', 'remaining', 'above_target', 'progress_percent']) {
      if (!safeNumber(data[k])) return false;
    }
    if (data.target !== 265000000 || Math.abs((data.historical_sales + data.today_sales) - data.monthly_sales) > 0.015) return false;
    if (typeof data.target_achieved !== 'boolean' || data.target_achieved !== (data.monthly_sales >= data.target)) return false;
    const expectedHistory = data.business_date === EVENT_START ? null : (() => {
      const day = new Date(data.business_date + 'T12:00:00Z');
      day.setUTCDate(day.getUTCDate() - 1);
      return day.toISOString().slice(0, 10);
    })();
    if (data.history_through !== expectedHistory) return false;
    if (data.business_date === EVENT_START && data.historical_sales !== 0) return false;
    const source = Date.parse(data.live_read_at);
    const history = Date.parse(data.history_verified_at);
    const server = Date.parse(data.server_time);
    if (!Number.isFinite(source) || !Number.isFinite(history) || !Number.isFinite(server)) return false;
    if (server - source > MAX_CLIENT_SOURCE_AGE_MS || source - server > 60000) return false;
    if (server - history > 1200000 || history - server > 60000) return false;
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

  function flashVerifiedChange(amount) {
    // Never announce fake increments while the number is just animating.
    // This is called once per distinct, successfully validated backend snapshot.
    window.clearTimeout(changeTimer);
    window.clearTimeout(glowTimer);
    const increase = amount > 0;
    el.changeChip.textContent = increase
      ? '✦  VERIFIED NEW SALES  + ' + fmtMoney(amount)
      : '✦  VERIFIED SALES ADJUSTMENT  ' + fmtMoney(Math.abs(amount));
    el.changeChip.classList.toggle('adjustment', !increase);
    el.changeChip.hidden = false;
    el.totalPanel.classList.remove('sales-changed');
    el.today.classList.remove('sales-changed');
    el.dashboard.classList.remove('verified-money-event');
    // Restart visual cue for a subsequent update.
    void el.totalPanel.offsetWidth;
    el.totalPanel.classList.add('sales-changed');
    el.today.classList.add('sales-changed');
    if (increase) el.dashboard.classList.add('verified-money-event');
    changeTimer = window.setTimeout(() => { el.changeChip.hidden = true; }, 10000);
    glowTimer = window.setTimeout(() => {
      el.totalPanel.classList.remove('sales-changed');
      el.today.classList.remove('sales-changed');
      el.dashboard.classList.remove('verified-money-event');
    }, 2300);
    if (increase) { playCashSound(); launchCashBurst(); }
  }

  function displaySnapshot(data) {
    const first = lastSnapshot === null;
    const previousToday = lastSnapshot && lastSnapshot.business_date === data.business_date ? lastSnapshot.today_sales : null;
    const previousHistory = lastSnapshot && lastSnapshot.business_date === data.business_date ? lastSnapshot.historical_sales : null;
    lastSnapshot = data;
    disconnected = false;
    serverNowAtReceipt = Date.parse(data.server_time);
    receivedAt = Date.now();
    clearNotice();
    setStatus('LIVE · AUTO UPDATING', 'live');
    animateMonthly(data.monthly_sales);
    el.today.textContent = fmtMoney(data.today_sales);
    if (previousToday !== null) {
      const centsChanged = Math.round(data.today_sales * 100) - Math.round(previousToday * 100);
      if (centsChanged !== 0) flashVerifiedChange(centsChanged / 100);
    }
    // Historical corrections can change the monthly total; never play a false
    // live-sale cash sound for the separate historical re-verification.
    if (previousHistory !== null && Math.round(data.historical_sales * 100) !== Math.round(previousHistory * 100)) {
      el.meta.textContent = 'HISTORICAL SALES REVERIFIED · SEE COMPLETED-DAY FIGURES';
    }
    el.progress.textContent = percentFormat.format(data.progress_percent) + '%';
    el.progressFill.style.width = Math.min(100, data.progress_percent) + '%';
    el.progressTrack.setAttribute('aria-valuenow', String(Math.min(100, data.progress_percent)));
    el.lastSync.textContent = 'TODAY ODOO VERIFIED · ' + fmtTime(data.live_read_at);
    el.historySync.textContent = 'HISTORY VERIFIED · ' + fmtTime(data.history_verified_at);
    if (!(previousHistory !== null && Math.round(data.historical_sales * 100) !== Math.round(previousHistory * 100))) {
      el.meta.textContent = 'OCTOBER COMPLETED DAYS (VERIFIED) + TODAY’S LIVE PICKME & UBER';
    }
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
        if (!el.overlay.hidden) stopCelebration();
        clearPrivateData();
        setStatus('SIGN IN REQUIRED', 'error');
        showNotice('Your celebration access has expired. Sign in to continue.', true);
        return; // Do not continuously hammer the protected endpoint.
      }
      if (response.status === 409) {
        if (!el.overlay.hidden) stopCelebration();
        setStatus('EVENT ENDED', 'error');
        el.meta.textContent = 'OCTOBER CAMPAIGN IS NOT ACTIVE';
        showNotice('The October campaign is not active; figures cannot be presented as LIVE.');
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


function ensureCashNoise() {
  if (!audioContext || cashNoiseBuffer) return;
  // Original browser-generated sound, not an external audio file or third-party asset.
  const rate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, Math.ceil(rate * 0.13), rate);
  const signal = buffer.getChannelData(0);
  let previous = 0;
  for (let i = 0; i < signal.length; i++) {
    const white = Math.random() * 2 - 1;
    previous = 0.72 * previous + 0.28 * white;
    signal[i] = (white * 0.67 + previous * 0.33) * (1 - i / signal.length * 0.18);
  }
  cashNoiseBuffer = buffer;
}

function playCashSound(preview = false) {
  // An ATM-note-dispensing sound: motor start, fast paper flutters and two firm end clicks.
  // Only a VERIFIED increase (or the explicit enable-button preview) triggers audio.
  if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
  const current = Date.now();
  if (!preview && current - lastCashPlayedAt < 2900) return;
  lastCashPlayedAt = current;
  try {
    ensureCashNoise();
    const now = audioContext.currentTime + 0.022;
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -19;
    compressor.knee.value = 17;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.12;
    compressor.connect(audioContext.destination);
    const master = audioContext.createGain();
    master.gain.setValueAtTime(preview ? 0.33 : 0.76, now);
    master.connect(compressor);
    const output = master;
    const flutterCount = preview ? 5 : 12;
    const flutterInterval = preview ? 0.075 : 0.073;

    // The low motor hum gives the sequence a physical ATM dispenser character.
    const motor = audioContext.createOscillator();
    const motorGain = audioContext.createGain();
    motor.type = 'sawtooth';
    motor.frequency.setValueAtTime(94, now);
    motor.frequency.linearRampToValueAtTime(123, now + 0.23);
    motor.frequency.linearRampToValueAtTime(102, now + flutterCount * flutterInterval + 0.16);
    motorGain.gain.setValueAtTime(0.0001, now);
    motorGain.gain.exponentialRampToValueAtTime(0.060, now + 0.065);
    motorGain.gain.setValueAtTime(0.055, now + flutterCount * flutterInterval);
    motorGain.gain.exponentialRampToValueAtTime(0.0001, now + flutterCount * flutterInterval + 0.20);
    const motorFilter = audioContext.createBiquadFilter();
    motorFilter.type = 'lowpass';
    motorFilter.frequency.value = 385;
    motor.connect(motorFilter);
    motorFilter.connect(motorGain);
    motorGain.connect(output);
    motor.start(now);
    motor.stop(now + flutterCount * flutterInterval + 0.22);

    for (let i = 0; i < flutterCount; i++) {
      const at = now + 0.065 + i * flutterInterval;
      const paper = audioContext.createBufferSource();
      paper.buffer = cashNoiseBuffer;
      paper.playbackRate.value = 0.88 + (i % 4) * 0.13;
      const paperFilter = audioContext.createBiquadFilter();
      paperFilter.type = 'bandpass';
      paperFilter.frequency.value = 1480 + (i % 3) * 270;
      paperFilter.Q.value = 0.55;
      const paperGain = audioContext.createGain();
      paperGain.gain.setValueAtTime(0.0001, at);
      paperGain.gain.exponentialRampToValueAtTime(0.19 + (i % 3) * 0.024, at + 0.004);
      paperGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.065);
      paper.connect(paperFilter);
      paperFilter.connect(paperGain);
      paperGain.connect(output);
      paper.start(at);
      paper.stop(at + 0.071);
      const mechanism = audioContext.createOscillator();
      const clickGain = audioContext.createGain();
      mechanism.type = 'square';
      mechanism.frequency.setValueAtTime(510 + (i % 2) * 165, at);
      clickGain.gain.setValueAtTime(0.0001, at);
      clickGain.gain.exponentialRampToValueAtTime(0.044, at + 0.002);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.021);
      mechanism.connect(clickGain);
      clickGain.connect(output);
      mechanism.start(at);
      mechanism.stop(at + 0.026);
    }
    // A brief double-clack at the end sounds like the tray opening.
    [0, 0.092].forEach((delay) => {
      const at = now + flutterCount * flutterInterval + 0.105 + delay;
      const clack = audioContext.createOscillator();
      const gain = audioContext.createGain();
      clack.type = 'triangle';
      clack.frequency.setValueAtTime(225, at);
      clack.frequency.exponentialRampToValueAtTime(113, at + 0.075);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.074);
      clack.connect(gain);
      gain.connect(output);
      clack.start(at);
      clack.stop(at + 0.082);
    });
  } catch (_) { /* The verified visual animation still works if sound is unavailable. */ }
}

function launchCashBurst() {
  if (reduceMotion || document.hidden || !el.cashBurst) return;
  window.clearTimeout(burstCleanup);
  el.cashBurst.replaceChildren();
  // Decorative note shapes only; they are NOT individual transactions or fabricated sales.
  const count = window.innerWidth < 900 ? 8 : 15;
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const note = document.createElement('span');
    note.className = 'cash-note';
    const angle = (i / count) * Math.PI * 2;
    const distance = (window.innerWidth < 900 ? 115 : 200) + (i % 5) * 31;
    note.style.setProperty('--cash-x', `${Math.round(Math.cos(angle) * distance)}px`);
    note.style.setProperty('--cash-y', `${Math.round(Math.sin(angle) * distance * .52 - 95)}px`);
    note.style.setProperty('--cash-rot', `${(i * 71) % 280 - 140}deg`);
    note.style.setProperty('--cash-delay', `${(i % 5) * 45}ms`);
    fragment.appendChild(note);
  }
  el.cashBurst.appendChild(fragment);
  burstCleanup = window.setTimeout(() => { el.cashBurst.replaceChildren(); }, 2450);
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
    count = Math.max(0, Math.min(count, (window.innerWidth < 740 ? 220 : 460) - confetti.length));
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
    if (now < effectUntil && confetti.length < 380 && Math.random() > .945) {
      const x = window.innerWidth * (.15 + Math.random() * .70);
      const y = window.innerHeight * (.12 + Math.random() * .48);
      spawnBurst(x, y, 7, .70);
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
  function stopCelebration() {
    window.clearInterval(celebrationTimer);
    celebrationTimer = 0;
    celebrationStartedAt = 0;
    effectUntil = 0;
    confetti = [];
    if (el.overlayBanknotes) el.overlayBanknotes.replaceChildren();
    if (effectFrame) { cancelAnimationFrame(effectFrame); effectFrame = 0; }
    if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    el.overlay.classList.remove('is-celebrating');
    el.overlay.hidden = true;
  }
  function persistentCelebrationPulse() {
    if (el.overlay.hidden || reduceMotion || document.hidden || !ctx) return;
    const elapsed = (performance.now() - celebrationStartedAt) / 1000;
    // Spectacular opening 30s, sustained for 2.5min, gentle ambient thereafter.
    const count = elapsed < 30 ? 60 : elapsed < 180 ? 36 : 14;
    spawnBurst(window.innerWidth * (.18 + Math.random() * .64), window.innerHeight * .22, count, elapsed < 30 ? 1 : .66);
    effectUntil = performance.now() + (elapsed < 30 ? 2200 : elapsed < 180 ? 4000 : 10000);
    if (!effectFrame) effectFrame = requestAnimationFrame(tickFx);
  }
  function startCelebration() {
    if (!lastSnapshot || !lastSnapshot.target_achieved || !el.overlay.hidden) return;
    el.overlay.hidden = false;
    el.overlay.classList.add('is-celebrating');
    el.returnButton.focus({ preventScroll: true });
    playMilestoneSound(); // Once on opening; no repetitive loud fanfare.
    celebrationStartedAt = performance.now();
    if (!reduceMotion && el.overlayBanknotes) {
      const notes = document.createDocumentFragment();
      const count = window.innerWidth < 741 ? 12 : 21;
      for (let i = 0; i < count; i++) {
        const banknote = document.createElement('span');
        banknote.className = 'overlay-banknote';
        banknote.style.setProperty('--note-left', ((i * 43.3 + 8) % 96) + '%');
        banknote.style.setProperty('--note-duration', (9 + (i % 6) * 1.3) + 's');
        banknote.style.setProperty('--note-delay', (-(i * 1.27 % 15)) + 's');
        banknote.style.setProperty('--note-sway', ((i % 2 ? 1 : -1) * (70 + (i % 4) * 24)) + 'px');
        notes.appendChild(banknote);
      }
      el.overlayBanknotes.replaceChildren(notes);
    }
    if (!reduceMotion && ctx) {
      const w = window.innerWidth, h = window.innerHeight;
      spawnBurst(w * .20, h * .28, 180);
      spawnBurst(w * .80, h * .28, 180);
      spawnBurst(w * .50, h * .25, 100);
      effectUntil = performance.now() + 9500;
      if (!effectFrame) effectFrame = requestAnimationFrame(tickFx);
      celebrationTimer = window.setInterval(persistentCelebrationPulse, 4000);
    }
  }
  el.returnButton.addEventListener('click', stopCelebration);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.overlay.hidden) stopCelebration();
  });
  el.soundButton.addEventListener('click', async () => {
    soundEnabled = !soundEnabled;
    el.soundButton.setAttribute('aria-pressed', String(soundEnabled));
    el.soundLabel.textContent = soundEnabled ? 'ATM SOUND ON' : 'ENABLE CASH AUDIO';
    if (soundEnabled) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) { audioContext = audioContext || new AudioCtx(); await audioContext.resume(); if (audioContext.state === 'running') playCashSound(true); }
      } catch (_) { /* Visual celebration works regardless of audio permission. */ }
    }
  });

  // User-initiated replay is available after reaching the milestone, via double-click on the banner.
  el.achieved.title = 'Double-click to replay the celebration';
  el.achieved.addEventListener('dblclick', startCelebration);

  window.setInterval(updateCountdown, 1000);
  poll();
})();
