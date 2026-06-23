// Socket.io initialization
const socket = io();

// State Variables
let myNickname = '';
let currentRoomId = null;
let isDrawer = false;
let isGameStageLocked = false; // Lock drawing when stage changes to 'guess'
let roundEndTimer = null; // Store round-end countdown timer reference

// Canvas Drawing State
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentColor = '#000000';
let currentLineWidth = 8;

// Set up Canvas line cap and join properties for smooth drawing
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

// Screen DOM Elements
const screens = {
  login: document.getElementById('screen-login'),
  lobbyList: document.getElementById('screen-lobby-list'),
  roomLobby: document.getElementById('screen-room-lobby'),
  game: document.getElementById('screen-game'),
  gameOver: document.getElementById('screen-game-over'),
};

// --- SCREEN NAVIGATION ---
function showScreen(screenId) {
  Object.keys(screens).forEach(key => {
    if (key === screenId) {
      screens[key].classList.add('active');
    } else {
      screens[key].classList.remove('active');
    }
  });

  // Specific screen transition adjustments
  if (screenId === 'lobbyList') {
    socket.emit('get-lobbies');
  }
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'normal') {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.className = 'toast show';
  if (type === 'error') {
    toast.style.borderColor = 'rgba(255, 59, 48, 0.6)';
    toast.style.boxShadow = '0 0 15px rgba(255, 59, 48, 0.3)';
  } else {
    toast.style.borderColor = 'rgba(0, 240, 255, 0.4)';
    toast.style.boxShadow = '0 0 15px rgba(0, 240, 255, 0.2)';
  }
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
    toast.classList.remove('show');
  }, 3000);
}

// --- LANDING PAGE EVENT LISTENERS ---
const nicknameInput = document.getElementById('input-nickname');
const btnRandomNickname = document.getElementById('btn-random-nickname');
const btnEnterLobby = document.getElementById('btn-enter-lobby');

btnRandomNickname.addEventListener('click', () => {
  // Trigger socket init-player again or generate locally
  // We'll let server suggest a new nickname
  socket.disconnect();
  socket.connect();
});

btnEnterLobby.addEventListener('click', () => {
  const nick = nicknameInput.value.trim();
  if (nick) {
    socket.emit('set-nickname', nick);
  } else {
    socket.emit('set-nickname', ''); // Will trigger fallback server generated nickname
  }
});

// --- LOBBY LIST SCREEN EVENT LISTENERS ---
const btnOpenCreateModal = document.getElementById('btn-open-create-modal');
const btnCloseCreateModal = document.getElementById('btn-close-create-modal');
const createRoomModal = document.getElementById('create-room-modal');
const btnConfirmCreateRoom = document.getElementById('btn-confirm-create-room');
const btnRefreshLobbies = document.getElementById('btn-refresh-lobbies');
const createRoomNameInput = document.getElementById('create-room-name');

btnOpenCreateModal.addEventListener('click', () => {
  createRoomModal.classList.remove('hidden');
});

btnCloseCreateModal.addEventListener('click', () => {
  createRoomModal.classList.add('hidden');
});

btnConfirmCreateRoom.addEventListener('click', () => {
  const roomName = createRoomNameInput.value.trim();
  const difficulty = document.querySelector('input[name="room-difficulty"]:checked').value;
  socket.emit('create-room', { roomName, difficulty });
  createRoomModal.classList.add('hidden');
  createRoomNameInput.value = '';
});

btnRefreshLobbies.addEventListener('click', () => {
  socket.emit('get-lobbies');
});

// --- ROOM LOBBY SCREEN EVENT LISTENERS ---
const btnLeaveRoom = document.getElementById('btn-leave-room');
const btnToggleReady = document.getElementById('btn-toggle-ready');

btnLeaveRoom.addEventListener('click', () => {
  // Reconnecting automatically disconnects and removes room state
  socket.disconnect();
  socket.connect();
  currentRoomId = null;
  showScreen('lobbyList');
});

