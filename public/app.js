// --- CLINICAL CASES ---
let CLINICAL_CASES = [];

const BASE_BEDS = {
  "101": { patient: "佐藤 一郎 (72歳)", diagnosis: "慢性心不全・経過観察", status: "stable", vitals: { hr: 72, bp_sys: 124, bp_dia: 80, spo2: 97, rr: 14 }, active_event: null },
  "102": { patient: "鈴木 美咲 (28歳)", diagnosis: "気管支喘息・点滴中", status: "stable", vitals: { hr: 80, bp_sys: 110, bp_dia: 70, spo2: 98, rr: 16 }, active_event: null },
  "103": { patient: "高橋 健二 (55歳)", diagnosis: "肝硬変・腹水管理", status: "stable", vitals: { hr: 65, bp_sys: 138, bp_dia: 85, spo2: 96, rr: 12 }, active_event: null },
  "104": { patient: "田中 友美 (42歳)", diagnosis: "腎盂腎炎・抗菌薬治療", status: "stable", vitals: { hr: 88, bp_sys: 115, bp_dia: 75, spo2: 95, rr: 18 }, active_event: null },
};

// --- STATE VARIABLES ---
let currentGameState = {
  status: "LOBBY",
  players: {},
  safety: 100,
  time_left: 180,
  beds: {},
  logs: [],
  debriefings: [],
  seconds_since_last_spawn: 0,
  peaceful_seconds: 0
};
let currentUserData = null;
let hasJoined = false; // Tracks if logged in
let gasUrl = localStorage.getItem('gas_url') || (typeof CONFIG !== 'undefined' ? CONFIG.gasUrl : '');
let isGasActive = false; // Connection success flag for GAS
let gameIntervalId = null;

// --- UI DOM ELEMENTS ---
const screens = {
  lobby: document.getElementById('lobby-screen'),
  game: document.getElementById('game-screen'),
  result: document.getElementById('result-screen'),
};

const lobbyLoading = document.getElementById('lobby-loading');
const lobbyEmailEntry = document.getElementById('lobby-email-entry');
const lobbyCodeEntry = document.getElementById('lobby-code-entry');
const lobbyRegistrationPanel = document.getElementById('lobby-registration-panel');

const userEmailInput = document.getElementById('user-email');
const otpCodeInput = document.getElementById('otp-code');
const regUsernameInput = document.getElementById('reg-username');

const btnSendOtp = document.getElementById('btn-send-otp');
const btnVerifyOtp = document.getElementById('btn-verify-otp');
const btnBackToEmail = document.getElementById('btn-back-to-email');
const btnRegisterName = document.getElementById('btn-register-name');

const lobbyWaiting = document.getElementById('lobby-waiting');
const otpHintText = document.getElementById('otp-hint-text');

// Settings Drawer DOM Elements
const btnSettingsToggle = document.getElementById('btn-settings-toggle');
const btnSettingsClose = document.getElementById('btn-settings-close');
const btnSettingsSave = document.getElementById('btn-settings-save');
const settingsDrawer = document.getElementById('settings-drawer');
const gasUrlInput = document.getElementById('gas-url-input');

// Badges
const badges = {
  settings: document.getElementById('settings-connection-status'),
  lobby: document.getElementById('lobby-connection-status'),
  game: document.getElementById('game-connection-status')
};

// Header Stats
const gameTimer = document.getElementById('game-timer');
const safetyGauge = document.getElementById('safety-gauge');
const safetyValue = document.getElementById('safety-value');

// --- AUDIO SOUND SYSTEM ---
const btnSoundToggle = document.getElementById('btn-sound-toggle');

const AudioMonitor = {
  ctx: null,
  soundEnabled: false,
  alarmInterval: null,
  heartbeatTimeout: null,
  targetHR: 75,
  currentAlarmLevel: 'stable',
  flatlineOsc: null,
  flatlineGain: null,
  
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.error("Web Audio API not supported", e);
    }
  },
  
  toggle() {
    this.init();
    this.soundEnabled = !this.soundEnabled;
    if (this.soundEnabled && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    
    if (btnSoundToggle) {
      btnSoundToggle.innerText = this.soundEnabled ? '🔊' : '🔇';
      btnSoundToggle.title = this.soundEnabled ? 'サウンドON' : 'サウンドOFF';
    }
    
    if (this.soundEnabled) {
      this.startHeartbeatLoop();
    } else {
      this.stopAlarm();
      this.stopHeartbeatLoop();
    }
  },
  
  playHeartbeat(frequency = 800, duration = 0.08, volume = 0.03) {
    if (!this.soundEnabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      
      gainNode.gain.setValueAtTime(volume, this.ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
      
      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);
      
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      console.warn("Heartbeat sound error:", e);
    }
  },
  
  startHeartbeatLoop() {
    if (this.heartbeatTimeout) return;
    
    const run = () => {
      if (!this.soundEnabled || !this.ctx) {
        this.heartbeatTimeout = null;
        return;
      }
      
      if (this.targetHR > 0) {
        // Modulate pitch dynamically based on lowest SpO2 (simulates patient monitor beep pitch drop)
        const spo2 = this.targetSpO2 || 98;
        // 100% SpO2 = 800Hz, 80% SpO2 = 440Hz
        const freq = Math.max(380, 440 + (spo2 - 80) * 18);
        const vol = this.targetHR > 120 ? 0.04 : 0.02;
        this.playHeartbeat(freq, 0.08, vol);
      }
      
      // 1.3x multiplier to make the audio tempo calmer and more realistic
      const interval = this.targetHR > 0 ? (60000 / this.targetHR) * 1.3 : 2000;
      this.heartbeatTimeout = setTimeout(run, interval);
    };
    
    run();
  },
  
  stopHeartbeatLoop() {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  },
  
  updateAlarmState(dangerLevel) {
    if (!this.soundEnabled || !this.ctx) {
      this.stopAlarm();
      return;
    }
    
    if (this.currentAlarmLevel === dangerLevel) return;
    
    this.stopAlarm();
    this.currentAlarmLevel = dangerLevel;
    
    if (dangerLevel === 'flatline') {
      try {
        this.flatlineOsc = this.ctx.createOscillator();
        this.flatlineGain = this.ctx.createGain();
        this.flatlineOsc.type = 'sine';
        this.flatlineOsc.frequency.setValueAtTime(523.25, this.ctx.currentTime); // C5
        this.flatlineGain.gain.setValueAtTime(0.04, this.ctx.currentTime);
        this.flatlineOsc.connect(this.flatlineGain);
        this.flatlineGain.connect(this.ctx.destination);
        this.flatlineOsc.start();
      } catch (e) {}
    } else if (dangerLevel === 'danger') {
      let isBeep = false;
      this.alarmInterval = setInterval(() => {
        isBeep = !isBeep;
        if (isBeep) {
          this.playHeartbeat(987.77, 0.25, 0.06); // B5, 0.25s
        }
      }, 350);
    } else if (dangerLevel === 'warning') {
      let isBeep = false;
      this.alarmInterval = setInterval(() => {
        isBeep = !isBeep;
        if (isBeep) {
          this.playHeartbeat(659.25, 0.2, 0.04); // E5, 0.2s
        }
      }, 500);
    }
  },
  
  stopAlarm() {
    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
    if (this.flatlineOsc) {
      try {
        this.flatlineOsc.stop();
      } catch (e) {}
      this.flatlineOsc = null;
    }
    this.flatlineGain = null;
    this.currentAlarmLevel = 'stable';
  }
};

if (btnSoundToggle) {
  btnSoundToggle.addEventListener('click', () => {
    AudioMonitor.toggle();
  });
}

function updateAudioEngine() {
  if (!AudioMonitor.soundEnabled) return;
  
  let maxDangerLevel = 'stable';
  let highestHR = 70;
  let lowestSpO2 = 98; // Track the lowest SpO2 to modulate QRS beep pitch
  let hasFlatline = false;
  
  if (currentGameState.status === "PLAYING" && currentGameState.beds) {
    Object.values(currentGameState.beds).forEach(bed => {
      const v = bed.vitals;
      
      if (bed.active_event && (v.hr === 0 || v.spo2 === 0)) {
        hasFlatline = true;
      }
      
      if (bed.status === 'danger') {
        maxDangerLevel = 'danger';
      } else if (bed.status === 'warning' && maxDangerLevel !== 'danger') {
        maxDangerLevel = 'warning';
      }
      
      if (bed.active_event && v.hr > highestHR) {
        highestHR = v.hr;
      }
      
      // Track lowest SpO2 of active emergency beds
      if (bed.active_event && v.spo2 > 0 && v.spo2 < lowestSpO2) {
        lowestSpO2 = v.spo2;
      }
    });
  }
  
  if (hasFlatline) {
    AudioMonitor.targetHR = 0;
    AudioMonitor.targetSpO2 = 0;
    AudioMonitor.updateAlarmState('flatline');
  } else {
    AudioMonitor.targetHR = highestHR;
    AudioMonitor.targetSpO2 = lowestSpO2;
    AudioMonitor.updateAlarmState(maxDangerLevel);
  }
}

// --- WAVEFORM CANVAS ENGINE ---
const bedWaveState = {
  "101": { wfx: 0, beatPhase: 0, prevPy: {} },
  "102": { wfx: 0, beatPhase: 0, prevPy: {} },
  "103": { wfx: 0, beatPhase: 0, prevPy: {} },
  "104": { wfx: 0, beatPhase: 0, prevPy: {} }
};

function gauss(p, c, w, a) {
  return a * Math.exp(-((p - c) * (p - c)) / (2 * w * w));
}

function ecgWave(p) {
  return gauss(p, 0.16, 0.020, 0.12) - gauss(p, 0.235, 0.006, 0.10) + gauss(p, 0.25, 0.006, 1.0) - gauss(p, 0.265, 0.007, 0.22) + gauss(p, 0.46, 0.040, 0.26);
}

function plethWave(p) {
  let v = Math.max(0, Math.sin(Math.PI * Math.min(1, p * 1.6))) * 1.0;
  v += gauss(p, 0.45, 0.06, 0.25);
  return v;
}

function artWave(p) {
  let v = Math.max(0, Math.sin(Math.PI * Math.min(1, p * 1.5))) * 1.0;
  v += gauss(p, 0.42, 0.05, 0.20);
  return v;
}

let waveIntervalId = null;
let lastWaveTS = 0;

