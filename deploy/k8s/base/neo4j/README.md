# Neo4j — validation status

These manifests (`statefulset.yaml`, `service.yaml`, `netpol.yaml`) are part of
`base/kustomization.yaml` — they go into ALL overlays (local/staging/prod) — and
they pass the two checks without a cluster that `deploy/k8s/validate.sh` runs:
`kustomize build` (assembles) and `kubeconform` (valid schema against Kubernetes 1.31).

**Update (2026-09-13): they RAN on a real cluster for the first time** — the
k3d cluster that `.github/workflows/propriedades.yml` creates on an Actions runner, via the
same `bootstrap.sh` as `make deploy-local`. And they only ran after fixing
three defects that neither of the two checks without a cluster can see: the container
died on boot with `Unrecognized setting ... PASSWORD` (the `NEO4J_USER`/
`NEO4J_PASSWORD` envs of the StatefulSet itself, see the comment there), the bootstrap's
source Secret had no `NEO4J_PASSWORD`, and the api did not receive `NEO4J_URI`/
`NEO4J_USER`. Measured there: the pod stays `1/1 Running` and the `readinessProbe` passes
after ONE 5s timeout failure on boot. The rest of the paragraph below
still holds — failover and load consumption remain unmeasured.

**They were NOT tested against a real cluster (`kubectl apply`).** They did not run
on the local k3d, failover was not exercised, real CPU/memory consumption under load was not measured,
and the `readinessProbe` (`cypher-shell`) was never observed in a real Pod — only in the equivalent
container of `docker-compose.yml`, where the same design (StatefulSet → single container,
same env vars, same `cypher-shell` probe) was validated end to end.

Two decisions recorded here because there is no ADR for them yet (the larger
decision — adopting Neo4j — is described in the branch/PR of this front, not in
`docs/adr/`):

- `resources.requests/limits` of the StatefulSet are a conservative GUESS (same
  order of magnitude as the dev `docker-compose.yml`), never measured under load.
- `storageClassName` is left open in the `volumeClaimTemplates` (uses the cluster's
  default) — unlike the shared api/engine PVC (`common/pvc-shared-data.yaml`), Neo4j only
  needs `ReadWriteOnce`, which most default StorageClasses offer. If a real cluster
  has none, this only shows up at `kubectl apply` time.
