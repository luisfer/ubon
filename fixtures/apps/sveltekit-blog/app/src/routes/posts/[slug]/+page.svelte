<script lang="ts">
  let { data } = $props();
</script>

<article>
  <h1>{data.post.title}</h1>
  <!-- Rendered from Markdown by the author when the post was saved. -->
  {@html data.post.html}
</article>
