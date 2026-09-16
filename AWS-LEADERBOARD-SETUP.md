# Leaderboard on AWS — first-time setup guide

This sets up an online leaderboard for **Spot the Rejection**. Your game is a static
site (hosted on **Netlify**); the leaderboard needs a tiny backend, which lives on AWS:

```
 Browser (Netlify site)  ──HTTPS──▶  API Gateway (HTTP API)  ──▶  Lambda  ──▶  DynamoDB
        the game                       the public URL           the code       the data
```

- **DynamoDB** = the database that stores each run (`name`, `timeMs`).
- **Lambda** = a small function that reads/writes the database.
- **API Gateway (HTTP API)** = the public web address your game calls.

**Cost:** all three have generous always-free tiers. For a hobby game this is
effectively **$0/month**. The database is "pay per request" so there's no idle cost.

You do **not** need to paste any AWS secret keys into the game. The browser only ever
talks to the public API URL. (The only place AWS credentials are used is on *your*
computer, once, to deploy — explained below.)

---

## What you'll end up with

1. A public API base URL like
   `https://abc123xyz.execute-api.us-east-1.amazonaws.com`
2. You paste that one URL into the game (`LEADERBOARD_API`), redeploy to Netlify, done.

---

## Option A — Deploy with the AWS SAM CLI (recommended, ~10 min)

This is the easiest first-time path: one guided command creates everything.

### A1. Create a free AWS account
- Go to https://aws.amazon.com/ → **Create an AWS Account**.
- You'll need an email, a password, and a credit card (for identity; you stay in the
  free tier). Choose the **Basic (Free) support plan**.

### A2. Create an access key (so the CLI can deploy on your behalf)
This is the one time you handle "keys". These are **your personal deploy credentials**
— they go on your computer only, never in the game.

1. Sign in to the AWS Console.
2. Top-right, click your account name → **Security credentials**.
3. Scroll to **Access keys** → **Create access key**.
4. Choose **Command Line Interface (CLI)**, acknowledge, **Create access key**.
5. You now see two values — copy both somewhere safe:
   - **Access key ID**  (looks like `AKIA...`)
   - **Secret access key**  (a long random string — shown only once)

> Treat the secret access key like a password. If it ever leaks, delete it in this
> same screen and make a new one.

### A3. Install the tools (macOS)
```bash
# Homebrew if you don't have it: https://brew.sh
brew install awscli aws-sam-cli
```

### A4. Tell the CLI who you are
```bash
aws configure
```
It will ask for four things — here's exactly what to enter:

| Prompt | What to type |
|---|---|
| `AWS Access Key ID` | the **Access key ID** from step A2 (`AKIA...`) |
| `AWS Secret Access Key` | the **Secret access key** from step A2 |
| `Default region name` | `us-east-1` (or the region nearest you — remember it) |
| `Default output format` | `json` |

### A5. Deploy
```bash
cd aws
sam build
sam deploy --guided
```
`--guided` asks a few questions. Recommended answers:

| Prompt | Answer |
|---|---|
| `Stack Name` | `spot-rejection-leaderboard` |
| `AWS Region` | press Enter (uses the region from A4) |
| `Parameter AllowOrigin` | your site origin, e.g. `https://YOUR-SITE.netlify.app` (see note below) |
| `Confirm changes before deploy` | `y` |
| `Allow SAM CLI IAM role creation` | `y` |
| `Disable rollback` | `N` |
| `HasNoAuthorizer... may not require authorization` (or similar "…without authorization" warnings for GetScores/PostScores) | `y` — this is expected; a public leaderboard is meant to be open |
| `Save arguments to configuration file` | `y` |

> **`AllowOrigin` note:** this is the CORS setting — the website allowed to call your
> API from a browser. Use your real Netlify URL once you know it. For a first quick
> test you can enter `*` (any origin), then tighten it later (step D).

When it finishes, SAM prints **Outputs**. Copy the value of **`ApiBaseUrl`** — that's
your public API URL. Example:
```
Key                 ApiBaseUrl
Value               https://abc123xyz.execute-api.us-east-1.amazonaws.com
```

➡️ Now jump to **Step C** (plug the URL into the game).

---

## Option B — All in the AWS Console, no CLI (click-through, ~25 min)

Use this if you'd rather not install anything. It's more clicking but avoids the CLI.

### B1. Create the DynamoDB table
1. Console → search **DynamoDB** → **Tables** → **Create table**.
2. **Table name:** `SpotRejectionScores`
3. **Partition key:** `pk`  (type **String**)
4. **Sort key:** `timeMs`  (type **Number**)
5. Leave defaults (on-demand capacity) → **Create table**.

### B2. Create the Lambda function
1. Console → **Lambda** → **Create function** → **Author from scratch**.
2. **Function name:** `LeaderboardFunction`
3. **Runtime:** **Node.js 20.x**
4. **Create function**.
5. In the **Code** tab, replace the contents of the file with **`aws/index.mjs`**
   from this project. Rename the file to `index.mjs` if needed. Click **Deploy**.
