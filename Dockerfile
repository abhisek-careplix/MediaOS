# VideoGen Studio: the web app, the Lemo-Opuscar style library and everything it renders with.
# Debian trixie: ffmpeg 7.1 (the library needs 7+) and Python 3.13 (the offline voice needs < 3.14).
FROM node:22-trixie-slim

ARG CLAUDE_CODE_VERSION=latest
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git ca-certificates curl python3 python3-venv fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# system libraries for the headless Chromium the renderer drives (Playwright's list, else the same set by hand)
RUN apt-get update \
 && (npx -y playwright-core install-deps chromium-headless-shell \
     || apt-get install -y --no-install-recommends libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
          libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 libpango-1.0-0 libcairo2 \
          libdbus-1-3 libexpat1 libxshmfence1 libx11-6 libxcb1 libxext6 fonts-liberation) \
 && rm -rf /var/lib/apt/lists/* /root/.npm

# Claude Code: writes scripts and brand kits, and directs films in Director mode
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

RUN useradd -m -u 10001 app && mkdir -p /data && chown app:app /data
USER app
WORKDIR /home/app
ENV LEMO_OPUSCAR_HOME=/home/app/lemo-opuscar

# the style library, its npm/Python packages, the headless browser and the Kokoro voice model (~1.5 GB in all)
RUN git clone --depth 1 https://github.com/lemomo-ai/lemo-opuscar.git /tmp/lo \
 && sh /tmp/lo/plugin/skills/lemo-opuscar/scripts/setup.sh \
 && sh /tmp/lo/plugin/skills/lemo-opuscar/scripts/setup.sh deps voice \
 && rm -rf /tmp/lo /home/app/.npm

# the lemo-opuscar skill, for Director mode
RUN claude plugin marketplace add lemomo-ai/lemo-opuscar && claude plugin install lemo-opuscar@lemolab

COPY --chown=app:app app /home/app/videogen/app
WORKDIR /home/app/videogen
# the app's own packages (PowerPoint export)
RUN cd app && npm ci --omit=dev --no-audit --no-fund && rm -rf /home/app/.npm

ENV HOST=0.0.0.0 \
    PORT=5178 \
    VIDEOGEN_FILMS=/data/films \
    VIDEOGEN_BRANDS=/data/brands \
    VIDEOGEN_PROOF=/data/proof \
    VIDEOGEN_UPLOADS=/data/uploads \
    VIDEOGEN_GOVERNANCE=/data/governance \
    RENDER_SLOTS=2
VOLUME /data
EXPOSE 5178
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fs http://127.0.0.1:5178/login -o /dev/null -H 'Host: localhost' || exit 1
CMD ["node", "app/server.mjs"]
