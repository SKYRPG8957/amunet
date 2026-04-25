# Luma Arcade

Minecraft Bedrock Edition 장거리 멀티플레이를 위한 Eggnet Arcade 스타일의 실사용 MVP입니다. 단순한 "서버 추가" 목록이 아니라, Xbox Live 활동 핸들 참가와 로컬 LAN/Friends 브리지를 같이 제공합니다. Mojang, Microsoft, Minecraft, Eggnet과는 무관합니다.

## 핵심 기능

- Xbox Live device-code 로그인
- Eggnet-style `list3` 월드 피드 조회와 통합 표시
- 팔로우/친구 XUID의 Minecraft activity handle 직접 조회
- Xbox SessionDirectory `customProperties` 기반 공개 월드 탐색
- `minecraft://activityHandleJoin/?handle=<handleId>` 딥링크 참가
- `/api/join/simple` 조인 URI 생성
- Bedrock UDP/RakNet 서버 상태 조회
- 로컬 LAN 월드 광고 후 `transfer` 패킷으로 선택 서버 이동
- Supabase Free tier용 Edge Function API, 사용자, XUID 추적, 월드 세션 캐시 스키마
- Cloudflare Worker/KV 무료 한도 보호 캐시와 Supabase upstream 일일 예산 차단
- 공개 유저 화면과 `/admin` 운영 콘솔 분리
- Luma 내부 계정 기반 프로필, Xbox는 계정 안에서 연동
- 국가별 월드 필터와 커뮤니티 채팅
- Web, Android/iOS Capacitor, Windows Tauri 패키징 기반

## Stack

- Web app: React 19 + Vite 8 + TypeScript
- Local network API: Node.js + `bedrock-protocol` + `prismarine-auth`
- Database/Auth: Supabase Free tier
- Android/iOS wrapper: Capacitor
- Windows EXE wrapper: Tauri

## Run

```bash
npm install
npm run dev
```

기본 URL:

- Web: `http://localhost:5173`
- Local API: `http://127.0.0.1:8787`
- LAN bridge: `19132/udp`

## Production

```bash
npm run build
npm start
```

Production defaults can serve the web app and API from one process. Set these on a VPS:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
AMUNET_SERVE_STATIC=1
AMUNET_PREWARM=1
```

Docker/VPS instructions are in `docs/DEPLOY.md`.

## Supabase Backend

Supabase-only public backend mode is supported.

```bash
npx supabase functions deploy amunet-api
```

Build the frontend with:

```bash
VITE_STATUS_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/amunet-api
```

Then the app uses Supabase Edge Functions for:

- `/api/worlds/live`
- `/api/join/simple`
- `/api/community/presence`
- `/api/targets/featured`

Details are in `docs/SUPABASE.md`.

For the exact "my computer can be off" deployment path, use `docs/NO_PC_DEPLOY.md`.
For the maximum free-tier architecture with Cloudflare caching and hard upstream budgets in front of Supabase, use `docs/FREE_SCALE.md`.
For multiple free static hosts and service-ready release options, use `docs/FREE_DEPLOY_OPTIONS.md`.
For Firebase Hosting static web deploys, use `docs/FIREBASE_HOSTING.md`.
For automatic APK/Windows EXE builds and versioned GitHub Releases, use `docs/RELEASE.md`.

## Verification

```bash
npm run build
npm run inspect:local
```

`tools/inspect-local.mjs` opens the local web app in Chrome, verifies live world cards render, clicks a `참가` button, and captures desktop/mobile screenshots under `artifacts/local`.
`tools/inspect-eggnet.mjs` is the reference probe used to open the live Eggnet web app and record the UI/API behavior under `artifacts/eggnet`.

## How It Works

1. `Xbox 로그인`을 누르면 Microsoft device-code 로그인을 시작합니다.
2. 로그인된 Xbox 계정 기준으로 친구/팔로우 XUID 목록을 가져옵니다.
3. Xbox multiplayer activity API에서 Minecraft 월드 활동과 `handleId`를 정규화합니다.
4. `참가` 버튼은 Minecraft를 `minecraft://activityHandleJoin/?handle=<handleId>`로 엽니다.
5. `LAN 브리지`는 PC/기기에서 Bedrock LAN 서버처럼 보이는 로컬 UDP 서버를 띄웁니다.
6. Minecraft가 이 로컬 월드에 들어오면 Luma가 선택 대상 서버로 `transfer` 패킷을 보냅니다.

## Environment

`.env.example`을 `.env`로 복사해서 필요 값만 채웁니다.

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

