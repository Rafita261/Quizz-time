const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-before-deploy';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  name: 'quiztime.sid', secret: SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 8 * 60 * 60 * 1000 }
}));

const seedQuestions = [
  { id: 1, type: 'qcm', text: "On average, how many close friends did a person have in 2001?", options: ['5', '10', '20', '50'], answer: '10', seconds: 14, points: 10, active: true },
  { id: 2, type: 'qcm', text: 'About how many times a day do we check our phones?', options: ['50 times', '100 times', '150 times', '300 times'], answer: '150 times', seconds: 14, points: 10, active: true },
  { id: 3, type: 'qcm', text: "What is the speaker's name?", options: ['Emma Watson', 'Allison Graham', 'Taylor Swift', 'Michelle Obama'], answer: 'Allison Graham', seconds: 14, points: 10, active: true },
  { id: 4, type: 'qcm', text: 'What simple challenge does she suggest?', options: ['10 minutes a day', 'One hour without screens', 'A day without speaking', 'A week without music'], answer: 'One hour without screens', seconds: 14, points: 10, active: true },
  { id: 5, type: 'qcm', text: "Name an example of an abbreviation mentioned in the video.", options: ['LOL', 'BRB', 'ASAP', 'FYI'], answer: 'LOL', seconds: 14, points: 10, active: true },
  { id: 6, type: 'tf', text: 'Texting while driving is now one of the top causes of death for teenagers, even more than drinking and driving.', options: ['True', 'False'], answer: 'True', seconds: 14, points: 10, active: true },
  { id: 7, type: 'tf', text: 'The speaker says that social media has no useful side and that we should stop using it completely.', options: ['True', 'False'], answer: 'False', seconds: 14, points: 10, active: true }
];

function loadStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { questions: seedQuestions, players: [], settings: { title: 'QuizTime', timeBonus: true, bonusMax: 5, showCorrectAnswer: true, lobbyMessage: 'Ready? Scan the QR code and join the game!', quizOpen: true }, nextId: 8 };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { questions: seedQuestions, players: [], settings: { title: 'QuizTime', timeBonus: true, bonusMax: 5, showCorrectAnswer: true, lobbyMessage: '', quizOpen: true }, nextId: 8 }; }
}
let store = loadStore();
// Shared quiz state: everyone uses the same start time.
let quizState = 'lobby';
let quizStartAt = null;
let startTimer = null;
let phase = 'lobby';
let currentQuestionIndex = -1;
let questionStartedAt = null;
let questionEndsAt = null;
let resultQuestionIndex = -1;
let resultsUntil = null;
let phaseTimer = null;
function publicQuizState() {
  return { state: quizState, startAt: quizStartAt, phase, questionIndex: currentQuestionIndex,
    questionStartedAt, questionEndsAt, resultQuestionIndex, resultsUntil,
    total: getPublicQuestions().length };
}
function emitQuizState() { io.emit('quiz-state', publicQuizState()); }
io.on('connection', socket => socket.emit('quiz-state', publicQuizState()));
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2)); }
function adminOnly(req, res, next) { if (!req.session.isAdmin) return res.redirect('/admin/login'); next(); }
function getPublicQuestions() { return store.questions.filter(q => q.active); }
function scoreFor(question, answer, elapsedSeconds) {
  if (String(answer) !== String(question.answer)) return 0;
  const remainingRatio = Math.max(0, (question.seconds - elapsedSeconds) / question.seconds);
  const bonus = store.settings.timeBonus ? Math.round(remainingRatio * Number(store.settings.bonusMax || 0)) : 0;
  return Number(question.points) + bonus;
}
function ensurePlayer(req, res, next) {
  if (!req.session.playerId) return res.redirect('/join');
  const player = store.players.find(p => p.id === req.session.playerId);
  if (!player) { req.session.playerId = null; return res.redirect('/join'); }
  req.player = player; next();
}

