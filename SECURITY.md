# Security

HomeHub controls devices on a trusted home network and can store cloud integration credentials. Do not expose the development server directly to the public Internet.

Credentials are encrypted at rest. Set a stable `DJANGO_SECRET_KEY` and preferably an explicit `HOMEHUB_ENCRYPTION_KEY` for installations that will be kept long term. Protect `.env` and the HomeHub runtime directory and back them up securely.

If a credential is accidentally committed, remove it from the current tree and rotate it. Removing it from a later commit does not remove it from Git history.
