/**
 * BOMB TIMER — Desktop Application Logic
 * Handles: timer, sonar, sensors, WebSocket sync, defuse, logging
 */

'use strict';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CFG = {
    defuseCode: '4829',     // must match server.js
    defaultTime: 5 * 60,    // 5 minutes in seconds
    wsUrl: (() => {
        const h = location.hostname || 'localhost';
        const p = location.port || 3000;
        return `ws://${h}:${p}`;
    })(),
};

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
    active: false,
    defused: false,
    timeLeft: CFG.defaultTime,
    timerInterval: null,
    ws: null,
    partialCode: '',
    sonarAngle: 0,
    sonarPulses: [],
    blastRadius: 0,
    tempVal: 28,
    stabVal: 92,
    signalLevel: 3,
};

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
    hours: $('t-hours'),
    minutes: $('t-minutes'),
    seconds: $('t-seconds'),
    badge: $('bomb-badge'),
    defuseDots: [$('d0'), $('d1'), $('d2'), $('d3')],
    defuseStatus: $('defuse-status'),
    defuseArea: $('defuse-area'),
    blastVal: $('blast-val'),
    tempVal: $('temp-val'),
    tempBar: $('temp-bar'),
    stabVal: $('stab-val'),
    stabBar: $('stab-bar'),
    hazardVal: $('hazard-val'),
    logList: $('log-list'),
    logCount: $('log-count'),
    logFooterTime: $('log-footer-time'),
    connDot: $('conn-dot'),
    connStatus: $('conn-status'),
    sysClock: $('sys-clock'),
    btnActivate: $('btn-activate'),
    btnDefuse: $('btn-defuse'),
    btnReset: $('btn-reset'),
    defusedOverlay: $('defused-overlay'),
    explodedOverlay: $('exploded-overlay'),
    defusedBy: $('defused-by'),
    sonarCanvas: $('sonar-canvas'),
};

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
function connectWS() {
    try {
        state.ws = new WebSocket(CFG.wsUrl);
    } catch (e) {
        setConnStatus(false);
        setTimeout(connectWS, 4000);
        return;
    }

    state.ws.onopen = () => {
        setConnStatus(true);
        state.ws.send(JSON.stringify({ type: 'register', role: 'display' }));
    };

    state.ws.onclose = () => {
        setConnStatus(false);
        setTimeout(connectWS, 4000);
    };

    state.ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        handleServerMsg(msg);
    };
}

function handleServerMsg(msg) {
    switch (msg.type) {
        case 'init_log':
            msg.entries.forEach(e => appendLog(e, false));
            break;
        case 'log':
            appendLog(msg.entry, true);
            break;
        case 'digit_update':
            onRemoteDigit(msg.partial);
            break;
        case 'defuse_result':
            handleDefuseResult(msg);
            break;
        case 'activate':
            startBomb(msg.duration);
            break;
        case 'reset':
            resetBomb(false);
            break;
    }
}

function wsSend(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(obj));
    }
}

function setConnStatus(online) {
    dom.connDot.classList.toggle('online', online);
    dom.connStatus.textContent = online ? 'ONLINE' : 'OFFLINE';
}

// ─── TIMER ────────────────────────────────────────────────────────────────────
function formatNum(n) { return String(Math.max(0, n)).padStart(2, '0'); }

function renderTimer() {
    const h = Math.floor(state.timeLeft / 3600);
    const m = Math.floor((state.timeLeft % 3600) / 60);
    const s = state.timeLeft % 60;
    dom.hours.textContent = formatNum(h);
    dom.minutes.textContent = formatNum(m);
    dom.seconds.textContent = formatNum(s);

    // Color shift: amber when < 60s
    const urgent = state.timeLeft < 60;
    dom.hours.classList.toggle('safe', !state.active);
    dom.minutes.classList.toggle('safe', !state.active || urgent);
    dom.seconds.classList.toggle('safe', !state.active || urgent);
}

