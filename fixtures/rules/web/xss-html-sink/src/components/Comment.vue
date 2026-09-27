<script setup lang="ts">
import { useRoute } from 'vue-router';

defineProps<{ comment: { body: string } }>();
const route = useRoute();
const note = route.query.note as string;
const banner = '<strong>Welcome</strong>';
</script>

<template>
  <div v-html="comment.body"></div> <!-- expect-warn: web/xss-html-sink -->
  <p v-html="note"></p> <!-- expect-block: web/xss-html-sink -->
  <p v-html="banner"></p> <!-- ok: constant from the script block -->
  <p>{{ note }}</p> <!-- ok: interpolation is escaped -->
</template>