6. **Configuration → Environment variables → Edit → Add:**
   | Key | Value |
   |---|---|
   | `TABLE_NAME` | `SpotRejectionScores` |
   | `ALLOW_ORIGIN` | `https://YOUR-SITE.netlify.app` (or `*` for testing) |
7. **Configuration → Permissions →** click the **execution role** link (opens IAM) →
   **Add permissions → Attach policies →** attach **`AmazonDynamoDBFullAccess`**
   (simplest for a hobby project). Save.

### B3. Create the HTTP API
1. Console → **API Gateway** → **Create API** → **HTTP API → Build**.
2. **Integrations:** Add integration → **Lambda** → pick `LeaderboardFunction`.
3. **API name:** `LeaderboardApi` → **Next**.
4. **Configure routes** — add **two** routes, both pointing to the Lambda integration:
   - Method `GET`, path `/scores`
   - Method `POST`, path `/scores`
5. **Next** through stages (default `$default`, auto-deploy) → **Create**.
6. Open your API → **CORS** → **Configure**:
   | Field | Value |
   |---|---|
   | Access-Control-Allow-Origin | `https://YOUR-SITE.netlify.app` (or `*` to test) |
   | Access-Control-Allow-Methods | `GET, POST, OPTIONS` |
   | Access-Control-Allow-Headers | `content-type` |
   Save.
7. Copy the **Invoke URL** at the top (e.g.
   `https://abc123xyz.execute-api.us-east-1.amazonaws.com`). That's your API URL.

➡️ Continue to **Step C**.

---

## Step C — Plug the API URL into the game

1. Open `game2-rejection-or-offer.html`.
2. Near the top of the `<script>` find:
   ```js
   const LEADERBOARD_API = "";
   ```
3. Paste your API base URL between the quotes (no trailing slash):
   ```js
   const LEADERBOARD_API = "https://abc123xyz.execute-api.us-east-1.amazonaws.com";
   ```
4. Save. That's the only change the game needs.

**Test locally first:** open the file in your browser, finish a run, type a name, and
click **Submit time**. You should see your entry appear in the list. If it says
"offline" you left the URL blank; if submit fails, see **Troubleshooting**.

---

## Step D — Deploy the game to Netlify (and lock down CORS)

1. Push your project to a Git repo (GitHub) — you already have one.
2. Netlify → **Add new site → Import an existing project** → pick the repo.
3. Build settings: **no build command**; **publish directory** = the repo root
   (this is a plain static site). Deploy.
4. Netlify gives you a URL like `https://your-game.netlify.app`. That is your
   **site origin**.
5. **Now make CORS exact** (recommended, more secure than `*`):
   - **If you used SAM (Option A):** redeploy with the real origin:
     ```bash
     cd aws
     sam deploy --parameter-overrides AllowOrigin=https://your-game.netlify.app
     ```
   - **If you used the Console (Option B):** update **two** places to your Netlify URL:
     the Lambda env var **`ALLOW_ORIGIN`**, and the **API Gateway → CORS →
     Access-Control-Allow-Origin**. Save both.

> The origin is just the scheme + host: `https://your-game.netlify.app` — **no path,
> no trailing slash**. If you later add a custom domain, add that origin too.

---

## What each "key/value" actually is (quick reference)

| Name | Where it goes | What to put |
|---|---|---|
| **Access key ID** / **Secret access key** | your computer, via `aws configure` (Option A only) | your personal AWS deploy credentials from Console → Security credentials. **Never** put these in the game or commit them. |
| **`AllowOrigin`** (SAM param) / **`ALLOW_ORIGIN`** (Lambda env) / **CORS Allow-Origin** | AWS | your Netlify site origin, e.g. `https://your-game.netlify.app` (or `*` while testing) |
| **`TABLE_NAME`** (Lambda env) | AWS (Option B) | `SpotRejectionScores` |
| **`LEADERBOARD_API`** | the game HTML | the API **Invoke/Base URL** AWS gives you |

---

## Troubleshooting

- **List shows "Leaderboard offline"** → `LEADERBOARD_API` is still `""`. Add the URL (Step C).
- **Submit fails / "Couldn't load"** and browser console shows a **CORS error** →
  your `AllowOrigin` doesn't match the site origin exactly. Fix it (Step D). Remember:
  `http://localhost` and `https://your-game.netlify.app` are *different* origins — to
  test locally add `http://localhost:PORT` (or use `*` temporarily).
- **403 / 404 from the API** → check the routes are exactly `GET /scores` and
  `POST /scores` and that the stage auto-deployed.
- **500 error** → open **CloudWatch → Log groups → /aws/lambda/LeaderboardFunction**
  to see the message. Usually a missing `TABLE_NAME` env var or the Lambda role
  lacking DynamoDB permissions.
- **See your data** → DynamoDB → Tables → `SpotRejectionScores` → **Explore items**.

## Removing everything later
- **SAM:** `sam delete` (deletes the stack, table, function, and API).
- **Console:** delete the API, the Lambda, and the DynamoDB table individually.
