# Corta

Base de connaissance perso d'idées. Application Next.js (dossier `web/`) ; l'ancienne version Python (dossier `app/`) reste disponible en plan B jusqu'à la bascule.

## Lancer en local (Next.js)
```
cp .env.example .env   # puis renseigner APP_PASSWORD et SESSION_SECRET
cd web
npm ci
npm run build
set -a; . ../.env; set +a
node .next/standalone/server.js    # ou `npm run dev` pour le développement
```
Il faut Node 20+. En mode standalone, copier d'abord `web/.next/static` vers `web/.next/standalone/.next/static` et `web/lib/db/migrations` vers `web/.next/standalone/lib/db/migrations` (le Dockerfile le fait). Plus simple en local : `npm run dev`, puis http://localhost:3000. La base SQLite est créée dans `DATA_DIR` (`./data/app.db`) et les migrations s'appliquent au démarrage (idempotentes). L'app refuse de démarrer si `APP_PASSWORD` vaut `change-me` ou si `SESSION_SECRET` fait moins de 32 caractères.

## Tests
```
cd web && npm test && npm run typecheck
```

## Déploiement sur le NAS (Docker)
1. Copier le dépôt sur le NAS.
2. `cp .env.example .env` et renseigner `APP_PASSWORD` et `SESSION_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Mettre `COOKIE_SECURE=1` si l'accès se fait en HTTPS.
3. `docker compose up -d --build`
4. L'app écoute sur le port 3000. Les données vivent dans `./data` (volume monté dans `/data`) : sauvegarder ce dossier. Le conteneur tourne avec l'uid 1000, donc `./data` doit lui être accessible en écriture (`chown 1000 data`).
5. Si le NAS est exposé sur Internet, placer l'app derrière un reverse proxy HTTPS, puis mettre `COOKIE_SECURE=1` et `TRUST_PROXY=1`.

Architecture : l'image se construit sur la machine qui lance `docker compose` (x86_64 ou ARM64 du NAS) ; `better-sqlite3` est épinglé en `^11` pour disposer d'un binaire précompilé Node 20, et l'étape de build utilise `node:20` complet pour pouvoir compiler en secours. À vérifier au premier `docker compose up -d --build` sur le NAS.

La base existante créée par la version Python est reprise telle quelle (même fichier `data/app.db`, même schéma). Pour revenir à la version Python : `docker compose stop web`, puis `docker compose --profile legacy up -d --build corta` (port 8000). Ne jamais lancer les deux en même temps.

## Sessions et sécurité
- Changer `SESSION_SECRET` invalide toutes les sessions existantes.
- Après 5 mots de passe erronés en 15 min, `/api/login` répond 429, même avec le bon mot de passe. Le compteur est en mémoire (remis à zéro au redémarrage). Sans `TRUST_PROXY=1`, il y a un seul compteur global ; avec, un compteur par IP (`X-Forwarded-For`), à n'activer que derrière un proxy de confiance.
- Le cookie de session est `HttpOnly`, `SameSite=Lax` (et `Secure` avec `COOKIE_SECURE=1`).

## Ancienne version Python
`python3 -m app.server` (port 8000) et `python3 -m unittest`. Voir `CLAUDE.md`.