AMUNET_STATUS_PORT=8787
AMUNET_BRIDGE_PORT=19132
AMUNET_BEDROCK_VERSION=26.10
AMUNET_ALLOW_PRIVATE_HOSTS=0
AMUNET_FEED_URL=https://eggnet.space/api/servers/list3
AMUNET_FEED_CACHE_MS=12000
AMUNET_PROVIDER_EGGNET=1
AMUNET_PROVIDER_XBOX=0
AMUNET_PREWARM_XBOX=0
AMUNET_ADMIN_REFRESH_KEY=
AMUNET_XBOX_DISCOVER_CACHE_MS=20000
```

`AMUNET_ALLOW_PRIVATE_HOSTS=1`은 신뢰 가능한 로컬 네트워크에서만 쓰세요. 기본값은 SSRF/로컬망 오용을 줄이기 위해 사설 주소를 차단합니다.

공개 Node 서버에서 `/api/bridge/*`, `/api/status/bedrock`, `/api/xbox/*`, `force=1` 갱신을 쓰려면 `AMUNET_ADMIN_REFRESH_KEY`를 긴 랜덤 값으로 설정하고 관리자 화면에서 같은 운영 키를 입력해야 합니다. 공개 서비스에서는 전역 Xbox 계정 노출을 막기 위해 `AMUNET_PROVIDER_XBOX=0`을 기본값으로 두세요.

`SUPABASE_SERVICE_ROLE_KEY`는 서버/Edge Function에서만 사용하세요. 브라우저 번들에 넣으면 안 됩니다.

## Supabase

1. 무료 Supabase 프로젝트를 생성합니다.
2. SQL editor에서 `supabase/migrations/202604250001_initial_schema.sql`을 실행합니다.
3. `.env`에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 넣습니다.

현재 스키마는 다음 데이터를 저장하도록 설계되어 있습니다.

- `profiles`: 앱 사용자 프로필과 Xbox XUID
- `tracked_xuids`: 사용자가 추적할 친구/팔로우 XUID
- `world_sessions`: Xbox activity에서 추출한 `handleId` 기반 월드 세션 캐시
- `bridge_targets`: LAN/Friends 브리지 대상
- `favorite_worlds`, `favorite_targets`: 사용자별 즐겨찾기

Xbox 토큰은 Supabase에 저장하지 않습니다. 로컬 `.amunet-auth` 캐시에만 남깁니다.

## Eggnet Analysis Notes

2026-04-25 기준 Eggnet 라이브 앱은 Flutter Web/PWA입니다. 첫 화면 HTML이 `/api/servers/list3`를 미리 가져오고, 앱 번들은 `handleId`를 `minecraft://activityHandleJoin/?handle=<handleId>`로 정규화합니다. `list3` 응답은 `serverId`, `ownerXuid`, `ownerGamertag`, `source`, `title`, `languageSchema`, `note`, `updatedAtMs`, `nethernetId`, `version`, `protocol`, `avatar_tiny_b64`를 포함하고, `note` 안의 `world.handle`에 `handleId`, `sessionTemplateName: "MinecraftLobby"`, `worldName`, `memberCount`, `maxMemberCount`, `joinRestriction`, `visibility`가 들어 있습니다.

즉 사용자가 IP/포트를 직접 등록하는 디렉터리가 아니라, 서버 쪽에서 Xbox/MinecraftLobby 활동 세션을 모아둔 공개 피드를 클라이언트가 빠르게 필터링하고 조인 URI로 넘기는 구조입니다. Luma는 이 구조를 맞춰 `/api/worlds/live`와 `/api/join/simple`을 제공합니다.

## Unified Providers

`/api/worlds/live`는 여러 provider를 병합합니다.

- `Eggnet`: `AMUNET_FEED_URL`의 `list3` 호환 공개 피드
- `Luma Xbox`: 로컬/운영 키가 있는 Node 헬퍼에서 로그인된 Xbox 계정의 social/following, MCBE presence, SessionDirectory activity handle, session `customProperties`를 직접 조회

별도 디버그 엔드포인트:

- `/api/worlds/eggnet`: Eggnet 호환 피드만 조회
- `/api/worlds/discover`: Luma Xbox SessionDirectory provider만 조회

`anti-eggnet` 저장소의 MIT licensed `serverinfo.js` 흐름을 참고해 SessionDirectory handle 탐색 방식을 통합했습니다. 원 저장소: `https://github.com/waternoob1005/anti-eggnet`

## Build Targets

```bash
# Web static build
npm run build

# Android APK project
npm run cap:add:android
npm run android

# iOS project, requires macOS + Xcode + Apple signing
npm run cap:add:ios
npm run ios

# Windows EXE, requires Rust toolchain + WebView2
npm run tauri:build
```

모바일에서 LAN/Friends 브리지를 완전하게 앱 내부에서 돌리려면 Capacitor 네이티브 UDP 플러그인 또는 foreground service가 추가로 필요합니다. 현재 구현은 웹 UI + 로컬 Node API 기준으로 실제 브리지 동작을 검증하는 MVP입니다.

## References

- `bedrock-protocol`: Bedrock RakNet 서버, ping, packet queue
- `prismarine-auth`: Microsoft/Xbox device-code auth
- `ProxyPass`: LAN 참가/전송 방식 참고용