btnToggleReady.addEventListener('click', () => {
  socket.emit('toggle-ready');
});

// --- GAME SCREEN & CANVAS EVENT LISTENERS ---
const btnClearCanvas = document.getElementById('btn-clear-canvas');
const colorBtns = document.querySelectorAll('.color-btn');
const brushSlider = document.getElementById('brush-size-slider');
const brushIndicator = document.getElementById('brush-indicator');
const guessForm = document.getElementById('form-guess');
const guessInput = document.getElementById('input-guess');
const canvasLockOverlay = document.getElementById('canvas-lock-overlay');
const drawingToolsBar = document.getElementById('drawing-tools-bar');

// Drawing Color selection
colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    colorBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentColor = btn.getAttribute('data-color');
  });
});

// Brush Size selector
brushSlider.addEventListener('input', (e) => {
  currentLineWidth = parseInt(e.target.value);
  brushIndicator.style.width = `${currentLineWidth}px`;
  brushIndicator.style.height = `${currentLineWidth}px`;
});

// Clear canvas button
btnClearCanvas.addEventListener('click', () => {
  if (isDrawer && !isGameStageLocked) {
    socket.emit('clear-canvas');
  }
});

// Guess Form Submit
guessForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = guessInput.value.trim();
  if (text) {
    socket.emit('submit-guess', text);
    guessInput.value = '';
  }
});

// --- PROTEST & VOTING SYSTEM ---
const btnProtest = document.getElementById('btn-protest');
const protestActionBar = document.getElementById('protest-action-bar');
const overlayProtestVote = document.getElementById('overlay-protest-vote');
const btnVoteAgree = document.getElementById('btn-vote-agree');
const btnVoteDisagree = document.getElementById('btn-vote-disagree');

btnProtest.addEventListener('click', () => {
  socket.emit('submit-protest');
});

btnVoteAgree.addEventListener('click', () => {
  socket.emit('submit-vote', 'agree');
  btnVoteAgree.style.boxShadow = '0 0 15px #39ff14';
  btnVoteAgree.disabled = true;
  btnVoteDisagree.disabled = true;
});

btnVoteDisagree.addEventListener('click', () => {
  socket.emit('submit-vote', 'disagree');
  btnVoteDisagree.style.boxShadow = '0 0 15px #ff007f';
  btnVoteAgree.disabled = true;
  btnVoteDisagree.disabled = true;
});

// --- CANVAS INTERACTION ---

// Convert client coords (mouse/touch) to logical canvas coords (800x600)
function getLogicalCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 800;
  const y = ((clientY - rect.top) / rect.height) * 600;
  return { x, y };
}

// Local draw function for drawing logical lines on client canvas
function drawLogicalLine(x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// Mouse events
canvas.addEventListener('mousedown', (e) => {
  if (!isDrawer || isGameStageLocked) return;
  isDrawing = true;
  const coords = getLogicalCoords(e.clientX, e.clientY);
  lastX = coords.x;
  lastY = coords.y;
  
  // Draw a dot on tap/click
  drawLogicalLine(lastX, lastY, lastX, lastY, currentColor, currentLineWidth);
  socket.emit('draw-line', {
    x1: lastX,
    y1: lastY,
    x2: lastX,
    y2: lastY,
    color: currentColor,
    width: currentLineWidth
  });
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDrawing || !isDrawer || isGameStageLocked) return;
  const coords = getLogicalCoords(e.clientX, e.clientY);
  const currentX = coords.x;
  const currentY = coords.y;

  drawLogicalLine(lastX, lastY, currentX, currentY, currentColor, currentLineWidth);
  
  // Send data to server
  socket.emit('draw-line', {
    x1: lastX,
    y1: lastY,
    x2: currentX,
    y2: currentY,
    color: currentColor,
    width: currentLineWidth
  });

  lastX = currentX;
  lastY = currentY;
});

