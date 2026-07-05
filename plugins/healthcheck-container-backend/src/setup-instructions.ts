/**
 * Operator setup guide, rendered in the health-check editor's config form
 * (Strategy DTO `setupInstructions`). Deliberately does NOT inline the proxy
 * compose - that lives in one canonical file so it is maintained in a single
 * place. This points operators at it and the full guide. Markdown, no
 * em-dashes.
 */
export const containerSetupInstructions = `
Checkstack never talks to the raw container socket. Run a **read-only socket-proxy** next to whichever Checkstack instance will run this check - your **core** instance or a **satellite** - and point the check at the proxy. Even a fully compromised instance can then only *read* container state, never control the host.

Checkstack ships a canonical, hardened proxy compose file (read-only, \`POST=0\`, internal-only network). \`include:\` it from your core or satellite compose rather than copying it:

\`\`\`bash
curl -o socket-proxy.yml \\
  https://raw.githubusercontent.com/enyineer/checkstack/main/deploy/socket-proxy/docker-compose.yml
\`\`\`

\`\`\`yaml
include:
  - socket-proxy.yml
services:
  checkstack:            # or "satellite:"
    networks: [default, checkstack-internal]
\`\`\`

Then set the **Endpoint** below to \`http://socket-proxy:2375\` (the default), and run the check locally on core (the default) or assign it to the satellite on that host.

**Podman:** enable the rootless socket (\`systemctl --user enable --now podman.sock\`) and set the endpoint to \`unix:///run/user/<uid>/podman/podman.sock\`, or front it with the same proxy (it speaks the libpod API).

Full walkthrough, including the multi-pod core caveat: [Monitor containers](https://enyineer.github.io/checkstack/user-guide/guides/monitor-containers/).
`.trim();
