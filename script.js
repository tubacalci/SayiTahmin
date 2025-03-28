const socket = io();
const jsConfetti = new JSConfetti();
let myName = null;
let myTeam = null;
let isReady = false;
let gameStarted = false;
let timerInterval = null;
let players = {};

function sanitizeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function showError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 3000);
}

function toggleLeaderboard() {
  const panel = document.getElementById("leaderboardDisplay");
  panel.style.display = panel.style.display === "block" ? "none" : "block";
}

function submitName() {
  const input = document.getElementById("playerName");
  myName = input.value.trim();
  if (!myName) return showError("playerNameError", "İsim gerekli!");
  socket.emit("setName", myName);
  document.getElementById("nameSelection").classList.add("hidden");
  document.getElementById("teamSelection").classList.remove("hidden");
}

function joinTeam(team) {
  myTeam = team;
  socket.emit("joinTeam", { name: myName, team });
  document.getElementById("teamSelection").classList.add("hidden");
  document.getElementById("gameArea").classList.remove("hidden");
  document.getElementById("changeTeamButton").classList.remove("hidden");
  document.getElementById("readyButton").classList.remove("hidden");
}

function changeTeam() {
  if (gameStarted) return;
  const newTeam = myTeam === "tutanlar" ? "bilenler" : "tutanlar";
  myTeam = newTeam;
  isReady = false;
  socket.emit("changeTeam", { name: myName, team: newTeam });
  document.getElementById("readyButton").innerHTML = "Hazır";
  document.getElementById("readyButton").disabled = false;
  document.getElementById("cancelReadyButton").classList.add("hidden");
}

function setReady() {
  if (gameStarted || isReady) return;
  isReady = true;
  socket.emit("playerReady");
  document.getElementById("readyButton").innerHTML = "Hazır (Bekleniyor)";
  document.getElementById("readyButton").disabled = true;
  document.getElementById("cancelReadyButton").classList.remove("hidden");
}

function cancelReady() {
  if (!isReady || gameStarted) return;
  isReady = false;
  socket.emit("cancelReady");
  document.getElementById("readyButton").innerHTML = "Hazır";
  document.getElementById("readyButton").disabled = false;
  document.getElementById("cancelReadyButton").classList.add("hidden");
}

function setSecretNumber() {
  const number = document.getElementById("secretNumber").value.trim();
  if (number.length !== 4 || isNaN(number)) return showError("secretNumberError", "4 basamaklı sayı gir!");
  socket.emit("setSecretNumber", number);
  document.getElementById("tutanlarControls").classList.add("hidden");
}

function checkGuess() {
  const guess = document.getElementById("guess").value.trim();
  if (guess.length !== 4 || isNaN(guess)) return showError("guessError", "4 basamaklı sayı gir!");
  socket.emit("guess", guess);
  document.getElementById("guess").value = "";
}

function startTimer(seconds) {
  const timer = document.getElementById("timer");
  clearInterval(timerInterval);
  let timeLeft = seconds;
  timer.style.display = "block";
  timer.innerHTML = `Kalan Süre: ${timeLeft}s`;
  timerInterval = setInterval(() => {
    timeLeft--;
    timer.innerHTML = `Kalan Süre: ${timeLeft}s`;
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timer.style.display = "none";
    }
  }, 1000);
}

function addResult(message) {
  const div = document.getElementById("result");
  const msg = document.createElement("div");
  msg.innerHTML = message;
  div.appendChild(msg);
  div.scrollTop = div.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById("chatInput");
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit("chatMessage", { name: myName, message: msg, team: myTeam });
  input.value = "";
}

function showRules() {
  document.getElementById("rulesModal").style.display = "flex";
}

function closeRules() {
  document.getElementById("rulesModal").style.display = "none";
}

function restartGame() {
  socket.emit("restartGame");
  document.getElementById("gameOverModal").style.display = "none";
}

