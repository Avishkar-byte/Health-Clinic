FROM node:20-slim

# Install OpenSSL which is required by Prisma
RUN apt-get update -y && apt-get install -y openssl

# Enable pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy the entire workspace
COPY . .

# Install all dependencies
RUN pnpm install

# Generate Prisma Client (needed before building)
RUN pnpm --filter=@healthcare/db generate

# Build workspace dependencies first
RUN pnpm --filter=@healthcare/contracts build
RUN pnpm --filter=@healthcare/prompts build

# Build the API and the Worker
RUN pnpm --filter=@healthcare/api build
RUN pnpm --filter=@healthcare/worker build

# Render sets $PORT at container runtime and routes traffic to it — do not
# hardcode a port. apps/api/src/main.ts already reads process.env.PORT with
# a 4000 fallback for local/other-platform use.
EXPOSE 4000

CMD ["bash", "docker-entrypoint.sh"]
