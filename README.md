# Feature Creep

A multiplayer reading hunt for students of English for Academic Purposes.

An academic essay rises up the screen towards a shredder. Players claim features of academic writing from a tray (hedging, a thesis statement, a source used as evidence, a grammar mistake…) and then click where that feature appears in the text before it is shredded. Right first time scores; a wrong click freezes the player for 2.5 seconds, so careful reading beats click-spamming.

After each round, everyone steps through three feedback screens:

1. **Scores** – a podium, each player's finds with the words they found, and the features nobody found, grouped by category.
2. **In the text** – the whole essay marked up: every find highlighted in the finder's colour, every missed feature underlined in red and labelled.
3. **Blind spots** – hit rates for each category and the most-missed features, each with a sentence from the text and a short explanation. The next round in the same game offers these features more often.

## Playing

- On the start screen everyone types their name, then either starts a new game or joins one from the list of open games. The list shows how many players each game has; a game holds four players and shows as full until someone leaves.
- The person who started the game is the host and decides when it starts.
- The host chooses what to hunt for: **Language**, **Argument**, **Organisation** or a **Mix**, then the text (or a random one) and the speed.
- Everyone sees the same text and the same tray of five features. When a feature is claimed, a new one replaces it. Each player hunts one feature at a time; claiming another drops the one you were holding.
- The host can pause the round.

## The texts

`shared/texts.js` holds six short argumentative essays (education, public health, business, linguistics, environmental science, politics). All the sources they cite are fictional. Each text contains every feature at least once and includes planted grammar mistakes and informal wording.

Features are tagged inline, one string per sentence:

```
'{counter,topic}Critics of phone use [[reporting|argue]] that a complete ban is the only effective solution.'
```

- `{thesis}` at the start of a sentence tags the whole sentence (several tags: `{counter,topic}`).
- `[[hedge|may not be]]` tags a phrase (several: `[[grammar,hedge|which suggest]]`).

Tag every instance of a feature, because clicking an untagged instance counts as a miss. Feature names, categories, points and definitions live in `shared/features.js`. `npm test` checks that every text parses and contains every feature.

## Running it locally

```
npm install
npm start
```

Then open http://localhost:3000 in two browser windows to try it with two players.

## Tests

```
npm test
```

This runs unit tests for the texts and game rules, plus an end-to-end test that starts a real server and plays a round with two WebSocket clients. Setting `FC_ROUND_MS` (for example `FC_ROUND_MS=30000 npm start`) shortens rounds for manual or browser testing.

## Deploying to Render

The repo includes `render.yaml`, so it can be deployed as a Render Blueprint: in Render choose **New → Blueprint**, pick this repository and accept the defaults. It runs as a single Node web service on the free plan, with the game and its WebSocket connections on the same port.

On the free plan the service sleeps after a period of inactivity and takes a little while to wake on the first visit. Games are held in memory, so a restart or redeploy ends any games in progress.

## How it is built

- `server/index.js` – Express serves the page; a WebSocket server (`ws`) on `/ws` carries the game.
- `server/rooms.js` – game rooms. The server holds the answers: players only receive the words of the text during a round, and every claim and click is checked on the server.
- `server/textEngine.js` – turns the tagged texts into clickable segments.
- `public/` – the client: plain HTML, CSS and JavaScript with no build step.
