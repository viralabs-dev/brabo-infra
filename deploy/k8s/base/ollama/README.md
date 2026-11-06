# Ollama em k8s — template, não deploy ativo

`job-model-loader.yaml` **não está referenciado em nenhuma kustomization**
(nem `base/kustomization.yaml`, nem overlay nenhum) e **não foi validado com
`kustomize build`/`kubeconform` como parte da árvore ativa** — só validado
como YAML solto (`kubeconform` direto no arquivo).

Por quê: `deploy/k8s/` não tem hoje NENHUM manifest do `ollama` em si — nem
Deployment, nem Service, nem StatefulSet. O `ollama` de produção no
`docker-compose.prod.yml` já é opcional (`profiles: ["llm"]`, porque em
produção o provider de chat normalmente é externo), então "Ollama em k8s"
seria uma decisão de arquitetura própria, fora do escopo desta frente (que é
subir o serviço `neo4j` + o loader de modelos no compose, mais o mínimo
declarado de k8s).

Este arquivo existe como PONTO DE PARTIDA para quando essa decisão for
tomada: quando um `ollama/deployment.yaml` + `ollama/service.yaml` existirem
com um Service chamado `ollama` expondo a porta 11434, este Job passa a fazer
sentido — hoje ele pressupõe um destino que não existe, e adicioná-lo ao
deploy ativo faria o Job entrar em CrashLoopBackOff em todo `kubectl apply
-k` real.

A lógica de referência (a que FOI validada de ponta a ponta, real, com
download de modelo de verdade) é `docker/ollama/pull-models.sh` — este Job
reduz a mesma lógica inline por não valer a pena montar ConfigMap/volume
para um manifest que ninguém aplica ainda.
