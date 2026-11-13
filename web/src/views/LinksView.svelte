<script>
  import Links from "../components/Links.svelte";
  let { d } = $props();
</script>

<section class="panel">
  <div class="panel-body"><Links {d} editable /></div>
</section>
