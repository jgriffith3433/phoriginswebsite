1. On the beta site root (not `/play/game.html`), in the console run `hawkesPlaytest.scenarios().map(s => s.id)` — you should see both `smoke` and `apex-slice`.
2. Run `hawkesPlaytest.start('apex-slice')` — it should open `/play/game.html?playtest=apex-slice` with no "no playtest scenario" error.
3. When the bot finishes, the report should include `quality.maxQuietSeconds` and `quality.textOnlyBeats`.
4. Optional: `hawkesPlaytest.start('smoke')` still boots level 1 as before.
