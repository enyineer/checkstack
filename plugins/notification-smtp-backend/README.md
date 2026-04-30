# SMTP Notification Plugin for Checkstack

This plugin provides SMTP-based email notification support for the Checkstack platform.

## Local Test Environment

To test SMTP notifications locally, we provide a pre-configured [Mailpit](https://mailpit.axllent.org/) instance. Mailpit is a lightweight SMTP testing server that captures all outgoing emails and exposes them via a web UI — no real emails are sent.

### 1. Start Mailpit

```bash
cd docker
docker-compose up -d
```

This will start:
- **SMTP server**: Port `1025`
- **Web UI**: Port `8025`

### 2. Configure the SMTP Strategy

In the Checkstack admin settings, configure the SMTP notification strategy with the following values:

- **Host**: `localhost`
- **Port**: `1025`
- **Secure (TLS/SSL)**: `false`
- **Username**: _(any value, or leave empty)_
- **Password**: _(any value, or leave empty)_
- **From Address**: `notifications@example.com`
- **From Name**: `Checkstack`

> Mailpit is configured with `MP_SMTP_AUTH_ACCEPT_ANY=1`, so any credentials (or none) will be accepted.

### 3. View Captured Emails

Open [http://localhost:8025](http://localhost:8025) in your browser to see all emails sent through Mailpit. The UI lets you inspect message headers, HTML/plain text bodies, and attachments.

### 4. Stop Mailpit

```bash
cd docker
docker-compose down
```

To also clear captured messages, remove the volume:

```bash
docker-compose down -v
```
