# Aragorn Ring / coordinator image for Railway (Option A: fixed services).
# One image, multiple services — each Railway service overrides the start command + env.
#   - coordinator: bun apps/coordinator/src/index.ts
#   - ring:        node --experimental-wasm-modules … apps/ring/src/index.ts  (biscuit-wasm needs Node, not bun)
# Settlement reuses the existing Sepolia deployment (addresses passed via env), so no
# deployments.sepolia.json / on-chain deploy is needed at runtime.
FROM node:22-slim

# bun for install (workspaces) + tiny utils
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash \
  && ln -s /root/.bun/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile || bun install

# Railway injects PORT; the ring/coordinator read it.
ENV NODE_ENV=production
# One image, two roles: SERVICE_ROLE=coordinator runs the coordinator (bun);
# anything else runs a ring (Node, for biscuit-wasm). Set SERVICE_ROLE per Railway service.
CMD ["sh","-c","if [ \"$SERVICE_ROLE\" = coordinator ]; then exec bun apps/coordinator/src/index.ts; else exec node --experimental-wasm-modules --experimental-transform-types --no-warnings apps/ring/src/index.ts; fi"]
