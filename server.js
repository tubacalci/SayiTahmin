const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 dakika
        skipMiddlewares: true,
    }
});

// Yeni eklenen ping endpoint’i
app.get('/ping', (req, res) => {
    res.send('Awake!'); // Sunucunun uyanık olduğunu bildirir
});

app.use(express.static(__dirname));

const CONFIG = {
    TURN_DURATION: 30 * 1000,
    MAX_TUTANLAR: 1,
    NUMBER_LENGTH: 4,
    BULL_POINTS: 5,
    COW_POINTS: 2,
    CORRECT_GUESS_POINTS: 50,
    SPEED_BONUS_5: 10,
    SPEED_BONUS_10: 5,
    TUTANLAR_MIN_POINTS: 20,
    TUTANLAR_LONG_GAME_BONUS: 30,
    LONG_GAME_THRESHOLD: 10,
};

let players = {};
let teams = { tutanlar: [], bilenler: [] };
let readyPlayers = [];
let secretNumber = null;
let gameStarted = false;
let currentTurnIndex = 0;
let turnTimer = null;
let guessCount = 0;
let tutanlarPlayerId = null;
let playerOrder = [];

function sanitizeHTML(str) {
    return str.replace(/[&<>"'`=\/]/g, function (s) {
        return ({
            '&': '&',
            '<': '<',
            '>': '>',
            '"': '"',
            "'": '&#39;',
            '/': '/',
            '`': '`',
            '=': '='
        })[s];
    });
}

io.on('connection', (socket) => {
    console.log('Yeni bir oyuncu bağlandı:', socket.id);

    if (socket.recovered) {
        console.log('Bağlantı geri geldi:', socket.id);
        socket.emit('updatePlayers', { teams, players });
    }

    socket.on('setName', (name) => {
        players[socket.id] = { name, ready: false, score: 0 };
        if (!playerOrder.includes(socket.id)) {
            playerOrder.push(socket.id);
        }
        console.log(`Oyuncu eklendi: ${name} (${socket.id})`);
        io.emit('updatePlayers', { teams, players });
    });

    socket.on('joinTeam', ({ name, team }) => {
        if (teams.tutanlar.some(p => p.id === socket.id) || teams.bilenler.some(p => p.id === socket.id)) {
            socket.emit('alreadyInTeam', 'Zaten bir takıma katıldın!');
            return;
        }

        if (team === 'tutanlar' && teams.tutanlar.length >= CONFIG.MAX_TUTANLAR) {
            socket.emit('teamFull', 'Sayı Tutanlar takımı dolu!');
            return;
        }

        const player = { id: socket.id, name, ready: false };
        if (team === 'tutanlar') {
            teams.tutanlar.push(player);
            tutanlarPlayerId = socket.id;
        } else {
            teams.bilenler.push(player);
        }

        io.emit('updatePlayers', { teams, players });
    });

    socket.on('changeTeam', ({ name, team }) => {
        if (gameStarted) return;

        if (team === 'tutanlar' && teams.tutanlar.length >= CONFIG.MAX_TUTANLAR) {
            socket.emit('teamFull', 'Sayı Tutanlar takımı dolu!');
            return;
        }

        teams.tutanlar = teams.tutanlar.filter(p => p.id !== socket.id);
        teams.bilenler = teams.bilenler.filter(p => p.id !== socket.id);
        const player = { id: socket.id, name, ready: false };

        if (team === 'tutanlar') {
            teams.tutanlar.push(player);
            tutanlarPlayerId = socket.id;
        } else {
            teams.bilenler.push(player);
        }

        readyPlayers = readyPlayers.filter(id => id !== socket.id);
        players[socket.id].ready = false;

        io.emit('updatePlayers', { teams, players });
    });

    socket.on('playerReady', () => {
        if (!readyPlayers.includes(socket.id) && !gameStarted) {
            readyPlayers.push(socket.id);
            players[socket.id].ready = true;
            updatePlayerReadyStatus(socket.id, true);
            checkAllReady();
        }
    });

    socket.on('cancelReady', () => {
        if (readyPlayers.includes(socket.id) && !gameStarted) {
            readyPlayers = readyPlayers.filter(id => id !== socket.id);
            players[socket.id].ready = false;
            updatePlayerReadyStatus(socket.id, false);
        }
    });

    socket.on('setSecretNumber', (number) => {
        if (!teams.tutanlar.some(p => p.id === socket.id) || secretNumber) return;

        if (number.length !== CONFIG.NUMBER_LENGTH || isNaN(number)) {
            socket.emit('error', 'Lütfen 4 basamaklı bir sayı gir!');
            return;
        }

        secretNumber = number;
        gameStarted = true;
        guessCount = 0;

        io.emit('numberSet');
        updateTurn();
    });

    socket.on('guess', (guess) => {
        if (!gameStarted || !teams.bilenler.some(p => p.id === socket.id)) return;
        if (teams.bilenler[currentTurnIndex].id !== socket.id) return;

        if (guess.length !== CONFIG.NUMBER_LENGTH || isNaN(guess)) {
            socket.emit('error', 'Geçersiz tahmin!');
            return;
        }

        clearTurnTimer();
        guessCount++;

        let bulls = 0;
        let cows = 0;
        const secretArray = secretNumber.split('');
        const guessArray = guess.split(''); // guessArray burada tanımlı hale getirildi

        for (let i = 0; i < CONFIG.NUMBER_LENGTH; i++) {
            if (secretArray[i] === guessArray[i]) {
                bulls++;
                secretArray[i] = guessArray[i] = null;
            }
        }

        for (let i = 0; i < CONFIG.NUMBER_LENGTH; i++) {
            if (guessArray[i] !== null) {
                const index = secretArray.indexOf(guessArray[i]);
                if (index !== -1) {
                    cows++;
                    secretArray[index] = null;
                }
            }
        }

        players[socket.id].score += bulls * CONFIG.BULL_POINTS + cows * CONFIG.COW_POINTS;
        if (tutanlarPlayerId) {
            players[tutanlarPlayerId].score -= (bulls + cows);
        }

        io.emit('result', {
            player: players[socket.id].name,
            guess,
            bulls,
            cows,
            guessCount
        });

        if (bulls === CONFIG.NUMBER_LENGTH) {
            players[socket.id].score += CONFIG.CORRECT_GUESS_POINTS;
            if (guessCount <= 5) players[socket.id].score += CONFIG.SPEED_BONUS_5;
            else if (guessCount <= 10) players[socket.id].score += CONFIG.SPEED_BONUS_10;

            if (players[tutanlarPlayerId].score < 0) {
                players[tutanlarPlayerId].score = 0;
            }
            players[tutanlarPlayerId].score += CONFIG.TUTANLAR_MIN_POINTS;

            io.emit('gameOver', {
                winner: players[socket.id].name,
                number: secretNumber,
                scores: Object.fromEntries(Object.entries(players).map(([id, p]) => [p.name, p.score]))
            });

            rotateTeams();
            resetGame();
        } else {
            if (guessCount >= CONFIG.LONG_GAME_THRESHOLD && tutanlarPlayerId) {
                players[tutanlarPlayerId].score += CONFIG.TUTANLAR_LONG_GAME_BONUS;
            }

            currentTurnIndex = (currentTurnIndex + 1) % teams.bilenler.length;
            updateTurn();
        }
    });

    socket.on('chatMessage', (data) => {
        io.emit('chatMessage', {
            name: sanitizeHTML(data.name),
            message: sanitizeHTML(data.message),
            team: data.team
        });
    });

    socket.on('restartGame', () => {
        resetGame();
        io.emit('gameRestarted');
    });

    socket.on('disconnect', () => {
        const player = players[socket.id];
        if (player) {
            io.emit('chatMessage', {
                name: 'Sistem',
                message: `${player.name} oyundan ayrıldı.`,
                team: 'all'
            });
        }

        teams.tutanlar = teams.tutanlar.filter(p => p.id !== socket.id);
        teams.bilenler = teams.bilenler.filter(p => p.id !== socket.id);
        readyPlayers = readyPlayers.filter(id => id !== socket.id);
        playerOrder = playerOrder.filter(id => id !== socket.id);
        if (tutanlarPlayerId === socket.id) {
            tutanlarPlayerId = null;
        }
        delete players[socket.id];

        io.emit('updatePlayers', { teams, players });

        if (gameStarted && teams.bilenler.length === 0) {
            io.emit('gameOver', {
                winner: 'Sayı Tutanlar (rakip kalmadı)',
                number: secretNumber,
                scores: Object.fromEntries(Object.entries(players).map(([id, p]) => [p.name, p.score]))
            });
            rotateTeams();
            resetGame();
        }
    });
});

