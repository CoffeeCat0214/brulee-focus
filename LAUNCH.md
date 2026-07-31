# Launching CoffeeCat

A runbook for putting CoffeeCat 1.0.0 on the Chrome Web Store, written July 2026.
Everything here is current as of that date; where Google is likely to have moved
things, it says so.

Budget about **90 minutes of your time**, then **1 to 5 business days of waiting**
for review. Nothing below is reversible-with-difficulty except the extension ID
and the item's public URL, both of which are fixed the moment you first publish.

---

## 0. Before you start

Three things you need that are not in this repo:

| What | Where | Notes |
| --- | --- | --- |
| A Google account for the developer profile | n/a | Use one you will still control in five years. The item cannot be moved between accounts later without Google's help. |
| **$5 one-time** developer registration fee | [Developer Dashboard](https://chrome.google.com/webstore/devconsole) | Card payment, one time, covers every extension you ever publish on that account. |
| A public URL for the privacy policy | You host it | `site/privacy.html` is written and ready. Step 2 covers deploying it. |

You also need to decide **who is publishing**: you personally, or a trading name.
The Web Store shows a publisher name on the listing, and since 2024 it must be
verified: a personal account shows your Google account name unless you set a
group publisher. Deciding this after publishing is a support ticket, so decide now.

---

## 1. Build and verify the package

From the repo root:

```bash
python3 tests/test_extension_integrity.py     # 20 tests, all must pass
python3 tools/package.py                      # -> dist/coffeecat-1.0.0.zip
```

`package.py` prints the file count, the zipped size and a SHA-256. Keep that
hash: it is how you confirm later that what you uploaded is what you have.

The build is an explicit allowlist, so the zip contains only the 21 files the
extension actually needs: no marketing site, no tests, no tooling, no
illustration master. Sanity-check it if you like:

```bash
unzip -l dist/coffeecat-1.0.0.zip
```

`manifest.json` must be at the **archive root**, not inside a wrapper folder. It
is; the packager writes paths relative to the repo root deliberately. This is the
single most common upload rejection.

### Test the exact artefact you are about to upload

Not the repo, the zip. They differ, and the whole point of the packager is that
they differ.

```bash
mkdir -p /tmp/coffeecat-check && unzip -o dist/coffeecat-1.0.0.zip -d /tmp/coffeecat-check
```

Then in Chrome: `chrome://extensions` → Developer mode on → **Load unpacked** →
select `/tmp/coffeecat-check`. Walk this list:

- [ ] The cat appears bottom-right on an ordinary `https` page.
- [ ] Dragging her moves her; **Reset position** puts her back.
- [ ] Clicking her sips and purrs (audio plays).
- [ ] All three sizes render correctly.
- [ ] Popup opens; **Start** begins a countdown and the cup starts draining.
- [ ] **Pause** and **Resume** behave.
- [ ] Switching brew modes is blocked mid-session and the lock note appears.
- [ ] **Set a Decaf session and let it actually finish.** The intermission must
      appear, count down from 5:00, and clear itself. This is the one path that
      takes real elapsed time to verify and it is the core of the product.
- [ ] With the session running, close every `http`/`https` tab and sit on
      `chrome://newtab` past the expiry. Open a normal page: the intermission
      should already be running, dated from the real expiry. *(This is what the
      service worker is for; before 1.0.0 the session silently never ended.)*
- [ ] `chrome://extensions` → **Service worker** link → console shows no errors.
- [ ] Dark mode: switch macOS to dark and reopen the popup.

Anything that fails here fails in review too, and review costs days.

---

## 2. Deploy the site and the privacy policy

The Web Store **requires** a privacy policy URL for any extension that handles
user data, and it interprets that broadly. CoffeeCat collects nothing, but it
still needs the URL. `site/privacy.html` is written and ready.

The site expects to be served from the **repo root** (its paths reach into
`../assets`). The simplest hosting that preserves that:

**GitHub Pages.** Push the repo to GitHub, then Settings → Pages → deploy from
branch `main`, folder `/ (root)`. You get:

- Site: `https://<user>.github.io/CoffeeCat/site/`
- Policy: `https://<user>.github.io/CoffeeCat/site/privacy.html`

Verify the policy URL loads in a private window before pasting it into the
dashboard. A 404 there is an automatic rejection.

> The repo currently has **no git remote**. `git remote -v` prints nothing, so
> this step starts with creating the GitHub repo and pushing.

Update the "Last updated" date in `site/privacy.html` if you edit the policy.

---

## 3. Create the item

Go to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole),
pay the $5 if you have not, then **Add new item** and upload
`dist/coffeecat-1.0.0.zip`.

