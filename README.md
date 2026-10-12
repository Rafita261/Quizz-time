# QuizTime — Express + EJS

## Fonctionnalités
- Interface responsive d'accueil, entrée par QR code et pseudonyme (sans compte joueur).
- QCM et Vrai/Faux, compte à rebours par question.
- Points de base + bonus de rapidité configurable.
- Classement et page de résultat.
- Tableau de bord admin : ajouter/supprimer des questions, régler durée/points, activer/désactiver les questions, ouvrir/fermer la partie, message d'accueil, bonus de temps, réinitialiser les scores.
- Stockage JSON local dans `data/store.json` (créé automatiquement au premier lancement).

## Démarrer
Prérequis : Node.js 18+.

```bash
npm install
cp .env.example .env
npm start
```

Ouvrir http://localhost:3000

## Identifiants admin par défaut
- Identifiant : `admin`
- Mot de passe : `ChangeMe123!`

**À faire avant toute mise en ligne :** modifier `ADMIN_ID`, `ADMIN_PASSWORD` et `SESSION_SECRET` dans `.env`. Le mot de passe par défaut est uniquement pour le développement. Ne pas exposer cette configuration telle quelle sur Internet.

## QR code
Le QR code est généré pour l'URL `/join` à partir du nom d'hôte utilisé pour accéder à l'application. Sur un réseau local, utilisez l'adresse IP LAN du serveur, par exemple `http://192.168.1.20:3000/join`, et autorisez le port 3000 dans le pare-feu. Ne scannez pas un QR code avec `localhost` depuis un téléphone : `localhost` désigne le téléphone lui-même.

## Points
- Réponse correcte : points de base.
- Bonus de rapidité : bonus maximum × (temps restant / durée), arrondi.
- Réponse incorrecte ou temps écoulé : 0 point.

## Limites de cette version MVP
Le chronomètre est exécuté côté navigateur et le stockage est un fichier JSON : pour un événement à fort trafic ou une compétition sensible, utiliser une base de données (SQLite/PostgreSQL), synchronisation temps réel côté serveur et validation serveur renforcée. La page admin propose un paramètre de correction pour préparer une évolution, mais cette version ne révèle pas automatiquement les bonnes réponses après chaque question.
