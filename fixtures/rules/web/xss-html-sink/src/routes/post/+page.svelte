<script lang="ts">
  import DOMPurify from 'isomorphic-dompurify';
  let { data } = $props();
</script>

<article>{@html data.content}</article> <!-- expect-warn: web/xss-html-sink -->
<article>{@html DOMPurify.sanitize(data.content)}</article> <!-- ok: sanitized -->