function startBomb(duration = CFG.defaultTime) {
    if (state.active) return;
    state.active = true;
    state.defused = false;
    state.timeLeft = duration;
    document.body.className = 'state-active';
    dom.badge.textContent = '⬤ ARMED';
    dom.badge.className = 'bomb-status-badge active';
    dom.btnActivate.disabled = true;
    dom.btnDefuse.disabled = false;

    state.timerInterval = setInterval(() => {
        state.timeLeft--;
        renderTimer();
        updateBlastRadius();
        if (state.timeLeft <= 0) {
            clearInterval(state.timerInterval);
            explode();
        }
    }, 1000);

    renderTimer();
    updateSensors();
}

function explode() {
    state.active = false;
    document.body.className = 'state-exploded';
    dom.explodedOverlay.classList.add('show');
    sonarPulse(260, 'rgba(255,34,51,0.8)');
}

// ─── DEFUSE ────────────────────────────────────────────────────────────────────
function onRemoteDigit(partial) {
    state.partialCode = String(partial || '');
    const len = state.partialCode.length;
    dom.defuseDots.forEach((dot, i) => {
        dot.classList.toggle('filled', i < len);
        dot.classList.remove('success', 'fail');
    });
}

function handleDefuseResult(msg) {
    const allDots = dom.defuseDots;
    if (msg.success) {
        allDots.forEach(d => { d.classList.add('success'); d.classList.remove('filled', 'fail'); });
        dom.defuseStatus.textContent = '✔ BOM BERHASIL DINONAKTIFKAN';
        dom.defuseStatus.style.color = 'var(--green)';
        setTimeout(() => triggerDefused(msg), 600);
    } else {
        allDots.forEach(d => { d.classList.add('fail'); d.classList.remove('filled', 'success'); });
        dom.defuseStatus.textContent = '✘ KODE SALAH — AKSES DITOLAK';
        dom.defuseStatus.style.color = 'var(--red)';
        setTimeout(() => {
            state.partialCode = '';
            dom.defuseDots.forEach(d => { d.className = 'dot'; });
            dom.defuseStatus.textContent = 'MENUNGGU INPUT REMOTE...';
            dom.defuseStatus.style.color = '';
        }, 1500);
    }
}

function triggerDefused(msg) {
    state.active = false;
    state.defused = true;
    clearInterval(state.timerInterval);
    document.body.className = 'state-defused';
    dom.badge.textContent = '✔ DEFUSED';
    dom.badge.className = 'bomb-status-badge defused';
    dom.defusedBy.textContent = `BY ${msg.attempt ? '●●●●' : 'LOCAL'} | ${msg.timestamp || new Date().toISOString()}`;
    dom.defusedOverlay.classList.add('show');
    sonarPulse(260, 'rgba(0,255,136,0.6)');
}

function localDefuse() {
    const code = prompt('Masukkan kode defuse (4 digit):');
    if (!code) return;
    wsSend({ type: 'defuse_attempt', code });
    // Optimistic local check too
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        handleDefuseResult({ success: code === CFG.defuseCode, attempt: code, timestamp: new Date().toISOString() });
    }
}

function activateBomb() {
    wsSend({ type: 'activate', duration: CFG.defaultTime });
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        startBomb(CFG.defaultTime);
    }
}

function resetBomb(sendMsg = true) {
    state.active = false;
    state.defused = false;
    state.timeLeft = CFG.defaultTime;
    state.partialCode = '';
    clearInterval(state.timerInterval);
    document.body.className = 'state-standby';
    dom.badge.textContent = 'STANDBY';
    dom.badge.className = 'bomb-status-badge';
    dom.btnActivate.disabled = false;
    dom.btnDefuse.disabled = true;
    dom.defuseStatus.textContent = 'MENUNGGU INPUT REMOTE...';
    dom.defuseStatus.style.color = '';
    dom.defuseDots.forEach(d => d.className = 'dot');
    dom.defusedOverlay.classList.remove('show');
    dom.explodedOverlay.classList.remove('show');
    state.blastRadius = 0;
    renderTimer();
    if (sendMsg) wsSend({ type: 'reset' });
}

