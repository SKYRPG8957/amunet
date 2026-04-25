export type FeaturedTarget = {
  id: string;
  name: string;
  host: string;
  port: number;
  region: string;
  language: string;
  category: string;
  tags: string[];
};

export type BridgeEvent = {
  type: string;
  message: string;
  detail?: Record<string, unknown>;
  at: string;
};

export type BridgeStatus = {
  running: boolean;
  target: Pick<FeaturedTarget, 'id' | 'name' | 'host' | 'port'> | null;
  bridgePort: number;
  version: string;
  lanAddresses: string[];
  clients: Array<{
    address: string;
    name: string;
    joinedAt: string;
  }>;
  events: BridgeEvent[];
};

export type XboxStatus = {
  signedIn: boolean;
  xuid: string | null;
  expiresOn: string | null;
  pending: boolean;
  code: string | null;
  verificationUri: string | null;
  message: string | null;
  error: string | null;
};

export type ActivityWorld = {
  id: string;
  serverId?: string;
  handleId: string;
  title: string;
  hostName: string;
  ownerXuid: string;
  ownerGamertag?: string;
  source?: string;
  language?: string;
  languages?: string[];
  avatarTinyBase64?: string;
  avatarUrl?: string;
  worldType: string;
  version: string;
  protocol: number;
  members: number;
  maxMembers: number;
  joinRestriction: string;
  visibility: string;
  nethernetId?: string;
  closed?: boolean;
  updatedAtMs: number;
  uri: string;
};

export type WorldProviderStatus = {
  id: string;
  name: string;
  ok: boolean;
  count: number;
  error: string | null;
  requiresLogin?: boolean;
  peopleCount?: number;
  mcbeOnlineCount?: number;
};

export type BedrockStatus = {
  id: string;
  name: string;
  host: string;
  port: number;
  online: boolean;
  motd: string;
  levelName: string;
  version: string;
  protocol: number;
  playersOnline: number;
  playersMax: number;
  serverId: string;
  gamemode: string;
  retrievedAt: string;
};

export type TrackedXuid = {
  id: string;
  xuid: string;
  gamertag: string | null;
  note: string | null;
  createdAt: string;
};

export type HostPresence = {
  xuid: string;
  gamertag: string;
  country: string;
  presence: string;
  lastSeenMs: number;
};