function startWaveformEngine() {
  if (waveIntervalId) {
    cancelAnimationFrame(waveIntervalId);
  }
  
  lastWaveTS = 0;
  Object.keys(bedWaveState).forEach(bid => {
    bedWaveState[bid].wfx = 0;
    bedWaveState[bid].beatPhase = 0;
    bedWaveState[bid].prevPy = {};
  });
  
  function loop(ts) {
    if (currentGameState.status !== "PLAYING") {
      waveIntervalId = null;
      return;
    }
    if (!lastWaveTS) lastWaveTS = ts;
    let dt = (ts - lastWaveTS) / 1000;
    lastWaveTS = ts;
    if (dt > 0.1) dt = 0.1;
    
    Object.entries(currentGameState.beds).forEach(([bid, bed]) => {
      const canvas = document.getElementById(`canvas-wf-${bid}`);
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      const state = bedWaveState[bid];
      const v = bed.vitals;
      
      if (canvas.width !== 400) {
        canvas.width = 400;
        canvas.height = 120;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, 400, 120);
        state.wfx = 0;
        state.prevPy = {};
      }
      
      const W = canvas.width;
      const H = canvas.height;
      const ar = (v.hr === 0 || v.spo2 === 0);
      const hr = ar ? 60 : Math.min(180, Math.max(30, v.hr));
      
      const lanes = [
        { y: H * 0.22, h: H * 0.16, col: "#37e07a" }, // ECG
        { y: H * 0.54, h: H * 0.14, col: "#ff5d6c" }, // Art
        { y: H * 0.82, h: H * 0.14, col: "#36c6ff" }  // Pleth
      ];
      
      const speed = W / 4.0;
      const steps = Math.max(1, Math.round(speed * dt));
      const dbp = Math.max(30, Math.round(v.bp_sys * 0.65));
      
      for (let i = 0; i < steps; i++) {
        const x = state.wfx;
        
        ctx.fillStyle = "#000";
        ctx.fillRect(x, 0, 6, H);
        
        if (x % 16 === 0) {
          ctx.strokeStyle = "rgba(0, 255, 102, 0.02)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        
        state.beatPhase += (hr / 60) * (1 / speed);
        if (state.beatPhase >= 1) {
          state.beatPhase -= 1;
        }
        
        let ecgVal = 0;
        if (ar) {
          if (bed.active_event && bed.active_event.is_arrest) {
            if (bed.active_event.cpr_active) {
              // Chest compressions artifact waveform (regular waves at ~100 bpm)
              ecgVal = Math.sin(state.wfx * 0.15) * 0.6 + (Math.random() - 0.5) * 0.05;
            } else {
              // Ventricular Fibrillation (VF) chaotic waveform
              ecgVal = (Math.sin(state.wfx * 0.2) + Math.sin(state.wfx * 0.5) * 0.5 + (Math.random() - 0.5) * 0.4) * 0.6;
            }
          } else {
            // Asystole / Flatline with slight noise
            ecgVal = (Math.random() - 0.5) * 0.03;
          }
        } else if (bed.status === 'danger' && v.hr > 130) {
          ecgVal = (Math.random() - 0.5) * 1.3;
        } else {
          ecgVal = ecgWave(state.beatPhase);
        }
        plotLine(ctx, state, lanes[0], x, ecgVal);
        
        let artVal = 0;
        if (!ar) {
          artVal = artWave(state.beatPhase) * ((v.bp_sys - dbp) / 60) + (dbp - 70) / 120;
        }
        plotLine(ctx, state, lanes[1], x, artVal);
        
        let plethVal = 0;
        if (!ar) {
          plethVal = plethWave(state.beatPhase) * (0.5 + (v.spo2 - 90) / 25);
        }
        plotLine(ctx, state, lanes[2], x, plethVal);
        
        state.wfx += 1;
        if (state.wfx >= W) {
          state.wfx = 0;
        }
      }
    });
    
    waveIntervalId = requestAnimationFrame(loop);
  }
  
  waveIntervalId = requestAnimationFrame(loop);
}

function plotLine(ctx, state, lane, x, val) {
  const y = lane.y - val * lane.h;
  ctx.strokeStyle = lane.col;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  
  const pp = state.prevPy[lane.col];
  if (pp && pp.x === x - 1) {
    ctx.moveTo(pp.x, pp.y);
  } else {
    ctx.moveTo(x, y);
  }
  ctx.lineTo(x, y);
  ctx.stroke();
  
  state.prevPy[lane.col] = { x, y };
}

// Beds Container
const wardGrid = document.getElementById('ward-grid');
const logFeed = document.getElementById('log-feed');

// Admin Panel Elements
const adminSelectBed = document.getElementById('admin-select-bed');
const adminSelectCase = document.getElementById('admin-select-case');
const btnAdminSpawn = document.getElementById('btn-admin-spawn');
const btnAdminHeal = document.getElementById('btn-admin-heal');
const btnAdminTime = document.getElementById('btn-admin-time');
const adminInvincibleToggle = document.getElementById('admin-invincible-toggle');
const adminPanelSection = document.getElementById('admin-panel-section');

// Admin Biometric Lock Elements
const btnAdminRegisterBio = document.getElementById('btn-admin-register-bio');
const btnAdminUnlockBio = document.getElementById('btn-admin-unlock-bio');
const btnAdminLockBio = document.getElementById('btn-admin-lock-bio');
const adminStatusBadge = document.getElementById('admin-status-badge');
const adminAuthDesc = document.getElementById('admin-auth-desc');

let isAdminAuthenticated = false; // Session authentication flag

// Result Screen
const resultTitle = document.getElementById('result-title');
const resultSafety = document.getElementById('result-safety');
const resultGrade = document.getElementById('result-grade');
const resultScores = document.getElementById('result-scores');
const debriefingFeed = document.getElementById('debriefing-feed');
const btnRestart = document.getElementById('btn-restart');

// --- TIMEOUT FETCH HELPER ---
async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 3000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// --- INITIALIZE PAGE ---
async function init() {
  updateConnectionBadges();
  updateAdminAuthUI();
  
  try {
    const res = await fetch('data/cases.json');
    const cases = await res.json();
    if (cases && cases.length > 0) {
      CLINICAL_CASES = cases;
      populateAdminCaseSelector();
    }
  } catch (e) {
    console.error("Failed to load cases:", e);
  }
  
  // Directly render lobby state
  updateState(currentGameState);

  // Trigger silent auto login check
  if (gasUrl) {
    checkAutoLogin(true); // silent = true
  } else {
    // If no gas URL, show unauthenticated/local mode
    showLobbySubPanel('auth');
  }
}

function showLobbySubPanel(panelId) {
  if (lobbyLoading) lobbyLoading.style.display = panelId === 'loading' ? 'block' : 'none';
  if (lobbyEmailEntry) lobbyEmailEntry.style.display = panelId === 'email' ? 'block' : 'none';
  if (lobbyCodeEntry) lobbyCodeEntry.style.display = panelId === 'code' ? 'block' : 'none';
  if (lobbyRegistrationPanel) lobbyRegistrationPanel.style.display = panelId === 'register' ? 'block' : 'none';
  if (lobbyWaiting) lobbyWaiting.style.display = panelId === 'waiting' ? 'block' : 'none';
}