app.get('/', (req, res) => res.render('home', { settings: store.settings, questionsCount: getPublicQuestions().length }));
app.get('/join', (req, res) => {
  const joinUrl = `${req.protocol}://${req.get('host')}/join`;
  QRCode.toDataURL(joinUrl, { margin: 1, width: 220 }, (err, qr) => res.render('join', { qr, settings: store.settings, error: null }));
});
app.post('/join', (req, res) => {
  if (!store.settings.quizOpen) return res.status(403).render('message', { title: 'Game closed', message: 'The host is not accepting new players right now.', link: '/' });
  const nickname = String(req.body.nickname || '').trim().replace(/[<>]/g, '').slice(0, 18);
  if (nickname.length < 2) {
    return QRCode.toDataURL(`${req.protocol}://${req.get('host')}/join`, { margin: 1, width: 220 }, (err, qr) => res.status(400).render('join', { qr, settings: store.settings, error: 'Choose a nickname between 2 and 18 characters.' }));
  }
  const id = require('crypto').randomBytes(12).toString('hex');
  store.players.push({ id, nickname, score: 0, answers: [], joinedAt: Date.now() });
  save(); req.session.playerId = id; res.redirect('/play');
});
function beginQuestion(index) {
  const questions = getPublicQuestions();
  if (index >= questions.length) {
    quizState = 'finished'; phase = 'finished'; questionStartedAt = null; questionEndsAt = null;
    emitQuizState(); return;
  }
  quizState = 'started'; phase = 'question'; currentQuestionIndex = index;
  questionStartedAt = Date.now(); questionEndsAt = questionStartedAt + 14000;
  resultQuestionIndex = index - 1;
  emitQuizState();
  if (phaseTimer) clearTimeout(phaseTimer);
  phaseTimer = setTimeout(() => finishQuestion(index), Math.max(0, questionEndsAt - Date.now()));
}
function finishQuestion(index) {
  if (quizState !== 'started' || currentQuestionIndex !== index || phase !== 'question') return;
  const question = getPublicQuestions()[index];
  if (!question) return;
  // Missing answers become explicit timeouts; no client can submit after the shared deadline.
  for (const player of store.players) {
    if (!player.answers.some(a => a.questionId === question.id)) {
      player.answers.push({ questionId: question.id, answer: '', correct: false, points: 0, elapsedSeconds: 14, timedOut: true });
    }
  }
  save();
  phase = 'results'; resultQuestionIndex = index; resultsUntil = Date.now() + 5000;
  emitQuizState();
  if (phaseTimer) clearTimeout(phaseTimer);
  // Player timeline: 1-second break, independently of the 5-second presentation results.
  phaseTimer = setTimeout(() => beginQuestion(index + 1), 1000);
}
function resetAndStartQuiz() {
  if (startTimer) clearTimeout(startTimer);
  if (phaseTimer) clearTimeout(phaseTimer);
  store.players.forEach(player => { player.score = 0; player.answers = []; });
  save(); currentQuestionIndex = -1; questionStartedAt = null; questionEndsAt = null;
  resultQuestionIndex = -1; resultsUntil = null; phase = 'countdown'; quizState = 'countdown';
  quizStartAt = Date.now() + 10000; emitQuizState();
  startTimer = setTimeout(() => { quizStartAt = null; beginQuestion(0); }, Math.max(0, quizStartAt - Date.now()));
}
app.get('/play', ensurePlayer, (req, res) => {
  const questions = getPublicQuestions();
  if (quizState === 'lobby' || quizState === 'countdown') {
    return res.render('play', { player: req.player, question: null, index: 0, total: questions.length, settings: store.settings, quizState, quizStartAt, phase, questionStartedAt, questionEndsAt, alreadyAnswered: false });
  }
  if (quizState === 'finished') return res.redirect('/result');
  const question = questions[currentQuestionIndex];
  if (!question || phase !== 'question' || Date.now() >= questionEndsAt) {
    return res.render('play', { player: req.player, question: null, index: Math.max(0, currentQuestionIndex + 1), total: questions.length, settings: store.settings, quizState, quizStartAt, phase, questionStartedAt, questionEndsAt, alreadyAnswered: false });
  }
  const alreadyAnswered = req.player.answers.some(a => a.questionId === question.id);
  res.render('play', { player: req.player, question: alreadyAnswered ? null : question, index: currentQuestionIndex + 1, total: questions.length, settings: store.settings, quizState, quizStartAt, phase, questionStartedAt, questionEndsAt, alreadyAnswered });
});
app.post('/answer', ensurePlayer, (req, res) => {
  if (quizState !== 'started' || phase !== 'question' || Date.now() >= questionEndsAt) return res.redirect('/play');
  const question = getPublicQuestions()[currentQuestionIndex];
  if (!question || question.id !== Number(req.body.questionId)) return res.redirect('/play');
  if (req.player.answers.some(a => a.questionId === question.id)) return res.redirect('/play');
  const elapsed = Math.max(0, Math.min(14, (Date.now() - questionStartedAt) / 1000));
  const answer = String(req.body.answer || '');
  const points = scoreFor({ ...question, seconds: 14 }, answer, elapsed);
  req.player.answers.push({ questionId: question.id, answer, correct: answer === String(question.answer), points, elapsedSeconds: elapsed });
  req.player.score += points; save(); res.redirect('/play');
});
app.get('/presentation', (req, res) => res.render('presentation', { settings: store.settings, state: publicQuizState(), data: presentationData() }));
function presentationData() {
  const questions = getPublicQuestions();
  const qi = resultQuestionIndex;
  const question = qi >= 0 ? questions[qi] : null;
  const answers = question ? store.players.map(p => ({ player: p, answer: p.answers.find(a => a.questionId === question.id) })).filter(x => x.answer && !x.answer.timedOut) : [];
  const distribution = question ? question.options.map(option => ({ option, count: answers.filter(x => x.answer.answer === option).length })) : [];
  const ranking = [...store.players].sort((a,b) => b.score-a.score || a.joinedAt-b.joinedAt).map((p,i)=>({ rank:i+1, nickname:p.nickname, score:p.score }));
  return { phase, state: quizState, questionNumber: qi + 1, total: questions.length, questionText: question ? question.text : null,
    correctAnswer: question && store.settings.showCorrectAnswer ? question.answer : null, distribution, ranking, resultsUntil,
    questionIndex: currentQuestionIndex, questionEndsAt, questionStartedAt, startAt: quizStartAt };
}
app.get('/presentation-data', (req, res) => res.json(presentationData()));
app.get('/result', ensurePlayer, (req, res) => {
  const ranking = [...store.players].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  const position = ranking.findIndex(p => p.id === req.player.id) + 1;
  res.render('result', { player: req.player, position, totalPlayers: ranking.length, settings: store.settings });
});
app.get('/leaderboard', (req, res) => {
  const players = [...store.players].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  res.render('leaderboard', { players, currentId: req.session.playerId || null, settings: store.settings });
});
app.post('/logout-player', (req, res) => { req.session.playerId = null; res.redirect('/join'); });

