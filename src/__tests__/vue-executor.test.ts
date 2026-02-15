import { runVueSecurityChecks } from '../scanners/security/executors/vue-executor';

describe('vue security executor', () => {
  it('detects unsafe v-html bindings in vue files', () => {
    const results = runVueSecurityChecks({
      file: 'App.vue',
      lines: ['<template><div v-html="rawHtml"></div></template>']
    });

    expect(results.some((r) => r.ruleId === 'VUE001')).toBe(true);
  });

  it('ignores non-vue files', () => {
    const results = runVueSecurityChecks({
      file: 'src/component.tsx',
      lines: ['const x = "<div v-html=\\"rawHtml\\"></div>";']
    });

    expect(results).toHaveLength(0);
  });
});