function populateAdminCaseSelector() {
  if (!adminSelectCase) return;
  adminSelectCase.innerHTML = '';
  CLINICAL_CASES.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.title} (${c.complaint})`;
    adminSelectCase.appendChild(opt);
  });
}

function recordStats(caseId, tried, correct) {
  if (!gasUrl) return;
  fetch(gasUrl, {
    method: 'POST',
    mode: 'cors',
    body: JSON.stringify({ action: "stats", case_id: caseId, tried: tried, correct: correct })
  }).catch(e => console.error(e));
}

async function checkAutoLogin(silent = false) {
  const email = localStorage.getItem('session_email');
  if (!gasUrl || !email) {
    showLobbySubPanel('email');
    return;
  }
  
  if (!silent) showLobbySubPanel('loading');

  try {
    const res = await fetchWithTimeout(`${gasUrl}?action=silent_check&email=${encodeURIComponent(email)}`, {
      method: 'GET',
      mode: 'cors'
    });
    const data = await res.json();
    
    if (data && data.status === "unauthenticated") {
      isGasActive = true;
      showLobbySubPanel('email');
    } else if (data && (data.status === "success" || data.status === "not_registered" || data.status === "not_found")) {
      isGasActive = true;
      
      const user = {
        email: data.email || email,
        name: data.name || "匿名医師",
        high_score: parseInt(data.high_score) || 0,
        completed_cases: Array.isArray(data.completed_cases) 
          ? data.completed_cases 
          : (data.completed_cases ? data.completed_cases.split(",") : []),
        last_played: data.last_played || ""
      };
      
      currentUserData = user;
      
      if (data.status === "not_registered" || data.status === "not_found" || user.name === "匿名医師") {
        showLobbySubPanel('register');
      } else {
        hasJoined = true;
        updateConnectionBadges();
        showLobbySubPanel('waiting');
        renderDashboard(user);
      }
    } else {
      isGasActive = false;
      showLobbySubPanel('email');
    }
  } catch (e) {
    console.warn("Auto login check failed:", e);
    isGasActive = false;
    showLobbySubPanel('email');
  }
  updateConnectionBadges();
}

async function sendOtp() {
  const email = userEmailInput.value.trim().toLowerCase();
  if (!email) {
    alert("メールアドレスを入力してください。");
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert("正しいメールアドレスの形式で入力してください。");
    return;
  }
  
  showLobbySubPanel('loading');
  
  try {
    const res = await fetchWithTimeout(`${gasUrl}?action=send_otp&email=${encodeURIComponent(email)}`, {
      method: 'GET',
      mode: 'cors'
    });
    const data = await res.json();
    
    if (data && data.status === "success") {
      isGasActive = true;
      updateConnectionBadges();
      
      if (data.test_code) {
        otpHintText.innerHTML = `テストアドレスを検知しました。<br>認証コード: <span style="font-size:1.2rem; font-weight:bold; color:var(--warning);">${data.test_code}</span>`;
      } else {
        otpHintText.innerText = "メールアドレス宛に6桁の認証コードを送信しました。";
      }
      
      userEmailInput.dataset.currentEmail = email;
      showLobbySubPanel('code');
    } else {
      alert("認証コードの送信に失敗しました: " + (data ? data.message : "不明なエラー"));
      showLobbySubPanel('email');
    }
  } catch (e) {
    console.error("Failed to send OTP:", e);
    alert("通信エラーが発生しました。GAS Web App URL が正しいか確認してください。");
    showLobbySubPanel('email');
  }
}

async function verifyOtp() {
  const email = userEmailInput.dataset.currentEmail;
  const code = otpCodeInput.value.trim();
  
  if (!email || !code || code.length !== 6) {
    alert("6桁の認証コードを正しく入力してください。");
    return;
  }
  
  showLobbySubPanel('loading');
  
  try {
    const res = await fetchWithTimeout(`${gasUrl}?action=verify_otp&email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`, {
      method: 'GET',
      mode: 'cors'
    });
    const data = await res.json();
    
    if (data && data.status !== "error") {
      isGasActive = true;
      updateConnectionBadges();
      
      localStorage.setItem('session_email', email);
      
      const user = {
        email: data.email || email,
        name: data.name || "匿名医師",
        high_score: parseInt(data.high_score) || 0,
        completed_cases: Array.isArray(data.completed_cases) 
          ? data.completed_cases 
          : (data.completed_cases ? data.completed_cases.split(",") : []),
        last_played: data.last_played || ""
      };
      
      currentUserData = user;
      
      if (data.status === "not_registered" || data.status === "not_found" || user.name === "匿名医師") {
        showLobbySubPanel('register');
      } else {
        hasJoined = true;
        showLobbySubPanel('waiting');
        renderDashboard(user);
      }
    } else {
      alert("認証エラー: " + (data ? data.message : "認証コードが正しくないか、有効期限が切れています。"));
      showLobbySubPanel('code');
    }
  } catch (e) {
    console.error("Failed to verify OTP:", e);
    alert("通信エラーが発生しました。");
    showLobbySubPanel('code');
  }
}

async function registerUserName() {
  const nickname = regUsernameInput.value.trim();
  if (!nickname) {
    alert("登録する医師名（表示名）を入力してください。");
    return;
  }
  if (nickname === "匿名医師" || nickname === "テスト専攻医") {
    alert("その名前は使用できません。別の医師名を入力してください。");
    return;
  }
  
  showLobbySubPanel('loading');
  
  if (currentUserData) {
    currentUserData.name = nickname;
    currentUserData.last_played = new Date().toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"});
    
    try {
      const data = await saveToGas(currentUserData);
      if (data && data.status === "success") {
        currentUserData.name = data.name;
        hasJoined = true;
        isGasActive = true;
        updateConnectionBadges();
        showLobbySubPanel('waiting');
        renderDashboard(currentUserData);
      } else {
        alert("登録エラーが発生しました: " + (data ? data.message : "不明なエラー"));
        showLobbySubPanel('register');
      }
    } catch (e) {
      console.error("Failed to register name:", e);
      alert("通信エラーが発生しました。時間を置いてやり直してください。");
      showLobbySubPanel('register');
    }
  } else {
    alert("セッションが見つかりません。再ログインしてください。");
    showLobbySubPanel('email');
  }
}

async function saveUserScore() {
  if (!currentUserData) return;
  
  const email = currentUserData.email;
  const score = currentGameState.players["player"] ? currentGameState.players["player"].score : 0;
  
  let scoreUpdated = false;
  if (score > currentUserData.high_score) {
    currentUserData.high_score = score;
    scoreUpdated = true;
    addLog("🏆 自己ベスト更新！ハイスコア: " + score + " 点！");
  }
  
  const newlyCompleted = currentGameState.debriefings
    .filter(d => d.result === "SUCCESS")
    .map(d => d.id);
  
  const origCompleted = currentUserData.completed_cases || [];
  const mergedCompleted = Array.from(new Set([...origCompleted, ...newlyCompleted]));
  
  if (mergedCompleted.length > origCompleted.length) {
    currentUserData.completed_cases = mergedCompleted;
    scoreUpdated = true;
    addLog("🎓 新たに " + newlyCompleted.length + " 件の症例を習得し、学習進捗が保存されました。");
  }

  currentUserData.last_played = new Date().toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"});

  const localDb = JSON.parse(localStorage.getItem('users_db') || '{}');
  localDb[email] = currentUserData;
  localStorage.setItem('users_db', JSON.stringify(localDb));

  if (gasUrl) {
    addLog("📡 GASへのスコア同期中...");
    try {
      const data = await saveToGas(currentUserData);
      if (data && data.status === "success") {
        isGasActive = true;
        currentUserData.name = data.name;
        addLog("🟢 GASスプレッドシートへの同期が完了しました。");
      } else {
        isGasActive = false;
        addLog("⚠️ GASへの同期に失敗しました（ローカルにのみ保存されました）。");
      }
    } catch (e) {
      isGasActive = false;
      console.warn("GAS save failed:", e);
      addLog("⚠️ GASへの同期に失敗しました（通信エラー）。");
    }
    updateConnectionBadges();
  }
}

async function saveToGas(user) {
  const res = await fetchWithTimeout(gasUrl, {
    method: "POST",
    mode: "cors",
    body: JSON.stringify({
      email: user.email,
      name: user.name,
      high_score: user.high_score,
      completed_cases: user.completed_cases,
      last_played: user.last_played
    })
  });
  return await res.json();
}

async function testGasConnection() {
  if (!gasUrl) {
    isGasActive = false;
    updateConnectionBadges();
    return;
  }
  try {
    const res = await fetchWithTimeout(`${gasUrl}?action=get_stats`, { timeout: 3000 });
    if (res.ok) {
      isGasActive = true;
    } else {
      isGasActive = false;
    }
  } catch (e) {
    console.warn("GAS connection test failed:", e);
    isGasActive = false;
  }
  updateConnectionBadges();
}

// --- STATE MANAGEMENT ---
function updateState(newState) {
  currentGameState = newState;
  
  if (!hasJoined) {
    switchScreen('lobby');
    lobbyWaiting.style.display = 'none';
  } else {
    if (lobbyLoading) lobbyLoading.style.display = 'none';
    if (lobbyEmailEntry) lobbyEmailEntry.style.display = 'none';
    if (lobbyCodeEntry) lobbyCodeEntry.style.display = 'none';
    if (lobbyRegistrationPanel) lobbyRegistrationPanel.style.display = 'none';
    
    if (newState.status === "LOBBY") {
      switchScreen('lobby');
      AudioMonitor.stopAlarm();
      AudioMonitor.stopHeartbeatLoop();
      if (currentUserData) {
        renderDashboard(currentUserData);
      }
    } else if (newState.status === "PLAYING") {
      switchScreen('game');
      renderGame();
    } else if (newState.status === "RESULT") {
      switchScreen('result');
      AudioMonitor.stopAlarm();
      AudioMonitor.stopHeartbeatLoop();
      renderResult();
    }
  }
}

function switchScreen(screenKey) {
  Object.keys(screens).forEach(key => {
    if (key === screenKey) {
      screens[key].classList.add('active');
    } else {
      screens[key].classList.remove('active');
    }
  });
}

// --- LOBBY/DASHBOARD SCREEN CONTROLLER ---
function renderDashboard(user) {
  hasJoined = true;
  showLobbySubPanel('waiting');
  
  document.getElementById('dash-name').innerText = `${user.name} 医師`;
  document.getElementById('dash-email').innerText = user.email;
  document.getElementById('dash-highscore').innerText = `${user.high_score} 点`;
  
  const completedCount = user.completed_cases ? user.completed_cases.length : 0;
  document.getElementById('dash-completed').innerText = `${completedCount} / 6 件`;
}

// Handle OTP buttons
if (btnSendOtp) {
  btnSendOtp.addEventListener('click', () => {
    sendOtp();
  });
}

if (btnVerifyOtp) {
  btnVerifyOtp.addEventListener('click', () => {
    verifyOtp();
  });
}

if (btnBackToEmail) {
  btnBackToEmail.addEventListener('click', () => {
    showLobbySubPanel('email');
  });
}

// Handle Name Registration
if (btnRegisterName) {
  btnRegisterName.addEventListener('click', () => {
    registerUserName();
  });
}

// Start shift
const btnStart = document.getElementById('btn-start');
btnStart.addEventListener('click', () => {
  startGame();
});

// --- GAME LOGIC CONTROLLER ---
function startGame() {
  currentGameState.status = "PLAYING";
  currentGameState.safety = 100;
  currentGameState.time_left = 180; // 3 minutes
  currentGameState.logs = [];
  currentGameState.debriefings = [];
  currentGameState.seconds_since_last_spawn = 0;
  currentGameState.peaceful_seconds = 0;
  
  // Clone beds state
  currentGameState.beds = {};
  Object.entries(BASE_BEDS).forEach(([bid, bedData]) => {
    currentGameState.beds[bid] = JSON.parse(JSON.stringify(bedData));
  });
  
  currentGameState.players = {
    "player": {
      name: currentUserData ? currentUserData.name : "ゲスト医師",
      score: 0,
      color: "#3b82f6"
    }
  };
  
  addLog("🚀 専攻医当直開始！急変コールや救急搬送に適切に指示を出してください。");
  spawnEmergency();
  startGameTimer();
  updateState(currentGameState);
  startWaveformEngine();
}

function startGameTimer() {
  if (gameIntervalId) clearInterval(gameIntervalId);
  
  gameIntervalId = setInterval(() => {
    if (currentGameState.status !== "PLAYING") {
      clearInterval(gameIntervalId);
      return;
    }
    
    // 思考中の一時停止判定を完全に廃止し、常に制限時間を減算する
    currentGameState.time_left -= 1;
    
    let hasActiveEmergency = false;
    
    // Beds decay & recovery
    Object.entries(currentGameState.beds).forEach(([bid, bed]) => {
      const evt = bed.active_event;
      if (!evt) {
        // Recovery
        const v = bed.vitals;
        if (bid === "101") {
          v.hr = v.hr > 72 ? Math.max(72, v.hr - 2) : Math.min(72, v.hr + 2);
          v.bp_sys = v.bp_sys > 124 ? Math.max(124, v.bp_sys - 2) : Math.min(124, v.bp_sys + 2);
          v.spo2 = Math.min(97, v.spo2 + 1);
        } else if (bid === "102") {
          v.hr = v.hr > 80 ? Math.max(80, v.hr - 2) : Math.min(80, v.hr + 2);
          v.bp_sys = v.bp_sys > 110 ? Math.max(110, v.bp_sys - 2) : Math.min(110, v.bp_sys + 2);
          v.spo2 = Math.min(98, v.spo2 + 1);
        } else if (bid === "103") {
          v.hr = v.hr > 65 ? Math.max(65, v.hr - 2) : Math.min(65, v.hr + 2);
          v.bp_sys = v.bp_sys > 138 ? Math.max(138, v.bp_sys - 2) : Math.min(138, v.bp_sys + 2);
          v.spo2 = Math.min(96, v.spo2 + 1);
        } else if (bid === "104") {
          v.hr = v.hr > 88 ? Math.max(88, v.hr - 2) : Math.min(88, v.hr + 2);
          v.bp_sys = v.bp_sys > 115 ? Math.max(115, v.bp_sys - 2) : Math.min(115, v.bp_sys + 2);
          v.spo2 = Math.min(95, v.spo2 + 1);
        }
        return;
      }
      
      hasActiveEmergency = true;
      const v = bed.vitals;
      const c_id = evt.id;
      const step = evt.current_step;
      
      // 心停止 (ACLS) の時間経過およびバイタル制御
      if (evt.is_arrest) {
        evt.arrest_seconds = (evt.arrest_seconds || 0) + 1;
        bed.status = 'danger';
        v.hr = 0;
        v.bp_sys = 0;
        v.spo2 = evt.cpr_active ? 15 : 0;
        v.rr = 0;
        
        if (evt.arrest_seconds >= 30) {
          currentGameState.safety = 0;
          addLog("💀 " + bid + "号室の患者 (" + bed.patient + ") が心停止から30秒間蘇生されず、死亡に至りました...");
        }
        return;
      }
      
      // 処置インターバル中 (is_processing) はバイタル減少をストップさせ、安定化へ寄せる
      if (evt.is_processing) {
        if (c_id === "dka") {
          v.bp_sys = Math.min(102, v.bp_sys + 1);
          v.hr = Math.max(112, v.hr - 1);
        } else if (c_id === "dissection") {
          v.bp_sys = v.bp_sys > 172 ? Math.max(172, v.bp_sys - 2) : Math.min(172, v.bp_sys + 2);
          v.hr = Math.max(96, v.hr - 1);
        } else if (c_id === "sepsis" || c_id === "obstructive_sepsis") {
          v.bp_sys = Math.min(85, v.bp_sys + 1);
          v.hr = Math.max(110, v.hr - 1);
        } else if (c_id === "varices") {
          v.bp_sys = Math.min(80, v.bp_sys + 1);
          v.spo2 = Math.min(92, v.spo2 + 1);
        } else if (c_id === "hyperkalemia") {
          v.hr = Math.min(50, v.hr + 1);
        } else if (c_id === "copd") {
          v.spo2 = Math.min(92, v.spo2 + 1);
        } else if (c_id === "anaphylaxis") {
          v.bp_sys = Math.min(90, v.bp_sys + 2);
          v.spo2 = Math.min(94, v.spo2 + 2);
        } else if (c_id === "pneumothorax") {
          v.bp_sys = Math.min(90, v.bp_sys + 2);
          v.spo2 = Math.min(90, v.spo2 + 2);
        } else if (c_id === "stemi") {
          v.bp_sys = Math.min(100, v.bp_sys + 1);
          v.hr = Math.min(60, v.hr + 1);
        } else if (c_id === "hypoglycemia") {
          v.hr = Math.max(85, v.hr - 1);
        } else if (c_id === "sah") {
          v.bp_sys = Math.max(150, v.bp_sys - 2);
        } else if (c_id === "pulmonary_embolism") {
          v.spo2 = Math.min(90, v.spo2 + 1);
        } else if (c_id === "heatstroke") {
          v.hr = Math.max(100, v.hr - 1);
          v.bp_sys = Math.min(95, v.bp_sys + 1);
        }
        return;
      }
      
      // 急変猶予時間の減算
      evt.time_limit = (evt.time_limit || 45) - 1;
      if (evt.time_limit <= 0) {
        triggerArrest(bid);
        return;
      }
      
      // Vitals decay rules matching server.py
      if (c_id === "dka") {
        if (step === 0) {
          v.bp_sys = Math.max(40, v.bp_sys - 1);
          v.hr = Math.min(140, v.hr + 1);
          if (v.bp_sys < 80) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 1);
          }
        } else {
          v.bp_sys = Math.min(110, v.bp_sys + 2);
          v.hr = Math.max(90, v.hr - 1);
        }
      } else if (c_id === "dissection") {
        if (step === 0) {
          v.bp_sys = Math.min(220, v.bp_sys + 2);
          v.hr = Math.min(140, v.hr + 1);
          if (v.bp_sys > 190) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 2);
          }
        } else {
          v.bp_sys = Math.max(115, v.bp_sys - 3);
          v.hr = Math.max(70, v.hr - 2);
        }
      } else if (c_id === "sepsis") {
        if (step === 0) {
          v.bp_sys = Math.max(40, v.bp_sys - 2);
          v.hr = Math.min(150, v.hr + 2);
          if (v.bp_sys < 75) {
            const penalty = currentGameState.time_left % 2 === 0 ? 2 : 1;
            currentGameState.safety = Math.max(0, currentGameState.safety - penalty);
          }
        } else {
          v.bp_sys = Math.min(95, v.bp_sys + 2);
          v.hr = Math.max(90, v.hr - 1);
        }
      } else if (c_id === "varices") {
        if (step === 0) {
          v.bp_sys = Math.max(45, v.bp_sys - 3);
          v.hr = Math.min(150, v.hr + 2);
          v.spo2 = Math.max(60, v.spo2 - 1);
          if (v.bp_sys < 70 || v.spo2 < 85) {
            const penalty = currentGameState.time_left % 2 === 0 ? 3 : 2;
            currentGameState.safety = Math.max(0, currentGameState.safety - penalty);
          }
        } else {
          v.bp_sys = Math.min(90, v.bp_sys + 3);
          v.spo2 = Math.min(95, v.spo2 + 2);
        }
      } else if (c_id === "hyperkalemia") {
        if (step === 0) {
          v.hr = Math.max(25, v.hr - 2);
          if (v.hr < 35) {
            const penalty = currentGameState.time_left % 2 === 0 ? 3 : 2;
            currentGameState.safety = Math.max(0, currentGameState.safety - penalty);
          }
        } else if (step === 1) {
          v.hr = Math.min(50, v.hr + 2);
        } else {
          v.hr = Math.min(60, v.hr + 3);
        }
      } else if (c_id === "copd") {
        if (step === 0) {
          v.spo2 = Math.max(50, v.spo2 - 2);
          if (v.spo2 < 80) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 2);
          }
        } else {
          v.spo2 = Math.min(95, v.spo2 + 3);
        }
      } else if (c_id === "adrenal") {
        if (step === 0) {
          v.bp_sys = Math.max(40, v.bp_sys - 1);
          v.hr = Math.min(140, v.hr + 1);
          if (v.bp_sys < 85) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 1);
          }
        } else {
          v.bp_sys = Math.min(110, v.bp_sys + 2);
          v.hr = Math.max(80, v.hr - 1);
        }
      } else if (c_id === "obstructive_sepsis") {
        if (step === 0) {
          v.bp_sys = Math.max(40, v.bp_sys - 2);
          v.hr = Math.min(150, v.hr + 2);
          if (v.bp_sys < 80) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 2);
          }
        } else {
          v.bp_sys = Math.min(100, v.bp_sys + 2);
          v.hr = Math.max(85, v.hr - 1);
        }
      } else if (c_id === "pancreatitis") {
        if (step === 0) {
          v.bp_sys = Math.max(80, v.bp_sys - 1);
          v.hr = Math.min(130, v.hr + 1);
          if (v.hr > 120) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 1);
          }
        } else {
          v.bp_sys = Math.min(120, v.bp_sys + 1);
          v.hr = Math.max(80, v.hr - 1);
        }
      } else if (c_id === "anaphylaxis") {
        if (step === 0) {
          v.bp_sys = Math.max(40, v.bp_sys - 3);
          v.spo2 = Math.max(50, v.spo2 - 2);
          v.hr = Math.min(160, v.hr + 2);
          if (v.bp_sys < 80 || v.spo2 < 85) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 3);
          }
        } else {
          v.bp_sys = Math.min(110, v.bp_sys + 4);
          v.spo2 = Math.min(98, v.spo2 + 3);
          v.hr = Math.max(80, v.hr - 2);
        }
      } else if (c_id === "pneumothorax") {
        if (step === 0) {
          v.bp_sys = Math.max(40, v.bp_sys - 3);
          v.spo2 = Math.max(50, v.spo2 - 2);
          v.hr = Math.min(150, v.hr + 2);
          if (v.bp_sys < 80 || v.spo2 < 80) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 3);
          }
        } else if (step === 1) {
          v.bp_sys = Math.min(100, v.bp_sys + 3);
          v.spo2 = Math.min(95, v.spo2 + 2);
          v.hr = Math.max(80, v.hr - 1);
        } else {
          v.bp_sys = Math.min(115, v.bp_sys + 2);
          v.spo2 = Math.min(97, v.spo2 + 1);
        }
      } else if (c_id === "stemi") {
        if (step === 0) {
          v.bp_sys = Math.max(50, v.bp_sys - 1);
          v.hr = Math.max(35, v.hr - 1);
          if (v.bp_sys < 90 || v.hr < 45) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 2);
          }
        } else {
          v.bp_sys = Math.min(110, v.bp_sys + 2);
          v.hr = Math.min(75, v.hr + 1);
        }
      } else if (c_id === "hypoglycemia") {
        if (step === 0) {
          v.hr = Math.min(120, v.hr + 1);
          if (currentGameState.time_left % 3 === 0) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 1);
          }
        } else if (step === 1) {
          v.hr = Math.max(80, v.hr - 2);
        } else {
          v.hr = Math.max(72, v.hr - 1);
        }
      } else if (c_id === "sah") {
        if (step === 0) {
          v.bp_sys = Math.min(230, v.bp_sys + 2);
          if (v.bp_sys > 180) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 2);
          }
        } else {
          v.bp_sys = Math.max(130, v.bp_sys - 4);
        }
      } else if (c_id === "pulmonary_embolism") {
        if (step === 0) {
          v.spo2 = Math.max(50, v.spo2 - 2);
          v.hr = Math.min(150, v.hr + 2);
          if (v.spo2 < 85) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 2.5);
          }
        } else {
          v.spo2 = Math.min(95, v.spo2 + 2);
          v.hr = Math.max(85, v.hr - 1);
        }
      } else if (c_id === "heatstroke") {
        if (step === 0) {
          v.hr = Math.min(145, v.hr + 2);
          v.bp_sys = Math.max(50, v.bp_sys - 1);
          if (v.hr > 120 || v.bp_sys < 85) {
            currentGameState.safety = Math.max(0, currentGameState.safety - 1.5);
          }
        } else {
          v.hr = Math.max(80, v.hr - 2);
          v.bp_sys = Math.min(110, v.bp_sys + 2);
        }
      }

      // Dynamic Respiration Rate (RR) simulator
      if (evt) {
        if (evt.is_processing) {
          // Returning to normal (16) under treatment
          v.rr = v.rr > 16 ? Math.max(16, v.rr - 1) : Math.min(16, v.rr + 1);
        } else {
          // Tachypnea compensation due to hypoxia, tachycardia, or shock
          let targetRR = 16;
          if (v.spo2 < 90) targetRR += (90 - v.spo2) * 1.5;
          if (v.hr > 100) targetRR += (v.hr - 100) * 0.15;
          if (v.bp_sys < 90) targetRR += (90 - v.bp_sys) * 0.1;
          targetRR = Math.min(38, Math.round(targetRR));
          
          if (v.hr === 0 || v.spo2 === 0) {
            v.rr = 0; // Apnea / Arrest
          } else {
            v.rr = v.rr < targetRR ? Math.min(targetRR, v.rr + 1) : Math.max(targetRR, v.rr - 1);
          }
        }
      } else {
        // Returning to base RR when stable
        const baseRR = bid === "101" ? 14 : bid === "102" ? 16 : bid === "103" ? 12 : 18;
        v.rr = v.rr < baseRR ? v.rr + 1 : v.rr > baseRR ? v.rr - 1 : baseRR;
      }
    });
    
    // Safety recovery system (every 3s of peace)
    if (!hasActiveEmergency) {
      currentGameState.peaceful_seconds += 1;
      if (currentGameState.peaceful_seconds >= 3) {
        if (currentGameState.safety < 100) {
          currentGameState.safety = Math.min(100, currentGameState.safety + 1);
          addLog("💚 病棟が平穏に維持され、患者安全度が自然回復しました (+1%)");
        }
        currentGameState.peaceful_seconds = 0;
      }
    } else {
      currentGameState.peaceful_seconds = 0;
    }
    
    if (adminInvincibleToggle && adminInvincibleToggle.checked) {
      currentGameState.safety = 100;
    }
    
    // Check Game Over / Clear
    if (currentGameState.safety <= 0) {
      currentGameState.status = "RESULT";
      addLog("💀 患者安全度が0%になり、重大なインシデントにより当直失敗（ゲームオーバー）！");
      saveUserScore();
      clearInterval(gameIntervalId);
      updateState(currentGameState);
      return;
    } else if (currentGameState.time_left <= 0) {
      currentGameState.status = "RESULT";
      addLog("🎉 シフト終了！すべての当直急変に適切に対処できました！");
      saveUserScore();
      clearInterval(gameIntervalId);
      updateState(currentGameState);
      return;
    }
    
    // Dynamic difficulty emergency spawner
    currentGameState.seconds_since_last_spawn += 1;
    const score = currentGameState.players["player"] ? currentGameState.players["player"].score : 0;
    const currentInterval = getSpawnInterval(score);
    if (currentGameState.seconds_since_last_spawn >= currentInterval) {
      spawnEmergency();
      currentGameState.seconds_since_last_spawn = 0;
    }
    
    renderGame();
  }, 1000);
}

function getSpawnInterval(score) {
  if (score < 150) return 35;
  if (score < 300) return 20;
  return 12;
}

function spawnEmergency() {
  if (currentGameState.status !== "PLAYING") return;
  
  const score = currentGameState.players["player"] ? currentGameState.players["player"].score : 0;
  
  const activeCaseIds = Object.values(currentGameState.beds)
    .filter(bed => bed.active_event)
    .map(bed => bed.active_event.id);
    
  const solvedCaseIds = currentGameState.debriefings.map(d => d.id);
  
  const availableCases = CLINICAL_CASES.filter(c => {
    if (activeCaseIds.includes(c.id) || solvedCaseIds.includes(c.id)) {
      return false;
    }
    if (score < 150 && ["leak", "insomnia", "delirium"].includes(c.id)) {
      return false;
    }
    return true;
  });
  
  if (availableCases.length === 0) return;
  
  const chosenCase = availableCases[Math.floor(Math.random() * availableCases.length)];
  
  // Find a stable bed
  const stableBeds = Object.entries(currentGameState.beds)
    .filter(([_, bed]) => bed.status === "stable")
    .map(([bid, _]) => bid);
    
  let bedId = null;
  if (stableBeds.length > 0) {
    bedId = stableBeds[Math.floor(Math.random() * stableBeds.length)];
  } else {
    // Increase beds dynamic if all full
    const existingIds = Object.keys(currentGameState.beds).map(id => parseInt(id)).filter(id => !isNaN(id));
    const newBid = existingIds.length > 0 ? (Math.max(...existingIds) + 1).toString() : "105";
    currentGameState.beds[newBid] = {
      patient: "",
      diagnosis: "",
      status: "stable",
      vitals: {},
      active_event: null
    };
    bedId = newBid;
  }
  
  const bed = currentGameState.beds[bedId];
  bed.patient = chosenCase.patient;
  bed.diagnosis = chosenCase.complaint + "疑い"; // 最初は確定疾患名ではなく主訴を表示！
  bed.status = chosenCase.status;
  bed.vitals = JSON.parse(JSON.stringify(chosenCase.vitals));
  bed.active_event = {
    id: chosenCase.id,
    title: chosenCase.title,
    complaint: chosenCase.complaint,
    diagnosis: chosenCase.diagnosis,
    description: chosenCase.description,
    source: chosenCase.source ? JSON.parse(JSON.stringify(chosenCase.source)) : null,
    steps: JSON.parse(JSON.stringify(chosenCase.steps)),
    current_step: 0,
    last_feedback: null,
    is_processing: false,
    time_limit: 45,
    is_arrest: false,
    cpr_active: false,
    adrenaline_given: false,
    arrest_seconds: 0
  };
  
  addLog("🚨 【当直コール】" + bedId + "号室 (" + bed.patient + ") が急変！主訴: 「" + chosenCase.complaint + "」");
}

function forceSpawnEmergency(bedId, caseId) {
  if (currentGameState.status !== "PLAYING") {
    addLog("⚠️ 当直シフトが開始されていません。");
    return;
  }
  
  const chosenCase = CLINICAL_CASES.find(c => c.id === caseId);
  if (!chosenCase) {
    addLog("⚠️ 選択された症例が見つかりません。");
    return;
  }
  
  const bed = currentGameState.beds[bedId];
  if (!bed) {
    addLog("⚠️ 対象のベッドが見つかりません。");
    return;
  }
  
  // Clean up if there was an active event
  bed.has_oxygen = false;
  bed.has_iv = false;
  
  bed.patient = chosenCase.patient;
  bed.diagnosis = chosenCase.complaint + "疑い";
  bed.status = chosenCase.status;
  bed.vitals = JSON.parse(JSON.stringify(chosenCase.vitals));
  bed.active_event = {
    id: chosenCase.id,
    title: chosenCase.title,
    complaint: chosenCase.complaint,
    diagnosis: chosenCase.diagnosis,
    description: chosenCase.description,
    source: chosenCase.source ? JSON.parse(JSON.stringify(chosenCase.source)) : null,
    steps: JSON.parse(JSON.stringify(chosenCase.steps)),
    current_step: 0,
    last_feedback: null,
    is_processing: false,
    time_limit: 45,
    is_arrest: false,
    cpr_active: false,
    adrenaline_given: false,
    arrest_seconds: 0
  };
  
  addLog("🚨 【管理者強制コール】" + bedId + "号室 (" + bed.patient + ") が急変！主訴: 「" + chosenCase.complaint + "」");
  renderGame();
}

function performAction(bedId, actionId) {
  if (currentGameState.status !== "PLAYING") return;
  
  const bed = currentGameState.beds[bedId];
  if (!bed || !bed.active_event || bed.active_event.is_processing) return;
  
  const evt = bed.active_event;
  const stepIdx = evt.current_step;
  const currentStepData = evt.steps[stepIdx];
  
  const selectedOpt = currentStepData.opts.find(opt => opt.id === actionId);
  if (!selectedOpt) return;
  
  const player = currentGameState.players["player"];
  if (!player) return;
  
  recordStats(evt.id, 1, selectedOpt.ok ? 1 : 0);

  // Set visual treatment indicators on correct choices
  if (selectedOpt.ok) {
    const actLower = actionId.toLowerCase();
    if (actLower.includes("oxygen") || actLower.includes("mask") || actLower.includes("inhale") || actLower.includes("intubation") || actLower.includes("adg")) {
      bed.has_oxygen = true;
    }
    if (actLower.includes("fluid") || actLower.includes("drip") || actLower.includes("iv") || actLower.includes("infusion") || actLower.includes("abx") || actLower.includes("ceftriaxone") || actLower.includes("piptazo") || actLower.includes("steroid") || actLower.includes("adrenaline") || actLower.includes("hydrocortisone") || actLower.includes("noradrenaline")) {
      bed.has_iv = true;
    }
  }
  
  if (selectedOpt.ok) {
    player.score += 50;
    
    const isNurseCall = ["leak", "insomnia", "delirium"].includes(evt.id);
    let recovery = 8;
    if (isNurseCall) {
      player.score -= 20; // +30 instead of +50 for minor nurse calls
      recovery = 5;
    }
    
    currentGameState.safety = Math.min(100, currentGameState.safety + recovery);
    evt.last_feedback = "✅ 【適切】 (安全度 +" + recovery + "%) " + selectedOpt.fb;
    addLog("✅ 処置適切: " + bedId + "号室 - " + selectedOpt.text + " (安全度 +" + recovery + "%)");
    
    // 次のステップがある場合、処置インターバルを挟む
    const nextStepIdx = evt.current_step + 1;
    if (nextStepIdx < evt.steps.length) {
      evt.is_processing = true;
      renderGame();
      
      // 3秒間の処置待ち時間
      setTimeout(() => {
        evt.current_step += 1;
        evt.is_processing = false;
        renderGame();
      }, 3000);
    } else {
      // 最後のステップが完了した場合
      evt.current_step += 1;
      bed.status = "stable";
      bed.diagnosis = evt.diagnosis; // ここで確定診断名を表示！
      bed.active_event = null;
      bed.has_oxygen = false;
      bed.has_iv = false;
      
      const bonus = isNurseCall ? 10 : 30;
      player.score += bonus;
      
      addLog("✨ " + bedId + "号室の " + bed.patient + " の状態は安定しました。確定診断: " + evt.diagnosis);
      
      currentGameState.debriefings.push({
        id: evt.id,
        patient: bed.patient,
        diagnosis: evt.diagnosis,
        title: evt.title,
        saved_by: player.name,
        result: "SUCCESS",
        source: evt.source ? JSON.parse(JSON.stringify(evt.source)) : null
      });
    }
  } else {
    const isCritical = !!selectedOpt.critical;
    player.score = Math.max(0, player.score - 10);
    
    const penalty = isCritical ? 15 : 7;
    currentGameState.safety = Math.max(0, currentGameState.safety - penalty);
    if (adminInvincibleToggle && adminInvincibleToggle.checked) {
      currentGameState.safety = 100;
    }
    evt.last_feedback = "❌ 【不適切】 (安全度 -" + penalty + "%) " + selectedOpt.fb;
    
    const severityStr = isCritical ? "【致命的ミス】" : "";
    addLog("❌ 処置不適切: " + bedId + "号室 - " + selectedOpt.text + " " + severityStr + " (安全度 -" + penalty + "%)");
    
    if (isCritical) {
      triggerArrest(bedId);
    }
  }
  
  renderGame();
}

function triggerArrest(bedId) {
  const bed = currentGameState.beds[bedId];
  if (!bed || !bed.active_event || bed.active_event.is_arrest) return;
  
  bed.active_event.is_arrest = true;
  bed.active_event.cpr_active = false;
  bed.active_event.adrenaline_given = false;
  bed.active_event.arrest_seconds = 0;
  
  bed.status = 'danger';
  bed.vitals.hr = 0;
  bed.vitals.bp_sys = 0;
  bed.vitals.spo2 = 0;
  bed.vitals.rr = 0;
  
  addLog("🚨 【緊急事態】" + bedId + "号室の患者 (" + bed.patient + ") が心停止 (VF / 無収縮) に陥りました！直ちに二次救命処置 (ACLS) を開始してください！");
  
  updateAudioEngine();
  renderGame();
}

function triggerRosc(bedId) {
  const bed = currentGameState.beds[bedId];
  if (!bed || !bed.active_event || !bed.active_event.is_arrest) return;
  
  bed.active_event.is_arrest = false;
  bed.active_event.cpr_active = false;
  bed.active_event.adrenaline_given = false;
  bed.active_event.time_limit = 30; // 猶予時間を30秒にリセット
  
  // 安全度を 15% 減点
  const inv = document.getElementById('admin-invincible-toggle');
  if (!inv || !inv.checked) {
    currentGameState.safety = Math.max(0, currentGameState.safety - 15);
  }
  
  // バイタルを初期化 (症例の vitals に設定)
  const chosenCase = CLINICAL_CASES.find(c => c.id === bed.active_event.id);
  if (chosenCase) {
    bed.vitals = JSON.parse(JSON.stringify(chosenCase.vitals));
  } else {
    bed.vitals.hr = 70;
    bed.vitals.bp_sys = 120;
    bed.vitals.spo2 = 98;
    bed.vitals.rr = 16;
  }
  bed.status = chosenCase ? chosenCase.status : 'stable';
  
  addLog("🎉 【蘇生成功】" + bedId + "号室の患者が自己心拍再開 (ROSC) しました！安全度ペナルティ(-15%)。治療を再開してください。");
  
  updateAudioEngine();
  renderGame();
}

function performAclsAction(bedId, actionType) {
  if (currentGameState.status !== "PLAYING") return;
  const bed = currentGameState.beds[bedId];
  if (!bed || !bed.active_event || !bed.active_event.is_arrest) return;
  
  const evt = bed.active_event;
  
  if (actionType === 'cpr') {
    evt.cpr_active = !evt.cpr_active;
    if (evt.cpr_active) {
      addLog("✊ " + bedId + "号室で胸骨圧迫 (CPR) を開始しました。");
    } else {
      addLog("✋ " + bedId + "号室の胸骨圧迫 (CPR) を中断しました。");
    }
  } else if (actionType === 'adrenaline') {
    if (evt.adrenaline_given) {
      addLog("⚠️ すでにアドレナリンが投与されています。除細動を行ってください。");
      return;
    }
    evt.adrenaline_given = true;
    addLog("💉 " + bedId + "号室にアドレナリン 1mg を静注しました。次の除細動のROSC成功率が向上します。");
  } else if (actionType === 'shock') {
    addLog("⚡ " + bedId + "号室で除細動 (電気ショック) を実行します。全員離れて！");
    
    AudioMonitor.playHeartbeat(1200, 0.4, 0.08);
    
    let successChance = 0.05;
    if (evt.cpr_active) {
      successChance = 0.35;
    }
    if (evt.adrenaline_given) {
      successChance += 0.20;
    }
    
    setTimeout(() => {
      if (currentGameState.status !== "PLAYING") return;
      const b = currentGameState.beds[bedId];
      if (!b || !b.active_event || !b.active_event.is_arrest) return;
      
      if (Math.random() < successChance) {
        triggerRosc(bedId);
      } else {
        b.active_event.adrenaline_given = false; // アドレナリン効果は消費される
        addLog("❌ " + bedId + "号室の除細動は失敗しました。反応なし。ACLSを継続してください。");
        renderGame();
      }
    }, 1000);
  }
  
  renderGame();
}

function addLog(text) {
  const timestamp = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  currentGameState.logs.push("[" + timestamp + "] " + text);
  if (currentGameState.logs.length > 25) {
    currentGameState.logs.shift();
  }
}

// --- GAME PLAY SCREEN CONTROLLER ---
function renderGame() {
  // Render Game Timer (mm:ss)
  const m = Math.floor(currentGameState.time_left / 60).toString().padStart(2, '0');
  const s = (currentGameState.time_left % 60).toString().padStart(2, '0');
  gameTimer.innerText = `${m}:${s}`;
  
  // Render Safety Gauge
  const safety = currentGameState.safety;
  safetyValue.innerText = `${safety}%`;
  safetyGauge.style.width = `${safety}%`;
  safetyGauge.className = 'safety-gauge';
  if (safety < 30) {
    safetyGauge.classList.add('danger');
  } else if (safety < 60) {
    safetyGauge.classList.add('warning');
  }
  
  // Render Bed Cards
  renderBeds();
  
  // Render User Vitals Widget
  if (currentUserData) {
    const p = currentGameState.players["player"];
    const currentScore = p ? p.score : 0;
    
    document.getElementById('widget-name').innerText = `${currentUserData.name} 医師`;
    document.getElementById('widget-meta').innerText = `アカウント: ${currentUserData.email} | 自己ベスト: ${currentUserData.high_score}点`;
    document.getElementById('current-player-score').innerText = `${currentScore} 点`;
  }
  
  // Render Logs
  renderLogs();
  
  // Ensure connection badges are correct in game header
  updateConnectionBadges();
  updateAudioEngine();
}

// --- DYNAMIC ISOMETRIC MICRO-ROOM BUILDER ---
function buildMicroRoom(bedId, bed) {
  const sh = (cx, cy, rx) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * 0.32}" fill="rgba(10, 16, 26, 0.4)"/>`;
  const v = bed.vitals || {};
  
  // Parse patient demographic from name string
  const patientStr = bed.patient || "";
  let sex = "M";
  if (patientStr.includes("女") || patientStr.includes("女性") || patientStr.includes("F")) {
    sex = "F";
  }
  
  let ageGroup = "adult";
  if (patientStr.includes("小児") || patientStr.includes("子供") || (patientStr.includes("歳") && parseInt(patientStr) < 15)) {
    ageGroup = "child";
  } else if (patientStr.includes("高齢者") || (patientStr.includes("歳") && parseInt(patientStr.match(/\d+/)) >= 65)) {
    ageGroup = "elderly";
  }
  
  const hairColor = ageGroup === "elderly" ? "#a8a8a8" : "#503824";
  const headRadius = ageGroup === "child" ? 10 : 12.5;
  
  // Face & Neck Color / Class
  let faceColor = "#ffd9b8";
  let faceClass = "";
  let neckColor = "#ffd2ad";
  
  const isArrest = v.hr === 0 || v.spo2 === 0;
  const isDanger = bed.status === "danger" || v.spo2 < 90;
  
  if (isArrest) {
    faceColor = "#8ca3c7"; // Dead pale
    neckColor = "#7e94b8";
  } else if (isDanger) {
    // Flashing cyanosis class defined in CSS
    faceClass = "face-cyanosis";
  }
  
  // Base Scene (Room Background)
  let svg = `<svg viewBox="0 0 400 240" class="micro-room-svg" preserveAspectRatio="xMidYMid meet">
    <!-- Floors & Walls -->
    <polygon points="200,60 384,150 200,240 16,150" fill="#0f172a"/>
    <polygon points="16,150 200,60 200,10 16,100" fill="#1e293b"/>
    <polygon points="200,60 384,150 384,100 200,10" fill="#111827"/>
    <polygon points="200,60 384,150 200,240 16,150" fill="none" stroke="#334155" stroke-width="1"/>
    
    <!-- Floor grid lines for aesthetic -->
    <polyline points="108,105 292,195" stroke="#1e293b" stroke-width="0.8"/>
    <polyline points="292,105 108,195" stroke="#1e293b" stroke-width="0.8"/>
  `;
  
  // Oxygen Tank (O2)
  if (bed.has_oxygen) {
    svg += `<g>
      ${sh(90, 145, 12)}
      <rect x="83" y="100" width="14" height="42" rx="6" fill="#0d9488"/>
      <rect x="86" y="93" width="8" height="8" rx="2" fill="#2dd4bf"/>
      <circle cx="90" cy="90" r="3" fill="#99f6e4"/>
    </g>`;
  }
  
  // IV Pole & Bag (IV)
  if (bed.has_iv) {
    svg += `<g>
      ${sh(125, 142, 9)}
      <rect x="123" y="65" width="4" height="75" fill="#475569"/>
      <rect x="114" y="60" width="22" height="15" rx="3" fill="#2563eb"/>
      <rect x="118" y="63" width="14" height="9" rx="2" fill="#dbeafe"/>
      <path d="M125 75 q-3 8 0 14" stroke="#dbeafe" stroke-width="1.2" fill="none"/>
    </g>`;
  }
  
  // Bed Frame & Pillow
  svg += `<g>
    ${sh(220, 175, 80)}
    <!-- Bed base structure -->
    <polygon points="148,108 174,142 174,172 148,138" fill="#1e293b"/>
    <polygon points="174,142 306,122 306,152 174,172" fill="#334155"/>
    <polygon points="148,108 284,88 306,122 174,142" fill="#0f172a"/>
    <ellipse cx="183" cy="119" rx="18" ry="9.5" fill="#1e293b"/>
  </g>`;
  
  // Blanket
  const blanketColor = "#1e293b";
  const blanketStroke = bed.status === "danger" ? "#f43f5e" : bed.status === "warning" ? "#fbbf24" : "#3b82f6";
  
  if (ageGroup === "child") {
    svg += `<path d="M196 132 C204 116 234 108 260 112 C272 114 272 122 262 126 C238 135 218 139 207 139 C198 139 192 137 196 132 Z" fill="${blanketColor}" stroke="${blanketStroke}" stroke-width="1.5"/>
      <path d="M212 125 C228 119 244 116 258 118" stroke="#334155" stroke-width="1" fill="none"/>`;
  } else {
    svg += `<path d="M196 132 C206 112 252 100 288 106 C302 109 302 119 291 124 C258 136 222 141 207 141 C198 141 192 138 196 132 Z" fill="${blanketColor}" stroke="${blanketStroke}" stroke-width="1.5"/>
      <path d="M214 124 C236 116 262 112 284 114" stroke="#334155" stroke-width="1" fill="none"/>`;
  }
  
  // Patient Head & Body
  svg += `<path d="M190 124 q6 4 12 6 l-3 7 q-8 -2 -12 -7 Z" fill="${neckColor}" class="${faceClass}"/>
    <circle cx="183" cy="116" r="${headRadius}" fill="${faceColor}" class="${faceClass}"/>`;
  
  // Patient Hair
  if (sex === "F") {
    svg += `<path d="M168 114 q15 -19 30 -1 q-2 -13 -15 -13 q-13 0 -15 14 Z" fill="${hairColor}"/>
      <path d="M170 117 q-8 13 -3 31 q11 -1 11 -15 q-1 -11 -8 -16 Z" fill="${hairColor}"/>`;
  } else {
    svg += `<path d="M171 115 q12 -16 24 -1 q-3 -11 -12 -11 q-9 0 -12 12 Z" fill="${hairColor}"/>`;
  }
  
  // Facial features
  svg += `<g>`;
  if (isArrest) {
    svg += `
      <line x1="177" y1="115" x2="181" y2="115" stroke="#1e293b" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="185" y1="115" x2="189" y2="115" stroke="#1e293b" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="178" y1="122" x2="188" y2="122" stroke="#475569" stroke-width="1.5" stroke-linecap="round"/>
    `;
  } else if (bed.status === "warning" || bed.status === "danger") {
    svg += `
      <line x1="175" y1="111" x2="181" y2="109" stroke="#1e293b" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="190" y1="111" x2="184" y2="109" stroke="#1e293b" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M176 116 L181 114" stroke="#1e293b" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M189 116 L184 114" stroke="#1e293b" stroke-width="1.8" stroke-linecap="round"/>
      <ellipse cx="183" cy="122" rx="2.5" ry="2.2" fill="#581c1c" stroke="#9a5b4a" stroke-width="0.8"/>
      <path d="M188 106 Q189 110 188 112 Q187 110 188 106 Z" class="sweat-drop"/>
      <path d="M174 109 Q175 113 174 115 Q173 113 174 109 Z" class="sweat-drop" style="animation-delay: 0.7s;"/>
    `;
  } else {
    svg += `
      <path d="M175 110 Q179 109 182 111" stroke="#1e293b" stroke-width="0.8" fill="none"/>
      <path d="M183 111 Q186 109 190 110" stroke="#1e293b" stroke-width="0.8" fill="none"/>
      <path d="M176 114 q3 1.8 6 0" stroke="#1e293b" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M184 114 q3 1.8 6 0" stroke="#1e293b" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M179 121 Q183 123 187 121" stroke="#9a5b4a" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    `;
  }
  svg += `</g>`;
  
  // Treatment mask overlay
  if (bed.has_oxygen) {
    svg += `<ellipse cx="183" cy="121" rx="6.5" ry="5.5" fill="rgba(45, 212, 191, 0.45)" stroke="#2dd4bf" stroke-width="1.2"/>
      <path d="M90 120 Q130 150 180 123" stroke="rgba(45, 212, 191, 0.45)" stroke-width="1.2" fill="none" stroke-dasharray="2 2"/>`;
  }
  
  // IV Line tube overlay
  if (bed.has_iv) {
    svg += `<path d="M125 75 Q145 110 205 127" stroke="rgba(255, 255, 255, 0.55)" stroke-width="1" fill="none"/>`;
  }
  
  svg += `
    <circle cx="174" cy="172" r="3.5" fill="#334155"/>
    <circle cx="306" cy="152" r="3.5" fill="#334155"/>
    <circle cx="148" cy="138" r="3.5" fill="#334155"/>
  </svg>`;
  
  return svg;
}

