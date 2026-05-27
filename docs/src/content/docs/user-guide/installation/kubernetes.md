---
title: Kubernetes
description: Deploy Checkstack on Kubernetes as a Deployment with a managed Postgres, using the built-in health and readiness probes.
---

Checkstack runs cleanly on Kubernetes as a single Deployment plus a Service. There is no official Helm chart at the time of writing; the manifests below are minimal but production-shaped. Use them as a starting point and adapt to your cluster's conventions.

> [!IMPORTANT]
> Checkstack does not officially support multi-replica deployments yet. Run with `replicas: 1`. The roadmap covers horizontal scaling, but for the current v1.x line the supported topology is one Checkstack pod plus one Postgres.

## Prerequisites

- Kubernetes 1.27+ (older versions probably work but are not tested).
- A PostgreSQL 14+ database reachable from the cluster. Use a managed service (RDS, Cloud SQL, ...), a Postgres operator (Zalando, CrunchyData, ...), or a single-replica StatefulSet for a starter setup.
- `kubectl` configured for the target namespace.

## The shape

```
Ingress -> Service (ClusterIP, port 80 -> 3000) -> Deployment (1 replica)
                                                       |
                                                       v
                                            external Postgres
```

The Checkstack pod terminates the application traffic on `:3000`. The Service exposes it as ClusterIP; an Ingress or a LoadBalancer Service handles external traffic and TLS.

## Secrets

Put every sensitive value in a `Secret`. Never put `ENCRYPTION_MASTER_KEY` or `BETTER_AUTH_SECRET` in a ConfigMap.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: checkstack-secrets
  namespace: checkstack
type: Opaque
stringData:
  DATABASE_URL: "postgresql://checkstack:STRONG_PASSWORD@postgres.checkstack.svc.cluster.local:5432/checkstack"
  # 64 hex characters. Generate with: openssl rand -hex 32
  ENCRYPTION_MASTER_KEY: "REPLACE_WITH_64_HEX_CHARS"
  # At least 32 characters. Generate with: openssl rand -base64 32
  BETTER_AUTH_SECRET: "REPLACE_WITH_32_PLUS_CHARS"
```

If you use an external secret manager (External Secrets Operator, sealed-secrets, SOPS, Vault Secrets Operator, ...), feed these keys from there. Just make sure the resulting `Secret` is in the same namespace as the Deployment.

> [!CAUTION]
> Losing `ENCRYPTION_MASTER_KEY` makes every encrypted secret in Checkstack's database unrecoverable. Treat it like a root credential. See [Secret encryption](/checkstack/user-guide/reference/secret-encryption/).

## ConfigMap for non-sensitive values

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: checkstack-config
  namespace: checkstack
data:
  BASE_URL: "https://status.example.com"
  # Optional. Internal pod-to-pod URL for plugin RPC. Defaults to BASE_URL.
  INTERNAL_URL: "http://checkstack.checkstack.svc.cluster.local:3000"
  LOG_LEVEL: "info"
```

`BASE_URL` MUST be the public URL users hit in the browser. It is used for CORS, redirect URIs, and the runtime `/api/config` endpoint the frontend reads. A mismatch causes the onboarding screen to silently fail to load.

`INTERNAL_URL`, if set, is what plugins use to call each other inside the cluster. Set this to the Service DNS name so internal RPC stays on the cluster network.

## Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkstack
  namespace: checkstack
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: checkstack
  template:
    metadata:
      labels:
        app: checkstack
    spec:
      containers:
        - name: checkstack
          image: ghcr.io/enyineer/checkstack:<version>
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - secretRef:
                name: checkstack-secrets
            - configMapRef:
                name: checkstack-config
          livenessProbe:
            httpGet:
              path: /.checkstack/health
              port: http
            initialDelaySeconds: 30
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /.checkstack/ready
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
            timeoutSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              cpu: "1"
              memory: 1Gi
```

The probes deserve a closer look:

- **`/.checkstack/health`** answers 200 as soon as the process is up, even before plugins finish loading. That makes it a true liveness signal: if it stops answering, kubelet should kill the pod.
- **`/.checkstack/ready`** answers 200 only when init has completed *and* every critical readiness probe registered by the platform and plugins is passing. While init is running, it returns 503 with a `Retry-After`. This is what gates traffic from the Service.

See [Health probes](/checkstack/user-guide/reference/health-probes/) for the full contract, including how plugin-contributed probes show up in the response body.

> [!TIP]
> `strategy.type: Recreate` is the recommended setting for a single-replica deployment. Rolling updates with one replica still cause downtime; Recreate avoids the brief overlap where two pods would compete for the same database state (see the upgrade notes).

## Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: checkstack
  namespace: checkstack
spec:
  type: ClusterIP
  selector:
    app: checkstack
  ports:
    - name: http
      port: 80
      targetPort: http
```

