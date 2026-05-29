/**
 * BOMB REMOTE — Android Remote Logic
 * Handles: digit input, defuse submit, timer mirror, WebSocket
 */

'use strict';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CFG = {
    wsUrl: (() => {
        const h = location.hostname || 'localhost';
        const p = location.port || 3000;
        return `ws://${h}:${p}`;
    })(),
};

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
    ws: null,
    code: '',
    active: false,
    timeLeft: 0,
};

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
    dot: $('r-dot'),
    connText: $('r-conn-text'),
    clock: $('r-clock'),
    timer: $('r-timer'),
    badge: $('r-badge'),
    cells: [$('rc0'), $('rc1'), $('rc2'), $('rc3')],
    feedback: $('r-feedback'),
    defuseBtn: $('r-defuse-btn'),
    logList: $('r-log-list'),
};

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
function connectWS() {
    try {
        state.ws = new WebSocket(CFG.wsUrl);
    } catch (e) {
        setConn(false);
        setTimeout(connectWS, 4000);
        return;
    }

    state.ws.onopen = () => {
        setConn(true);
        state.ws.send(JSON.stringify({ type: 'register', role: 'remote' }));
    };

    state.ws.onclose = () => {
        setConn(false);
        setTimeout(connectWS, 4000);
    };

    state.ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        handleMsg(msg);
    };
}

function handleMsg(msg) {
    switch (msg.type) {
        case 'activate':
            state.active = true;
            state.timeLeft = msg.duration || 300;
            dom.badge.textContent = '⬤ ARMED';
            dom.badge.className = 'r-status-badge active';
            renderRemoteTimer();
            addLog('BOMB ARMED', 'normal');
            break;
        case 'reset':
            state.active = false;
            state.timeLeft = 0;
            dom.timer.textContent = '--:--:--';
            dom.timer.className = 'r-timer-display';
            dom.badge.textContent = 'STANDBY';
            dom.badge.className = 'r-status-badge';
            addLog('SYSTEM RESET', 'normal');
            break;
        case 'defuse_result':
            handleDefuseResult(msg);
            break;
        case 'log':
            if (msg.entry) addLog(msg.entry.event, '');
            break;
    }
}

function wsSend(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(obj));
    }
}

function setConn(online) {
    dom.dot.classList.toggle('online', online);
    dom.connText.textContent = online ? 'TERHUBUNG' : 'TERPUTUS — menghubungkan...';
}

// ─── TIMER MIRROR ────────────────────────────────────────────────────────────
function renderRemoteTimer() {
    if (!state.active) return;
    const h = Math.floor(state.timeLeft / 3600);
    const m = Math.floor((state.timeLeft % 3600) / 60);
    const s = state.timeLeft % 60;
    const str = `${pad(h)}:${pad(m)}:${pad(s)}`;
    dom.timer.textContent = str;
    dom.timer.className = state.timeLeft < 60 ? 'r-timer-display safe' : 'r-timer-display';

    if (state.timeLeft > 0) {
        state.timeLeft--;
        setTimeout(renderRemoteTimer, 1000);
    } else {
        dom.timer.textContent = '💥 DETONATE';
        dom.badge.textContent = 'DETONATED';
        dom.badge.className = 'r-status-badge';
        state.active = false;
    }
}

function pad(n) { return String(Math.max(0, n)).padStart(2, '0'); }

// ─── CODE INPUT ───────────────────────────────────────────────────────────────
function pressDigit(digit) {
    if (state.code.length >= 4) return;
    state.code += digit;
    renderCode();
    wsSend({ type: 'digit_input', digit, partial: state.code });
    vibrate(30);
}

function deleteDigit() {
    if (state.code.length === 0) return;
    state.code = state.code.slice(0, -1);
    renderCode();
    wsSend({ type: 'digit_input', digit: null, partial: state.code });
    vibrate(15);
}

function clearCode() {
    state.code = '';
    renderCode();
    wsSend({ type: 'digit_input', digit: null, partial: '' });
    vibrate(15);
}

function renderCode() {
    dom.cells.forEach((cell, i) => {
        const filled = i < state.code.length;
        cell.textContent = filled ? state.code[i] : '·';
        cell.classList.toggle('filled', filled);
        cell.classList.remove('success', 'fail');
    });
    dom.defuseBtn.disabled = state.code.length < 4;
    if (state.code.length < 4) {
        dom.feedback.textContent = `${4 - state.code.length} DIGIT LAGI...`;
        dom.feedback.style.color = '';
    } else {
        dom.feedback.textContent = 'SIAP KIRIM — TEKAN DEFUSE';
        dom.feedback.style.color = 'var(--cyan)';
    }
}

function submitDefuse() {
    if (state.code.length < 4) return;
    dom.defuseBtn.disabled = true;
    dom.feedback.textContent = 'MENGIRIM KODE...';
    wsSend({ type: 'defuse_attempt', code: state.code });
    vibrate(80);
}

function handleDefuseResult(msg) {
    dom.cells.forEach(cell => {
        cell.classList.remove('filled');
        cell.classList.add(msg.success ? 'success' : 'fail');
    });

    if (msg.success) {
        dom.feedback.textContent = '✔ BERHASIL DINONAKTIFKAN!';
        dom.feedback.style.color = 'var(--green)';
        dom.badge.textContent = '✔ DEFUSED';
        dom.badge.className = 'r-status-badge defused';
        state.active = false;
        addLog('DEFUSE SUCCESS', 'success');
        vibrate([100, 50, 100]);
    } else {
        dom.feedback.textContent = '✘ KODE SALAH — COBA LAGI';
        dom.feedback.style.color = 'var(--red)';
        addLog('DEFUSE FAILED', 'fail');
        vibrate([50, 30, 50, 30, 200]);
        setTimeout(() => {
            state.code = '';
            renderCode();
        }, 1500);
    }
}

// ─── ACTION BUTTONS ───────────────────────────────────────────────────────────
function remoteActivate() {
    wsSend({ type: 'activate', duration: 300 });
    addLog('ACTIVATE SENT', 'normal');
    vibrate(120);
}

function remoteReset() {
    wsSend({ type: 'reset' });
    clearCode();
    addLog('RESET SENT', 'normal');
    vibrate(60);
}

// ─── LOG ─────────────────────────────────────────────────────────────────────
function addLog(text, type = 'normal') {
    const empty = dom.logList.querySelector('.r-log-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = `r-log-entry ${type}`;
    const time = new Date().toTimeString().slice(0, 8);
    div.textContent = `${time} · ${text}`;
    dom.logList.appendChild(div);
    dom.logList.scrollTop = dom.logList.scrollHeight;

    while (dom.logList.children.length > 30) {
        dom.logList.removeChild(dom.logList.firstChild);
    }
}

// ─── HAPTIC ──────────────────────────────────────────────────────────────────
function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
}

// ─── CLOCK ───────────────────────────────────────────────────────────────────
function updateClock() {
    dom.clock.textContent = new Date().toTimeString().slice(0, 8);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
    setConn(false);
    renderCode();
    setInterval(updateClock, 1000);
    updateClock();
    connectWS();
    addLog('REMOTE BOOT', 'normal');
}

document.addEventListener('DOMContentLoaded', init);
