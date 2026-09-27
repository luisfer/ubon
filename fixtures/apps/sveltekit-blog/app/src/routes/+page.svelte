<script lang="ts">
  let { data } = $props();
</script>

<h1>Notes</h1>
<ul>
  {#each data.posts as post}
    <li><a href="/posts/{post.slug}">{post.title}</a></li>
  {/each}
</ul>
