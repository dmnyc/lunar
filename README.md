# Lunar

[Lunar](https://lunar.ninja) is a web client for interacting with [Nostr](https://github.com/fiatjaf/nostr), a protocol that attempts to make decentralized social media a reality.

Lunar is a fork and full technical overhaul of [astral](https://github.com/monlovesmango/astral) (astral.ninja), the original Nostr client by [monlovesmango](https://github.com/monlovesmango), which itself began as a fork of [Branle](https://github.com/fiatjaf/branle) by [fiatjaf](https://github.com/fiatjaf). The overhaul modernizes the stack (Vite, NDK, Pinia) and adds NIP-07/NIP-46 signers, NWC + lightning zaps (NIP-57), and more, while keeping astral's original design and aesthetic.

## Install the dependencies
```bash
yarn
# or
npm install
```

### Start the app in development mode (hot-code reloading, error reporting, etc.)
```bash
yarn dev
# or
npm run dev
# or if quasar installed locally
quasar dev
```

### Lint the files
```bash
yarn lint
# or
npm run lint
```

### Format the files
```bash
yarn format
# or
npm run format
```

### Build the app for production in PWA mode:
```bash
yarn build:pwa
# or
npm run build:pwa
# or if quasar installed locally
quasar build -m pwa
```

### Build the app for production in SPA mode:
```bash
yarn build:spa
# or
npm run build:spa
# or if quasar installed locally
quasar build
```

## Docker

### Build the docker image (uses PWA mode):
```bash
docker build -t lunar .
```

### Run the container:
```bash
docker run -d -p 8080:8000 --name lunar lunar
```

and connect to 'http://localhost:8080/'