canvas.addEventListener('mouseup', () => {
  isDrawing = false;
});

canvas.addEventListener('mouseleave', () => {
  isDrawing = false;
});

// Touch events for mobile support
canvas.addEventListener('touchstart', (e) => {
  if (!isDrawer || isGameStageLocked) return;
  e.preventDefault(); // Prevent scrolling on mobile while drawing
  isDrawing = true;
  const touch = e.touches[0];
  const coords = getLogicalCoords(touch.clientX, touch.clientY);
  lastX = coords.x;
  lastY = coords.y;

  // Draw a dot on touch start
  drawLogicalLine(lastX, lastY, lastX, lastY, currentColor, currentLineWidth);
  socket.emit('draw-line', {
    x1: lastX,
    y1: lastY,
    x2: lastX,
    y2: lastY,
    color: currentColor,
    width: currentLineWidth
  });
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!isDrawing || !isDrawer || isGameStageLocked) return;
  e.preventDefault();
  const touch = e.touches[0];
  const coords = getLogicalCoords(touch.clientX, touch.clientY);
  const currentX = coords.x;
  const currentY = coords.y;

  drawLogicalLine(lastX, lastY, currentX, currentY, currentColor, currentLineWidth);
  
  socket.emit('draw-line', {
    x1: lastX,
    y1: lastY,
    x2: currentX,
    y2: currentY,
    color: currentColor,
    width: currentLineWidth
  });

  lastX = currentX;
  lastY = currentY;
}, { passive: false });

canvas.addEventListener('touchend', () => {
  isDrawing = false;
});

canvas.addEventListener('touchcancel', () => {
  isDrawing = false;
});


// --- GAME OVER SCREEN LISTENERS ---
const btnReturnLobby = document.getElementById('btn-return-lobby');
btnReturnLobby.addEventListener('click', () => {
  socket.emit('return-to-lobby');
});


// --- SOCKET.IO EVENT LISTENERS ---

// Player Initialization
socket.on('init-player', ({ nickname }) => {
  myNickname = nickname;
  nicknameInput.value = nickname;
  document.getElementById('user-nickname-display').innerText = nickname;
});

socket.on('nickname-set', ({ nickname }) => {
  myNickname = nickname;
  document.getElementById('user-nickname-display').innerText = nickname;
  showScreen('lobbyList');
});

// Update lobby room cards list
socket.on('lobbies-list', (lobbyList) => {
  const container = document.getElementById('lobby-rooms-container');
  container.innerHTML = '';

  if (lobbyList.length === 0) {
    container.innerHTML = `
      <div class="empty-rooms">
        <p>目前沒有任何大廳</p>
        <small>點擊右上角「建立大廳」來開啟新的遊戲！</small>
      </div>
    `;
    return;
  }

  lobbyList.forEach(room => {
    const card = document.createElement('div');
    card.className = 'glass-card room-card';
    
    const diffBadgeClass = room.difficulty === 'difficult' ? 'badge-difficult' : 'badge-normal';
    const diffLabel = room.difficulty === 'difficult' ? '困難' : '一般';
    
    const playStatusLabel = room.status === 'playing' ? '遊戲中' : '等待中';
    const playStatusBadge = room.status === 'playing' ? 'badge-playing' : diffBadgeClass;

    card.innerHTML = `
      <div class="card-top">
        <h3>${room.name}</h3>
        <span class="badge ${playStatusBadge}">${room.status === 'playing' ? playStatusLabel : diffLabel}</span>
      </div>
      <div class="card-bottom">
        <span class="player-count">👥 ${room.playerCount} / 10</span>
        ${room.status === 'lobby' && room.playerCount < 10 
          ? `<button class="btn btn-primary btn-sm btn-join" data-id="${room.id}">加入</button>`
          : `<button class="btn btn-secondary btn-sm" disabled>${room.status === 'playing' ? '遊戲中' : '已滿'}</button>`
        }
      </div>
    `;

    // Join room action
    const btnJoin = card.querySelector('.btn-join');
    if (btnJoin) {
      btnJoin.addEventListener('click', () => {
        socket.emit('join-room', room.id);
      });
    }

    container.appendChild(card);
  });
});

