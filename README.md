# Secret Circle

A completely static, single-cycle gift draw for GitHub Pages. There is no server,
database, account, email provider, or build step.

## Publish on GitHub Pages

1. Create a new public GitHub repository, or open the repository for your existing
   Pages site.
2. Upload `index.html`, `styles.css`, `app.js`, and `.nojekyll` to the repository
   root and commit them.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Choose your publishing branch (usually `main`), select `/(root)`, and save.
6. Open the Pages URL GitHub shows after deployment.

If the site is at `https://username.github.io/repository/`, links generated there
will automatically use that address.

## Run locally

The encryption API needs a secure browser context. `localhost` counts as secure:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Use it

1. Enter one unique participant name per line.
2. Select **Create private links**.
3. Copy each link to the matching participant, or download the CSV.
4. Participants open their link and select **Reveal my person**.

The generator makes exactly one cycle containing everyone, so nobody draws
themselves, each participant draws exactly one person, and each participant is
drawn exactly once.

After generation, the organizer screen independently checks and displays the
participant count, number of unique recipients, number of self-matches, and whether
all assignments form one complete circle. It confirms those properties without
showing the assignments.

## Security model

- The draw is generated locally with the browser's cryptographically secure random
  number generator.
- Each assignment is encrypted separately with AES-128-GCM. A fresh random 128-bit
  key is generated for every link and used exactly once.
- The decryption key lives after `#` in the participant URL. URL fragments are not
  sent to GitHub Pages by the browser.
- The published files contain no names, assignments, links, or keys.
- The organizer sees the generated private links and could open them. This design
  prevents ordinary participants and visitors from seeing other assignments; it
  does not make the organizer cryptographically unable to inspect them.
- Anyone who receives or obtains a participant's complete private link can reveal
  that participant's assignment. Send links privately.
- There is no server-side recovery, live sign-up, revocation, or messaging.

If a private link is lost before delivery, generate a new draw and redistribute all
links. Refreshing the organizer page erases the generated list from the page.
