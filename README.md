# Label Padho — setup guide

A blog reviewing Indian packaged snacks, **one post per product** (one for Maggi, one for Kurkure, and so on).

- **Website:** published free on GitHub Pages by a GitHub Actions workflow.
- **Permanent review numbers:** every review gets a number (No. 1, No. 2 …) that never changes.
  Its page address, votes and views all belong to that number.
- **Votes, view counts and visit tracking:** stored in a free Supabase database.

The site works without Supabase. Until you connect it, vote buttons, view counts and
"Most upvoted / Most viewed" simply stay hidden.

---

## What's in this folder

| Path | What it is |
|------|------------|
| `_config.yml` | **Site settings. Edit this first.** |
| `_posts/` | Your reviews. One file = one snack |
| `_templates/new-post.md` | Copy this to start every review |
| `_data/verdicts.yml` | Names of the three verdicts |
| `index.html` | Landing page |
| `posts/index.html` | All reviews: search, filters, sorting |
| `stats/index.html` | Stats dashboard at `/stats/` |
| `about.md`, `how-i-rate.md` | Your About and method pages |
| `404.html` | Page for broken links |
| `.github/workflows/pages.yml` | **Publishes the site** and assigns review numbers |
| `_system/assign_post_numbers.py` | The numbering robot the workflow runs |
| `_system/post-numbers.json` | Record of every number ever issued (created automatically; never edit) |
| `supabase/setup.sql` | Database setup for votes and visits (run once) |
| `assets/` | Styling, script, favicon, and `images/` for pack photos |
| `_layouts/`, `_includes/` | Page templates |

---

## Part 1 — Put the website online (15 minutes)

**1. Create a repository.** Sign in at <https://github.com>, click **+ > New repository**, name it
`label-padho`, set it to **Public**, leave "Add a README" unticked, and click **Create repository**.

**2. Upload the files.** Click **uploading an existing file**. Unzip the download, open the
`label-padho-site` folder, select **everything inside it** and drag it into the browser. Click **Commit changes**.

> **Mac users:** the `.github` folder is hidden in Finder. Press **Cmd + Shift + .** (full stop) inside the
> folder to show hidden files *before* selecting everything, or the site will never publish.

**3. Check the workflow uploaded.** In the repository you must see a `.github` folder containing
`workflows/pages.yml`. If it's missing, click **Add file > Create new file**, type the name
`.github/workflows/pages.yml`, paste in the contents of that file from the download, and commit.

**4. Edit `_config.yml`.** Click the file, then the pencil icon, and change the lines marked `<-- CHANGE`:

| Your repository is named | `url` | `baseurl` |
|---|---|---|
| `label-padho` | `"https://YOUR-USERNAME.github.io"` | `"/label-padho"` |
| `YOUR-USERNAME.github.io` | `"https://YOUR-USERNAME.github.io"` | `""` |

**5. Tell Pages to use the workflow.** Go to **Settings > Pages**. Under **Build and deployment**, set
**Source** to **GitHub Actions**. (Not "Deploy from a branch". That would skip the numbering robot.)

**6. Publish.** Open the **Actions** tab. If a "Publish site" run failed before step 5, click it and
choose **Re-run all jobs**. Otherwise click **Publish site > Run workflow**. When it shows a green tick
(about 2 minutes), the site is live at `https://YOUR-USERNAME.github.io/label-padho/`.

From now on, **every commit publishes automatically**.

---

## Part 2 — Switch on votes, view counts and visit tracking (10 minutes)

**1. Create a Supabase project.** Sign up at <https://supabase.com> (free plan), click **New project**,
choose a name and a strong database password, pick the **Mumbai** region if offered, and create it.

**2. Create the database.** Open **SQL Editor > New query**, paste the whole of `supabase/setup.sql`,
and click **Run**. You should see "Success. No rows returned". Running it again later is safe.

> **Only if you ran the earlier name-based `setup.sql` before:** it will stop with a message asking you
> to reset. Run this first (it deletes old test votes and visits), then run `setup.sql` again:
> ```sql
> drop table if exists public.votes, public.page_views;
> ```

**3. Copy two values** from the **Connect** dialog or **Project Settings > API Keys**:
- **Project URL**, like `https://abcdefghijklm.supabase.co`
- **Publishable key**, starting with `sb_publishable_`

Never use the **secret** key on the website. The publishable key is meant to be public; the database
only lets it call the five safe functions in `setup.sql`.

**4. Paste them into `_config.yml`** and commit:
```yaml
supabase:
  url: "https://abcdefghijklm.supabase.co"
  key: "sb_publishable_xxxxxxxxxxxxxxxx"
```

**5. Stop counting yourself.** Open `https://YOUR-SITE/stats/` in every browser and phone you use and
click **Stop counting my visits**.

### What you get

| Feature | Where | Details |
|---|---|---|
| **Upvote / downvote** | Each review (verdict box and end of post) | One vote per browser per review. Click again to undo, or switch sides |
| **View count** | Review header, cards | Reloading within 30 minutes isn't counted twice |
| **Most upvoted (top 3)** | Home page | By upvotes, then net score, then views |
| **Most viewed (top 3)** | Home page | By views |
| **Sorting** | All reviews page | Newest, most upvoted, most viewed, highest score |
| **Visit tracking** | `/stats/` | Visits today / 7 / 30 days / all time, unique readers, daily chart, top pages, referring websites, per-review views and votes |

**Privacy:** each browser gets a random ID in localStorage. No cookies, IP addresses or personal
details are stored. The footer says so automatically once Supabase is connected.

