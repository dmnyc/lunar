const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      // { path: '', component: () => import('pages/IndexPage.vue') },
      {
        path: '',
        // path: '/feed',
        component: () => import(/* webpackChunkName: "about" */ 'pages/Feed.vue'),
        name: 'feed',
      },
      {
        path: '/follow',
        component: () => import('pages/SearchFollow.vue'),
        name: 'follow',
      },
      {
        path: '/settings/:initUser?',
        component: () => import('pages/Settings.vue'),
        name: 'settings',
      },
      {
        path: '/messages/inbox',
        component: () => import('pages/Inbox.vue'),
        name: 'inbox',
      },
      {
        path: '/messages/:pubkey(npub[a-z0-9A-Z]{59})',
        component: () => import('pages/Messages.vue'),
        name: 'messages',
      },
      {
        path: '/:eventId(note1[a-z0-9]+)',
        component: () => import('pages/Event.vue'),
        name: 'event',
      },
      {
        // nevent uses a separate route — Vue Router's param-regex parser can't
        // handle a (?:note1|nevent1) alternation group, so we split them.
        path: '/:eventId(nevent1[a-z0-9]+)',
        component: () => import('pages/Event.vue'),
        name: 'eventNevent',
      },
      {
        path: '/wallet',
        component: () => import('pages/Wallet.vue'),
        name: 'wallet',
      },
      {
        path: '/notifications',
        component: () => import('pages/Notifications.vue'),
        name: 'notifications',
      },
      {
        path: '/:pubkey(npub[a-z0-9A-Z]{59})',
        component: () => import('pages/Profile.vue'),
        name: 'profile',
      },
      {
        path: '/hashtag/:hashtagId([a-zA-Z0-9_]{1,63})',
        component: () => import('pages/Hashtag.vue'),
        name: 'hashtag',
      },
      {
        path: '/devTools',
        component: () => import('pages/DevTools.vue'),
        name: 'devTools',
      },
      {
        path: '/:catchAll(.*)*',
        component: () => import('pages/ErrorNotFound.vue'),
      },
    ],
  },

  // Always leave this as last one,
  // but you can also remove it
]

export default routes
