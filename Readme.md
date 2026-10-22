# Listening History

A local web app for exploring and comparing Calin's and Dominik's Spotify, Tidal, and Apple Music listening histories. It provides rankings, listening insights, shared-taste comparisons, games, concert preparation, and other music statistics.

With the `calin` and `dominik` input folders present, launch it from the repository root:

```bash
python server.py --person Calin ./calin --person Dominik ./dominik --open
```

The histories are loaded locally, the server starts on `http://127.0.0.1:8000`, and the app opens in the default browser.
