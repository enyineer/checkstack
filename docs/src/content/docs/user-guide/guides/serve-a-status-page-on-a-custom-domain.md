---
title: "Serve a status page on a custom domain"
description: "Publish a status page on your own domain like status.example.com over HTTPS, fully isolated from the Checkstack admin UI, using DNS verification and edge TLS."
---

You can serve a published status page on its own domain, for example `status.example.com`, so visitors never see a Checkstack admin URL. The custom-domain surface is isolated from the admin app: only the published page and its data are reachable there, never the admin UI, the API, or any other page. For the full isolation model, see [Status pages](/checkstack/developer-guide/architecture/status-pages/#custom-domains).

You need three things: a status page you can publish, control of the domain's DNS, and an edge (ingress or reverse proxy) that terminates TLS. The flow is: add the domain, prove you own it with a DNS record, point the domain at Checkstack, terminate TLS, and publish.

> [!IMPORTANT]
> A domain only goes live when it is BOTH verified AND the page is published. Verifying the domain alone is not enough.

## 1. Add the domain in the builder

Open the status page in the builder and find the **Custom domain** panel. Enter the host (for example `status.example.com`) and click **Save**. Checkstack generates a one-time DNS verification token and shows the exact TXT record to create.

## 2. Prove ownership with a DNS TXT record

Add the TXT record shown in the builder to your DNS provider, then click **Verify**. The record looks like this (copy the exact value from the builder):

```text
Type   Name                                   Value
TXT    _checkstack-verify.status.example.com  cs-verify-3f2a9c4e-... (from the builder)
```

The `_checkstack-verify` prefix is fixed. Some DNS providers want the record **Name** entered relative to your zone (for example `_checkstack-verify.status` if your zone is `example.com`) rather than fully qualified - check how your provider expects subdomain records.

> [!TIP]
> DNS changes take time to propagate. If Verify reports "No TXT record found", wait a few minutes and try again. You can check propagation with `dig TXT _checkstack-verify.status.example.com` (or `nslookup -type=TXT ...`).

## 3. Point the domain at Checkstack

Add a record so the domain resolves to the same host or load balancer that serves your Checkstack admin URL:

```text
Type    Name      Value
CNAME   status    ingress.example.com.        # the host serving your Checkstack admin URL
# or, if you cannot use a CNAME (e.g. an apex domain):
A       status    203.0.113.10                # your ingress / load-balancer IP
```

Verification (step 2) and pointing the domain (step 3) are independent and can be done in either order.

## 4. Terminate TLS at your edge

Checkstack itself does not terminate TLS; your ingress or reverse proxy does, exactly as it already does for your primary Checkstack domain. Pick whichever matches your deployment.

### Kubernetes (nginx-ingress + cert-manager)

Add an Ingress (and let cert-manager issue the certificate) for the custom host. This assumes you already run nginx-ingress and a cert-manager `ClusterIssuer` named `letsencrypt-prod`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: checkstack-status-example
  namespace: checkstack
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts: ["status.example.com"]
      secretName: status-example-tls
  rules:
    - host: status.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: checkstack
                port:
                  number: 80
```

cert-manager requests a certificate via the HTTP-01 challenge once DNS (step 3) resolves to the ingress. See the [Kubernetes installation guide](/checkstack/user-guide/installation/kubernetes/) for the base setup.

### On-demand TLS (Caddy)

If you front Checkstack with Caddy, let it issue certificates on demand, gated by Checkstack's authorization hook so a certificate is only ever minted for a domain an operator has verified:

```caddy
{
  on_demand_tls {
    # Caddy appends ?domain=<host>; Checkstack returns 200 only for a
    # configured + verified + published custom domain, 404 otherwise.
    ask http://checkstack-backend:3000/.well-known/checkstack/authorize-domain
  }
}

# Serve any host (subject to the on-demand check above) from Checkstack.
https:// {
  tls {
    on_demand
  }
  reverse_proxy checkstack-backend:3000
}
```

### Cloudflare for SaaS

If you use Cloudflare for SaaS to onboard customer domains:

1. Create a **custom hostname** for `status.example.com`.
2. Set the **fallback origin** to your Checkstack ingress hostname.
3. Use `https://<your-checkstack>/.well-known/checkstack/authorize-domain?domain=status.example.com` as the validation check so Cloudflare only provisions for domains Checkstack recognises.

## 5. Publish the page

In the builder, click **Publish**. A verified domain serves nothing until the page is published.

After you verify and publish, the domain begins serving within about a minute. Checkstack briefly caches host lookups (about 60 seconds), so if you visited the domain **before** finishing setup, give it up to a minute for the not-yet-configured result to expire.

## 6. Confirm it is live

Open `https://status.example.com`. You should see your published page. In the builder, the Custom domain panel shows a green **Verified** badge and links to the live URL.

## What visitors can and cannot see

On a custom domain, visitors can reach only the published page and the data in its widgets. The admin UI, the API, other status pages, and platform endpoints are all blocked at the server, regardless of what a client requests. The page is served by a separate minimal bundle that ships none of the admin app. See [Status pages](/checkstack/developer-guide/architecture/status-pages/#the-locked-down-surface) for the full model.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Verify says "No TXT record found" | DNS not propagated yet, or the record name is wrong | Re-check the Name and Value against the builder; wait a few minutes; `dig TXT _checkstack-verify.<domain>` |
| Browser shows a TLS/certificate error | Your edge has not issued a certificate yet | Check the cert-manager `Certificate`/`Order`, or that the `ask` endpoint returns 200 for the host; confirm DNS (step 3) resolves to the edge |
| Page shows "This status page isn't available" / 404 | The page is verified but not published, or you visited before finishing setup | Publish the page; wait up to ~60s for the cached negative result to expire |
| It still shows the admin login look | The domain points at the wrong host | Confirm the CNAME/A record targets the Checkstack ingress |
| A third-party widget renders blank | Its renderer remote did not load | Ensure the widget's plugin is installed; built-in widgets always render |
