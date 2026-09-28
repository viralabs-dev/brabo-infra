#!/usr/bin/env bash
# O alarme das provas de `propriedades.yml`, uma issue POR ALVO que falhou.
#
# Saiu do passo inline quando o workflow ganhou o SEGUNDO job (AT-195, a prova
# da instalação por compose, que roda noutro runner): dois jobs com o mesmo
# alarme copiado divergiriam no primeiro ajuste de texto, e o título é a CHAVE
# de reaproveitamento — um título diferente num dos dois abriria issue nova a
# cada falha.
#
# Uso (sourced, num passo com GH_TOKEN e URL_DO_RUN no ambiente):
#   source scripts/ci/alarmar-prova.sh
#   alarmar '<alvo>' '<outcome do passo>' ['<onde olhar além do log>']
#
# Só `failure` alarma: `skipped` de um alvo cujo pré-requisito caiu é alarmado
# pelo pré-requisito, que tem título próprio (o bootstrap, o build).
#
# A busca é `--json` + comparação EXATA de título (o mesmo desenho de
# `tag-release.yml`): o título tem crase, e a sintaxe de busca do GitHub a
# trataria como operador. Uma nova falha do mesmo alvo vira COMENTÁRIO na issue
# aberta — enxurrada de issues idênticas ensina a ignorar.
alarmar() {
  local alvo="$1" desfecho="$2" onde="${3:-}" titulo corpo existente url
  [ "${desfecho}" = "failure" ] || return 0
  titulo="Prova de propriedade falhou: \`${alvo}\`"
  corpo="$(mktemp)"
  {
    echo "A rodada agendada de \`propriedades.yml\` reprovou em \`${alvo}\`."
    echo
    echo "- run: ${URL_DO_RUN}"
    echo "- commit: \`${GITHUB_SHA}\` (${GITHUB_REF_NAME})"
    echo "- data: $(date -u +%Y-%m-%dT%H:%MZ)"
    echo
    echo "O log do passo tem a mensagem do script${onde:+; ${onde}}."
    echo "Uma nova falha deste alvo vira comentário AQUI. Feche a issue quando a prova voltar a passar."
  } > "${corpo}"

  existente="$(TITULO="${titulo}" gh issue list --state open --limit 200 --json number,title \
    --jq '.[] | select(.title == $ENV.TITULO) | .number' | head -1)"

  if [ -n "${existente}" ]; then
    gh issue comment "${existente}" --body-file "${corpo}"
    echo "::notice::comentei na issue #${existente} (${alvo})"
  else
    url="$(gh issue create --title "${titulo}" --body-file "${corpo}")"
    echo "::notice::issue aberta para ${alvo}: ${url}"
  fi
  rm -f "${corpo}"
}