Upload first, fill the listing after. The upload is what generates your extension
ID, and it validates the manifest immediately, so you find out about a packaging
problem before you have written any copy.

---

## 4. Fill in the listing

### Store listing tab

**Title** (45 char max)

```
CoffeeCat
```

**Summary** (132 char max). This is what shows in search results:

```
A tiny coffee cat who sits on your pages and keeps time. Pour a Focus Coffee and watch her cup empty.
```

**Description**, the long field. This draft is honest about what the extension
does and does not do, which matters because reviewers read it against your
permissions:

```
CoffeeCat puts a small coffee cat in the corner of the pages you browse, and
gives her a timer you read by looking at her cup.

Pour a Focus Coffee and the coffee starts going down, quietly, in time with your
session. When the cup runs out, the session does too: coffee rises over the page
and Crème Brûlée sits with you for a five-minute intermission. Refill when you
are ready, or snooze and carry on without restarting.

Four brews:
- Espresso Shot, 25 minutes
- Slow Pour, 45 minutes
- Cold Brew, 90 minutes
- Decaf, 15 minutes

Every one of them ends the same way, with a five-minute intermission.

She is also just a cat. Drag her anywhere on the page, click her for a sip and a
purr, make her small or large, or switch her off entirely.

Private by construction:
- No backend, no analytics, no accounts, no telemetry.
- CoffeeCat makes no network requests at all.
- Your settings live in local extension storage on your own machine.
- It never reads your browsing history or the contents of your pages.

Chrome will warn that the extension can read and change your data on the sites
you visit. That warning is triggered by needing to run on ordinary pages in order
to draw a cat on them. It describes what Chrome permits, not what CoffeeCat does.
The source is public.
```

**Category:** Workflow & Planning. (Fun is tempting, and CoffeeCat is fun, but the
timer is the thing people search for. Revisit if search traffic disappoints.)

**Language:** English.

### Graphics

Generate them:

```bash
python3 tools/shoot_store.py     # -> dist/store/*.png, three at 1280x800
```

- **Screenshots**: required, at least one, up to five, exactly 1280x800.
  The three generated files are composed from the real UI, in order:
  companion, focus coffee, intermission. Upload all three in that order; the
  first is the one people see.
- **Store icon**: 128x128. Use `assets/icons/icon-128.png`.
- **Small promo tile**: 440x280. *Optional but do it.* Without one you are
  ineligible for any Chrome Web Store featuring. This repo does not generate one;
  it is the single asset you will need to make by hand.
- **Marquee promo tile**: 1400x560. Only needed if you are chasing a feature
  spot. Skip for launch.

### Privacy tab

This is the part that most often sends a first submission back. Be precise.

- **Single purpose description:**

  ```
  CoffeeCat displays a cat companion and a visual focus timer on web pages, so a
  focus session and the break that follows it are visible where the user is
  already looking.
  ```