// ─── SENSORS ──────────────────────────────────────────────────────────────────
function updateSensors() {
    // Temperature simulation — rises when bomb is active
    if (state.active) {
        state.tempVal = Math.min(98, state.tempVal + (Math.random() * 0.8));
    } else {
        state.tempVal = Math.max(28, state.tempVal - (Math.random() * 0.3));
    }
    // Stability simulation
    state.stabVal = state.active
        ? Math.max(30, state.stabVal - Math.random() * 1.5)
        : Math.min(95, state.stabVal + Math.random() * 0.5);

    dom.tempVal.textContent = state.tempVal.toFixed(1);
    dom.stabVal.textContent = state.stabVal.toFixed(0);
    dom.tempBar.style.width = `${(state.tempVal / 100) * 100}%`;
    dom.stabBar.style.width = `${state.stabVal}%`;

    // Hazard level
    const t = state.tempVal;
    const hazard = t < 40 ? 'I' : t < 60 ? 'II' : t < 80 ? 'III' : 'IV';
    dom.hazardVal.textContent = hazard;

    // Signal bars
    const sigBars = document.querySelectorAll('.sig-bar');
    sigBars.forEach((bar, i) => {
        bar.classList.toggle('active', i < state.signalLevel);
    });

    setTimeout(updateSensors, 1500);
}

function updateBlastRadius() {
    // Blast radius grows as time decreases
    const ratio = 1 - (state.timeLeft / CFG.defaultTime);
    state.blastRadius = Math.round(ratio * 500);
    dom.blastVal.textContent = state.blastRadius + ' m';
}

// ─── SONAR ────────────────────────────────────────────────────────────────────
const sonarCtx = dom.sonarCanvas.getContext('2d');
const SONAR_CX = 130, SONAR_CY = 130, SONAR_R = 120;

function sonarPulse(r = SONAR_R, color = 'rgba(0,212,255,0.5)') {
    state.sonarPulses.push({ r: 0, maxR: r, color, alpha: 1 });
}

