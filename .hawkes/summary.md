First part of the first-use warm-up: while the chapter card is up, the game now fetches and decodes the level's audio (one-shots from the level JSON and every line and sound in the cutscenes it references), so cutscenes, doors and phone calls no longer decode on first play.

Shader and material compilation for hidden meshes was already in place (`warmStartState`, `meshShadersReady`).

Not done yet: texture upload, pooled-prop instantiation, particle pre-creation, spreading remaining work across frames, and before/after smoke-l1..l8 detector numbers. Typecheck passes; I did not run the playtests.

GPU estimate: none needed.
