# Ollama on k8s — template, not an active deployment

`job-model-loader.yaml` is **not referenced by any kustomization**
(neither `base/kustomization.yaml` nor any overlay) and was **not validated with
`kustomize build`/`kubeconform` as part of the active tree** — it was only validated
as loose YAML (`kubeconform` directly on the file).

Why: `deploy/k8s/` today has NO `ollama` manifest at all — neither a Deployment,
nor a Service, nor a StatefulSet. The production `ollama` in `docker-compose.prod.yml`
is already optional (`profiles: ["llm"]`, because in production the chat provider is usually
external), so "Ollama on k8s" would be an architecture decision of its own, outside the scope of this front (which is
bringing up the `neo4j` service + the model loader in compose, plus the minimum
declared k8s).

This file exists as a STARTING POINT for when that decision is made: once an
`ollama/deployment.yaml` + `ollama/service.yaml` exist with a Service named `ollama`
exposing port 11434, this Job starts to make sense — today it assumes a target that does
not exist, and adding it to the active deploy would make the Job enter CrashLoopBackOff on every real `kubectl apply
-k`.

The reference logic (the one that WAS validated end to end, for real, with an actual model
download) is `docker/ollama/pull-models.sh` — this Job inlines the same
logic because it is not worth mounting a ConfigMap/volume for a manifest nobody applies yet.
