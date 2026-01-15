---
---
# Running Checkstack with Docker

This guide walks you through deploying Checkstack using Docker.

## Prerequisites

- Docker installed and running
- PostgreSQL database (or use a managed service like Supabase, Neon, etc.)

## Required Environment Variables

Checkstack requires four environment variables to run:

| Variable | Description | Requirements |
|----------|-------------|--------------|
| `DATABASE_URL` | PostgreSQL connection string | Valid Postgres URI |
| `ENCRYPTION_MASTER_KEY` | Encrypts secrets in the database | 64 hex characters (32 bytes) |
| `BETTER_AUTH_SECRET` | Signs session cookies and OAuth states | Minimum 32 characters |
| `BASE_URL` | Public URL where Checkstack is accessed | Full URL (e.g., `https://status.example.com`) |

## Generating Secrets

### ENCRYPTION_MASTER_KEY

Generate a secure 32-byte key:

```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using OpenSSL
openssl rand -hex 32
```

This produces a 64-character hexadecimal string (e.g., `a1b2c3d4e5f6...`).

### BETTER_AUTH_SECRET

Generate a secure random string (minimum 32 characters):

```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Using OpenSSL
openssl rand -base64 32
```

## Quick Start

```bash
# Pull the latest image
docker pull ghcr.io/enyineer/checkstack:latest

# Run with required environment variables
docker run -d \
  --name checkstack \
  -e DATABASE_URL="postgresql://user:password@host:5432/checkstack" \
  -e ENCRYPTION_MASTER_KEY="<your-64-char-hex-key>" \
  -e BETTER_AUTH_SECRET="<your-32-char-secret>" \
  -e BASE_URL="http://localhost:3000" \
  -p 3000:3000 \
  ghcr.io/enyineer/checkstack:latest
```

## Docker Compose (Recommended)

The Checkstack repository includes a ready-to-use `docker-compose.yml` in the project root that runs both Checkstack and PostgreSQL:

```bash
# Clone the repository (or download just the docker-compose.yml)
git clone https://github.com/enyineer/checkstack.git
cd checkstack

# Create your .env file with required secrets
cat > .env << EOF
POSTGRES_USER=checkstack
POSTGRES_PASSWORD=checkstack
POSTGRES_DB=checkstack
ENCRYPTION_MASTER_KEY=$(openssl rand -hex 32)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BASE_URL=http://localhost:3000
EOF

# Start everything
docker compose up -d
```

### Updating the Checkstack Image

To update to a newer version:

```bash
# Pull the latest image
docker compose pull

# Recreate containers with the new image
docker compose up -d
```

> [!TIP]
> You can also pin to a specific version by editing the `image:` line in `docker-compose.yml`:
> ```yaml
> image: ghcr.io/enyineer/checkstack:v1.2.3
> ```

## Quick Start (Single Container)

If you already have a PostgreSQL database, you can run Checkstack as a single container:

```bash
docker run -d \
  --name checkstack \
  -e DATABASE_URL="postgresql://user:password@host:5432/checkstack" \
  -e ENCRYPTION_MASTER_KEY="<your-64-char-hex-key>" \
  -e BETTER_AUTH_SECRET="<your-32-char-secret>" \
  -e BASE_URL="http://localhost:3000" \
  -p 3000:3000 \
  ghcr.io/enyineer/checkstack:latest
```

## Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `INTERNAL_URL` | (falls back to `BASE_URL`) | Internal RPC URL for backend-to-backend calls. Set to K8s service name (e.g., `http://checkstack-service:3000`) for multi-pod load balancing. |

## Default Admin Credentials

On first startup, Checkstack creates a default admin user:

- **Email**: `admin@checkstack.dev`
- **Password**: `admin`

> [!CAUTION]
> Change the default admin password immediately after first login!

## Health Check

Verify Checkstack is running:

```bash
curl http://localhost:3000/api/health
```

## Troubleshooting

### "ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex characters)"

Your encryption key is not the correct length. Generate a new one using the commands above.

### "BETTER_AUTH_SECRET must be at least 32 characters"

Your auth secret is too short. Generate a longer one using the commands above.

### Database connection errors

- Verify your `DATABASE_URL` is correct and the database is reachable
- Ensure PostgreSQL is running and accepting connections
- Check firewall rules allow connections between containers

## Next Steps

- [Configure authentication strategies](../security/external-applications.md)
- [Set up notification channels](../backend/notification-strategies.md)
- [Create your first health check](../backend/healthcheck-strategies.md)