function renderBeds() {
  wardGrid.innerHTML = '';
  
  Object.entries(currentGameState.beds).forEach(([bedId, bed]) => {
    const card = document.createElement('div');
    card.className = `bed-card ${bed.status}`;
    
    // Status text
    let statusLabel = '安定';
    if (bed.status === 'warning') statusLabel = '急変！';
    if (bed.status === 'danger') statusLabel = '重篤！！';
    
    // Vitals display mapping
    const v = bed.vitals;
    
    // Heart pulse icon class
    const heartPulseHtml = v.hr > 0 ? '<span class="v-pulse-heart">❤️</span>' : '<span style="color:var(--danger)">💔</span>';

    let ecgClass = 'stable';
    let alertBadgeHtml = '';

    if (bed.active_event && (v.hr === 0 || v.spo2 === 0)) {
      ecgClass = 'flatline';
      alertBadgeHtml = '<div class="monitor-alert-badge">⚠️ FLATLINE</div>';
    } else if (bed.status === 'danger') {
      ecgClass = 'danger';
      let alertMsg = '⚠️ CRITICAL';
      if (v.hr > 130) {
        alertMsg = '⚠️ TACHYCARDIA';
      } else if (v.hr < 45) {
        alertMsg = '⚠️ BRADYCARDIA';
      } else if (v.bp_sys < 80) {
        alertMsg = '⚠️ SHOCK';
      } else if (v.spo2 < 85) {
        alertMsg = '⚠️ DESAT';
      }
      alertBadgeHtml = `<div class="monitor-alert-badge">${alertMsg}</div>`;
    } else if (bed.status === 'warning') {
      ecgClass = 'warning';
      let alertMsg = '⚠️ WARNING';
      if (v.hr > 115) {
        alertMsg = '⚠️ HR HIGH';
      } else if (v.spo2 < 92) {
        alertMsg = '⚠️ SPO2 LOW';
      }
      alertBadgeHtml = `<div class="monitor-alert-badge">${alertMsg}</div>`;
    }
    
    // Action panel / Event info
    let actionsPanelHtml = '';
    const evt = bed.active_event;
    
    if (!evt) {
      actionsPanelHtml = `
        <div class="bed-actions-panel">
          <div class="no-event-placeholder">
            🩺 バイタル安定・経過観察中
          </div>
        </div>
      `;
    } else if (evt.is_arrest) {
      // 心停止 (ACLS) パネルUI
      const timeRemaining = 30 - evt.arrest_seconds;
      const timeClass = timeRemaining <= 10 ? 'danger pulsate' : 'danger';
      const cprStatusText = evt.cpr_active ? "胸骨圧迫実施中 (100回/分)..." : "胸骨圧迫が停止しています！";
      const cprClass = evt.cpr_active ? "btn-acls active" : "btn-acls";
      const adrenalineText = evt.adrenaline_given ? "アドレナリン投与済" : "アドレナリン 1mg 静注";
      const adrenalineClass = evt.adrenaline_given ? "btn-acls disabled" : "btn-acls";
      
      actionsPanelHtml = `
        <div class="bed-actions-panel acls-panel">
          <div class="event-details">
            <span class="event-title alert-blink">🚨 🫀 心停止 (Cardiac Arrest) 発生！</span>
            <span class="event-desc">心室細動 (VF) または無収縮 (Asystole) を検知しました。直ちに二次救命処置 (ACLS) を開始してください！</span>
            <div class="event-step-bar arrest-bar">💀 脳死・死亡まで: <span class="${timeClass}">${timeRemaining}秒</span></div>
            <div class="cpr-indicator ${evt.cpr_active ? 'active' : ''}">${cprStatusText}</div>
          </div>
          <div class="actions-grid acls-layout">
            <button class="${cprClass}" data-bed="${bedId}" data-acls-action="cpr">
              ✊ ${evt.cpr_active ? '胸骨圧迫を停止する' : '胸骨圧迫を開始する'}
            </button>
            <button class="btn-acls btn-shock" data-bed="${bedId}" data-acls-action="shock">
              ⚡ 除細動 (電気ショック)
            </button>
            <button class="${adrenalineClass}" data-bed="${bedId}" data-acls-action="adrenaline">
              💉 ${adrenalineText}
            </button>
          </div>
        </div>
      `;
    } else if (evt.is_processing) {
      // 処置インターバル中のローディング表示
      actionsPanelHtml = `
        <div class="bed-actions-panel">
          <div class="processing-placeholder">
            <span class="processing-pulse">⏳</span> 処置を実施中... (点滴投与 / カテーテル手配中)
          </div>
        </div>
      `;
    } else {
      const currentStep = evt.steps[evt.current_step];
      const progressText = `状況判断: ${evt.current_step + 1} / ${evt.steps.length}`;
      
      let feedbackHtml = '';
      if (evt.last_feedback) {
        const isSuccess = evt.last_feedback.includes('✅');
        const fbClass = isSuccess ? 'fb-success' : 'fb-fail';
        feedbackHtml = `<div class="event-feedback ${fbClass}">${escapeHtml(evt.last_feedback)}</div>`;
      }
      
      const buttonsHtml = currentStep.opts.map(opt => `
        <button class="btn-action" data-bed="${bedId}" data-action="${opt.id}">
          ${escapeHtml(opt.text)}
        </button>
      `).join('');
      
      const limitSec = evt.time_limit || 45;
      const limitClass = limitSec <= 15 ? 'danger pulsate' : (limitSec <= 30 ? 'warning' : 'info');
      
      actionsPanelHtml = `
        <div class="bed-actions-panel">
          <div class="event-details">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
              <span class="event-title">🚨 ${escapeHtml(evt.complaint)}</span>
              <span class="event-timer-badge ${limitClass}">⚠️ 急変まで: ${limitSec}秒</span>
            </div>
            <span class="event-desc">${escapeHtml(evt.description)}</span>
            <div class="event-step-bar">${progressText}</div>
            <div class="event-question">${escapeHtml(currentStep.q)}</div>
            ${feedbackHtml}
          </div>
          <div class="actions-grid options-layout">
            ${buttonsHtml}
          </div>
        </div>
      `;
    }
    
    // 診断名部分の制御: アクティブイベント中は主訴を表示
    const displayDiag = evt ? `${evt.complaint}疑い` : bed.diagnosis;

    card.innerHTML = `
      <!-- Left: Bio & 2.5D Isometric Room -->
      <div class="bed-bio">
        <div class="bed-header">
          <span class="bed-id">${bedId}号室</span>
          <span class="status-label">${statusLabel}</span>
        </div>
        <div class="patient-name">${escapeHtml(bed.patient)}</div>
        <div class="patient-diag">${escapeHtml(displayDiag)}</div>
        
        <!-- 2.5D Micro-Room -->
        <div class="micro-room-container">
          ${buildMicroRoom(bedId, bed)}
        </div>
      </div>
      
      <!-- Middle: Vitals Monitor (4-Quadrant & Canvas) -->
      <div class="vital-monitor">
        <div class="vital-grid">
          <!-- HR (Neon Green) -->
          <div class="vital-cell c-ecg">
            <span class="v-label">HR (bpm)</span>
            <span class="v-val">${v.hr > 0 ? v.hr : '---'} ${heartPulseHtml}</span>
            <span class="v-sub">ECG</span>
          </div>
          
          <!-- BP (Neon Red) -->
          <div class="vital-cell c-art">
            <span class="v-label">BP (mmHg)</span>
            <span class="v-val">${v.bp_sys > 0 ? `${v.bp_sys}/${v.bp_dia}` : '---/---'}</span>
            <span class="v-sub">Art</span>
          </div>
          
          <!-- SpO2 (Neon Blue) -->
          <div class="vital-cell c-pleth">
            <span class="v-label">SpO2 (%)</span>
            <span class="v-val">${v.spo2 > 0 ? v.spo2 : '---'}%</span>
            <span class="v-sub">Pleth</span>
          </div>
          
          <!-- RR (Neon Yellow) -->
          <div class="vital-cell c-resp">
            <span class="v-label">RR (rpm)</span>
            <span class="v-val">${v.rr > 0 ? v.rr : '0'}</span>
            <span class="v-sub">Resp</span>
          </div>
        </div>
        
        <!-- Waveform Canvas -->
        <div class="waveform-container">
          <canvas id="canvas-wf-${bedId}" class="waveform-canvas"></canvas>
        </div>
        
        ${alertBadgeHtml}
      </div>
      
      <!-- Right: Action Panel -->
      ${actionsPanelHtml}
    `;
    
    // Bind click events to action buttons inside the card
    card.querySelectorAll('.btn-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const bid = btn.getAttribute('data-bed');
        const aid = btn.getAttribute('data-action');
        performAction(bid, aid);
      });
    });
    
    // Bind click events to ACLS buttons inside the card
    card.querySelectorAll('.btn-acls').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const bid = btn.getAttribute('data-bed');
        const actionType = btn.getAttribute('data-acls-action');
        performAclsAction(bid, actionType);
      });
    });
    
    wardGrid.appendChild(card);
  });
}

