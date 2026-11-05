import { defineConfig } from 'vitest/config';

// Lógica pura e leitura de arquivo: sem banco, sem rede. As aferições cruzadas leem os
// clones irmãos (BRABO_IRMAOS, padrão `..`) — ver scripts/ci/irmaos.ts.
export default defineConfig({
  test: { include: ['scripts/**/*.spec.ts'] },
});
