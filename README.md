# Feature Creep

A multiplayer reading hunt for students of English for Academic Purposes.

An academic essay appears one paragraph at a time. A tray shows the features of academic writing still hidden in that paragraph (hedging, a thesis statement, a source used as evidence, a grammar mistake…). Players choose a feature and click where it appears. They have a set time to find every feature before the paragraph is replaced by the next one. Right first time scores; a wrong click freezes the player for 2.5 seconds, so careful reading beats click-spamming.

After each round, everyone steps through three feedback screens:

1. **Scores** – a podium, each player's finds with the words they found, and the features nobody found, grouped by category.
2. **In the text** – the whole essay marked up: every find highlighted in the finder's colour, every missed feature underlined in red and labelled.
3. **Blind spots** – hit rates for each category and the most-missed features, each with a sentence from the text and a short explanation. The next round in the same game flags these features in the tray.

## Playing

- On the start screen everyone types their name, then either starts a new game or joins one from the list of open games. The list shows how many players each game has; a game holds four players and shows as full until someone leaves.
- The person who started the game is the host and decides when it starts.
- The host chooses what to hunt for: **Language**, **Argument**, **Organisation** or a **Mix**, then the text (or a random one) and the speed.
- Everyone sees the same paragraph and the same tray. The host can pause the round.

### The rules of a round

- **One paragraph at a time.** Each paragraph has its own clock: a base time, plus reading time for its length, plus time for each feature there is to find in it. **Gentle** allows more time than **Brisk**. When the clock runs out the next paragraph replaces it; anything not found counts as missed.
- **The tray.** It holds one tile for every feature still to be found in the paragraph on screen, with how many are left. It never offers a feature the paragraph does not contain, so every tile can be completed.
- **Choosing.** Click a tile to hunt that feature. Any number of players can hunt the same feature, and choosing another tile swaps at no cost. You keep hunting the same feature until the paragraph has no more of it.
- **Finding.** Click the words, or any part of the sentence, where the feature appears. Each instance scores once, for whoever clicks it first. Clicking one that is already found costs nothing; a wrong click freezes you for 2.5 seconds.
- **Clearing.** When every feature in the paragraph is found, every player gets the same bonus: 5 points for each tenth of the time still left, so up to 50. The next paragraph then arrives early.
- **Time's up.** If the clock runs out first, the paragraph stays for a few seconds with everything that was missed underlined and named, then gives way to the next one.
- **Streaks.** Three correct finds in a row, with no wrong click between them, and every find is worth ×1.5 (rounded to the nearest 5) until a wrong click.
- **Hints.** While a wrong click keeps you waiting, the definition of the feature you are hunting appears under the paragraph.
- **Sound.** A chime for a correct find, a low double note for a wrong click, and a tick each second for the last ten seconds of a paragraph. The **Sound on / Sound off** button mutes all of it.
- Paragraphs with nothing to find in the chosen focus are left out of the round (for example, the conclusion in an **Argument** round). The feedback screens still show the whole essay.

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

This runs unit tests for the texts and game rules, plus an end-to-end test that starts a real server and plays a round with two WebSocket clients. Setting `FC_ROUND_MS` (for example `FC_ROUND_MS=30000 npm start`) fixes the length of a whole round, shared equally between its paragraphs, for manual or browser testing.

## Deploying to Render

The repo includes `render.yaml`, so it can be deployed as a Render Blueprint: in Render choose **New → Blueprint**, pick this repository and accept the defaults. It runs as a single Node web service on the free plan, with the game and its WebSocket connections on the same port.

On the free plan the service sleeps after a period of inactivity and takes a little while to wake on the first visit. Games are held in memory, so a restart or redeploy ends any games in progress.

## How it is built

- `server/index.js` – Express serves the page; a WebSocket server (`ws`) on `/ws` carries the game.
- `server/rooms.js` – game rooms. The server holds the answers: players only receive the words of the text during a round, and every claim and click is checked on the server.
- `server/textEngine.js` – turns the tagged texts into clickable segments.
- `public/` – the client: plain HTML, CSS and JavaScript with no build step. The look is the "Marked Up" identity: white sheets on a grey desk, a serif for the essay and headings, and a highlighter colour for each player (yellow, pink, green, blue). Colours and fonts are set at the top of `public/style.css`; player colours are in `server/rooms.js` and category colours in `shared/features.js`.
