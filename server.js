const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 5000,
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Word Lists
const charactersAndAnimals = [
  '哆啦A夢', '皮卡丘', '蠟筆小新', '櫻桃小丸子', '孫悟空',
  '魯夫', '鳴人', '柯南', '龍貓', '喬巴',
  '史迪奇', '熊貓', '獅子', '老虎', '大象',
  '長頸鹿', '企鵝', '海豚', '無尾熊', '兔子',
  '貓咪', '狗狗', '狐狸', '猴子', '松鼠',
  '倉鼠', '恐龍', '樹懶', '河馬', '斑馬'
];

const actions = [
  '游泳', '唱歌', '跳舞', '跑步', '睡覺',
  '吃東西', '打籃球', '騎自行車', '畫畫', '看書',
  '哭泣', '拍照', '玩遊戲', '爬樹', '刷牙',
  '洗澡', '打噴嚏', '飛翔', '釣魚', '彈吉他'
];

// Room State Storage
const rooms = {};

// Helper: Generate random nickname
function generateRandomNickname() {
  const adjectives = ['可愛的', '閃耀的', '憤怒的', '機智的', '慵懶的', '超酷的', '愛笑的', '神祕的', '奔跑的', '微笑的'];
  const nouns = ['皮卡丘', '波霸珍奶', '小柴犬', '北極熊', '哈密瓜', '太空人', '小企鵝', '獨角獸', '棉花糖', '大飛龍'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}${noun}`;
}

// Helper: Get random word based on difficulty and avoid repetition
function getRandomWord(difficulty, usedWords = []) {
  let word = '';
  let attempts = 0;
  const maxAttempts = 100;
  
  do {
    if (difficulty === 'difficult') {
      const char = charactersAndAnimals[Math.floor(Math.random() * charactersAndAnimals.length)];
      const act = actions[Math.floor(Math.random() * actions.length)];
      word = char + act; // Combined phrase
    } else {
      // 50% character/animal, 50% action
      if (Math.random() < 0.5) {
        word = charactersAndAnimals[Math.floor(Math.random() * charactersAndAnimals.length)];
      } else {
        word = actions[Math.floor(Math.random() * actions.length)];
      }
    }
    attempts++;
  } while (usedWords.includes(word) && attempts < maxAttempts);

  return word;
}

// Broadcast active lobby list to everyone
function broadcastLobbyList() {
  const lobbyList = Object.values(rooms).map(room => ({
    id: room.id,
    name: room.name,
    difficulty: room.difficulty,
    playerCount: room.players.length,
    status: room.status,
  }));
  io.emit('lobbies-list', lobbyList);
}

// Broadcast room detailed state to room players
function broadcastRoomDetail(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('room-detail', {
    id: room.id,
    name: room.name,
    difficulty: room.difficulty,
    status: room.status,
    players: room.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      ready: p.ready,
      score: p.score,
      isHost: p.isHost
    })),
    currentDrawerId: room.status === 'playing' || room.status === 'round-end' 
      ? room.players[room.currentDrawerIndex]?.id 
      : null,
    stage: room.stage,
    timeLeft: room.timeLeft,
    currentWord: room.status === 'playing' ? null : room.currentWord
  });
}

// Run single round countdown timer
function startRoundTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.timerInterval) {
    clearInterval(room.timerInterval);
  }

  room.timerInterval = setInterval(() => {
    const activeRoom = rooms[roomId];
    if (!activeRoom || activeRoom.status !== 'playing') {
      clearInterval(room.timerInterval);
      return;
    }

    activeRoom.timeLeft--;

    io.to(roomId).emit('timer-update', {
      timeLeft: activeRoom.timeLeft,
      stage: activeRoom.stage
    });

    if (activeRoom.timeLeft <= 0) {
      if (activeRoom.stage === 'draw') {
        // Transition to guess-only stage
        activeRoom.stage = 'guess';
        activeRoom.timeLeft = 60;
        io.to(roomId).emit('stage-change', {
          stage: activeRoom.stage,
          timeLeft: activeRoom.timeLeft
        });
        
        io.to(roomId).emit('chat-message', {
          nickname: '系統',
          text: '作畫時間截止！畫板已鎖定，其他玩家還有 60 秒時間猜題！',
          isSystem: true
        });
      } else if (activeRoom.stage === 'guess') {
        // Time ran out completely - Drawer gets -1 point
        clearInterval(activeRoom.timerInterval);
        
        const drawer = activeRoom.players[activeRoom.currentDrawerIndex];
        if (drawer) {
          drawer.score -= 1;
        }

        io.to(roomId).emit('chat-message', {
          nickname: '系統',
          text: `時間到！無人猜中答案，正確答案是【${activeRoom.currentWord}】。畫手【${drawer ? drawer.nickname : ''}】被扣除 1 分！`,
          isSystem: true
        });

        endRound(roomId, null, drawer, false);
      }
    }
  }, 1000);
}

// End the current round
function endRound(roomId, winnerPlayer, penalizedDrawer, isManualApproval = false) {
  const room = rooms[roomId];
  if (!room) return;

  if (room.timerInterval) {
    clearInterval(room.timerInterval);
  }

  room.status = 'round-end';
  room.canProtest = isManualApproval;
  
  // Send round end event
  io.to(roomId).emit('round-end', {
    correctWord: room.currentWord,
    winnerNickname: winnerPlayer ? winnerPlayer.nickname : null,
    winnerId: winnerPlayer ? winnerPlayer.id : null,
    drawerNickname: room.players[room.currentDrawerIndex]?.nickname || '',
    drawerPenalty: !!penalizedDrawer,
    isManualApproval: isManualApproval,
    players: room.players
  });

  // Schedule next round trigger (unless protest pauses it)
  room.nextRoundTimeout = setTimeout(() => {
    startNextRoundOrGameOver(roomId);
  }, 5000);
}

function startNextRoundOrGameOver(roomId) {
  const activeRoom = rooms[roomId];
  if (!activeRoom) return;

  activeRoom.currentDrawerIndex++;

  if (activeRoom.currentDrawerIndex < activeRoom.players.length) {
    startRound(roomId);
  } else {
    // Game Over
    activeRoom.status = 'game-over';
    const leaderboard = [...activeRoom.players].sort((a, b) => b.score - a.score);
    
    io.to(roomId).emit('game-over', {
      leaderboard: leaderboard.map(p => ({
        nickname: p.nickname,
        score: p.score
      }))
    });
    
    broadcastRoomDetail(roomId);
    broadcastLobbyList();
  }
}

// Start a round
function startRound(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  room.status = 'playing';
  room.stage = 'draw';
  room.timeLeft = 120;
  
  // Choose random word that has not been used this session
  room.currentWord = getRandomWord(room.difficulty, room.usedWords);
  room.usedWords.push(room.currentWord);
  
  // Reset protest states
  room.canProtest = false;
  room.protested = false;
  room.recentGuesses = [];

  const drawer = room.players[room.currentDrawerIndex];
  if (!drawer) {
    room.status = 'game-over';
    broadcastRoomDetail(roomId);
    return;
  }

  // Clear drawing on all clients
  io.to(roomId).emit('clear-canvas');

  // Notify players
  room.players.forEach(p => {
    if (p.id === drawer.id) {
      io.to(p.id).emit('round-start', {
        role: 'drawer',
        word: room.currentWord,
        difficulty: room.difficulty,
        drawerNickname: drawer.nickname,
        timeLeft: room.timeLeft
      });
    } else {
      io.to(p.id).emit('round-start', {
        role: 'guesser',
        difficulty: room.difficulty,
        drawerNickname: drawer.nickname,
        timeLeft: room.timeLeft
      });
    }
  });

  io.to(roomId).emit('chat-message', {
    nickname: '系統',
    text: `第 ${room.currentDrawerIndex + 1} 回合開始！現在由【${drawer.nickname}】作畫。`,
    isSystem: true
  });

  startRoundTimer(roomId);
  broadcastRoomDetail(roomId);
}

io.on('connection', (socket) => {
  let currentRoomId = null;
  let userNickname = generateRandomNickname();

  // Socket initialization
  socket.emit('init-player', { nickname: userNickname });

  // Get current lobbies
  socket.on('get-lobbies', () => {
    broadcastLobbyList();
  });

  // Set custom nickname
  socket.on('set-nickname', (nickname) => {
    if (nickname && nickname.trim()) {
      userNickname = nickname.trim().substring(0, 15);
    }
    socket.emit('nickname-set', { nickname: userNickname });
  });

  // Create lobby room
  socket.on('create-room', ({ roomName, difficulty }) => {
    if (currentRoomId) {
      handleLeaveRoom(socket, currentRoomId);
    }

    const roomId = 'room_' + Math.random().toString(36).substr(2, 9);
    const difficultySetting = difficulty === 'difficult' ? 'difficult' : 'normal';
    const nameSetting = roomName && roomName.trim() ? roomName.trim().substring(0, 20) : `房間 #${Object.keys(rooms).length + 1}`;

    rooms[roomId] = {
      id: roomId,
      name: nameSetting,
      difficulty: difficultySetting,
      players: [{
        id: socket.id,
        nickname: userNickname,
        ready: false,
        score: 0,
        isHost: true
      }],
      status: 'lobby',
      currentDrawerIndex: 0,
      currentWord: '',
      stage: 'draw',
      timeLeft: 120,
      timerInterval: null,
      usedWords: [], // Used words logs for uniqueness
      recentGuesses: [], // Stores guesses for lookup
      canProtest: false,
      protested: false,
      protest: null,
      protestInterval: null,
      nextRoundTimeout: null,
      lastApprovedGuessText: ''
    };

    currentRoomId = roomId;
    socket.join(roomId);
    
    socket.emit('create-room-success', { roomId });
    broadcastRoomDetail(roomId);
    broadcastLobbyList();
  });

  // Join existing lobby room
  socket.on('join-room', (roomId) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('error-msg', '房間不存在！');
      return;
    }

    if (room.players.length >= 10) {
      socket.emit('error-msg', '房間已滿（最多 10 人）！');
      return;
    }

    if (room.status !== 'lobby') {
      socket.emit('error-msg', '遊戲已經開始！');
      return;
    }

    if (currentRoomId) {
      handleLeaveRoom(socket, currentRoomId);
    }

    room.players.push({
      id: socket.id,
      nickname: userNickname,
      ready: false,
      score: 0,
      isHost: false
    });

    currentRoomId = roomId;
    socket.join(roomId);

    socket.emit('join-room-success', { roomId });
    broadcastRoomDetail(roomId);
    broadcastLobbyList();

    io.to(roomId).emit('chat-message', {
      nickname: '系統',
      text: `${userNickname} 加入了房間。`,
      isSystem: true
    });
  });

  // Toggle ready status
  socket.on('toggle-ready', () => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.ready = !player.ready;
    broadcastRoomDetail(currentRoomId);

    const allReady = room.players.every(p => p.ready);
    if (allReady && room.players.length >= 1 && room.status === 'lobby') {
      room.players.forEach(p => {
        p.score = 0;
      });
      room.currentDrawerIndex = 0;
      room.usedWords = []; // Clear word usage log for new game
      startRound(currentRoomId);
    }
  });

  // Draw lines synchronization
  socket.on('draw-line', (drawData) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    if (room.status !== 'playing' || room.stage !== 'draw') return;

    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;

    socket.to(currentRoomId).emit('draw-line', drawData);
  });

  // Clear Canvas
  socket.on('clear-canvas', () => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    if (room.status !== 'playing' || room.stage !== 'draw') return;

    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;

    io.to(currentRoomId).emit('clear-canvas');
  });

  // Submit Guess
  socket.on('submit-guess', (guessText) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    if (room.status !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const drawer = room.players[room.currentDrawerIndex];
    if (drawer && drawer.id === socket.id) {
      return;
    }

    const cleanGuess = guessText.trim();
    if (!cleanGuess) return;

    // Check if correct
    if (cleanGuess === room.currentWord) {
      player.score += 1;
      
      io.to(currentRoomId).emit('chat-message', {
        nickname: '系統',
        text: `恭喜【${player.nickname}】答對了！答案就是【${room.currentWord}】！`,
        isSystem: true
      });

      endRound(currentRoomId, player, null, false);
    } else {
      const guessId = 'guess_' + Math.random().toString(36).substr(2, 9);
      
      // Store in recentGuesses for drawer synonym validation lookup
      room.recentGuesses.push({
        id: guessId,
        playerId: socket.id,
        text: cleanGuess
      });
      if (room.recentGuesses.length > 50) room.recentGuesses.shift();

      io.to(currentRoomId).emit('guess-received', {
        id: guessId,
        playerId: socket.id,
        nickname: player.nickname,
        text: cleanGuess
      });
    }
  });

  // Drawer approves a guess as correct (synonym)
  socket.on('approve-guess', ({ guessId, playerId }) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    if (room.status !== 'playing') return;

    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer || drawer.id !== socket.id) return;

    const winner = room.players.find(p => p.id === playerId);
    if (!winner) return;

    // Lookup approved guess text
    const foundGuess = room.recentGuesses.find(g => g.id === guessId);
    const guessText = foundGuess ? foundGuess.text : '相似答案';
    room.lastApprovedGuessText = guessText;

    // Save state for possible Protest/Revert
    room.preProtestStage = room.stage;
    room.preProtestTimeLeft = room.timeLeft;
    room.preProtestWinnerId = winner.id;
    room.preProtestWinnerScore = winner.score; // Store score BEFORE adding point
    room.preProtestDrawerId = drawer.id;
    room.preProtestDrawerScore = drawer.score;

    // Award point
    winner.score += 1;

    io.to(currentRoomId).emit('chat-message', {
      nickname: '系統',
      text: `畫手【${drawer.nickname}】判定【${winner.nickname}】的回答「${guessText}」正確！答案是【${room.currentWord}】。`,
      isSystem: true
    });

    // End round with Manual Approval flag true
    endRound(currentRoomId, winner, null, true);
  });

  // Submit Protest Event
  socket.on('submit-protest', () => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    
    // Protest is only valid in round-end state, if allowed, and hasn't already been triggered
    if (room.status !== 'round-end' || !room.canProtest || room.protested) return;

    // Drawer and the approved winner cannot protest
    const drawer = room.players[room.currentDrawerIndex];
    if ((drawer && drawer.id === socket.id) || socket.id === room.preProtestWinnerId) return;

    room.protested = true;
    room.canProtest = false;

    // Cancel next round scheduler
    if (room.nextRoundTimeout) {
      clearTimeout(room.nextRoundTimeout);
    }

    const protester = room.players.find(p => p.id === socket.id);
    const protesterName = protester ? protester.nickname : '玩家';
    const guesser = room.players.find(p => p.id === room.preProtestWinnerId);
    const guesserName = guesser ? guesser.nickname : '猜中者';

    // Initialize Protest voting state
    room.protest = {
      protesterId: socket.id,
      protesterNickname: protesterName,
      guesserId: room.preProtestWinnerId,
      guesserNickname: guesserName,
      guessText: room.lastApprovedGuessText,
      votes: {}, // socket.id -> 'agree' | 'disagree'
      timeLeft: 5
    };

    io.to(currentRoomId).emit('protest-start', {
      protesterNickname: protesterName,
      guesserNickname: guesserName,
      guessText: room.lastApprovedGuessText,
      timeLeft: 5
    });

    // Start protest 5s voting countdown
    if (room.protestInterval) clearInterval(room.protestInterval);
    
    room.protestInterval = setInterval(() => {
      const activeRoom = rooms[currentRoomId];
      if (!activeRoom || !activeRoom.protest) {
        clearInterval(activeRoom?.protestInterval);
        return;
      }

      activeRoom.protest.timeLeft--;
      io.to(currentRoomId).emit('protest-timer-update', {
        timeLeft: activeRoom.protest.timeLeft
      });

      if (activeRoom.protest.timeLeft <= 0) {
        clearInterval(activeRoom.protestInterval);
        
        // Count votes
        let agreeCount = 0;
        let disagreeCount = 0;
        
        Object.values(activeRoom.protest.votes).forEach(vote => {
          if (vote === 'agree') agreeCount++;
          if (vote === 'disagree') disagreeCount++;
        });

        io.to(currentRoomId).emit('chat-message', {
          nickname: '系統',
          text: `抗議投票結束。同意判定：${agreeCount} 票，反對判定（抗議）：${disagreeCount} 票。`,
          isSystem: true
        });

        // If Disagree strictly outvotes Agree
        if (disagreeCount > agreeCount) {
          // Protest SUCCEEDS: Revert score, restore game
          const winner = activeRoom.players.find(p => p.id === activeRoom.preProtestWinnerId);
          if (winner) {
            winner.score = activeRoom.preProtestWinnerScore; // Revert
          }

          activeRoom.status = 'playing';
          activeRoom.stage = activeRoom.preProtestStage;
          activeRoom.timeLeft = activeRoom.preProtestTimeLeft;

          io.to(currentRoomId).emit('protest-result', {
            success: true,
            agreeCount,
            disagreeCount
          });

          io.to(currentRoomId).emit('chat-message', {
            nickname: '系統',
            text: `抗議成功！收回加分，遊戲繼續！畫手繼續作畫。`,
            isSystem: true
          });

          // Sync game status back
          broadcastRoomDetail(currentRoomId);
          
          // Re-send state to players to restore drawing view
          const activeDrawer = activeRoom.players[activeRoom.currentDrawerIndex];
          activeRoom.players.forEach(p => {
            if (p.id === activeDrawer.id) {
              io.to(p.id).emit('protest-revert', {
                role: 'drawer',
                word: activeRoom.currentWord,
                difficulty: activeRoom.difficulty,
                drawerNickname: activeDrawer.nickname,
                timeLeft: activeRoom.timeLeft,
                stage: activeRoom.stage
              });
            } else {
              io.to(p.id).emit('protest-revert', {
                role: 'guesser',
                difficulty: activeRoom.difficulty,
                drawerNickname: activeDrawer.nickname,
                timeLeft: activeRoom.timeLeft,
                stage: activeRoom.stage
              });
            }
          });

          startRoundTimer(currentRoomId);

        } else {
          // Protest FAILS: Drawer's judgment holds, proceed to next round
          io.to(currentRoomId).emit('protest-result', {
            success: false,
            agreeCount,
            disagreeCount
          });

          io.to(currentRoomId).emit('chat-message', {
            nickname: '系統',
            text: `抗議失敗！維持畫手判定，準備進入下一回合。`,
            isSystem: true
          });

          // Go to next round after 2 seconds
          setTimeout(() => {
            startNextRoundOrGameOver(currentRoomId);
          }, 2000);
        }

        activeRoom.protest = null;
      }
    }, 1000);
  });

  // Submit Vote
  socket.on('submit-vote', (voteValue) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    if (!room.protest) return;

    if (voteValue === 'agree' || voteValue === 'disagree') {
      room.protest.votes[socket.id] = voteValue;

      // Count current votes
      let agreeCount = 0;
      let disagreeCount = 0;
      Object.values(room.protest.votes).forEach(v => {
        if (v === 'agree') agreeCount++;
        if (v === 'disagree') disagreeCount++;
      });

      io.to(currentRoomId).emit('vote-update', {
        agreeCount,
        disagreeCount
      });
    }
  });

  // Return to lobby from game over
  socket.on('return-to-lobby', () => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const room = rooms[currentRoomId];
    if (room.status !== 'game-over') return;

    room.status = 'lobby';
    room.players.forEach(p => {
      p.ready = false;
      p.score = 0;
    });
    room.usedWords = [];

    broadcastRoomDetail(currentRoomId);
    broadcastLobbyList();
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    if (currentRoomId) {
      handleLeaveRoom(socket, currentRoomId);
    }
  });
});