// Room connection responses
socket.on('create-room-success', ({ roomId }) => {
  currentRoomId = roomId;
  showScreen('roomLobby');
});

socket.on('join-room-success', ({ roomId }) => {
  currentRoomId = roomId;
  showScreen('roomLobby');
});

socket.on('error-msg', (msg) => {
  showToast(msg, 'error');
});

// Detailed Room State updates
socket.on('room-detail', (room) => {
  // Update Room waiting lobby title & badge
  const roomTitle = document.getElementById('room-lobby-title');
  if (roomTitle) roomTitle.innerText = room.name;

  const diffBadge = document.getElementById('room-lobby-diff-badge');
  if (diffBadge) {
    diffBadge.innerText = room.difficulty === 'difficult' ? '困難模式' : '一般模式';
    diffBadge.className = room.difficulty === 'difficult' ? 'badge badge-difficult' : 'badge badge-normal';
  }

  // Update Player count count
  document.getElementById('room-player-count').innerText = room.players.length;

  // Render players waiting room list
  const playersListContainer = document.getElementById('room-players-list');
  playersListContainer.innerHTML = '';

  let amIReady = false;

  room.players.forEach(p => {
    const isSelf = p.id === socket.id;
    if (isSelf) amIReady = p.ready;

    const playerCard = document.createElement('div');
    playerCard.className = `player-lobby-card ${isSelf ? 'is-self' : ''}`;
    
    const readyClass = p.ready ? 'status-ready' : 'status-waiting';
    const readyLabel = p.ready ? '已準備' : '未準備';

    playerCard.innerHTML = `
      <div class="player-info-meta">
        <span>👤 ${p.nickname} ${isSelf ? ' (你)' : ''}</span>
        ${p.isHost ? '<span class="host-tag">房主</span>' : ''}
      </div>
      <span class="player-status-badge ${readyClass}">${readyLabel}</span>
    `;
    playersListContainer.appendChild(playerCard);
  });

  // Update Ready Button label
  const btnToggleReady = document.getElementById('btn-toggle-ready');
  if (btnToggleReady) {
    if (amIReady) {
      btnToggleReady.innerText = '取消準備';
      btnToggleReady.className = 'btn btn-danger btn-block btn-ready';
    } else {
      btnToggleReady.innerText = '準備完成';
      btnToggleReady.className = 'btn btn-success btn-block btn-ready';
    }
  }

  // Handle active game screen transition
  if (room.status === 'playing') {
    showScreen('game');
  } else if (room.status === 'lobby') {
    showScreen('roomLobby');
  }
});

// Chat message log in lobby
socket.on('chat-message', (msg) => {
  const roomChatContainer = document.getElementById('room-chat-messages');
  
  if (roomChatContainer) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const msgDiv = document.createElement('div');
    
    if (msg.isSystem) {
      msgDiv.className = 'chat-msg system';
      msgDiv.innerHTML = `<span class="time">[${timeStr}]</span> ${msg.text}`;
    } else {
      msgDiv.className = 'chat-msg';
      msgDiv.innerHTML = `<span class="time">[${timeStr}]</span><span class="nick">${msg.nickname}:</span> ${msg.text}`;
    }
    
    roomChatContainer.appendChild(msgDiv);
    roomChatContainer.scrollTop = roomChatContainer.scrollHeight;
  }
});

