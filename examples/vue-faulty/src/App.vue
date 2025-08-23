<template>
  <div>
    <!-- A11Y001/A11Y006: img without alt or dimensions -->
    <img src="/hero.png" />
    <!-- A11Y004: clickable div -->
    <div @click="clicked">Press</div>
    <!-- SEC008: env fallback -->
    <pre>{{ apiUrl || 'http://admin:password@api.example.com' }}</pre>
    <!-- SEC016: eval -->
    <pre>{{ eval('1+1') }}</pre>
  </div>
</template>

<script setup lang="ts">
const apiUrl = (import.meta as any).env?.VITE_API_URL;
function clicked() {
  alert('clicked');
}
</script>