function renderLogs() {
  logFeed.innerHTML = '';
  currentGameState.logs.forEach(log => {
    const div = document.createElement('div');
    div.innerText = log;
    logFeed.appendChild(div);
  });
  logFeed.scrollTop = logFeed.scrollHeight;
}

// --- RESULT SCREEN CONTROLLER ---
function renderResult() {
  const safety = currentGameState.safety;
  resultSafety.innerText = `${safety}%`;
  
  // Grade evaluation
  resultGrade.className = 'value';
  if (safety >= 80) {
    resultGrade.innerText = "優秀当直 (Grade A)";
    resultGrade.classList.add('grade-a');
  } else if (safety >= 50) {
    resultGrade.innerText = "当直完了 (Grade B)";
    resultGrade.classList.add('grade-b');
  } else {
    resultGrade.innerText = "当直失敗 (Grade F)";
    resultGrade.classList.add('grade-f');
  }
  
  // Render final score (Single Player)
  resultScores.innerHTML = '';
  const score = currentGameState.players["player"] ? currentGameState.players["player"].score : 0;
  
  const li = document.createElement('li');
  li.innerHTML = `
    <span>🏆 あなたの最終スコア</span>
    <span class="p-score">${score} 点</span>
  `;
  resultScores.appendChild(li);
  
  // Render debriefings
  debriefingFeed.innerHTML = '';
  if (currentGameState.debriefings.length === 0) {
    debriefingFeed.innerHTML = '<div class="debriefing-card">今回の当直中に緊急対応した症例はありません。</div>';
  } else {
    currentGameState.debriefings.forEach(d => {
      const card = document.createElement('div');
      card.className = `debriefing-card success`;
      
      let sourceHtml = '';
      if (d.source && d.source.title && d.source.url) {
        sourceHtml = `
          <div class="debrief-source">
            <span class="source-label">📄 出典論文:</span>
            <a href="${escapeHtml(d.source.url)}" target="_blank" rel="noopener noreferrer" class="source-link" title="${escapeHtml(d.source.title)}">
              ${escapeHtml(d.source.title)}
            </a>
          </div>
        `;
      }
      
      card.innerHTML = `
        <div class="debrief-title">
          <span>${escapeHtml(d.title)}</span>
          <span style="font-size:0.75rem; color:var(--success);">✅ 救命完了</span>
        </div>
        <p style="font-size: 0.85rem; line-height: 1.4; margin-bottom: 0.5rem;">
          ${escapeHtml(d.patient)} (${escapeHtml(d.diagnosis)}) に対する急変対応は、
          適切な臨床判断により速やかに解決されました。
        </p>
        ${sourceHtml}
      `;
      debriefingFeed.appendChild(card);
    });
  }
  
  // Update local currentUserData record high_score immediately for UI consistency
  if (currentUserData && score > currentUserData.high_score) {
    currentUserData.high_score = score;
  }
}

