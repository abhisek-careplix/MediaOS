# Deploying VideoGen

VideoGen runs as one Docker container behind Caddy, which serves it over HTTPS.

**Right now it's set up as an open site with no sign-in** (`OPEN_ACCESS=1`). Anyone with the link can make and export instant films. These guardrails stay on:

- **Director mode is off.** It runs a shell-capable agent and costs about $4 a film. It only works once sign-in is on.
- **Hourly limits:**
  - each visitor gets 15 Claude-written scripts and 8 exports an hour;
  - the whole site gets 150 Claude calls an hour.
  - Change these in `.env`.
- **Want a light gate without accounts?** Uncomment `basic_auth` in `Caddyfile` for one shared password.

When you want CarePlix-only access, see [Later: Google sign-in](#later-google-sign-in-careplix-only). Filling in the Google settings turns sign-in on and open access off.

```
browser ──HTTPS──► Caddy (certificates, :443) ──► VideoGen container (:5178)
                                                     ├─ web app + API (Node)
                                                     ├─ renderer: headless Chromium + ffmpeg 7 + Kokoro voice
                                                     ├─ Claude Code CLI (scripts, brand kits; Director when signed in)
                                                     └─ /data volume: films and brand kits
```

Without `OPEN_ACCESS` or Google settings, the app runs as it does on your Mac: localhost only, no sign-in. It refuses to listen on a public address in that state.

## Fastest: live from this Mac in 2 minutes

A Cloudflare quick tunnel gives your local VideoGen a public `https://….trycloudflare.com` address. Nothing to rent. The site is up only while your Mac is awake and both commands are running.

```sh
brew install cloudflared
cd ~/VideoGen && OPEN_ACCESS=1 node app/server.mjs           # terminal 1: the app, open mode
cloudflared tunnel --url http://localhost:5178               # terminal 2: prints your public URL
```

Scripts are written with whatever Claude login this Mac has. For a site other people use, start the app with an API key instead: `ANTHROPIC_API_KEY=sk-ant-… OPEN_ACCESS=1 node app/server.mjs`. The address changes every time `cloudflared` restarts.

## Always-on on Google Cloud (careplix-labs): one command

`deploy/gcp-up.sh` does every step below in project `careplix-labs`. Your gcloud default project is left alone. It:
1. enables Compute Engine;
2. reserves a static IP;
3. opens ports 80 and 443;
4. creates an `e2-standard-8` Debian VM;
5. uploads the app;
6. writes the server's `.env`, installs Docker, then builds and starts the containers;
7. waits until `https://<ip>.sslip.io` answers.

[sslip.io](https://sslip.io) turns the IP into a hostname, so you get HTTPS with no DNS setup.

```sh
gcloud auth login                                      # if gcloud isn't signed in as a careplix-labs user
./deploy/gcp-up.sh                                     # asks for the Anthropic API key, deploys, prints the live URL
```

- **Updates:** run `./deploy/gcp-up.sh` again. It re-uploads, rebuilds and restarts, keeping the server's `.env`, films and brand kits.
- **Your own hostname:** add `DOMAIN=videogen.careplix.com` once its DNS A record points at the IP.
- **Removing it:** `./deploy/gcp-down.sh` deletes the VM (with its films), the IP and the firewall rule.

**Cost:** an always-on `e2-standard-8` is the main fixed cost, roughly $200 a month on demand; check current pricing. Stop the VM when nobody needs the site:
```sh
gcloud --project careplix-labs compute instances stop videogen --zone us-central1-a
```

## Always-on: any server, step by step

### What you need

| | |
|---|---|
| A Linux VM with Docker | Rendering is CPU-bound. 8 vCPU / 32 GB / 100 GB disk handles two renders at once (e.g. Google Compute Engine `e2-standard-8`, Debian 12 or Ubuntu 24.04). The image is about 4.5 GB. x86 (the script's default, `e2-standard-8`) and Arm (`MACHINE=t2a-standard-8`) both work; the Arm build is the one tested so far. |
| A hostname | e.g. `videogen.careplix.com`, an A record pointing at the VM. Ports 80 and 443 open. No domain yet? `<ip-with-dashes>.sslip.io` (e.g. `34-120-5-6.sslip.io`) resolves to the VM and gets a real certificate. |
| A Google OAuth client | Only for CarePlix-only sign-in later (see below). |
| An Anthropic API key | From console.anthropic.com, under the CarePlix organization. A personal claude.ai login is not meant for a shared server. |

Cloud Run and other request-scoped platforms are a poor fit: renders need local disk, progress streams stay open for the whole job, and Director runs (once sign-in is on) take 15–60 minutes.

### 1. Configure

On the VM:

```sh
git clone <your copy of this folder> videogen && cd videogen    # or scp the folder
cp .env.example .env
nano .env                                                        # fill in every value
```

| Variable | |
|---|---|
| `DOMAIN`, `PUBLIC_URL` | The hostname, and `https://` + hostname |
| `OPEN_ACCESS` | `1` for the open site |
| `ANTHROPIC_API_KEY` | The Claude API key |
| `LIMIT_*_PER_HOUR` | The open site's hourly limits |
| `RENDER_SLOTS` | Concurrent full-film renders (each uses 4 browser workers) |

### 2. Run

```sh
docker compose up -d --build        # first build: a few minutes on a fast connection (library, browser, 354 MB voice model)
docker compose logs -f videogen     # expect: "VideoGen running at https://… (OPEN to everyone, no sign-in; Director off; …)"
```

Open `https://<DOMAIN>`: the studio opens directly. The Studio tab says Director mode is off on the public site.

## Video shots (Productions)

Storyboard frames become video shots in **Productions → Shoot**. People see three engines by plain names:

| In the app | Engine | Needs |
|---|---|---|
| Standard | Veo 3.1 Fast on Vertex AI | nothing: the VM's service account, like the frames |
| Premium | Veo 3.1 on Vertex AI | nothing |
| Character | Kling through fal.ai | a fal.ai key: `./deploy/gcp-keys.sh` asks for it (not shown), stores it in the VM's `.env`, restarts the app, and can also save it in `.env.local` for local testing |

A shot needs an Illustrated or Cinematic frame to start from; graphics shots stay brand cards. **Make the rough cut** puts the chosen takes on the timeline with the voice-over and music and opens it in Create. `./deploy/gcp-keys.sh FAL_KEY --off` removes the key.

## Google sign-in, CarePlix only

In Google Cloud Console, in a project under the **careplix.com** organization (`careplix-labs` is):

1. **Google Auth Platform → Branding / Audience** (formerly "OAuth consent screen"): user type **Internal**, so only accounts in the CarePlix Google Workspace can reach the consent screen at all. App name "VideoGen Studio"; scopes `openid`, `email`, `profile`.
2. **Google Auth Platform → Clients → Create client**, type **Web application**, with the authorized redirect URI `https://<DOMAIN>/auth/google/callback` (today `https://34-134-160-18.sslip.io/auth/google/callback`; `gcp-signin.sh` prints it).
3. Run `./deploy/gcp-signin.sh` and paste the client ID and secret when asked (the secret isn't shown). It sets the variables below on the VM, creates a session key if there isn't one, restarts the app and checks the site now asks for sign-in. `./deploy/gcp-signin.sh --off` goes back to an open site. Later deploys keep sign-in on.

The server enforces the domain a second time, independently of the consent screen. It accepts an ID token only when:
- its signature checks out against Google's published keys;
- the issuer is Google;
- the audience is your client ID;
- the token hasn't expired;
- the nonce matches the one this server sent;
- the email is verified;
- both the Workspace `hd` claim and the email address belong to `ALLOWED_DOMAINS`.

Then add these to `.env` (the commented block at the bottom of `.env.example`) and run `docker compose up -d` again:

| Variable | |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From the OAuth client |
| `ALLOWED_DOMAINS` | `careplix.com` (comma-separate to add more) |
| `SESSION_SECRET` | `openssl rand -hex 32`; changing it signs everyone out |
| `MAX_DIRECTORS`, `DIRECTOR_USERS` | Director productions at once (0 = off), and who may start them |

With sign-in on, open access switches off by itself, every route needs a CarePlix session, and Director mode can be enabled.

## Tested

On an Arm (arm64) Docker host, the image builds cleanly:
- Debian trixie;
- ffmpeg 7.1.5;
- Playwright's Chromium dependencies;
- the library with its voice model;
- the Claude Code CLI and the lemo-opuscar plugin.

The running container passed these checks:
- **Sign-in gates:** signed-out visitors go to the sign-in page, and a CarePlix session is accepted.
- **Everything installed:** all 66 styles, the offline voice and the Claude CLI.
- **Brand kits:** saving a kit fetched its fonts.
- **A full film:** a branded, narrated 45-second film rendered in 55 seconds with 6 vCPUs, at −14.3 LUFS, and its narration transcribed correctly.
- **Config files:** `docker compose config` and `caddy validate` both pass.

**Live on Google Cloud** (careplix-labs, `e2-standard-8`, x86), deployed with `deploy/gcp-up.sh` to an sslip.io address:
- **HTTPS:** a valid Let's Encrypt certificate, renewed automatically by Caddy.
- **Open mode:** no sign-in, Director off, and HSTS and security headers sent.
- **Claude:** works on the server with the API key.
- **A full film:** a narrated 35-second film exported in 46 seconds, at −14.2 LUFS, with correct narration.

Not yet tested:
- a real Google sign-in round trip, which needs your OAuth client and domain;
- Director mode in the container, which needs sign-in on.

## Operating it

- **Data** lives in the `videogen-data` volume (`/data/films`, `/data/brands`). Back it up with `docker run --rm -v videogen_videogen-data:/d -v $PWD:/b busybox tar czf /b/videogen-data.tgz -C /d .`
- **Update** the app or the style library: `git pull && docker compose up -d --build`. Running jobs stop when the container restarts. Check the Studio for live productions first.
- **Costs** (as measured here):
  - a script is about $0.03 (Sonnet);
  - a brand kit design is about $0.03;
  - a 30-second Director film is about $4 (Opus).
  - Set a monthly spend limit on the API key in the Anthropic Console.
  - The VM is the fixed cost; an `e2-standard-8` runs roughly $200 a month on demand (check current pricing).
- **Logs**: sign-ins and refusals are logged as `[auth] …`.

## Security notes

- **Sessions:** a signed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie lasting 7 days (`SESSION_DAYS`). Every page, file and API route requires a session, except the sign-in page and its background images.
- **Requests:** writes are refused unless they come from `PUBLIC_URL`, and requests addressed to any other host name are refused.
- **Director mode runs an agent with shell access inside the container.** It runs as the same unprivileged user as the web server. It gets a minimal environment: the Anthropic key, but not the Google or session secrets. Even so, treat Director as trusted-user only:
  - keep `DIRECTOR_USERS` to people who need it, or set `MAX_DIRECTORS=0`;
  - don't mount other credentials into the container.
  - Moving productions into their own throwaway container is the next hardening step.
- **Data leaving the server:**
  - Prompts and scripts go to the Anthropic API.
  - Narration is generated offline (Kokoro).
  - Fonts are fetched from GitHub (google/fonts) the first time a brand kit uses them.
  - Style demos in the Styles gallery stream from the official Lemo-Opuscar site.
- **Licences:**
  - Library demo films and frames are CC BY 4.0; credit "LemoLab".
  - Brand-kit fonts are OFL, and each film folder carries the licence file.
  - Films you make are yours.