Use ClusterIP and put an Ingress in front for TLS termination. If your cluster does not have an Ingress controller, switch to LoadBalancer.

## Ingress (TLS-terminating)

A minimal example with nginx-ingress and cert-manager. Adapt class names and TLS issuers to your cluster.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: checkstack
  namespace: checkstack
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - status.example.com
      secretName: checkstack-tls
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

The long proxy timeouts matter: Checkstack uses WebSockets for realtime signals and (with satellites) for satellite connections.

## Postgres

You have three reasonable options:

1. **Managed.** AWS RDS, GCP Cloud SQL, Azure Database, Crunchy Bridge, Supabase, Neon, ... point `DATABASE_URL` at the managed connection string. Recommended for production.
2. **Operator.** Zalando Postgres Operator, CrunchyData PGO. Production-grade, lives in-cluster, more moving parts.
3. **StatefulSet.** A single-replica Postgres in a StatefulSet with a PVC. Easiest, no HA. Acceptable for small installs.

For (3) the manifest is straightforward; pick `postgres:16-alpine`, mount a PVC at `/var/lib/postgresql/data`, and set `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` via a Secret. Use the same `DATABASE_URL` shape shown above to wire Checkstack to it.

> [!WARNING]
> Whatever path you pick, snapshot the database. Checkstack does not back itself up. A weekly logical dump plus continuous WAL archiving is the safe baseline for production.

## Optional: satellite as a separate Deployment

If you want a satellite running in the same cluster or another cluster, deploy it as its own Deployment. Create the satellite record in Checkstack's UI first to get the client ID and token; then:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkstack-satellite
  namespace: checkstack
spec:
  replicas: 1
  selector:
    matchLabels:
      app: checkstack-satellite
  template:
    metadata:
      labels:
        app: checkstack-satellite
    spec:
      containers:
        - name: satellite
          image: ghcr.io/enyineer/checkstack-satellite:<version>
          env:
            - name: CHECKSTACK_CORE_URL
              value: "http://checkstack.checkstack.svc.cluster.local:3000"
            - name: CHECKSTACK_SATELLITE_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: checkstack-satellite-creds
                  key: clientId
            - name: CHECKSTACK_SATELLITE_TOKEN
              valueFrom:
                secretKeyRef:
                  name: checkstack-satellite-creds
                  key: token
```

For multi-region or off-cluster satellites, switch `CHECKSTACK_CORE_URL` to the public HTTPS URL of the core and run the satellite wherever you want the probes to originate from.

## Applying the manifests

Put the YAML in a directory and apply with kustomize or kubectl:

```bash
kubectl create namespace checkstack
kubectl -n checkstack apply -f .
```

Watch the rollout:

```bash
kubectl -n checkstack rollout status deploy/checkstack
kubectl -n checkstack logs -f deploy/checkstack
```

Once `kubectl -n checkstack get pods` shows the pod as `Ready`, open `BASE_URL` in a browser. See [First-run setup](/checkstack/user-guide/installation/first-run-setup/).

## Upgrades

For a single-replica deployment, upgrades are a brief outage:

1. Update the `image:` field to the new pinned tag.
2. `kubectl apply -f deployment.yaml`.
3. With `strategy.type: Recreate`, kubelet stops the old pod and starts the new one in sequence.

The new pod runs database migrations on boot (Drizzle migrations per plugin schema). Readiness will stay false until migrations complete, which keeps the Service from sending traffic to a half-migrated instance.

> [!TIP]
> Pin the image tag to a specific version, never use `:latest`. See [Upgrading](/checkstack/user-guide/installation/upgrading/) for the BETA versioning policy and rolling-restart story.

## Where to go next

- [First-run setup](/checkstack/user-guide/installation/first-run-setup/) walks through the onboarding flow once the pod is ready.
- [Health probes](/checkstack/user-guide/reference/health-probes/) details what the readiness response means.
- [Configuration reference](/checkstack/user-guide/reference/) lists every supported environment variable.
- [Upgrading](/checkstack/user-guide/installation/upgrading/) for upgrade mechanics and version pinning.
