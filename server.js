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
  { id: 1, type: 'qcm', text: "On average, how many close friends did a person have in 2001?", options: ['5', '10', '20', '50'], answer: '10', seconds: 30, points: 10, active: true },
  { id: 2, type: 'qcm', text: 'About how many times a day do we check our phones?', options: ['50 times', '100 times', '150 times', '300 times'], answer: '150 times', seconds: 30, points: 10, active: true },
  { id: 3, type: 'qcm', text: "What is the speaker's name?", options: ['Emma Watson', 'Allison Graham', 'Taylor Swift', 'Michelle Obama'], answer: 'Allison Graham', seconds: 30, points: 10, active: true },
  { id: 4, type: 'qcm', text: 'What simple challenge does she suggest?', options: ['10 minutes a day', 'One hour without screens', 'A day without speaking', 'A week without music'], answer: 'One hour without screens', seconds: 30, points: 10, active: true },
  { id: 5, type: 'qcm', text: "Name an example of an abbreviation mentioned in the video.", options: ['LOL', 'BRB', 'ASAP', 'FYI'], answer: 'LOL', seconds: 30, points: 10, active: true },
  { id: 6, type: 'tf', text: 'Texting while driving is now one of the top causes of death for teenagers, even more than drinking and driving.', options: ['True', 'False'], answer: 'True', seconds: 45, points: 10, active: true },
  { id: 7, type: 'tf', text: 'The speaker says that social media has no useful side and that we should stop using it completely.', options: ['True', 'False'], answer: 'False', seconds: 45, points: 10, active: true }
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
function publicQuizState() { return { state: quizState, startAt: quizStartAt }; }
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
  if (quizState !== 'lobby') return res.status(403).render('message', { title: 'Quiz already started', message: 'The game has started. You can no longer join this session.', link: '/' });
  if (!store.settings.quizOpen) return res.status(403).render('message', { title: 'Game closed', message: 'The host is not accepting new players right now.', link: '/' });
  const nickname = String(req.body.nickname || '').trim().replace(/[<>]/g, '').slice(0, 18);
  if (nickname.length < 2) {
    return QRCode.toDataURL(`${req.protocol}://${req.get('host')}/join`, { margin: 1, width: 220 }, (err, qr) => res.status(400).render('join', { qr, settings: store.settings, error: 'Choose a nickname between 2 and 18 characters.' }));
  }
  const id = require('crypto').randomBytes(12).toString('hex');
  store.players.push({ id, nickname, score: 0, answers: [], joinedAt: Date.now() });
  save(); req.session.playerId = id; res.redirect('/play');
});
app.get('/play', ensurePlayer, (req, res) => {
  if (quizState !== 'started') {
    return res.render('play', { player: req.player, question: null, index: 0, total: getPublicQuestions().length, settings: store.settings, quizState, quizStartAt });
  }
  const questions = getPublicQuestions();
  const answered = req.player.answers.map(a => a.questionId);
  const next = questions.find(q => !answered.includes(q.id));
  if (!next) return res.redirect('/result');
  res.render('play', { player: req.player, question: next, index: answered.length + 1, total: questions.length, settings: store.settings, quizState, quizStartAt });
});
app.post('/answer', ensurePlayer, (req, res) => {
  if (quizState !== 'started') return res.redirect('/play');
  const question = getPublicQuestions().find(q => q.id === Number(req.body.questionId));
  if (!question) return res.redirect('/play');
  if (req.player.answers.some(a => a.questionId === question.id)) return res.redirect('/play');
  const elapsed = Math.max(0, Math.min(question.seconds, Number(req.body.elapsedSeconds) || 0));
  const answer = String(req.body.answer || '');
  const points = scoreFor(question, answer, elapsed);
  req.player.answers.push({ questionId: question.id, answer, correct: answer === String(question.answer), points, elapsedSeconds: elapsed });
  req.player.score += points; save(); res.redirect('/play');
});
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
  if (quizState === 'started') return res.redirect('/admin');
  if (quizState === 'countdown') return res.redirect('/admin');
  if (!getPublicQuestions().length) return res.status(400).send('Add at least one active question before starting the quiz.');
  quizState = 'countdown';
  quizStartAt = Date.now() + 10000;
  io.emit('quiz-state', publicQuizState());
  if (startTimer) clearTimeout(startTimer);
  startTimer = setTimeout(() => {
    quizState = 'started';
    io.emit('quiz-state', publicQuizState());
  }, Math.max(0, quizStartAt - Date.now()));
  res.redirect('/admin');
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
