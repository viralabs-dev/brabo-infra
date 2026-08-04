/**
 * Verificador de layout — o que só o navegador sabe.
 *
 * Contraste é aritmética e vive num teste (`apps/web/src/lib/contraste.ts`).
 * Texto vazando, menu fora da tela e alvo de clique pequeno demais dependem de
 * LAYOUT REAL: largura de fonte, quebra de linha, posição calculada. Nenhum
 * ambiente de teste do repositório faz layout — jsdom não mede nada —, então
 * esta verificação roda no Chrome, contra a aplicação de pé.
 *
 * Uso: cole no console do DevTools, ou rode pelo agente com o
 * `javascript_tool`. Devolve JSON — a saída é para ser lida por quem decide, e
 * o que ela acha vira achado, não correção automática.
 *
 * Deliberadamente SEM dependência: nada de axe-core ou Playwright. Um
 * verificador que exige instalar um runtime novo não é rodado.
 */
(() => {
  const MIN_ALVO = 24; // px — piso de alvo de toque que a WCAG 2.2 (AA) pede
  const achados = [];

  const visivel = (el) => {
    const s = getComputedStyle(el);
    return (
      s.display !== 'none' &&
      s.visibility !== 'hidden' &&
      s.opacity !== '0' &&
      el.getClientRects().length > 0
    );
  };

  const nomear = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      : '';
    const txt = (el.textContent ?? '').trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` — “${txt}”` : ''}`;
  };

  for (const el of document.querySelectorAll('body *')) {
    if (!visivel(el)) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);

    // 1. TEXTO VAZANDO: o conteúdo é mais largo/alto que a caixa e o overflow
    //    não é rolável — ou seja, existe texto que ninguém consegue ler.
    const cortaX = el.scrollWidth > el.clientWidth + 1;
    const cortaY = el.scrollHeight > el.clientHeight + 1;
    const rolavelX = ['auto', 'scroll'].includes(s.overflowX);
    const rolavelY = ['auto', 'scroll'].includes(s.overflowY);
    const temTextoProprio = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim() !== '',
    );
    if (temTextoProprio && ((cortaX && !rolavelX) || (cortaY && !rolavelY))) {
      achados.push({
        tipo: 'texto-cortado',
        elemento: nomear(el),
        detalhe: `conteúdo ${el.scrollWidth}×${el.scrollHeight} numa caixa ${el.clientWidth}×${el.clientHeight}, overflow ${s.overflow}`,
      });
    }

    // 2. FORA DA TELA: elemento posicionado (menu, dropdown, tooltip) cujo
    //    retângulo sai da viewport. É o "menu mal posto".
    const posicionado = ['absolute', 'fixed'].includes(s.position);
    if (posicionado && r.width > 0 && r.height > 0) {
      const foraDireita = r.right > window.innerWidth + 1;
      const foraEsquerda = r.left < -1;
      const foraBaixo = r.bottom > window.innerHeight + 1;
      if (foraDireita || foraEsquerda || foraBaixo) {
        achados.push({
          tipo: 'fora-da-viewport',
          elemento: nomear(el),
          detalhe: `rect ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} · viewport ${window.innerWidth}×${window.innerHeight}`,
        });
      }
    }

    // 3. RECORTADO PELO ANCESTRAL: o clássico dropdown dentro de um container
    //    com `overflow: hidden` — ele existe, tem tamanho, e some na tela.
    if (posicionado && r.width > 0) {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflow === 'hidden' || ps.overflowY === 'hidden') {
          const pr = p.getBoundingClientRect();
          if (r.bottom > pr.bottom + 1 || r.top < pr.top - 1) {
            achados.push({
              tipo: 'recortado-por-ancestral',
              elemento: nomear(el),
              detalhe: `ancestral ${nomear(p)} tem overflow hidden e corta em ${Math.round(pr.bottom)}`,
            });
          }
          break;
        }
      }
    }

    // 4. ALVO PEQUENO: botão/link menor que o piso de toque.
    const clicavel =
      el.tagName === 'BUTTON' ||
      el.tagName === 'A' ||
      el.getAttribute('role') === 'button';
    if (clicavel && r.width > 0 && (r.width < MIN_ALVO || r.height < MIN_ALVO)) {
      achados.push({
        tipo: 'alvo-pequeno',
        elemento: nomear(el),
        detalhe: `${Math.round(r.width)}×${Math.round(r.height)}px, piso ${MIN_ALVO}`,
      });
    }
  }

  // Dedup: a mesma caixa costuma acusar o mesmo problema em pai e filho.
  const vistos = new Set();
  const unicos = achados.filter((a) => {
    const chave = `${a.tipo}|${a.elemento}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  return {
    url: location.pathname,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    total: unicos.length,
    porTipo: unicos.reduce((acc, a) => {
      acc[a.tipo] = (acc[a.tipo] ?? 0) + 1;
      return acc;
    }, {}),
    achados: unicos.slice(0, 40),
  };
})();
