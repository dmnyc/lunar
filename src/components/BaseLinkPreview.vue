<template>
  <a
    v-if='card'
    :href='url'
    target='_blank'
    rel='noopener noreferrer'
    class='link-preview-card'
    @click.stop
  >
    <img v-if='card.image' :src='card.image' :alt='card.title || ""' class='link-preview-img' loading='lazy'/>
    <div class='link-preview-body'>
      <div class='link-preview-domain'>{{ domain }}</div>
      <div v-if='card.title' class='link-preview-title'>{{ card.title }}</div>
      <div v-if='card.description' class='link-preview-desc'>{{ card.description }}</div>
    </div>
  </a>
</template>

<script>
import DOMPurify from 'dompurify'

export default {
  name: 'BaseLinkPreview',
  props: {
    url: { type: String, required: true }
  },

  data() {
    return { card: null }
  },

  computed: {
    domain() {
      try { return new URL(this.url).hostname.replace(/^www\./, '') } catch { return '' }
    }
  },

  async mounted() {
    try {
      const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(this.url)}`)
      if (!res.ok) return
      const { status, data } = await res.json()
      if (status !== 'success' || !data) return
      this.card = {
        title: data.title ? DOMPurify.sanitize(data.title) : null,
        description: data.description ? DOMPurify.sanitize(data.description) : null,
        image: data.image?.url || null,
      }
    } catch { /* network error or rate limit — silently skip */ }
  }
}
</script>

<style lang='css' scoped>
.link-preview-card {
  display: flex;
  flex-direction: row;
  border: 1px solid var(--q-accent);
  border-radius: .5rem;
  overflow: hidden;
  margin-top: .75rem;
  text-decoration: none;
  color: inherit;
  max-width: 32rem;
  transition: opacity .15s;
}
.link-preview-card:hover { opacity: .85; }
.link-preview-img {
  width: 7rem;
  min-width: 7rem;
  object-fit: cover;
  flex-shrink: 0;
}
.link-preview-body {
  padding: .5rem .65rem;
  display: flex;
  flex-direction: column;
  gap: .2rem;
  overflow: hidden;
  min-width: 0;
}
.link-preview-domain {
  font-size: .7rem;
  opacity: .6;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.link-preview-title {
  font-weight: 600;
  font-size: .85rem;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.link-preview-desc {
  font-size: .78rem;
  opacity: .7;
  line-height: 1.4;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
