<script lang="ts">
  let { form } = $props();
</script>

<form method="POST">
  <textarea name="markdown">{form?.markdown ?? ''}</textarea>
  <button>Preview</button>
</form>

{#if form}
  <section class="preview">{@html form.html}</section>
{/if}