// Yardımcı Fonksiyonlar
function updatePlayerReadyStatus(id, ready) {
    ['tutanlar', 'bilenler'].forEach(team => {
        teams[team] = teams[team].map(p => p.id === id ? { ...p, ready } : p);
    });
    io.emit('updatePlayers', { teams, players });
}

function checkAllReady() {
    const total = teams.tutanlar.length + teams.bilenler.length;
    if (total > 1 && readyPlayers.length === total) {
        io.emit('gameStart');
    }
}

function updateTurn() {
    if (teams.bilenler.length === 0) return;
    const currentPlayer = teams.bilenler[currentTurnIndex].name;
    io.emit('updateTurn', { currentPlayer, timeLeft: CONFIG.TURN_DURATION / 1000 });
    startTurnTimer();
}

function startTurnTimer() {
    clearTurnTimer();
    turnTimer = setTimeout(() => {
        currentTurnIndex = (currentTurnIndex + 1) % teams.bilenler.length;
        io.emit('turnTimeout', teams.bilenler[currentTurnIndex].name);
        updateTurn();
    }, CONFIG.TURN_DURATION);
}

function clearTurnTimer() {
    if (turnTimer) clearTimeout(turnTimer);
}

function rotateTeams() {
    if (playerOrder.length <= 1) return;
    const currentIndex = playerOrder.indexOf(tutanlarPlayerId);
    const nextIndex = (currentIndex + 1) % playerOrder.length;
    tutanlarPlayerId = playerOrder[nextIndex];

    teams.tutanlar = [{ id: tutanlarPlayerId, name: players[tutanlarPlayerId].name, ready: false }];
    teams.bilenler = playerOrder
        .filter(id => id !== tutanlarPlayerId)
        .map(id => ({ id, name: players[id].name, ready: false }));

    io.emit('teamsRotated', {
        newTutanlar: players[tutanlarPlayerId].name,
        teams
    });
}

function resetGame() {
    secretNumber = null;
    gameStarted = false;
    readyPlayers = [];
    currentTurnIndex = 0;
    guessCount = 0;
    clearTurnTimer();
    Object.keys(players).forEach(id => players[id].ready = false);
    io.emit('updatePlayers', { teams, players });
}

server.listen(3000, () => {
    console.log('🚀 Sunucu 3000 portunda çalışıyor...');
});