<script lang="ts">
  let { form } = $props();
</script>

<form method="POST">
  <textarea name="markdown">{form?.markdown ?? ''}</textarea>
  <button>Preview</button>
</form>

{#if form}
  <section>{@html form.html}</section> <!-- expect-block: web/xss-html-sink -->
  <section>{@html form.clean}</section> <!-- ok: the action sanitizes it before returning it -->
  <p>{form.saved}</p> <!-- ok: interpolation is escaped -->
{/if}
