# Neo4j — status de validação

Estes manifests (`statefulset.yaml`, `service.yaml`, `netpol.yaml`) fazem
parte do `base/kustomization.yaml` — entram em TODOS os overlays
(local/staging/prod) — e passam nas duas checagens sem cluster que
`deploy/k8s/validate.sh` roda: `kustomize build` (monta) e `kubeconform`
(schema válido contra o Kubernetes 1.31).

**NÃO foram testados contra um cluster real (`kubectl apply`).** Não subiram
no k3d local, não foi exercitado failover, não foi medido consumo real de
CPU/memória sob carga, e o `readinessProbe` (`cypher-shell`) nunca foi
observado num Pod de verdade — só no container equivalente do
`docker-compose.yml`, onde o mesmo desenho (StatefulSet → container único,
mesmas env vars, mesma probe via `cypher-shell`) foi validado de ponta a
ponta.

Duas decisões registradas aqui porque não há ADR para elas ainda (a decisão
maior — adotar Neo4j — está descrita na branch/PR desta frente, não em
`docs/adr/`):

- `resources.requests/limits` do StatefulSet são um CHUTE conservador (mesma
  ordem de grandeza do `docker-compose.yml` de dev), nunca medido sob carga
  real.
- `storageClassName` fica em aberto nos `volumeClaimTemplates` (usa o default
  do cluster) — ao contrário do PVC compartilhado api/engine
  (`common/pvc-shared-data.yaml`), Neo4j só precisa de `ReadWriteOnce`, que a
  maioria das StorageClass default oferece. Se um cluster real não tiver uma,
  isso só aparece na hora do `kubectl apply`.
