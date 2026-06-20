// --- CLINICAL CASES ---
let CLINICAL_CASES = [];

const BASE_BEDS = {
  "101": { patient: "佐藤 一郎 (72歳)", diagnosis: "慢性心不全・経過観察", status: "stable", vitals: { hr: 72, bp_sys: 124, bp_dia: 80, spo2: 97 }, active_event: null },
  "102": { patient: "鈴木 美咲 (28歳)", diagnosis: "気管支喘息・点滴中", status: "stable", vitals: { hr: 80, bp_sys: 110, bp_dia: 70, spo2: 98 }, active_event: null },
  "103": { patient: "高橋 健二 (55歳)", diagnosis: "肝硬変・腹水管理", status: "stable", vitals: { hr: 65, bp_sys: 138, bp_dia: 85, spo2: 96 }, active_event: null },
  "104": { patient: "田中 友美 (42歳)", diagnosis: "腎盂腎炎・抗菌薬治療", status: "stable", vitals: { hr: 88, bp_sys: 115, bp_dia: 75, spo2: 95 }, active_event: null },
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

const lobbyInput = document.getElementById('username');
const userEmailInput = document.getElementById('user-email');
const btnJoin = document.getElementById('btn-join');
const btnGoogleLogin = document.getElementById('btn-google-login');
const lobbyWaiting = document.getElementById('lobby-waiting');

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

// Beds Container
const wardGrid = document.getElementById('ward-grid');
const logFeed = document.getElementById('log-feed');

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
  
  try {
    const res = await fetch('data/cases.json');
    const cases = await res.json();
    if (cases && cases.length > 0) {
      CLINICAL_CASES = cases;
    }
  } catch (e) {
    console.error("Failed to load cases:", e);
  }
  
  // Try checking GAS URL connectivity silently if configured
  if (gasUrl) {
    testGasConnection();
  }
  
  // Directly render lobby state
  updateState(currentGameState);
}

function recordStats(caseId, tried, correct) {
  if (!gasUrl) return;
  fetch(gasUrl, {
    method: 'POST',
    body: JSON.stringify({ action: "stats", case_id: caseId, tried: tried, correct: correct })
  }).catch(e => console.error(e));
}

async function testGasConnection() {
  if (!gasUrl) return;
  try {
    const testUrl = `${gasUrl}?email=test_connection_ping@gmail.com`;
    const res = await fetchWithTimeout(testUrl, { mode: 'cors' });
    const data = await res.json();
    if (data && (data.status === "success" || data.status === "not_found")) {
      isGasActive = true;
    } else {
      isGasActive = false;
    }
  } catch (err) {
    console.warn("GAS connection test failed:", err);
    isGasActive = false;
  }
  updateConnectionBadges();
}