**Limits:** votes are one per *browser*, not per person, so clearing browser data allows voting again
(stopping that fully would need visitor logins). `/stats/` is hidden from search engines and unlinked,
but anyone with the address can open it; it shows totals only. Supabase may pause free projects after
a long stretch with no activity; if counts vanish, sign in to Supabase and restore the project.

---

## Part 3 — Writing a review

1. Open `_templates/new-post.md` and copy everything.
2. In `_posts`, click **Add file > Create new file**.
3. Name it `YYYY-MM-DD-product-name.md`, e.g. `2026-10-02-maggi-masala.md`.
4. Paste, fill in the fields, write the review below the second `---`, and **commit**.

About a minute later, the robot adds three lines to the top of your file and publishes it:

```yaml
# Permanent review number, managed automatically. Do not edit the next two lines.
post_id: 7
permalink: /posts/7/
```

> **Tip:** because the robot commits to your repository, reload the GitHub page before editing a review
> again, so you're working on the version that includes its number.

### How permanent numbers work

The number is the review's identity. **The page address, votes and views belong to the number**, not to
the file name, title or product name.

| You do this | What happens |
|---|---|
| Publish a new review | It gets the next number |
| Change the title, product name or text | Nothing changes: same number, address, votes and views |
| Rename or move the file | Keeps its number |
| Edit, delete or swap the `post_id` lines | The robot puts the correct number back |
| Rename the file **and** mess with the number in the same commit | Still keeps its number (matched to its previous version by content) |
| Copy an old review to start a new one | The copy gets a new number |
| Delete a review | Its number is retired forever and never reused |
| Restore a deleted review with its original file name | Gets its old number, votes and views back |

Each run's log is shown under **Actions > Publish site > (latest run)**, in a "Review numbers" summary.

### Fields

| Field | Required | Example | Shown |
|---|---|---|---|
| `title` | Yes | `"Two minutes to make, a lifetime of maida"` | Headline under the product name |
| `date` | Yes | `2026-10-02 10:00:00 +0530` | Future dates stay hidden until that date |
| `product` | Yes | `"Maggi 2-Minute Masala Noodles"` | Big name everywhere |
| `brand` | Yes | `"Nestlé"` | Under the product name |
| `snack_type` | Yes | `"Instant noodles"` | Grouping and filters. Spell it identically each time |
| `verdict` | Yes | `bad` | `good`, `okay` or `bad` |
| `score` | Yes | `3` | Whole number from 1 to 10 |
| `description` | Yes | `"One or two sentences."` | Cards, verdict box, Google |
| `image`, `image_alt` | No | `"/assets/images/maggi.jpg"` | Pack photo |
| `pack_size`, `price`, `label_checked` | No | `"70 g"`, `"₹15"`, `"October 2026"` | Fact strip in the header |
| `ingredients` | No | list of `name`, `flag`, `note` | Numbered ingredient list with coloured marks |
| `nutrition`, `nutrition_basis`, `nutrition_note` | No | list of `name`, `value`, `sub`, `flag` | Nutrition facts panel |
| `good_points`, `bad_points` | No | lists | "What works / What doesn't" boxes |
| `post_id`, `permalink` | **Never type these** | | Added by the robot |

**Photos:** upload to `assets/images/`. Square or portrait JPG/PNG/WebP under about 300 KB works best.
In `image:` write the path without your baseurl (`"/assets/images/maggi.jpg"`). Inside review text,
include it: `![Back of the pack](/label-padho/assets/images/maggi-back.jpg)`.

---

## Handy SQL (Supabase > SQL Editor)

```sql
-- Wipe all visit data (e.g. after testing)
truncate public.page_views;

-- Wipe all votes
truncate public.votes;

-- Reset votes and views for review No. 7
delete from public.votes      where post_id = 7;
delete from public.page_views where post_id = 7;
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Nothing publishes / Actions tab is empty | `.github/workflows/pages.yml` wasn't uploaded (see Part 1, steps 2 and 3) |
| Run fails at **Deploy** with a Pages/environment error | Settings > Pages > Source must be **GitHub Actions**. Then re-run the workflow |
| Run fails at **Save review numbers** with "permission denied" or 403 | Settings > Actions > General > Workflow permissions: choose **Read and write permissions**, save, re-run |
| Run fails at **Save review numbers** with a merge conflict | You committed while the robot was saving. Just commit any small change again, or re-run |
| Run fails at **Build with Jekyll** | Front matter typo. Open the failed step to see the file and line. Quote text containing `:`, indent with spaces |
| Site has no styling | `baseurl` in `_config.yml` doesn't match the repository name |
| Review doesn't appear | Future date, file name doesn't start with `YYYY-MM-DD-`, or file isn't in `_posts` |
| Verdict mark is blank | `verdict` or `flag` isn't exactly `good`, `okay` or `bad` |
| Vote buttons don't appear | Supabase `url`/`key` empty or mistyped, or the run hasn't finished |
| `/stats/` says "Stats couldn't load" | `setup.sql` wasn't run, wrong URL, or secret key used instead of publishable key |
| GitHub says your edit conflicts | The robot updated the file after your last commit. Reload the page and edit again |

---

## Customising the look

- **Name and slogan:** `title` and `tagline` in `_config.yml`. The big hero headline is in `index.html`.
- **Verdict names:** `_data/verdicts.yml` (don't rename the keys `good`, `okay`, `bad`).
- **Colours:** variables at the top of `assets/css/style.css`: `--packet`, `--good`, `--okay`, `--bad`.
- **Font:** Archivo from Google Fonts, in `_includes/head.html`.
- **Custom domain:** Settings > Pages > Custom domain, then set `url` to your domain and `baseurl` to `""`.