// Round Start Event
socket.on('round-start', (data) => {
  showScreen('game');
  
  // Close any overlays
  document.getElementById('overlay-round-end').classList.add('hidden');
  
  isDrawer = (data.role === 'drawer');
  isGameStageLocked = false;
  canvasLockOverlay.classList.add('hidden');

  // Display Drawer Name & Round info
  document.getElementById('game-drawer-nickname').innerText = data.drawerNickname;

  // Display prompt word based on role
  const wordDisplay = document.getElementById('game-word-display');
  const wordBanner = document.getElementById('game-word-banner');
  
  if (isDrawer) {
    wordDisplay.innerText = data.word;
    wordBanner.classList.add('is-drawer');
    showToast(`現在是你的作畫回合！題目是【${data.word}】`, 'normal');
    
    // Show Drawer Drawing tools
    drawingToolsBar.classList.remove('hidden');
    // Hide Guess input
    guessForm.style.display = 'none';
  } else {
    wordDisplay.innerText = `??? (${data.difficulty === 'difficult' ? '困難難度' : '一般難度'})`;
    wordBanner.classList.remove('is-drawer');
    showToast(`新回合開始！目前由【${data.drawerNickname}】作畫。`, 'normal');

    // Hide Drawer Drawing tools
    drawingToolsBar.classList.add('hidden');
    // Show Guess input
    guessForm.style.display = 'flex';
  }

  // Set initial timer
  document.getElementById('game-timer-text').innerText = `${data.timeLeft}s`;
  const timerBar = document.getElementById('timer-bar');
  timerBar.style.width = '100%';
  timerBar.classList.remove('locked');

  // Reset local canvas drawing coordinates
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Reset guessing messages list
  const guessContainer = document.getElementById('game-guess-messages');
  guessContainer.innerHTML = `
    <div class="guess-bubble system-msg">
      回合開始！由 ${data.drawerNickname} 開始作畫！
    </div>
  `;
});

// Timer Updates
socket.on('timer-update', (data) => {
  document.getElementById('game-timer-text').innerText = `${data.timeLeft}s`;
  
  const timerBar = document.getElementById('timer-bar');
  const totalDuration = data.stage === 'draw' ? 120 : 60;
  const percentage = (data.timeLeft / totalDuration) * 100;
  timerBar.style.width = `${percentage}%`;
});

// Stage Transition (e.g. Draw stage 120s finished, Guess-only stage 60s starts)
socket.on('stage-change', (data) => {
  isGameStageLocked = true;
  
  // Show lock overlay
  canvasLockOverlay.classList.remove('hidden');

  // Change timer progress color to magenta/red
  const timerBar = document.getElementById('timer-bar');
  timerBar.classList.add('locked');
  timerBar.style.width = '100%';

  // Hide drawing tools (if we were the drawer)
  drawingToolsBar.classList.add('hidden');

  // Log system message in guesses log
  const guessContainer = document.getElementById('game-guess-messages');
  const lockMsg = document.createElement('div');
  lockMsg.className = 'guess-bubble system-msg';
  lockMsg.innerText = '時間到！畫板已鎖定，猜題倒數 60 秒！';
  guessContainer.appendChild(lockMsg);
  guessContainer.scrollTop = guessContainer.scrollHeight;
});

// Sync lines from server
socket.on('draw-line', (data) => {
  drawLogicalLine(data.x1, data.y1, data.x2, data.y2, data.color, data.width);
});

// Sync canvas clearing
socket.on('clear-canvas', () => {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
});

// Guess list log update
socket.on('guess-received', (guess) => {
  const guessContainer = document.getElementById('game-guess-messages');
  
  const bubble = document.createElement('div');
  bubble.className = `guess-bubble ${isDrawer ? 'drawer-view' : ''}`;
  
  bubble.innerHTML = `
    <div class="guess-meta">
      <span class="nick">${guess.nickname}</span>
      ${isDrawer 
        ? `<button class="guess-action-btn" data-id="${guess.id}" data-player="${guess.playerId}">判定正確</button>` 
        : ''
      }
    </div>
    <div class="guess-text">${guess.text}</div>
  `;

  // Manual judgment handler
  if (isDrawer) {
    const btnApprove = bubble.querySelector('.guess-action-btn');
    btnApprove.addEventListener('click', () => {
      socket.emit('approve-guess', {
        guessId: guess.id,
        playerId: guess.playerId
      });
    });
  }

  guessContainer.appendChild(bubble);
  guessContainer.scrollTop = guessContainer.scrollHeight;
});

