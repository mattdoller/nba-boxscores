# To do

## Features

- [ ] Stop the team card's season stats and zones at the game on screen,
      like the player card's season so far, from the season index. Its
      record and game log already stop there.

## CI

- [ ] Refresh the README's screenshots in CI, opening a pull request when
      they change.
  - Give `bin/readme-screenshots` an `--out DIR` option, so CI can write
    to a temporary folder and compare with the committed `images/`.
  - Add `.github/workflows/screenshots.yml`:
    - Run on pushes to `main` that touch the page or its data
      (`public/**`, `server.js`, `dev/fake-season.js`,
      `bin/readme-screenshots`), and by hand (`workflow_dispatch`).
      `images/` isn't in the filter, so merging a screenshot pull request
      doesn't run it again.
    - Install ffmpeg (Chrome is already on GitHub's Ubuntu runners), and a
      fixed font set (Noto, say) so the images look the same from run to
      run.
    - Run the script into a temporary folder and compare with `images/`.
      If anything differs, copy the new images to a branch (say
      `screenshots/update`), push it, and open a pull request, or update
      the one already open.
    - Needs `contents: write` and `pull-requests: write`.
  - Turn on Settings → Actions → General → "Allow GitHub Actions to
    create and approve pull requests"; the workflow's token can't open
    pull requests without it.
  - The GIFs differ on every run, since their frames depend on timing, so
    let the PNGs decide: if any PNG changed, the pull request includes
    fresh GIFs too; if none did, nothing happens. A change only an
    animation shows (how fast shots fly, say) won't open a pull request
    by itself; run the workflow by hand for those. Making the GIFs
    deterministic (Chrome's virtual time while recording) is possible but
    fiddly.
  - Pull requests the workflow's own token opens don't run CI, and the
    ruleset on `main` requires the CI check. Either merge them as an
    admin, who can bypass it (they only change images), or open them with
    a fine-grained personal access token or a GitHub App kept as a repo
    secret, which does run CI and could auto-merge like Dependabot's.
  - The first run opens a pull request regardless, since the runner's
    fonts differ from a local machine's; after that, only real changes
    do. The fake season is "last season", so each October the images
    change once, which correctly opens one.
  - About 2 to 3 minutes of Actions time per qualifying push.
