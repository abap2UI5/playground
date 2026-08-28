_This project is open source and developed alongside other projects or during free time. Contributions are greatly appreciated!_

Check out the contribution guidelines [here.](https://abap2ui5.github.io/docs/resources/contribution.html)

## Before opening a pull request

```bash
npm ci
npx playwright install chromium   # the tests drive a real browser
npm run check                     # build -> size budget -> tests, what check.yml runs
```

`npm run build` is four cached steps and takes minutes the first time; after
that only what changed is rebuilt. `npm run serve` puts `dist/` on
`localhost:8080` if you want to click around, and `npm test` alone runs the
Playwright suite against whatever `dist/` already holds — which is why
`npm run check` exists: it cannot be typed in the wrong order.

The tests are the gate. Everything runs through a real browser, and
`tests/samples.spec.js` imports the sample catalogue and drives every entry, so
a sample without a test is not possible.

Two things worth reading before proposing a change: the **deliberate limits**
in [AGENTS.md](AGENTS.md) — several obvious-looking improvements have already
been considered and refused, with the reasons written down — and the size
budget, since everything here ends up in a bundle a visitor downloads.