// In-Game score updates & drawer list update
socket.on('room-detail', (room) => {
  if (room.status !== 'playing' && room.status !== 'round-end') return;

  // Render Scores panel
  const scoresContainer = document.getElementById('game-scores-list');
  scoresContainer.innerHTML = '';

  // Sort players by score
  const sortedPlayers = [...room.players].sort((a,b) => b.score - a.score);

  sortedPlayers.forEach(p => {
    const isCurrentDrawer = p.id === room.currentDrawerId;
    const isSelf = p.id === socket.id;

    const row = document.createElement('div');
    row.className = `score-row ${isCurrentDrawer ? 'is-drawer' : ''}`;

    let roleIndicator = '';
    if (isCurrentDrawer) {
      roleIndicator = '✏️ 畫家';
    } else {
      roleIndicator = '🔍 猜題中';
    }

    row.innerHTML = `
      <div class="player-nick" title="${p.nickname}">
        <span>${p.nickname} ${isSelf ? ' (你)' : ''}</span>
        <small class="role-indicator">${roleIndicator}</small>
      </div>
      <span class="score-num">${p.score} 分</span>
    `;

    scoresContainer.appendChild(row);
  });

  // Sync turn number
  const roundInfo = document.getElementById('game-round-info');
  if (roundInfo) {
    // Current drawer index out of players count
    const currentDrawerIndex = room.players.findIndex(p => p.id === room.currentDrawerId);
    roundInfo.innerText = `回合 ${currentDrawerIndex + 1} / ${room.players.length}`;
  }
});

// Round End Transition modal
socket.on('round-end', (data) => {
  const overlay = document.getElementById('overlay-round-end');
  overlay.classList.remove('hidden');

  // Fill in correct word
  document.getElementById('round-end-answer').innerText = data.correctWord;

  // Display winner or penalty message
  const winnerAnnouncement = document.getElementById('round-end-winner-announcement');
  const penaltyAnnouncement = document.getElementById('round-end-penalty-announcement');

  if (data.winnerNickname) {
    winnerAnnouncement.classList.remove('hidden');
    winnerAnnouncement.querySelector('.winner-text').innerHTML = `恭喜 <strong>${data.winnerNickname}</strong> 猜中答案！`;
    penaltyAnnouncement.classList.add('hidden');
  } else {
    winnerAnnouncement.classList.add('hidden');
    if (data.drawerPenalty) {
      penaltyAnnouncement.classList.remove('hidden');
    } else {
      // Normal end (maybe some other reason)
      penaltyAnnouncement.classList.add('hidden');
    }
  }

  // Handle Protest button display
  if (data.isManualApproval) {
    const isWinner = socket.id === data.winnerId;
    if (!isDrawer && !isWinner) {
      protestActionBar.classList.remove('hidden');
    } else {
      protestActionBar.classList.add('hidden');
    }
  } else {
    protestActionBar.classList.add('hidden');
  }

  // 5 seconds Countdown display
  if (roundEndTimer) clearInterval(roundEndTimer);
  let count = 5;
  const countdownSpan = document.getElementById('round-end-countdown-secs');
  countdownSpan.innerText = count;

  roundEndTimer = setInterval(() => {
    count--;
    countdownSpan.innerText = count;
    if (count <= 0) {
      clearInterval(roundEndTimer);
    }
  }, 1000);
});

