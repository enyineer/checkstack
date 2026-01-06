# Checkmate System Monitor

Checkmate is a system monitor which allows you to configure Health-Checks and automatically communicate to your users if something breaks.

> [!WARNING]
> Checkmate is currently in alpha and is not ready for production use.
>
> Breaking changes are to be expected regularly in this development phase. We're still happy if you try it out and give us feedback!

## Running locally

To run this project in development, run `bun run dev` in the root directory.

This command will automatically:
1. Start the Docker infrastructure (Postgres & PgAdmin).
2. Start the Backend server (Port 3000).
3. Start the Frontend server (Vite default port).

### Infrastructure

The `bun run dev` command relies on `docker-compose`. Ensure Docker Desktop is running.

- **Postgres Database**: Exposed on port `5432`.
- **PgAdmin**: Exposed on port `5050` (`http://localhost:5050`).
  - **Email**: `admin@checkmate-monitor.com`
  - **Password**: `admin`
  - **Server connection**: Use hostname `postgres` (internal Docker network) or `localhost` (if mapped). Credentials: `checkmate` / `checkmate`.

To stop the Docker containers, run:
```bash
bun run docker:stop
```

## Developer Documentation

For comprehensive documentation on building plugins, architecture guides, and API references, see the **[Documentation Index](./docs/README.md)**.


## License

This project is licensed under the [Elastic License 2.0](LICENSE.md).

**What this means:**
✅ **You can** use this software for free in your company (internally), for personal projects, or for research.
✅ **You can** modify the code and distribute it to others (as long as you keep the license and copyright).
✅ **You can** build commercial applications *on top* of this software (e.g., using it as a database or library).

❌ **You cannot** sell this software as a managed service (SaaS) where the software itself is the product.
❌ **You cannot** remove or hack the license keys (if applicable).

If you need to use this software as part of a managed commercial service, please [contact us](mailto:hi@enking.dev) for a commercial license.