app.get('/admin/login', (req, res) => res.render('admin-login', { error: null }));
app.post('/admin/login', async (req, res) => {
  const id = String(req.body.adminId || '');
  const password = String(req.body.password || '');
  if (id === ADMIN_ID && password === ADMIN_PASSWORD) { req.session.isAdmin = true; return req.session.save(err => err ? res.status(500).send('Session error') : res.redirect('/admin')); }
  res.status(401).render('admin-login', { error: 'Incorrect username or password.' });
});
app.post('/admin/start-quiz', adminOnly, (req, res) => {
  if (!getPublicQuestions().length) return res.status(400).send('Add at least one active question before starting the quiz.');
  resetAndStartQuiz(); res.redirect('/admin');
});
app.post('/admin/logout', adminOnly, (req, res) => { req.session.isAdmin = false; res.redirect('/'); });
app.get('/admin', adminOnly, (req, res) => res.render('admin', { questions: store.questions, players: [...store.players].sort((a,b)=>b.score-a.score), settings: store.settings, message: null, quizState, quizStartAt }));
app.post('/admin/question', adminOnly, (req, res) => {
  const id = Number(req.body.id);
  const type = req.body.type === 'tf' ? 'tf' : 'qcm';
  const text = String(req.body.text || '').trim().slice(0, 500);
  const options = type === 'tf' ? ['True', 'False'] : String(req.body.options || '').split('\n').map(s=>s.trim()).filter(Boolean).slice(0, 8);
  const answer = String(req.body.answer || '').trim();
  const seconds = Math.max(5, Math.min(300, Number(req.body.seconds) || 30));
  const points = Math.max(1, Math.min(1000, Number(req.body.points) || 10));
  if (!text || options.length < 2 || !options.includes(answer)) return res.status(400).render('admin', { questions: store.questions, players: [...store.players].sort((a,b)=>b.score-a.score), settings: store.settings, message: 'Check the question, answer choices, and correct answer.', quizState, quizStartAt });
  if (id) {
    const q = store.questions.find(q => q.id === id);
    if (q) Object.assign(q, { type, text, options, answer, seconds, points, active: req.body.active === 'on' });
  } else store.questions.push({ id: store.nextId++, type, text, options, answer, seconds, points, active: req.body.active === 'on' });
  save(); res.redirect('/admin');
});
app.post('/admin/question/:id/delete', adminOnly, (req, res) => { store.questions = store.questions.filter(q => q.id !== Number(req.params.id)); save(); res.redirect('/admin'); });
app.post('/admin/settings', adminOnly, (req, res) => {
  store.settings.title = String(req.body.title || 'QuizTime').slice(0, 60);
  store.settings.lobbyMessage = String(req.body.lobbyMessage || '').slice(0, 200);
  store.settings.timeBonus = req.body.timeBonus === 'on';
  store.settings.bonusMax = Math.max(0, Math.min(50, Number(req.body.bonusMax) || 0));
  store.settings.showCorrectAnswer = req.body.showCorrectAnswer === 'on';
  store.settings.quizOpen = req.body.quizOpen === 'on';
  save(); res.redirect('/admin');
});
app.post('/admin/reset-scores', adminOnly, (req, res) => { store.players = []; save(); res.redirect('/admin'); });
app.use((req, res) => res.status(404).render('message', { title: 'Page not found', message: 'This page does not exist.', link: '/' }));

httpServer.listen(PORT, () => console.log(`QuizTime ready: http://localhost:${PORT}\nAdmin : ${ADMIN_ID} / ${ADMIN_PASSWORD}`));