// Final Game Over Rank Screen
socket.on('game-over', (data) => {
  // 隱藏回合結束的疊加層，避免遮擋排行榜
  document.getElementById('overlay-round-end').classList.add('hidden');

  showScreen('gameOver');

  const leaderboardContainer = document.getElementById('final-leaderboard');
  leaderboardContainer.innerHTML = '';

  data.leaderboard.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = `leaderboard-row rank-${index + 1}`;
    
    let medal = '';
    if (index === 0) medal = '🥇';
    else if (index === 1) medal = '🥈';
    else if (index === 2) medal = '🥉';
    else medal = `${index + 1}.`;

    row.innerHTML = `
      <div class="player-name-score">
        <span class="rank-num">${medal}</span>
        <span class="name">${player.nickname}</span>
      </div>
      <span class="score">${player.score} 分</span>
    `;

    leaderboardContainer.appendChild(row);
  });
});

// Protest Starts Event
socket.on('protest-start', (data) => {
  // Clear local next round countdown timer
  if (roundEndTimer) {
    clearInterval(roundEndTimer);
    roundEndTimer = null;
  }

  // Hide round-end overlay and show protest voting overlay
  document.getElementById('overlay-round-end').classList.add('hidden');
  overlayProtestVote.classList.remove('hidden');

  // Fill in protest information
  document.getElementById('protest-protester').innerText = data.protesterNickname;
  document.getElementById('protest-guesser').innerText = data.guesserNickname;
  document.getElementById('protest-guess-text').innerText = data.guessText;
  document.getElementById('protest-countdown-secs').innerText = data.timeLeft;

  // Reset vote count labels
  document.getElementById('vote-count-agree').innerText = '0';
  document.getElementById('vote-count-disagree').innerText = '0';

  // Reset and enable voting buttons
  btnVoteAgree.disabled = false;
  btnVoteDisagree.disabled = false;
  btnVoteAgree.style.boxShadow = '';
  btnVoteDisagree.style.boxShadow = '';
});

// Update protest voting countdown timer
socket.on('protest-timer-update', (data) => {
  document.getElementById('protest-countdown-secs').innerText = data.timeLeft;
});

// Live update vote counts
socket.on('vote-update', (data) => {
  document.getElementById('vote-count-agree').innerText = data.agreeCount;
  document.getElementById('vote-count-disagree').innerText = data.disagreeCount;
});

// Protest Result Event
socket.on('protest-result', (data) => {
  overlayProtestVote.classList.add('hidden');
  if (data.success) {
    showToast(`抗議成功 (${data.disagreeCount} 票反對 vs ${data.agreeCount} 票同意)！加分撤銷，遊戲繼續！`, 'normal');
  } else {
    showToast(`抗議失敗 (${data.disagreeCount} 票反對 vs ${data.agreeCount} 票同意)！維持原判，準備下一回合。`, 'error');
  }
});

// Protest Success Revert Game State
socket.on('protest-revert', (data) => {
  // Hide overlays if still open
  document.getElementById('overlay-round-end').classList.add('hidden');
  overlayProtestVote.classList.add('hidden');

  isDrawer = (data.role === 'drawer');
  isGameStageLocked = (data.stage === 'guess');

  // Restore canvas lock overlay
  if (isGameStageLocked) {
    canvasLockOverlay.classList.remove('hidden');
    drawingToolsBar.classList.add('hidden');
    guessForm.style.display = 'flex';
  } else {
    canvasLockOverlay.classList.add('hidden');
    if (isDrawer) {
      drawingToolsBar.classList.remove('hidden');
      guessForm.style.display = 'none';
    } else {
      drawingToolsBar.classList.add('hidden');
      guessForm.style.display = 'flex';
    }
  }

  // Restore Timer display properties
  document.getElementById('game-timer-text').innerText = `${data.timeLeft}s`;
  const timerBar = document.getElementById('timer-bar');
  const totalDuration = data.stage === 'draw' ? 120 : 60;
  const percentage = (data.timeLeft / totalDuration) * 100;
  timerBar.style.width = `${percentage}%`;

  if (isGameStageLocked) {
    timerBar.classList.add('locked');
  } else {
    timerBar.classList.remove('locked');
  }
});