// 🔌 SOCKET EVENTS
socket.on("updatePlayers", ({ teams, players: updated }) => {
  players = updated;

  const tutanlarHTML = teams.tutanlar.map(p =>
    `<div class="player-card ${p.name === myName ? 'my-name' : ''}">${sanitizeHTML(p.name)} ${p.ready ? '<span class="ready">Hazır</span>' : ''}</div>`).join('');
  const bilenlerHTML = teams.bilenler.map(p =>
    `<div class="player-card ${p.name === myName ? 'my-name' : ''}">${sanitizeHTML(p.name)} ${p.ready ? '<span class="ready">Hazır</span>' : ''}</div>`).join('');

  document.getElementById("tutanlar").innerHTML = tutanlarHTML;
  document.getElementById("bilenler").innerHTML = bilenlerHTML;

  updateLeaderboard(players);
});

socket.on("teamFull", msg => alert(msg));
socket.on("alreadyInTeam", msg => alert(msg));
socket.on("notification", msg => {
  const el = document.getElementById("notification");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
});

socket.on("gameStart", () => {
  gameStarted = true;
  setTimeout(() => {
    document.getElementById("readyButton").classList.add("hidden");
    document.getElementById("cancelReadyButton").classList.add("hidden");
    document.getElementById("changeTeamButton").classList.add("hidden");
    document.getElementById("gameControls").classList.remove("hidden");
    if (myTeam === "tutanlar") {
      document.getElementById("tutanlarControls").classList.remove("hidden");
    } else {
      document.getElementById("bilenlerControls").classList.remove("hidden");
    }
  }, 1000);
});

socket.on("numberSet", () => {
  addResult("Sayı belirlendi! Tahmin başlayabilir.");
});

socket.on("updateTurn", ({ currentPlayer, timeLeft }) => {
  const turnEl = document.getElementById("turnDisplay");
  turnEl.style.display = "block";
  turnEl.textContent = `Sıra: ${sanitizeHTML(currentPlayer)}`;
  const guessInput = document.getElementById("guess");
  const guessBtn = document.getElementById("guessButton");

  if (myName === currentPlayer) {
    guessInput.disabled = false;
    guessBtn.disabled = false;
    document.getElementById("turnInfo").textContent = "Sıra sende!";
  } else {
    guessInput.disabled = true;
    guessBtn.disabled = true;
    document.getElementById("turnInfo").textContent = `Sıra: ${sanitizeHTML(currentPlayer)}`;
  }

  startTimer(timeLeft);
});

socket.on("result", ({ player, guess, bulls, cows, guessCount }) => {
  addResult(`Tahmin ${guessCount}: ${sanitizeHTML(player)} → ${guess} <span class="bull">${bulls} boğa</span>, <span class="cow">${cows} inek</span>`);
});

socket.on("gameOver", ({ winner, number, scores }) => {
  document.getElementById("gameOverMessage").textContent = `Kazanan: ${sanitizeHTML(winner)}, Sayı: ${number}`;
  document.getElementById("gameOverModal").style.display = "flex";
  jsConfetti.addConfetti();
  gameStarted = false;

  let html = "<h3>Lider Tablosu</h3>";
  for (const [name, score] of Object.entries(scores)) {
    html += `<p>${sanitizeHTML(name)}: ${score} puan</p>`;
  }
  document.getElementById("leaderboard").innerHTML = html;
});

socket.on("chatMessage", ({ name, message, team }) => {
  const msg = document.createElement("div");
  msg.className = `${team}-message`;
  msg.textContent = `${name}: ${message}`;
  document.getElementById("chatArea").appendChild(msg);
  setTimeout(() => msg.remove(), 8000);
});

socket.on("gameRestarted", () => {
  gameStarted = false;
  document.getElementById("gameArea").classList.add("hidden");
  document.getElementById("teamSelection").classList.remove("hidden");
  document.getElementById("result").innerHTML = "";
  document.getElementById("turnDisplay").style.display = "none";
});

function updateLeaderboard(playersData) {
  const leaderboardContent = document.getElementById("leaderboardContent");
  const scores = Object.values(playersData).map(p => ({ name: p.name, score: p.score }));
  scores.sort((a, b) => b.score - a.score);
  leaderboardContent.innerHTML = scores.map(p => `<p>${sanitizeHTML(p.name)}: <span>${p.score}</span></p>`).join('');
}