btnRestart.addEventListener('click', () => {
  startGame();
});

// --- UTILS ---
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- GAS SETTINGS PANEL EVENT BINDINGS ---
function updateConnectionBadges() {
  const isConfigured = !!gasUrl.trim();
  let text = '⚪ ローカル保存モード';
  let className = 'status-badge local';
  
  if (isConfigured) {
    if (isGasActive) {
      text = '🟢 GASスプレッドシート連携中';
      className = 'status-badge connected';
    } else {
      text = '🟡 GAS接続確認中 / 待機中...';
      className = 'status-badge local';
    }
  }
  
  Object.entries(badges).forEach(([key, badge]) => {
    if (badge) {
      badge.innerText = text;
      badge.className = className;
    }
  });
}

// Init settings input
if (gasUrlInput) {
  gasUrlInput.value = gasUrl;
}

if (btnSettingsToggle) {
  btnSettingsToggle.addEventListener('click', () => {
    settingsDrawer.classList.add('open');
    updateAdminAuthUI();
  });
}

if (btnSettingsClose) {
  btnSettingsClose.addEventListener('click', () => {
    settingsDrawer.classList.remove('open');
    // Lock the admin panel again when drawer closes for security
    isAdminAuthenticated = false;
    updateAdminAuthUI();
  });
}

