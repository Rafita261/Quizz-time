# QuizTime — Express + EJS

## Features
- Responsive home page, QR-code joining, and nickname-based entry (no player account required).
- Multiple-choice and true/false questions with a countdown timer for each question.
- Base points plus a configurable speed bonus.
- Leaderboard and results page.
- Admin dashboard: add/delete questions, configure duration and points, activate/deactivate questions, open/close the game, set the welcome message and speed bonus, and reset scores.
- Local JSON storage in `data/store.json` (created automatically on first launch).

## Getting started
Requirements: Node.js 18+.

```bash
npm install
cp .env.example .env
npm start
```

Open http://localhost:3000

## Default admin credentials
- Username: `admin`
- Password: `ChangeMe123!`

**Before deploying:** change `ADMIN_ID`, `ADMIN_PASSWORD`, and `SESSION_SECRET` in `.env`. The default password is for development only. Do not expose this configuration on the public internet as-is.

## QR code
The QR code is generated for `/join` using the hostname used to access the application. On a local network, use the server's LAN IP address, for example `http://192.168.1.20:3000/join`, and allow port 3000 through the firewall. Do not scan a QR code containing `localhost` from a phone: `localhost` refers to the phone itself.

## Scoring
- Correct answer: base points.
- Speed bonus: maximum bonus × (time remaining / duration), rounded.
- Incorrect answer or timeout: 0 points.

## MVP limitations
The timer runs in the browser and data is stored in a JSON file. For high-traffic events or high-stakes competitions, use a database (SQLite/PostgreSQL), server-side real-time synchronization, and stronger server-side validation. The admin page includes a setting for showing correct answers for future development, but this version does not automatically reveal correct answers after each question.

## Live quiz timing and presentation screen

- Each question has a server-controlled 14-second answer window.
- After the question closes, players wait 1 second before the next question starts.
- The presentation screen displays the completed question's answer distribution for 5 seconds, independently of the players' timeline. This means the first 4 seconds of the next question overlap with the previous results screen.
- Players can join while a quiz is running (when **Accept players** is enabled) and join the currently active question.
- In the admin dashboard, use **Restart quiz** to reset scores/answers and restart from question 1 after a 10-second countdown.
- Open `/presentation` on a separate display/projector for live results and the leaderboard.