function handleLeaveRoom(socket, roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const playerIndex = room.players.findIndex(p => p.id === socket.id);
  if (playerIndex === -1) return;

  const player = room.players[playerIndex];
  room.players.splice(playerIndex, 1);

  io.to(roomId).emit('chat-message', {
    nickname: '系統',
    text: `${player.nickname} 離開了房間。`,
    isSystem: true
  });

  // If currently voting protest and protester or guesser left, cancel protest
  if (room.protest && (socket.id === room.protest.protesterId || socket.id === room.protest.guesserId)) {
    if (room.protestInterval) clearInterval(room.protestInterval);
    room.protest = null;
    io.to(roomId).emit('chat-message', {
      nickname: '系統',
      text: `抗議相關玩家離線，取消抗議投票，直接進入下一回合。`,
      isSystem: true
    });
    startNextRoundOrGameOver(roomId);
  }

  if (room.players.length === 0) {
    if (room.timerInterval) clearInterval(room.timerInterval);
    if (room.protestInterval) clearInterval(room.protestInterval);
    delete rooms[roomId];
  } else {
    if (player.isHost) {
      room.players[0].isHost = true;
      io.to(roomId).emit('chat-message', {
        nickname: '系統',
        text: `房主已更換為 ${room.players[0].nickname}。`,
        isSystem: true
      });
    }

    if (room.status === 'playing') {
      if (room.currentDrawerIndex >= room.players.length) {
        room.status = 'game-over';
        const leaderboard = [...room.players].sort((a, b) => b.score - a.score);
        io.to(roomId).emit('game-over', {
          leaderboard: leaderboard.map(p => ({
            nickname: p.nickname,
            score: p.score
          }))
        });
      } else {
        if (playerIndex <= room.currentDrawerIndex) {
          if (playerIndex === room.currentDrawerIndex) {
            io.to(roomId).emit('chat-message', {
              nickname: '系統',
              text: `目前畫手已離線，跳至下一回合！`,
              isSystem: true
            });
            
            if (room.currentDrawerIndex < room.players.length) {
              startRound(roomId);
            } else {
              room.status = 'game-over';
              const leaderboard = [...room.players].sort((a, b) => b.score - a.score);
              io.to(roomId).emit('game-over', {
                leaderboard: leaderboard.map(p => ({
                  nickname: p.nickname,
                  score: p.score
                }))
              });
            }
          } else {
            room.currentDrawerIndex--;
          }
        }
      }
    }

    broadcastRoomDetail(roomId);
  }

  broadcastLobbyList();
}

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