if (btnSettingsSave) {
  btnSettingsSave.addEventListener('click', async () => {
    gasUrl = gasUrlInput.value.trim();
    localStorage.setItem('gas_url', gasUrl);
    isGasActive = false;
    updateConnectionBadges();
    // Lock the admin panel again on save
    isAdminAuthenticated = false;
    updateAdminAuthUI();
    settingsDrawer.classList.remove('open');
    console.log("Saved GAS URL:", gasUrl);
    
    // Sync to local python server
    try {
      await fetch('/api/save_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gas_url: gasUrl })
      });
      console.log("Synced GAS URL to local server");
    } catch (e) {
      console.warn("Failed to sync config to local server:", e);
    }
    
    // Instantly test connection after save
    if (gasUrl) {
      await testGasConnection();
      // If user is already logged in, sync their latest score to new GAS
      if (hasJoined && currentUserData) {
        await saveUserScore();
      }
    }
  });
}

// --- ADMIN PANEL EVENT BINDINGS ---
if (btnAdminSpawn) {
  btnAdminSpawn.addEventListener('click', () => {
    if (!isAdminAuthenticated) {
      addLog("⚠️ 管理者認証が完了していません。");
      return;
    }
    const bedId = adminSelectBed.value;
    const caseId = adminSelectCase.value;
    if (bedId && caseId) {
      forceSpawnEmergency(bedId, caseId);
    }
  });
}

