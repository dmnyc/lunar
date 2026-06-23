<template>
  <div>
  {{url}}
  {{preview}}
  </div>
</template>

<script>
// fetch is a browser global; cross-fetch dependency removed in the overhaul

export default {
  name: 'BaseLinkPreview',
  props: {url: {type: String, required: true}},

  data() {
    return {
      preview: '',
    }
  },

  async mounted() {
    let res = await (await fetch(this.url)).json
    console.log('res', res)
    // if (res)
  }
}
</script>

<style lang='css' scoped>
</style>

