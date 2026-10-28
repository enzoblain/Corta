# Corta

Base de connaissance perso d'idées. Python 3.12, bibliothèque standard uniquement.

## Lancer en local
```
cp .env.example .env   # puis renseigner APP_PASSWORD et SESSION_SECRET
set -a; . ./.env; set +a
python3 -m app.server
```
Ouvrir http://localhost:8000. La base SQLite est créée dans `./data/app.db` et les migrations s'appliquent au démarrage (idempotentes).

## Tests
```
python3 -m unittest
```

## Déploiement sur le NAS (Docker)
1. Copier le dépôt sur le NAS.
2. `cp .env.example .env` et renseigner `APP_PASSWORD` et `SESSION_SECRET` (`python3 -c "import secrets; print(secrets.token_hex(32))"`). Mettre `COOKIE_SECURE=1` si l'accès se fait en HTTPS.
3. `docker compose up -d --build`
4. L'app écoute sur le port 8000. Les données vivent dans `./data` (volume monté dans `/data`) : sauvegarder ce dossier. Le conteneur tourne avec l'uid 1000, donc `./data` doit lui être accessible en écriture (`chown 1000 data`).
5. Si le NAS est exposé sur Internet, placer l'app derrière un reverse proxy HTTPS.

## Sessions et sécurité
- Changer `SESSION_SECRET` invalide toutes les sessions existantes (la déconnexion ne supprime que le cookie côté navigateur).
- Après 5 mots de passe erronés en 15 min depuis une même IP, `/login` répond 429. Le compteur est en mémoire (remis à zéro au redémarrage). Derrière un reverse proxy, toutes les requêtes semblent venir de l'IP du proxy.
- `APP_PASSWORD` ne doit pas rester à `change-me` et `SESSION_SECRET` doit faire au moins 32 caractères, sinon l'app refuse de démarrer.