- **Permission justifications**, one per permission, and they must match the
  manifest exactly:

  | Permission | Justification |
  | --- | --- |
  | `storage` | Stores the user's own settings locally: whether the cat is shown, her size, her position on the page, the state of the focus timer, and a local count of completed sessions. No user data is collected or transmitted. |
  | `alarms` | Ends a focus session at the scheduled time and starts the five-minute intermission, including when no page is open. Without it a session cannot end reliably. |
  | Host permissions | *Not requested.* If the form asks, say so. The content script's `matches` covers injection; the extension declares no `host_permissions`. |

- **Data usage**: tick **nothing**. Then certify all three statements:
  not sold to third parties, not used for unrelated purposes, not used to
  determine creditworthiness. All three are true.

- **Privacy policy URL:** the one from step 2.

### Distribution tab

- **Visibility: Public.**
- **Regions:** all.
- **Pricing:** free.

> Consider publishing **Unlisted** first: the item goes through the same review,
> but only people with the link can find it. You can flip it to Public later
> without a new review. Worth it if you want to see it live in the store before
> anyone else does.

---

## 5. Submit

**Submit for review.** Then wait. Most extensions clear in a few days; anything
that trips a heuristic can take longer. Extensions requesting broad host access
get more scrutiny, which is part of why 1.0.0 does not request any.

While you wait, do not: upload a new version (it restarts the queue), or change
the listing (same).

### If it is rejected

The rejection email names a policy section. The likely ones here:

| Rejection | What it means | Fix |
| --- | --- | --- |
| Insufficient permission justification | The reviewer could not map a permission to a visible feature | Rewrite the justification to name the user-visible behaviour, not the API |
| Privacy policy missing/unreachable | The URL 404s, or is not a policy | Check it in a private window |
| Metadata mismatch | The description promises something the code does not do | Cut the claim |

Fix, then resubmit through the same item. Rejections do not cost you the $5 or
the extension ID.

---

## 6. After it is live

- **Grab the URLs.** The item URL is
  `https://chromewebstore.google.com/detail/<extension-id>`. The site's install
  section already describes adding her from the store, but step 1 is prose with
  nowhere to click. There is a `LAUNCH TODO` comment on it in
  `site/index.html`. Make it a link and redeploy.
- **Tag the release.** `git tag v1.0.0 && git push --tags`, so the commit that
  produced that SHA-256 is findable.
- **Turn on email notifications** in the dashboard for reviews and policy
  changes. Policy changes are the ones that will bite you: Google announces
  manifest and policy deadlines by email and enforces them on schedule.

### Shipping 1.0.1 and beyond

1. Bump `version` in `manifest.json`. It must be strictly greater; the store
   rejects a re-upload at the same version.
2. `python3 tests/test_extension_integrity.py`
3. `python3 tools/package.py`
4. Upload the new zip to the same item, then **Submit for review**.

Updates go through review too, though they usually clear faster. Users get the
update automatically within a few hours of approval.

**Do not lose the developer account.** The extension ID is tied to it, and a lost
account means republishing under a new ID, which means every existing user is
orphaned on a version that will never update again.

---

## Appendix: what changed for launch

Recorded because these are the things most likely to be quietly undone later.

| Change | Why it mattered |
| --- | --- |
| Sprites cut to delivery size (922KB → 107KB) | The 890x1142 master was decoded per tab on every page visited, ~4MB of bitmap to draw a 116px thumbnail |
| `image-rendering: pixelated` removed | The art is continuous-tone; nearest-neighbour was not making pixel art, it was dropping 98% of rows and columns |
| Session completion moved to a service worker | Every open tab used to race to write the same completion; with no page open a session never ended at all |
| `chrome.storage.sync` → `chrome.storage.local` | The UI claimed "nothing leaves your browser" while syncing settings through the user's Google account |
| `host_permissions` removed | Declared for all http/https and never used |
| `minimum_chrome_version: 111` | `color-mix()` in the intermission; older Chromes rendered it with transparent gradients |
| `tools/package.py` added | A naive zip of the repo shipped ~4MB including the marketing site and the archived art |