if (btnAdminHeal) {
  btnAdminHeal.addEventListener('click', () => {
    if (!isAdminAuthenticated) {
      addLog("⚠️ 管理者認証が完了していません。");
      return;
    }
    if (currentGameState.status === "PLAYING") {
      currentGameState.safety = 100;
      addLog("💚 管理者権限: 患者安全度を100%に全回復しました。");
      renderGame();
    } else {
      addLog("⚠️ 当直シフトが開始されていません。");
    }
  });
}

if (btnAdminTime) {
  btnAdminTime.addEventListener('click', () => {
    if (!isAdminAuthenticated) {
      addLog("⚠️ 管理者認証が完了していません。");
      return;
    }
    if (currentGameState.status === "PLAYING") {
      currentGameState.time_left = Math.min(currentGameState.time_left, 10);
      addLog("⏱️ 管理者権限: 残り時間を10秒に短縮しました。");
      renderGame();
    } else {
      addLog("⚠️ 当直シフトが開始されていません。");
    }
  });
}

// --- WEBBIOMETRIC AUTHENTICATION LOCK LOGIC ---
function updateAdminAuthUI() {
  const credId = localStorage.getItem('admin_cred_id');
  
  if (!btnAdminRegisterBio || !btnAdminUnlockBio || !btnAdminLockBio || !adminStatusBadge || !adminPanelSection || !adminAuthDesc) return;
  
  if (!credId) {
    // Unregistered state
    btnAdminRegisterBio.style.display = 'block';
    btnAdminUnlockBio.style.display = 'none';
    btnAdminLockBio.style.display = 'none';
    adminStatusBadge.innerText = '🔒 未登録 (UNREGISTERED)';
    adminStatusBadge.style.color = '#fbbf24'; // Warning yellow
    adminAuthDesc.innerText = '管理者専用デバッグツールを使用するには、まずこのデバイスの生体認証（Touch ID/Face ID等）を登録してください。';
    adminPanelSection.style.display = 'none';
  } else if (isAdminAuthenticated) {
    // Authenticated state
    btnAdminRegisterBio.style.display = 'none';
    btnAdminUnlockBio.style.display = 'none';
    btnAdminLockBio.style.display = 'block';
    adminStatusBadge.innerText = '🔓 認証完了 (UNLOCKED)';
    adminStatusBadge.style.color = '#10b981'; // Connected green
    adminAuthDesc.innerText = '管理者ロックは解除されています。デバッグツールが有効です。';
    
    // Display panel
    adminPanelSection.style.display = 'block';
  } else {
    // Locked state
    btnAdminRegisterBio.style.display = 'none';
    btnAdminUnlockBio.style.display = 'block';
    btnAdminLockBio.style.display = 'none';
    adminStatusBadge.innerText = '🔒 ロック中 (LOCKED)';
    adminStatusBadge.style.color = '#ef4444'; // Danger red
    adminAuthDesc.innerText = 'デバッグツールにアクセスするには、「生体認証でロック解除」をクリックして指紋・顔認証を行ってください。';
    adminPanelSection.style.display = 'none';
  }
}

// Convert buffer to Base64URL
function bufferToBase64URL(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Convert Base64URL to buffer
function base64URLToBuffer(base64url) {
  let base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// WebAuthn Registration (Credentials Creation)
async function registerAdminBiometrics() {
  try {
    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);
    
    const userID = new Uint8Array(16);
    window.crypto.getRandomValues(userID);

    const rpId = window.location.hostname || "localhost";

    const publicKeyCredentialCreationOptions = {
      challenge: challenge,
      rp: {
        name: "Ward Simulator",
        id: rpId
      },
      user: {
        id: userID,
        name: "admin@ward-simulator",
        displayName: "Ward Simulator Administrator"
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 } // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform", // Platform-integrated (Touch ID / Face ID)
        userVerification: "required"
      },
      timeout: 60000
    };

    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions
    });

    if (credential) {
      const credId = bufferToBase64URL(credential.rawId);
      localStorage.setItem('admin_cred_id', credId);
      addLog("🔒 管理者デバイスの生体認証（Touch ID等）を正常に登録しました。");
      return true;
    }
  } catch (err) {
    console.error("Biometric registration error:", err);
    alert("登録に失敗しました（WebAuthnをサポートするブラウザとデバイスが必要です）: " + err.message);
  }
  return false;
}

// WebAuthn Authentication (Credentials Assertion)
async function authenticateAdminBiometrics() {
  try {
    const credIdStr = localStorage.getItem('admin_cred_id');
    if (!credIdStr) {
      alert("生体認証が登録されていません。");
      return false;
    }

    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const rawId = base64URLToBuffer(credIdStr);

    const publicKeyCredentialRequestOptions = {
      challenge: challenge,
      allowCredentials: [{
        id: rawId,
        type: "public-key"
      }],
      userVerification: "required",
      timeout: 60000
    };

    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions
    });

    if (assertion) {
      addLog("🔓 生体認証によるロック解除に成功しました。管理者用ツールが有効です。");
      return true;
    }
  } catch (err) {
    console.error("Biometric authentication error:", err);
    alert("認証に失敗しました: " + err.message);
  }
  return false;
}

// Biometric control event bindings
if (btnAdminRegisterBio) {
  btnAdminRegisterBio.addEventListener('click', async () => {
    const success = await registerAdminBiometrics();
    if (success) {
      updateAdminAuthUI();
    }
  });
}

if (btnAdminUnlockBio) {
  btnAdminUnlockBio.addEventListener('click', async () => {
    const success = await authenticateAdminBiometrics();
    if (success) {
      isAdminAuthenticated = true;
      updateAdminAuthUI();
    }
  });
}

if (btnAdminLockBio) {
  btnAdminLockBio.addEventListener('click', () => {
    isAdminAuthenticated = false;
    updateAdminAuthUI();
    addLog("🔒 管理者ロックを再有効化し、デバッグツールをロックしました。");
  });
}

// Initial triggers
init();
