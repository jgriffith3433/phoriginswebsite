# /feed textures (the Earth on the Moon camera)

Used only by `site/terminal/feed.js`, and only fetched when a visitor opens `/feed` on the front-page terminal.
All four are NASA Earth Observatory images. NASA content is generally not subject to copyright in the United States;
NASA asks to be acknowledged as the source. Taken as WebP from the npm package `@johnmorrisdotca/chikyu-earth` 0.51.1
(`dist/textures/`, MIT code; its NOTICE.md documents each picture's NASA source), unchanged, 2026-11-14.

| File | Size | From | NASA source and credit |
|---|---|---|---|
| `earth-day.webp` | 2048 x 1024 | `day-2048.webp` | Blue Marble: Next Generation with topography and bathymetry, September 2004 (Visible Earth 73801). NASA Earth Observatory (Reto Stöckli). |
| `earth-night.webp` | 2048 x 1024 | `night-2048.webp` | Earth at Night, Black Marble 2016 (Visible Earth 144898). NASA Earth Observatory, Suomi NPP VIIRS data (Miguel Román, NASA GSFC). |
| `earth-clouds.webp` | 1024 x 512 | `clouds-1024.webp` | Blue Marble clouds (Visible Earth 57747). NASA Earth Observatory (Reto Stöckli). |
| `earth-water.webp` | 1024 x 512 | `water-1024.webp` | Ocean mask made from the day picture above (where it is blue and dark). |

The lunar ground on the feed is procedural (shader noise), not a texture.