function drawSonar() {
    const ctx = sonarCtx;
    const W = dom.sonarCanvas.width, H = dom.sonarCanvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background & grid circles
    ctx.fillStyle = '#050C14';
    ctx.beginPath();
    ctx.arc(SONAR_CX, SONAR_CY, SONAR_R, 0, Math.PI * 2);
    ctx.fill();

    const gridColor = 'rgba(0,212,255,0.08)';
    for (let i = 1; i <= 4; i++) {
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(SONAR_CX, SONAR_CY, (SONAR_R / 4) * i, 0, Math.PI * 2);
        ctx.stroke();
    }
    // Crosshair
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(SONAR_CX - SONAR_R, SONAR_CY); ctx.lineTo(SONAR_CX + SONAR_R, SONAR_CY);
    ctx.moveTo(SONAR_CX, SONAR_CY - SONAR_R); ctx.lineTo(SONAR_CX, SONAR_CY + SONAR_R);
    ctx.stroke();

    // Sweep arm
    if (state.active) {
        const grad = ctx.createConicalGradient
            ? null
            : null; // fallback below
        const armAngle = state.sonarAngle;
        // Sweep fade arc
        for (let i = 0; i < 60; i++) {
            const a = armAngle - (i * Math.PI / 60);
            const alpha = (60 - i) / 60 * 0.4;
            ctx.strokeStyle = `rgba(255,34,51,${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(SONAR_CX, SONAR_CY);
            ctx.lineTo(
                SONAR_CX + Math.cos(a) * SONAR_R,
                SONAR_CY + Math.sin(a) * SONAR_R
            );
            ctx.stroke();
        }
        // Bright arm
        ctx.strokeStyle = 'rgba(255,34,51,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(SONAR_CX, SONAR_CY);
        ctx.lineTo(
            SONAR_CX + Math.cos(armAngle) * SONAR_R,
            SONAR_CY + Math.sin(armAngle) * SONAR_R
        );
        ctx.stroke();

        // Blast radius ring
        const ringR = (state.blastRadius / 500) * SONAR_R;
        if (ringR > 0) {
            ctx.strokeStyle = `rgba(255,170,0,0.5)`;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.arc(SONAR_CX, SONAR_CY, Math.min(ringR, SONAR_R), 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        state.sonarAngle = (state.sonarAngle + 0.03) % (Math.PI * 2);
    } else {
        // Idle: subtle green sweep
        ctx.strokeStyle = 'rgba(0,255,136,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(SONAR_CX, SONAR_CY);
        ctx.lineTo(
            SONAR_CX + Math.cos(state.sonarAngle) * SONAR_R,
            SONAR_CY + Math.sin(state.sonarAngle) * SONAR_R
        );
        ctx.stroke();
        state.sonarAngle = (state.sonarAngle + 0.008) % (Math.PI * 2);
    }

    // Pulse rings
    state.sonarPulses = state.sonarPulses.filter(p => p.alpha > 0.01);
    state.sonarPulses.forEach(p => {
        ctx.strokeStyle = p.color.replace(/[\d.]+\)$/, `${p.alpha})`);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(SONAR_CX, SONAR_CY, p.r, 0, Math.PI * 2);
        ctx.stroke();
        p.r = Math.min(p.r + 3, p.maxR);
        p.alpha *= 0.96;
    });

    // Border glow
    ctx.strokeStyle = state.active ? 'rgba(255,34,51,0.4)' : 'rgba(0,212,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(SONAR_CX, SONAR_CY, SONAR_R, 0, Math.PI * 2);
    ctx.stroke();

    requestAnimationFrame(drawSonar);
}

// ─── CLOCK ───────────────────────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    dom.sysClock.textContent = now.toTimeString().slice(0, 8);
}

// ─── LOG ─────────────────────────────────────────────────────────────────────
let logEntries = [];

function appendLog(entry, animate = true) {
    if (!entry || !entry.event) return;
    logEntries.push(entry);

    const empty = dom.logList.querySelector('.log-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    const evClass = entry.event.includes('SUCCESS') ? 'ev-SUCCESS'
        : entry.event.includes('FAIL') ? 'ev-FAILED'
            : entry.event.includes('CONNECT') ? 'ev-CONNECT'
                : entry.event.includes('ACTIV') ? 'ev-ACTIVATE'
                    : '';
    div.className = `log-entry ${evClass}`;

    const t = new Date(entry.timestamp);
    const timeStr = t.toTimeString().slice(0, 8);

    div.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-event">${entry.event}${entry.ip ? ' [' + entry.ip.slice(-8) + ']' : ''}${entry.attempt ? ' → ' + '●'.repeat(entry.attempt.length) : ''}</span>
  `;

    dom.logList.appendChild(div);
    dom.logList.scrollTop = dom.logList.scrollHeight;
    dom.logCount.textContent = logEntries.length;
    dom.logFooterTime.textContent = timeStr;

    // Keep max 100 entries visible
    while (dom.logList.children.length > 100) {
        dom.logList.removeChild(dom.logList.firstChild);
    }
}

function clearLog() {
    logEntries = [];
    dom.logList.innerHTML = '<div class="log-empty">Tidak ada aktivitas...</div>';
    dom.logCount.textContent = '0';
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
    renderTimer();
    setConnStatus(false);
    updateSensors();
    drawSonar();
    setInterval(updateClock, 1000);
    updateClock();
    connectWS();

    // Initial local log
    appendLog({ event: 'SYSTEM_BOOT', timestamp: new Date().toISOString() });
}

document.addEventListener('DOMContentLoaded', init);
