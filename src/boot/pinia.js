import { boot } from 'quasar/wrappers'
import { createPinia } from 'pinia'

// Pinia backs the modern stores introduced by the overhaul (signer/auth,
// wallet, NDK connection state). The legacy Vuex store still drives the
// existing feed/profile UI and runs alongside it during the migration.
export default boot(({ app }) => {
  app.use(createPinia())
})