// --- DATABASE SYNC LOGICS (GAS & LocalStorage) ---
async function loginUser(email, nickname) {
  email = email.toLowerCase().trim();
  let user = null;
  let gasSuccess = false;
  
  btnJoin.disabled = true;
  btnJoin.innerText = "通信中...";
  btnGoogleLogin.disabled = true;

  if (gasUrl) {
    try {
      const url = `${gasUrl}?email=${encodeURIComponent(email)}`;
      const res = await fetchWithTimeout(url, { mode: 'cors' });
      const data = await res.json();
      if (data && (data.status === "success" || data.status === "not_found")) {
        gasSuccess = true;
        isGasActive = true;
        if (data.status === "success") {
          user = {
            email: data.email,
            name: data.name || nickname,
            high_score: parseInt(data.high_score) || 0,
            completed_cases: Array.isArray(data.completed_cases) 
              ? data.completed_cases 
              : (data.completed_cases ? data.completed_cases.split(",") : []),
            last_played: data.last_played || new Date().toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"})
          };
        }
      }
    } catch (e) {
      console.warn("GAS login failed, falling back to local database:", e);
      isGasActive = false;
    }
  }

  // Fallback to local storage
  if (!user) {
    const localDb = JSON.parse(localStorage.getItem('users_db') || '{}');
    if (localDb[email]) {
      user = localDb[email];
      user.name = nickname; // Overwrite name with newest input
    } else {
      user = {
        email: email,
        name: nickname,
        high_score: 0,
        completed_cases: [],
        last_played: ""
      };
    }
  }

  currentUserData = user;
  isGasActive = gasSuccess;

  // Sync to local storage
  const localDb = JSON.parse(localStorage.getItem('users_db') || '{}');
  localDb[email] = user;
  localStorage.setItem('users_db', JSON.stringify(localDb));

  // If new user on GAS, post initial registration
  if (gasSuccess && gasUrl && !user.last_played) {
    try {
      user.last_played = new Date().toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"});
      await saveToGas(user);
    } catch (e) {
      console.error("GAS registration post failed:", e);
    }
  }

  btnJoin.disabled = false;
  btnJoin.innerText = "ログインして当直室に入る";
  btnGoogleLogin.disabled = false;

  hasJoined = true;
  updateConnectionBadges();
  renderDashboard(user);
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

  // Always sync to local storage
  const localDb = JSON.parse(localStorage.getItem('users_db') || '{}');
  localDb[email] = currentUserData;
  localStorage.setItem('users_db', JSON.stringify(localDb));

  // Sync to GAS
  if (gasUrl) {
    addLog("📡 GASへのスコア同期中...");
    try {
      const data = await saveToGas(currentUserData);
      if (data && data.status === "success") {
        isGasActive = true;
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
  // CORS POST without Content-Type header to avoid OPTIONS preflight block
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

// --- STATE MANAGEMENT ---
function updateState(newState) {
  currentGameState = newState;
  
  if (!hasJoined) {
    switchScreen('lobby');
    document.getElementById('login-auth-panel').style.display = 'block';
    lobbyWaiting.style.display = 'none';
  } else {
    if (newState.status === "LOBBY") {
      switchScreen('lobby');
      if (currentUserData) {
        renderDashboard(currentUserData);
      }
    } else if (newState.status === "PLAYING") {
      switchScreen('game');
      renderGame();
    } else if (newState.status === "RESULT") {
      switchScreen('result');
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
  document.getElementById('login-auth-panel').style.display = 'none';
  lobbyWaiting.style.display = 'block';
  
  document.getElementById('dash-name').innerText = `${user.name} 医師`;
  document.getElementById('dash-email').innerText = user.email;
  document.getElementById('dash-highscore').innerText = `${user.high_score} 点`;
  
  const completedCount = user.completed_cases ? user.completed_cases.length : 0;
  document.getElementById('dash-completed').innerText = `${completedCount} / 6 件`;
}

// Handle Custom Test Account Sign-in
btnJoin.addEventListener('click', () => {
  const email = userEmailInput.value.trim();
  const nickname = lobbyInput.value.trim();
  if (!email || !nickname) {
    alert("テスト用メールアドレスと表示名を入力してください。");
    return;
  }
  loginUser(email, nickname);
});

// Handle simulated Google Sign-in Mockup
btnGoogleLogin.addEventListener('click', () => {
  const randomSuffix = Math.floor(Math.random() * 900) + 100;
  const dummyEmail = `resident${randomSuffix}@gmail.com`;
  const dummyName = `専攻医${randomSuffix}先生`;
  loginUser(dummyEmail, dummyName);
});

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
}

function startGameTimer() {
  if (gameIntervalId) clearInterval(gameIntervalId);
  
  gameIntervalId = setInterval(() => {
    if (currentGameState.status !== "PLAYING") {
      clearInterval(gameIntervalId);
      return;
    }
    
    // 思考中の一時停止判定: 「アクティブなイベントがあり、かつ処置中(is_processing)ではない」ベッドがある場合は減算をスキップ
    let isThinking = false;
    Object.values(currentGameState.beds).forEach(bed => {
      if (bed.active_event && !bed.active_event.is_processing) {
        isThinking = true;
      }
    });
    
    if (!isThinking) {
      currentGameState.time_left -= 1;
    }
    
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
    steps: JSON.parse(JSON.stringify(chosenCase.steps)),
    current_step: 0,
    last_feedback: null,
    is_processing: false // 処置ディレイフラグ
  };
  
  addLog("🚨 【当直コール】" + bedId + "号室 (" + bed.patient + ") が急変！主訴: 「" + chosenCase.complaint + "」");
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
      
      const bonus = isNurseCall ? 10 : 30;
      player.score += bonus;
      
      addLog("✨ " + bedId + "号室の " + bed.patient + " の状態は安定しました。確定診断: " + evt.diagnosis);
      
      currentGameState.debriefings.push({
        id: evt.id,
        patient: bed.patient,
        diagnosis: evt.diagnosis,
        title: evt.title,
        saved_by: player.name,
        result: "SUCCESS"
      });
    }
  } else {
    const isCritical = !!selectedOpt.critical;
    player.score = Math.max(0, player.score - 10);
    
    const penalty = isCritical ? 15 : 7;
    currentGameState.safety = Math.max(0, currentGameState.safety - penalty);
    evt.last_feedback = "❌ 【不適切】 (安全度 -" + penalty + "%) " + selectedOpt.fb;
    
    const severityStr = isCritical ? "【致命的ミス】" : "";
    addLog("❌ 処置不適切: " + bedId + "号室 - " + selectedOpt.text + " " + severityStr + " (安全度 -" + penalty + "%)");
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
    const hrVal = v.hr > 0 ? `${v.hr} bpm` : '0 (---)';
    const bpVal = v.bp_sys > 0 ? `${v.bp_sys}/${v.bp_dia}` : '0/0';
    const spo2Val = v.spo2 > 0 ? `${v.spo2}%` : '0% (---)';
    
    // Heart pulse icon class
    const heartPulseHtml = v.hr > 0 ? '<span class="v-pulse-heart">❤️</span>' : '<span style="color:var(--danger)">💔</span>';
    
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
      
      actionsPanelHtml = `
        <div class="bed-actions-panel">
          <div class="event-details">
            <span class="event-title">🚨 ${escapeHtml(evt.complaint)}</span> <!-- 診断名ではなく主訴をタイトルに -->
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
      <!-- Left: Bio -->
      <div class="bed-bio">
        <div class="bed-header">
          <span class="bed-id">${bedId}号室</span>
          <span class="status-label">${statusLabel}</span>
        </div>
        <div class="patient-name">${escapeHtml(bed.patient)}</div>
        <div class="patient-diag">${escapeHtml(displayDiag)}</div>
      </div>
      
      <!-- Middle: Vitals Monitor -->
      <div class="vital-monitor">
        <div class="vital-row">
          <span class="vital-label">心拍数 (HR)</span>
          <span class="vital-value v-hr">${heartPulseHtml} ${hrVal}</span>
        </div>
        <div class="vital-row">
          <span class="vital-label">血圧 (BP)</span>
          <span class="vital-value v-bp">⚡ ${bpVal}</span>
        </div>
        <div class="vital-row">
          <span class="vital-label">酸素飽和度 (SpO2)</span>
          <span class="vital-value v-spo2">💨 ${spo2Val}</span>
        </div>
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
      card.innerHTML = `
        <div class="debrief-title">
          <span>${escapeHtml(d.title)}</span>
          <span style="font-size:0.75rem; color:var(--success);">✅ 救命完了</span>
        </div>
        <p style="font-size: 0.85rem; line-height: 1.4;">
          ${escapeHtml(d.patient)} (${escapeHtml(d.diagnosis)}) に対する急変対応は、
          適切な臨床判断により速やかに解決されました。
        </p>
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
  });
}

if (btnSettingsClose) {
  btnSettingsClose.addEventListener('click', () => {
    settingsDrawer.classList.remove('open');
  });
}

if (btnSettingsSave) {
  btnSettingsSave.addEventListener('click', async () => {
    gasUrl = gasUrlInput.value.trim();
    localStorage.setItem('gas_url', gasUrl);
    isGasActive = false;
    updateConnectionBadges();
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

// Initial triggers
init();
