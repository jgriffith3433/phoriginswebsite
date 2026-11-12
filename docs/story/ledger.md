# The ledger (what the Shadow did, and who noticed)

The save keeps a **ledger** next to the reply-choice state (`vossTrust`, `haleTemper`): `ledger: { kills, possessions, consumes, witnesses, reported }` (`src/game/ledger.ts`, on the `ph-origins-save` cookie). Going Home resets it when the level mounts; The Station and The Morning read what is there. New Game and Reset clear it.

| Count | Meaning |
|---|---|
| kills | Bystanders the Shadow killed: pedestrians, shopkeepers, the receptionist. Police, hostiles and the lesson's guards are not bystanders. |
| possessions / consumes | Links made, bodies consumed (the lesson's own count too). |
| witnesses | Bystanders within 16 m of a kill who saw it and ran. |
| reported | Times the story said it out loud: the TV report, a Voss line that knows, the newspaper read. |

## Bands

| Band | Kills | The city | The Morning |
|---|---|---|---|
| 0, no one hurt | 0 | The street is as it was. | TV: "No one was hurt." Paper: A QUIET NIGHT ON TOWER AVENUE. Pierce: "Nobody hurt. Maybe I can still walk back." Voss lines 03 and 06 say the street has nothing. |
| 1, injuries | 1 | Witnesses nearby run; nothing more. | TV: one man taken to hospital. Paper: MAN TAKEN TO HOSPITAL. Pierce: "One man in hospital. That was my hand." Voss: a hospital bed is a witness. |
| 2, deaths | 2 or more | A siren sounds the moment the second body drops; a police car comes in along the avenue and stops ahead of Pierce inside 20 s (about 12 s), two officers step out and chase; every walker within 7 m flees (not one in five); at The Station the gate has an officer and three wanted posters, and a siren sounds over the platform. | TV: deaths, with the count (two, three, four, five or more, each its own voiced take). Paper: N DEAD ON TOWER AVENUE, "no weapon, no suspect". Pierce: "They're counting them. Every one of them mine." Voss: "The police are counting. So am I." |

The public never learns what Pierce is: the wanted posters show a silhouette "for questioning", the news names no vat, no B3, no creature.

## Where each reads the ledger

- `goingHome.ts` `noteKill` counts, sends witnesses running and starts the siren at SIREN_KILLS (2); `stepHeat` brings the car (`policeCar.ts`, boxes and an emissive light bar, no scene light) three seconds after the siren; `heat()` is the probe's view.
- `theStation.ts` `gateWatch`: officer (`asset-ch23-npc`, voice Police, `bark.station.officer`) and posters (`wantedPosters.ts`).
- `theMorning.ts`: report 4 of the TV, ticker 4, the newspaper on the coffee table (**Read the paper**, E / Use, once), and `phone.json` `voss-morning` lines 03 and 06 (`alt` with `ledgerBand`, two lines per band).
- Probe: `ledger()` (counts and band, optional seed), `heat()`, `morning()` (`band`, `kills`, `report`, `paper`, `paperRead`), `replies().ledger`. Playtest `ledger-city` compares a 3-kill and a 0-kill Morning.

Voices: the Morning News anchor (`anchor`), Pierce, Voss and Police keep their fixed Gen voices; no new voice was designed (the anchor already existed).
