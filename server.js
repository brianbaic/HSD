const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const express = require("express");
const session = require("express-session");
const { Server } = require("socket.io");
const si = require("systeminformation");
const Docker = require("dockerode");

const execFileAsync = promisify(execFile);

const PORT = process.env.PORT || 3019;
const UPDATE_INTERVAL_MS = Number(process.env.UPDATE_INTERVAL_MS || 5000);
const STORAGE_REFRESH_MS = Number(process.env.STORAGE_REFRESH_MS || 60000);
const CONTAINER_REFRESH_MS = Number(process.env.CONTAINER_REFRESH_MS || 15000);
const NOTIFICATION_REFRESH_MS = Number(process.env.NOTIFICATION_REFRESH_MS || 30000);
const SHARE_DU_TIMEOUT_MS = Number(process.env.SHARE_DU_TIMEOUT_MS || 30000);
const HISTORY_POINTS = Number(process.env.HISTORY_POINTS || 48);
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
const SMARTCTL_BIN = process.env.SMARTCTL_BIN || "smartctl";
const LSBLK_BIN = process.env.LSBLK_BIN || "lsblk";
const DU_BIN = process.env.DU_BIN || "du";
const NOTIFY_BIN = process.env.NOTIFY_BIN || "/usr/local/emhttp/webGui/scripts/notify";
const PHP_BIN = process.env.PHP_BIN || "php";
const SENSORS_BIN = process.env.SENSORS_BIN || "sensors";
const PHP_NOTIFY_ARGS = String(process.env.PHP_NOTIFY_ARGS || "-d short_open_tag=1")
  .split(/\s+/)
  .map((value) => value.trim())
  .filter(Boolean);
const MDSTAT_PATH = process.env.MDSTAT_PATH || "/proc/mdstat";
const HOST_EMHTTP_DIR = process.env.HOST_EMHTTP_DIR || "/var/local/emhttp";
const HOST_EMHTTP_DISKS_PATH = process.env.HOST_EMHTTP_DISKS_PATH || path.join(HOST_EMHTTP_DIR, "disks.ini");
const HOST_PROC_DIR = process.env.HOST_PROC_DIR || "/host/proc";
const HOST_HOSTNAME_PATH = process.env.HOST_HOSTNAME_PATH || "/host/etc/hostname";
const HOST_UNRAID_VERSION_PATH = process.env.HOST_UNRAID_VERSION_PATH || "/host/etc/unraid-version";
const HOST_NOTIFICATIONS_DIR = process.env.HOST_NOTIFICATIONS_DIR || "/host/boot/config/plugins/dynamix/notifications";
const HOST_SYSLOG_PATH = process.env.HOST_SYSLOG_PATH || "/host/var/log/syslog";
const HOST_BOOT_CONFIG_DIR = process.env.HOST_BOOT_CONFIG_DIR || "/host/boot/config";
const HOST_SHARES_CONFIG_DIR = process.env.HOST_SHARES_CONFIG_DIR || path.join(HOST_BOOT_CONFIG_DIR, "shares");
const HOST_SMB_CONFIG_PATH = process.env.HOST_SMB_CONFIG_PATH || path.join(HOST_BOOT_CONFIG_DIR, "smb-extra.conf");
const HOST_SMB_SHARES_PATH = process.env.HOST_SMB_SHARES_PATH || path.join(HOST_BOOT_CONFIG_DIR, "smb-shares.conf");
const HOST_NFS_EXPORTS_PATH = process.env.HOST_NFS_EXPORTS_PATH || "/host/etc/exports";
const HOST_DOCKER_TEMPLATES_DIR =
  process.env.HOST_DOCKER_TEMPLATES_DIR || path.join(HOST_BOOT_CONFIG_DIR, "plugins", "dockerMan", "templates-user");
const HOST_USER_SCRIPTS_DIR =
  process.env.HOST_USER_SCRIPTS_DIR || path.join(HOST_BOOT_CONFIG_DIR, "plugins", "user.scripts", "scripts");
const HOST_PLUGINS_DIR = process.env.HOST_PLUGINS_DIR || path.join(HOST_BOOT_CONFIG_DIR, "plugins");
const HOST_VM_CONFIG_DIR = process.env.HOST_VM_CONFIG_DIR || "/host/etc/libvirt/qemu";
const DATA_DIR = path.join(__dirname, "data");
const CONFIG_PATH = path.join(DATA_DIR, "services.json");
const WIKI_PATH = path.join(DATA_DIR, "wiki.json");
const DIST_DIR = path.join(__dirname, "dist");
const PUBLIC_DIR = path.join(__dirname, "public");

const docker = new Docker({ socketPath: DOCKER_SOCKET_PATH });

const app = express();
const server = http.createServer(app);
const io = new Server(server);
let openIdClientModulePromise = null;

app.set("trust proxy", 1);

let storageInsightsCache = {
  value: null,
  fetchedAt: 0,
  promise: null
};

let containerStatsCache = {
  value: null,
  fetchedAt: 0,
  promise: null
};

let notificationsCache = {
  value: null,
  fetchedAt: 0,
  promise: null
};

const metricsHistory = {
  cpuLoad: [],
  memoryUsage: [],
  networkThroughput: [],
  arrayUsage: []
};

let lastHistorySnapshotAt = 0;

app.use(express.json());

function ensureDataDirSync() {
  if (!fsSync.existsSync(DATA_DIR)) {
    fsSync.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadPersistentSessionSecret() {
  if (String(process.env.SESSION_SECRET || "").trim()) {
    return String(process.env.SESSION_SECRET).trim();
  }

  ensureDataDirSync();

  try {
    if (fsSync.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fsSync.readFileSync(CONFIG_PATH, "utf8"));
      const configuredSecret = String(parsed?.auth?.sessionSecret || "").trim();
      if (configuredSecret) {
        return configuredSecret;
      }
    }
  } catch (_error) {
  }

  const secretPath = path.join(DATA_DIR, ".session-secret");
  try {
    if (fsSync.existsSync(secretPath)) {
      const existingSecret = String(fsSync.readFileSync(secretPath, "utf8") || "").trim();
      if (existingSecret) {
        return existingSecret;
      }
    }
  } catch (_error) {
  }

  const generatedSecret = crypto.randomBytes(32).toString("hex");
  fsSync.writeFileSync(secretPath, `${generatedSecret}\n`, "utf8");
  return generatedSecret;
}

const runtimeSessionSecret = loadPersistentSessionSecret();

const DEFAULT_WIKI_CATEGORY_DEFINITIONS = [
  { id: "system", title: "System", description: "Host overview, hardware state, and overall health.", weight: 10 },
  { id: "containers", title: "Containers", description: "Docker inventory, services, and container-specific notes.", weight: 20 },
  { id: "storage", title: "Storage", description: "Shares, devices, usage, and storage health.", weight: 30 },
  { id: "network", title: "Network", description: "Interfaces, addressing, routes, and throughput.", weight: 40 },
  { id: "security", title: "Security", description: "Authentication posture and access-related details.", weight: 50 },
  { id: "maintenance", title: "Maintenance", description: "Notifications, logs, and operational follow-up.", weight: 60 }
];

const DEFAULT_WIKI_CREATED_AT = "2026-03-24T00:00:00.000Z";

const sessionMiddleware = session({
  name: "dashboard.sid",
  secret: runtimeSessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: "auto"
  }
});

app.use(sessionMiddleware);

const defaultConfig = {
  notes: [],
  dashboardGuide: [
    "Use Dashboard for live system overview, quick service controls, and storage summaries.",
    "Use Services to search the full app list and toggle supported containers on or off.",
    "Use Storage for full device details. Spun-down array drives may show state instead of temperature.",
    "Use Hardware & Network for host specs, thermal readings, and network interface details.",
    "Use Settings to manage OIDC, sidebar preferences, and the dashboard profile shown in the left rail.",
    "Use this Server Log for maintenance notes, outage timelines, and upgrade history."
  ],
  services: [
    { name: "Unraid", category: "Management", favorite: true, port: "", path: "", description: "Server dashboard", url: "https://unraid.rekabs.com", imageUrl: "" },
    { name: "Pihole", category: "Network", favorite: true, port: "8080", path: "", description: "DNS filtering", url: "https://pihole.unraid.rekabs.com", imageUrl: "" },
    { name: "NPM", category: "Management", favorite: true, port: "81", path: "", description: "Nginx Proxy Manager", url: "https://npm.unraid.rekabs.com", imageUrl: "" },
    { name: "Duplicacy", category: "Storage", favorite: false, port: "3875", path: "", description: "Backup management", url: "https://duplicacy.unraid.rekabs.com", imageUrl: "" },
    { name: "Sonarr", category: "Media", favorite: true, port: "8989", path: "", description: "TV automation", url: "https://sonarr.unraid.rekabs.com", imageUrl: "" },
    { name: "Radarr", category: "Media", favorite: true, port: "7878", path: "", description: "Movie automation", url: "https://radarr.unraid.rekabs.com", imageUrl: "" },
    { name: "Prowlarr", category: "Media", favorite: false, port: "9696", path: "", description: "Indexer manager", url: "https://prowlarr.unraid.rekabs.com", imageUrl: "" },
    { name: "Tdarr", category: "Media", favorite: false, port: "8265", path: "", description: "Media transcoding", url: "https://tdarr.unraid.rekabs.com", imageUrl: "" },
    { name: "SABnzbd", category: "Downloads", favorite: true, port: "8085", path: "", description: "Usenet downloads", url: "https://sabnzbd.unraid.rekabs.com/", imageUrl: "" },
    { name: "qBittorrent", category: "Downloads", favorite: false, port: "8081", path: "", description: "Torrent client", url: "https://qbit.unraid.rekabs.com", imageUrl: "" },
    { name: "Jellyfin", category: "Media", favorite: true, port: "8096", path: "", description: "Media streaming", url: "https://jellyfin.unraid.rekabs.com", imageUrl: "" },
    { name: "Jellyseerr", category: "Media", favorite: false, port: "5055", path: "", description: "Media requests", url: "https://jellyseerr.unraid.rekabs.com", imageUrl: "" },
    { name: "Jellystat", category: "Media", favorite: false, port: "3001", path: "", description: "Playback analytics", url: "https://jellystat.unraid.rekabs.com", imageUrl: "" },
    { name: "Jellysweep", category: "Media", favorite: false, port: "5056", path: "", description: "Library cleanup", url: "https://jellysweep.unraid.rekabs.com", imageUrl: "" },
    { name: "Tinyauth", category: "Security", favorite: false, port: "3002", path: "", description: "Lightweight auth", url: "https://tinyauth.unraid.rekabs.com", imageUrl: "" },
    { name: "Pocket ID", category: "Security", favorite: false, port: "1411", path: "", description: "Identity service", url: "https://sso.unraid.rekabs.com", imageUrl: "" },
    { name: "Portainer", category: "Management", favorite: true, port: "9000", path: "", description: "Container management", url: "https://portainer.unraid.rekabs.com", imageUrl: "" },
    { name: "PostgreSQL", category: "Storage", favorite: false, port: "5432", path: "", description: "Database endpoint", url: "", imageUrl: "" }
  ],
  shares: [
    { name: "appdata", path: "/mnt/user/appdata" },
    { name: "media", path: "/mnt/user/Media" },
    { name: "shared_storage", path: "/mnt/user/shared_storage" },
    { name: "backups", path: "/mnt/user/Backups" }
  ],
  auth: {
    enabled: true,
    providerName: "Pocket ID",
    issuer: "https://sso.unraid.rekabs.com",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    postLogoutRedirectUri: "",
    scopes: "openid profile email",
    sessionSecret: runtimeSessionSecret
  },
  profile: {
    displayName: "",
    title: "Home Lab Operator",
    avatarLabel: ""
  }
};

const legacyDefaultDashboardGuide = [
  "Use Dashboard for live system overview, quick service controls, and storage summaries.",
  "Use Services to search the full app list and toggle supported containers on or off.",
  "Use Storage for full device details. Spun-down array drives may show state instead of temperature.",
  "Use Settings to manage OIDC, sidebar preferences, and the dashboard profile shown in the left rail.",
  "Use this Server Log for maintenance notes, outage timelines, and upgrade history."
];

async function ensureConfigFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(CONFIG_PATH);
  } catch (_error) {
    await fs.writeFile(CONFIG_PATH, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
  }
}

function normalizeService(service) {
  return {
    name: String(service.name || "").trim(),
    description: String(service.description || "").trim(),
    category: String(service.category || "General").trim() || "General",
    favorite: Boolean(service.favorite),
    port: String(service.port || "").trim(),
    path: String(service.path || "").trim(),
    url: String(service.url || "").trim(),
    imageUrl: String(service.imageUrl || "").trim()
  };
}

function normalizeAuthConfig(auth) {
  const fallbackSecret =
    String(auth?.sessionSecret || "").trim() ||
    runtimeSessionSecret;

  return {
    enabled: true,
    providerName: String(auth?.providerName || "Pocket ID").trim() || "Pocket ID",
    issuer: String(auth?.issuer || "").trim(),
    clientId: String(auth?.clientId || "").trim(),
    clientSecret: String(auth?.clientSecret || "").trim(),
    redirectUri: String(auth?.redirectUri || "").trim(),
    postLogoutRedirectUri: String(auth?.postLogoutRedirectUri || "").trim(),
    scopes: String(auth?.scopes || "openid profile email").trim() || "openid profile email",
    sessionSecret: fallbackSecret
  };
}

function normalizeProfileConfig(profile) {
  return {
    displayName: String(profile?.displayName || "").trim(),
    title: String(profile?.title || "Home Lab Operator").trim() || "Home Lab Operator",
    avatarLabel: String(profile?.avatarLabel || "").trim()
  };
}

function normalizeIntegrationsConfig(integrations) {
  return {
    anthropicApiKey: String(integrations?.anthropicApiKey || "").trim()
  };
}

function sanitizeIntegrationsForClient(integrations) {
  const normalized = normalizeIntegrationsConfig(integrations);
  return {
    anthropicApiKeyConfigured: Boolean(normalized.anthropicApiKey),
    anthropicApiKey: normalized.anthropicApiKey ? "__UNCHANGED__" : ""
  };
}

function mergeIntegrationsSecrets(currentIntegrations, nextIntegrations) {
  const current = normalizeIntegrationsConfig(currentIntegrations);
  const next = normalizeIntegrationsConfig(nextIntegrations);

  if (next.anthropicApiKey === "__UNCHANGED__") {
    next.anthropicApiKey = current.anthropicApiKey;
  }

  return next;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugifyValue(value, fallback = "item") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function sanitizeAuthConfigForClient(auth) {
  const normalized = normalizeAuthConfig(auth);
  return {
    enabled: normalized.enabled,
    providerName: normalized.providerName,
    issuer: normalized.issuer,
    clientId: normalized.clientId,
    clientSecretConfigured: Boolean(normalized.clientSecret),
    clientSecret: normalized.clientSecret ? "__UNCHANGED__" : "",
    redirectUri: normalized.redirectUri,
    postLogoutRedirectUri: normalized.postLogoutRedirectUri,
    scopes: normalized.scopes,
    sessionSecretConfigured: Boolean(normalized.sessionSecret),
    sessionSecret: normalized.sessionSecret ? "__UNCHANGED__" : ""
  };
}

function oidcConfigured(auth) {
  const normalized = normalizeAuthConfig(auth);
  return Boolean(
    normalized.issuer &&
      normalized.clientId &&
      normalized.clientSecret &&
      normalized.redirectUri &&
      normalized.scopes
  );
}

function sanitizeConfigForClient(config) {
  return {
    notes: Array.isArray(config.notes) ? config.notes : [],
    dashboardGuide: normalizeDashboardGuide(config.dashboardGuide),
    services: Array.isArray(config.services) ? config.services : [],
    shares: Array.isArray(config.shares) ? config.shares : [],
    auth: sanitizeAuthConfigForClient(config.auth),
    profile: normalizeProfileConfig(config.profile),
    integrations: sanitizeIntegrationsForClient(config.integrations)
  };
}

function mergeAuthSecrets(currentAuth, nextAuth) {
  const current = normalizeAuthConfig(currentAuth);
  const next = normalizeAuthConfig(nextAuth);

  if (next.clientSecret === "__UNCHANGED__") {
    next.clientSecret = current.clientSecret;
  }

  if (next.sessionSecret === "__UNCHANGED__") {
    next.sessionSecret = current.sessionSecret;
  }

  if (!next.sessionSecret) {
    next.sessionSecret = current.sessionSecret || crypto.randomBytes(32).toString("hex");
  }

  return next;
}

function normalizedSearchValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function serviceMatchTerms(service) {
  const names = new Set();
  const rawName = String(service?.name || "").trim();
  const normalizedName = normalizedSearchValue(rawName);
  if (normalizedName) {
    names.add(normalizedName);
  }

  const lowered = rawName.toLowerCase();
  if (normalizedName === "npm" || lowered === "npm") {
    names.add("nginxproxymanager");
    names.add("nginxproxymanagerofficial");
  }

  if (normalizedName === "pocketid") {
    names.add("pocketid");
  }

  return Array.from(names);
}

function serviceProtectedFromDisable(service) {
  const terms = serviceMatchTerms(service);
  return (
    terms.includes("unraid") ||
    terms.includes("pihole") ||
    terms.includes("npm") ||
    terms.includes("nginxproxymanager") ||
    terms.includes("nginxproxymanagerofficial")
  );
}

function serviceContainerMatchScore(service, containerInfo) {
  const serviceNames = serviceMatchTerms(service);
  if (!serviceNames.length) {
    return 0;
  }

  const names = Array.isArray(containerInfo?.Names)
    ? containerInfo.Names.map((name) => name.replace(/^\//, ""))
    : [];
  const normalizedNames = names.map((name) => normalizedSearchValue(name));
  const image = normalizedSearchValue(containerInfo?.Image);
  const labels = Object.values(containerInfo?.Labels || {}).map((value) => normalizedSearchValue(value));

  for (const serviceName of serviceNames) {
    if (normalizedNames.includes(serviceName)) {
      return 100;
    }

    if (normalizedNames.some((name) => name.startsWith(serviceName))) {
      return 90;
    }

    if (normalizedNames.some((name) => name.includes(serviceName))) {
      return 75;
    }

    if (image.includes(serviceName)) {
      return 60;
    }

    if (labels.some((label) => label.includes(serviceName))) {
      return 40;
    }
  }

  return 0;
}

function normalizeShare(share) {
  return {
    name: String(share.name || "").trim(),
    path: String(share.path || "").trim()
  };
}

function normalizeNote(note) {
  if (typeof note === "string") {
    const content = sanitizeRichText(note);
    return content
      ? {
          content,
          createdAt: new Date().toISOString()
        }
      : null;
  }

  const content = sanitizeRichText(note?.content || "");
  if (!content) {
    return null;
  }

  const createdAt = String(note?.createdAt || "").trim();

  return {
    content,
    createdAt: createdAt || new Date().toISOString()
  };
}

function normalizeDashboardGuide(guide) {
  if (typeof guide === "string") {
    const normalized = sanitizeRichText(guide);
    return normalized || defaultConfig.dashboardGuide;
  }

  if (!Array.isArray(guide)) {
    return defaultConfig.dashboardGuide;
  }

  const normalized = guide
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  if (
    normalized.length === legacyDefaultDashboardGuide.length &&
    normalized.every((entry, index) => entry === legacyDefaultDashboardGuide[index])
  ) {
    return defaultConfig.dashboardGuide;
  }

  return normalized.length ? normalized : defaultConfig.dashboardGuide;
}

function stripDangerousRichTextBlocks(value) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style|iframe|object|embed|svg|math|template|noscript)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|svg|math|template|noscript)\b[^>]*\/?\s*>/gi, "");
}

function sanitizeStyleDeclaration(style) {
  return String(style || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawProperty, ...rawValueParts] = entry.split(":");
      const property = String(rawProperty || "").trim().toLowerCase();
      const value = rawValueParts.join(":").trim();
      if (!property || !value) {
        return "";
      }

      if (property === "text-align" && /^(left|center|right|justify)$/i.test(value)) {
        return `text-align:${value.toLowerCase()}`;
      }

      if (property === "color" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
        return `color:${value}`;
      }

      return "";
    })
    .filter(Boolean)
    .join(";");
}

function sanitizeRichText(value) {
  const content = String(value || "").trim();
  if (!content) {
    return "";
  }

  if (!/<\/?[a-z][\s\S]*>/i.test(content)) {
    return content;
  }

  const allowedTags = new Set(["b", "strong", "i", "em", "u", "ul", "ol", "li", "p", "div", "br", "span", "font"]);
  const sanitized = stripDangerousRichTextBlocks(content).replace(/<\s*(\/?)\s*([a-z0-9-]+)([^>]*)>/gi, (_match, closingSlash, rawTagName, rawAttributes) => {
    const tagName = String(rawTagName || "").toLowerCase();
    if (!allowedTags.has(tagName)) {
      return "";
    }

    if (closingSlash) {
      return `</${tagName}>`;
    }

    if (tagName === "br") {
      return "<br>";
    }

    const attributes = String(rawAttributes || "");
    const sanitizedAttributes = [];

    const styleMatch = attributes.match(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
    const styleValue = styleMatch ? sanitizeStyleDeclaration(styleMatch[2] ?? styleMatch[3] ?? "") : "";
    if (styleValue && ["div", "p", "span", "li", "ul", "ol"].includes(tagName)) {
      sanitizedAttributes.push(`style="${styleValue}"`);
    }

    const alignMatch = attributes.match(/\balign\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const alignValue = String(alignMatch?.[2] ?? alignMatch?.[3] ?? alignMatch?.[4] ?? "").trim().toLowerCase();
    if (alignValue && /^(left|center|right|justify)$/.test(alignValue) && ["div", "p", "span", "li", "ul", "ol"].includes(tagName) && !styleValue.includes("text-align:")) {
      sanitizedAttributes.push(`style="text-align:${alignValue}"`);
    }

    const colorMatch = attributes.match(/\bcolor\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const colorValue = String(colorMatch?.[2] ?? colorMatch?.[3] ?? colorMatch?.[4] ?? "").trim();
    if (tagName === "font" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorValue)) {
      sanitizedAttributes.push(`color="${colorValue}"`);
    }

    return sanitizedAttributes.length ? `<${tagName} ${sanitizedAttributes.join(" ")}>` : `<${tagName}>`;
  });

  return sanitized.trim();
}

function validateConfig(payload) {
  if (!payload || !Array.isArray(payload.services)) {
    return "Config must include a services array.";
  }

  if (!Array.isArray(payload.shares)) {
    return "Config must include a shares array.";
  }

  if (!Array.isArray(payload.notes)) {
    return "Config must include a notes array.";
  }

  if (payload.dashboardGuide != null && !Array.isArray(payload.dashboardGuide) && typeof payload.dashboardGuide !== "string") {
    return "Dashboard guide must be an array or formatted string.";
  }

  if (payload.profile && typeof payload.profile !== "object") {
    return "Profile settings must be an object.";
  }

  const auth = normalizeAuthConfig(payload.auth);
  if (auth.enabled) {
    if (!auth.issuer || !auth.clientId || !auth.redirectUri) {
      return "OIDC settings require issuer, client ID, and redirect URI when authentication is enabled.";
    }

    if (!auth.clientSecret) {
      return "OIDC client secret is required when authentication is enabled.";
    }
  }

  for (const service of payload.services) {
    const normalized = normalizeService(service);
    if (!normalized.name) {
      return "Every service needs a name.";
    }

    if (normalized.port && !/^\d+$/.test(normalized.port)) {
      return `Service "${normalized.name}" has an invalid port.`;
    }
  }

  for (const share of payload.shares) {
    const normalized = normalizeShare(share);
    if (!normalized.name || !normalized.path) {
      return "Every tracked share needs both a name and a path.";
    }
  }

  return null;
}

async function readConfig() {
  await ensureConfigFile();
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);

  return {
    notes: Array.isArray(parsed.notes)
      ? parsed.notes.map(normalizeNote).filter(Boolean)
      : typeof parsed.notes === "string"
        ? [normalizeNote(parsed.notes)].filter(Boolean)
        : defaultConfig.notes,
    dashboardGuide: normalizeDashboardGuide(parsed.dashboardGuide),
    services: Array.isArray(parsed.services) ? parsed.services.map(normalizeService) : defaultConfig.services,
    shares: Array.isArray(parsed.shares) ? parsed.shares.map(normalizeShare) : defaultConfig.shares,
    auth: normalizeAuthConfig(parsed.auth || defaultConfig.auth),
    profile: normalizeProfileConfig(parsed.profile || defaultConfig.profile),
    integrations: normalizeIntegrationsConfig(parsed.integrations)
  };
}

async function writeConfig(config) {
  await ensureConfigFile();
  const currentConfig = await readConfig();
  const nextConfig = {
    notes: Array.isArray(config.notes) ? config.notes.map(normalizeNote).filter(Boolean) : [],
    dashboardGuide: normalizeDashboardGuide(config.dashboardGuide ?? currentConfig.dashboardGuide),
    services: config.services.map(normalizeService),
    shares: config.shares.map(normalizeShare),
    auth: mergeAuthSecrets(currentConfig.auth, config.auth || {}),
    profile: normalizeProfileConfig(config.profile || currentConfig.profile),
    integrations: config.integrations
      ? mergeIntegrationsSecrets(currentConfig.integrations, config.integrations)
      : normalizeIntegrationsConfig(currentConfig.integrations)
  };
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return nextConfig;
}

async function getAnthropicApiKey() {
  const envKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (envKey) return envKey;
  const config = await readConfig();
  return String(config.integrations?.anthropicApiKey || "").trim();
}

async function readWiki() {
  ensureDataDirSync();
  const apiKey = await getAnthropicApiKey();
  try {
    const raw = await fs.readFile(WIKI_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      categories: Array.isArray(parsed.categories) ? parsed.categories : DEFAULT_WIKI_CATEGORY_DEFINITIONS.map((def) => ({ ...def, articles: [] })),
      generatedAt: parsed.generatedAt || null,
      apiKeyConfigured: Boolean(apiKey)
    };
  } catch (_error) {
    return {
      categories: DEFAULT_WIKI_CATEGORY_DEFINITIONS.map((def) => ({ ...def, articles: [] })),
      generatedAt: null,
      apiKeyConfigured: Boolean(apiKey)
    };
  }
}

async function writeWiki(wiki) {
  ensureDataDirSync();
  const payload = {
    categories: wiki.categories || [],
    generatedAt: wiki.generatedAt || null
  };
  await fs.writeFile(WIKI_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

async function gatherWikiMetadata() {
  const [config, system, storageInsights, containerStats] = await Promise.all([
    readConfig(),
    getSystemStats().catch(() => ({})),
    getCachedStorageInsights().catch(() => ({})),
    getCachedContainerStats().catch(() => ({ containers: [] }))
  ]);

  const [dockerTemplates, shareConfigs, userScripts, plugins, vms] = await Promise.all([
    getDockerTemplateSummaries().catch(() => []),
    getShareConfigSummaries().catch(() => []),
    getUserScriptSummaries().catch(() => []),
    getPluginSummaries().catch(() => []),
    getVmSummaries().catch(() => [])
  ]);

  const nfsExports = await safeReadText(HOST_NFS_EXPORTS_PATH).then((raw) => parseExports(raw)).catch(() => []);

  const disks = storageInsights.disks || [];

  return {
    system: {
      hostname: system.os?.hostname || "unknown",
      distro: system.os?.distro || "unknown",
      release: system.os?.release || "unknown",
      cpu: system.cpu ? `${system.cpu.manufacturer} ${system.cpu.brand} (${system.cpu.physicalCores}C/${system.cpu.cores}T @ ${system.cpu.speed} GHz)` : "unknown",
      memoryTotal: system.memory?.total || "unknown"
    },
    containers: {
      total: (containerStats.containers || []).length,
      list: (containerStats.containers || []).map((c) => ({
        name: c.name,
        image: c.image,
        ports: (c.ports || []).map((p) => p.PublicPort ? `${p.PublicPort}→${p.PrivatePort}/${p.Type}` : `${p.PrivatePort}/${p.Type}`).filter(Boolean),
        networks: c.networks || [],
        labels: Object.fromEntries(
          Object.entries(c.labels || {}).filter(([key]) => /^(com\.docker\.compose|traefik|homepage)/.test(key)).slice(0, 10)
        )
      }))
    },
    services: (config.services || []).map((s) => ({
      name: s.name,
      category: s.category,
      description: s.description,
      url: s.url || null,
      port: s.port || null
    })),
    storage: {
      array: storageInsights.array ? {
        status: storageInsights.array.status,
        parity: storageInsights.array.parity,
        operation: storageInsights.array.operation
      } : {},
      cachePools: storageInsights.cachePools || [],
      disks: disks.map((d) => ({
        device: d.device,
        label: d.label,
        type: d.type,
        rotational: d.rotational,
        filesystem: d.filesystem,
        mdRole: d.mdRole,
        sizeBytes: d.size,
        sizeFormatted: d.size ? formatBytes(d.size) : null,
        usage: d.usage ? {
          usagePercent: d.usage.usagePercent,
          usedFormatted: formatBytes(d.usage.used),
          availableFormatted: formatBytes(d.usage.available)
        } : null,
        health: d.health,
        smartPassed: d.smartPassed,
        smartWarnings: d.smartWarnings,
        spundown: d.spundown,
        errors: d.errors
      })),
      deviceGroups: storageInsights.deviceGroups || [],
      smartAlerts: storageInsights.smartAlerts || []
    },
    shares: shareConfigs,
    nfsExports,
    network: {
      interfaces: (system.networkHealth || []).map((iface) => ({
        name: iface.iface,
        ip4: iface.ip4,
        state: iface.state,
        speed: iface.speed,
        type: iface.type,
        isDefault: iface.default
      }))
    },
    dockerTemplates,
    userScripts,
    plugins,
    vms,
    auth: {
      provider: config.auth?.providerName || "unknown",
      issuerConfigured: Boolean(config.auth?.issuer),
      scopes: config.auth?.scopes || ""
    }
  };
}

async function generateWikiCategory(categoryDef, metadata) {
  const apiKey = await getAnthropicApiKey();
  if (!apiKey) {
    throw new Error("Anthropic API key is not configured. Add it in Settings → Integrations to enable wiki generation.");
  }

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const systemPrompt = `You are a senior home lab engineer writing a reference wiki for an Unraid server. The audience is the server owner — write so they can understand their own setup, troubleshoot issues, and plan maintenance.

Rules:
- Only document what is actually present in the metadata — never invent features or services
- DO NOT reference live/temporal values (current CPU temp, load, uptime, memory usage percentage, container running state). These change constantly and make articles stale. Instead, describe the hardware capabilities, configuration choices, and what to watch for.
- Use ## for article titles and ### for subsections
- For each topic, cover: (1) what is configured and why it matters, (2) common issues and how to diagnose them, (3) maintenance recommendations specific to this setup
- When SMART warnings, disk errors, or degraded states appear in the metadata, explain what they mean and what actions to take
- For containers/services, explain what each service does, how it relates to other services on this server, and common troubleshooting steps
- For storage, explain the array topology, redundancy model, and what happens if a disk fails
- Include specific details from the metadata (device names, IPs, share settings, container images) so the wiki is tailored to this server
- Write 200-500 words per article for adequate depth
- Separate multiple articles with ---`;

  const categoryPrompts = {
    system: `Write wiki articles for this Unraid server's hardware and OS configuration.

Article ideas: host identity and OS version, CPU capabilities and what workloads it can handle, memory capacity and allocation considerations.

For the CPU, explain the core/thread layout and what it means for containerized workloads. For memory, describe the total capacity and general guidance for this server's workload mix (${metadata.containers.total} containers).

Server metadata:\n${JSON.stringify(metadata.system, null, 2)}\nContainer count: ${metadata.containers.total}`,

    containers: `Write wiki articles about the Docker containers and services running on this server.

Group related services and explain how they work together (e.g., media automation chains like Sonarr→Radarr→download clients, reverse proxy relationships, DNS dependencies). For each significant service, cover: what it does, what port/URL it uses, common issues and how to restart or troubleshoot it, and dependencies on other containers.

Metadata:\nContainers: ${JSON.stringify(metadata.containers, null, 2)}\nDashboard Services: ${JSON.stringify(metadata.services, null, 2)}\nDocker Templates: ${JSON.stringify(metadata.dockerTemplates, null, 2)}`,

    storage: `Write wiki articles about this server's storage architecture.

Cover: (1) Array topology — how many data disks, parity disks, and what redundancy model this provides. What happens if a disk fails? (2) Per-disk health — flag any disks with SMART warnings, errors, or degraded health and explain what to do. (3) Cache pools — their role and what data lives on them. (4) Share configuration — explain security settings, cache policies, split levels, and what each share is used for. (5) Capacity planning — which disks or shares are approaching full.

Metadata:\nStorage: ${JSON.stringify(metadata.storage, null, 2)}\nShares: ${JSON.stringify(metadata.shares, null, 2)}`,

    network: `Write wiki articles about this server's network configuration.

Cover: (1) Network interfaces — which is the primary, what speeds are negotiated, and what each interface is used for. (2) IP addressing — document the current assignments. (3) NFS exports — what is shared, to whom, and security considerations. (4) Common network troubleshooting for Unraid (DNS resolution, reverse proxy issues, Docker network modes).

Metadata:\nNetwork: ${JSON.stringify(metadata.network, null, 2)}\nNFS Exports: ${JSON.stringify(metadata.nfsExports, null, 2)}\nContainers (for network context): ${JSON.stringify(metadata.containers.list.map((c) => ({ name: c.name, ports: c.ports, networks: c.networks })), null, 2)}`,

    security: `Write wiki articles about this server's security and authentication configuration.

Cover: (1) OIDC setup — what provider is used, what scopes are configured, and what this protects. (2) Access control — who can access the dashboard and what operations require authentication. (3) Security best practices for this setup — certificate management, secret rotation, what to check periodically. (4) Common auth troubleshooting (token expiry, callback URL mismatches, provider outages).

Metadata:\nAuth: ${JSON.stringify(metadata.auth, null, 2)}\nContainer count behind auth: ${metadata.containers.total}`,

    maintenance: `Write wiki articles about this server's maintenance tools, automation, and operational health.

Cover: (1) Installed plugins — what each one does and which are critical vs optional. (2) User scripts — what automation is configured, schedules, and what to check if a script fails. (3) Virtual machines — resources allocated and management notes. (4) Recommended maintenance schedule for this server (parity checks, SMART tests, plugin updates, Docker image updates, backup verification).

Metadata:\nPlugins: ${JSON.stringify(metadata.plugins, null, 2)}\nUser Scripts: ${JSON.stringify(metadata.userScripts, null, 2)}\nVMs: ${JSON.stringify(metadata.vms, null, 2)}\nDisk count: ${(metadata.storage.disks || []).length}\nSMART alerts: ${JSON.stringify(metadata.storage.smartAlerts, null, 2)}`
  };

  const userPrompt = categoryPrompts[categoryDef.id] || `Write wiki articles for the "${categoryDef.title}" category. Metadata:\n${JSON.stringify(metadata, null, 2)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  });

  const content = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");

  const articles = content
    .split(/\n---\n/)
    .map((section, index) => {
      const trimmed = section.trim();
      if (!trimmed) return null;
      const titleMatch = trimmed.match(/^##\s+(.+)/m);
      return {
        id: `${categoryDef.id}-${index + 1}`,
        title: titleMatch ? titleMatch[1].trim() : `${categoryDef.title} — Section ${index + 1}`,
        content: trimmed,
        generatedAt: new Date().toISOString()
      };
    })
    .filter(Boolean);

  return articles;
}

async function getOidcMetadata(auth) {
  const issuer = String(auth?.issuer || "").replace(/\/+$/, "");
  if (!issuer) {
    throw new Error("OIDC issuer is not configured.");
  }

  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed with status ${response.status}.`);
  }

  return response.json();
}

async function loadOpenIdClientModule() {
  if (!openIdClientModulePromise) {
    openIdClientModulePromise = import("openid-client");
  }

  return openIdClientModulePromise;
}

async function getOidcClient(auth) {
  const client = await loadOpenIdClientModule();
  const clientMetadata = {
    client_secret: auth.clientSecret,
    redirect_uris: [auth.redirectUri],
    response_types: ["code"]
  };
  const clientAuthentication = auth.clientSecret ? client.ClientSecretPost(auth.clientSecret) : client.None();
  const config = await client.discovery(new URL(String(auth.issuer || "").replace(/\/+$/, "")), auth.clientId, clientMetadata, clientAuthentication);
  return { client, config };
}

function buildUserProfile(idTokenClaims, userInfo) {
  const claims = idTokenClaims || {};
  const source = userInfo || claims;
  return {
    sub: source.sub || claims.sub || "",
    name: source.name || source.preferred_username || source.email || claims.name || claims.preferred_username || claims.email || "Authenticated user",
    email: source.email || claims.email || "",
    preferredUsername: source.preferred_username || claims.preferred_username || ""
  };
}

function maskConfigForDashboard(config) {
  return buildDashboardPayload ? sanitizeConfigForClient(config) : sanitizeConfigForClient(config);
}

async function authState() {
  const config = await readConfig();
  return {
    enabled: Boolean(config.auth?.enabled),
    configured: oidcConfigured(config.auth),
    config
  };
}

async function ensureAuthenticated(req, res, next) {
  try {
    const { configured } = await authState();
    const authPath = req.path.startsWith("/api/auth/");
    const socketPath = req.path.startsWith("/socket.io/");

    if (authPath || socketPath) {
      return next();
    }

    if (req.session?.user) {
      return next();
    }

    if (!configured) {
      if (requestIsLocal(req)) {
        if (!req.path.startsWith("/api/")) {
          return next();
        }

        if (req.path === "/api/config" && req.method === "GET") {
          return next();
        }
      }

      return res.status(503).send("Authentication is enabled but OIDC is not fully configured.");
    }

    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Authentication required." });
    }

    req.session.returnTo = req.originalUrl || "/";
    return res.redirect("/api/auth/login");
  } catch (error) {
    return res.status(500).send(error.message);
  }
}

function normalizeRequestIp(ipAddress) {
  return String(ipAddress || "")
    .replace(/^::ffff:/i, "")
    .replace(/^\[(.*)\]$/, "$1")
    .trim()
    .toLowerCase();
}

function requestIsLocal(req) {
  const ip = normalizeRequestIp(req.socket?.remoteAddress || req.connection?.remoteAddress || "");
  if (!ip) {
    return false;
  }

  if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost") {
    return true;
  }

  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) {
    return true;
  }

  const private172 = ip.match(/^172\.(\d{1,3})\./);
  if (private172) {
    const secondOctet = Number(private172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  return /^(fc|fd|fe80:)/i.test(ip);
}

async function requireWriteAccess(req, res, next) {
  try {
    const { configured } = await authState();

    if (req.session?.user) {
      return next();
    }

    if (!configured) {
      if (req.path === "/api/config" && requestIsLocal(req)) {
        return next();
      }

      return res.status(503).json({ error: "Authentication is enabled but OIDC is not fully configured." });
    }

    return res.status(401).json({ error: "Authentication required." });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 0;
  }

  return bytes;
}

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(numeric, 100));
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) {
    return null;
  }

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

async function safeReadText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (_error) {
    return "";
  }
}

async function safeReadDir(dirPath, options = {}) {
  try {
    return await fs.readdir(dirPath, options);
  } catch (_error) {
    return [];
  }
}

async function safeAccess(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

function parseIniSections(raw) {
  const sections = [];
  let current = null;

  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    const sectionMatch = trimmed.match(/^\["(.+)"\]$/);
    if (sectionMatch) {
      current = { name: sectionMatch[1], values: {} };
      sections.push(current);
      continue;
    }

    const keyValueMatch = trimmed.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (!keyValueMatch || !current) {
      continue;
    }

    const [, key, rawValue] = keyValueMatch;
    const valueMatch = rawValue.match(/^"(.*)"$/);
    current.values[key] = valueMatch ? valueMatch[1] : rawValue;
  }

  return sections;
}

function parseKeyValueConfig(raw) {
  const values = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = String(rawValue || "").replace(/^"(.*)"$/, "$1").trim();
    values[key] = value;
  }

  return values;
}

function looksSensitiveKey(key) {
  return /(secret|token|password|passwd|apikey|api_key|clientsecret|sessionsecret|privatekey|cookie|credential|auth|key|jwt|bearer|oauth)/i.test(String(key || ""));
}

function redactSensitiveValue(key, value) {
  const stringValue = String(value || "").trim();
  if (!stringValue) {
    return "";
  }

  if (looksSensitiveKey(key)) {
    return "[redacted]";
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(stringValue)) {
    return "[redacted]";
  }

  if (stringValue.length > 48 && /^[A-Za-z0-9+/_=-]+$/.test(stringValue)) {
    return "[redacted]";
  }

  return stringValue;
}

function summarizeTemplateValuePresence(key, value) {
  const stringValue = String(value || "").trim();
  if (!stringValue) {
    return "unset";
  }

  if (looksSensitiveKey(key) || redactSensitiveValue(key, stringValue) === "[redacted]") {
    return "set (redacted)";
  }

  return "set";
}

function summarizeBooleanLike(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "unset";
  }

  if (["yes", "true", "1"].includes(normalized)) {
    return "enabled";
  }

  if (["no", "false", "0"].includes(normalized)) {
    return "disabled";
  }

  return normalized;
}

function parseUnraidSizedValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric * 1024 : 0;
}

function humanReadableDiskLabel(id, deviceName, sizeBytes) {
  const normalizedId = String(id || "").trim().replace(/_/g, " - ");
  const sizeText = sizeBytes ? new Intl.NumberFormat(undefined, { maximumFractionDigits: sizeBytes >= 10 * 1024 ** 4 ? 0 : 1 }).format(sizeBytes / 1024 ** 4) : null;
  const parts = [];

  if (normalizedId) {
    parts.push(normalizedId);
  }
  if (sizeText) {
    parts.push(`${sizeText} TB`);
  }
  if (deviceName) {
    parts.push(`(${deviceName})`);
  }

  return parts.join(" - ") || deviceName || "Disk";
}

function buildUnraidMounts(name, type) {
  if (name === "flash") {
    return ["/boot"];
  }

  if (/^disk\d+$/i.test(name)) {
    return [`/mnt/${name}`];
  }

  if (String(type || "").toLowerCase() === "cache" || name === "cache" || name === "containers") {
    return [`/mnt/${name}`];
  }

  return [];
}

function buildUnraidDiskInsights(disksIniRaw) {
  const sections = parseIniSections(disksIniRaw);
  if (!sections.length) {
    return [];
  }

  return sections
    .map(({ name, values }) => {
      const status = String(values.status || "").trim();
      const type = String(values.type || "").trim();
      const deviceName = String(values.device || values.deviceSb || "").trim();
      const sizeBytes = parseUnraidSizedValue(values.size);
      const fsSizeBytes = parseUnraidSizedValue(values.fsSize);
      const fsFreeBytes = parseUnraidSizedValue(values.fsFree);
      const fsUsedBytes = parseUnraidSizedValue(values.fsUsed);
      const hasFilesystemUsage = fsSizeBytes > 0 && Number.isFinite(fsFreeBytes) && Number.isFinite(fsUsedBytes);
      const warnings = [values.warning, values.critical].map((value) => String(value || "").trim()).filter(Boolean);
      const errorCount = Number(values.numErrors || 0);
      const tempValue = String(values.temp || "").trim();
      const rawTemperature = tempValue && tempValue !== "*" ? Number(tempValue) : null;
      const temperature = Number.isFinite(rawTemperature) && rawTemperature > 0 ? rawTemperature : null;
      const mounts = buildUnraidMounts(name, type);
      const mdRole =
        name === "parity" ? "Parity" :
        /^disk(\d+)$/i.test(name) ? `Disk ${name.match(/^disk(\d+)$/i)[1]}` :
        null;

      if (!status || /^DISK_NP/i.test(status) || (!deviceName && !sizeBytes)) {
        return null;
      }

      return {
        device: deviceName || name,
        label: humanReadableDiskLabel(values.id || values.idSb || name, deviceName || name, sizeBytes || fsSizeBytes),
        deviceName: deviceName || name,
        type: String(values.transport || type || "disk").trim() || "disk",
        rotational: String(values.rotational || "") === "1",
        filesystem: String(values.fsType || "").trim() || null,
        mdRole,
        bootHint: name === "flash",
        size: sizeBytes || fsSizeBytes,
        mounts,
        usage: hasFilesystemUsage
          ? {
              mount: mounts[0] || null,
              used: fsUsedBytes,
              available: fsFreeBytes,
              usagePercent: fsSizeBytes ? Number(((fsUsedBytes / fsSizeBytes) * 100).toFixed(2)) : 0
            }
          : null,
        temperature: Number.isFinite(temperature) ? temperature : null,
        smartPassed: errorCount === 0 ? true : false,
        smartWarnings: errorCount > 0 ? [`${errorCount} disk errors`] : warnings,
        health: warnings.length || errorCount > 0 ? "warning" : /DISK_OK/i.test(status) ? "healthy" : "unknown",
        spundown: String(values.spundown || "") === "1",
        status,
        reads: Number(values.numReads || 0),
        writes: Number(values.numWrites || 0),
        errors: errorCount
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function readThermalZones() {
  try {
    const entries = await fs.readdir("/sys/class/thermal", { withFileTypes: true });
    const zones = entries
      .filter((entry) => entry.isDirectory() && /^thermal_zone\d+$/i.test(entry.name))
      .map((entry) => entry.name);

    const results = await Promise.all(
      zones.map(async (zoneName) => {
        const zonePath = path.join("/sys/class/thermal", zoneName);
        const [typeRaw, tempRaw] = await Promise.all([
          safeReadText(path.join(zonePath, "type")),
          safeReadText(path.join(zonePath, "temp"))
        ]);

        const type = String(typeRaw || "").trim();
        const rawTemp = Number(String(tempRaw || "").trim());
        const temperature = Number.isFinite(rawTemp)
          ? rawTemp > 1000
            ? rawTemp / 1000
            : rawTemp
          : null;

        if (!type || !Number.isFinite(temperature) || temperature < -50 || temperature > 150) {
          return null;
        }

        return {
          zone: zoneName,
          type,
          temperature: Number(temperature.toFixed(1))
        };
      })
    );

    return results.filter(Boolean);
  } catch (_error) {
    return [];
  }
}

async function readSensorsData() {
  try {
    const { stdout } = await execFileAsync(SENSORS_BIN, ["-j"], { timeout: 10000 });
    return JSON.parse(String(stdout || "{}"));
  } catch (_error) {
    return {};
  }
}

function extractSensorMetrics(sensorsData) {
  const metrics = {
    cpuPackage: null,
    motherboard: null,
    arrayFanRpm: null,
    coreTemperatures: []
  };

  const collectEntries = (group) =>
    Object.entries(group || {}).filter(([, value]) => value && typeof value === "object" && !Array.isArray(value));

  for (const [chipName, chipData] of Object.entries(sensorsData || {})) {
    const entries = collectEntries(chipData);

    for (const [label, values] of entries) {
      const normalizedLabel = String(label || "").toLowerCase();
      const normalizedChip = String(chipName || "").toLowerCase();

      const inputValue =
        Object.entries(values).find(([key, value]) => /_input$/i.test(key) && Number.isFinite(Number(value)))?.[1] ?? null;
      const numericValue = Number(inputValue);

      if (!Number.isFinite(numericValue)) {
        continue;
      }

      if (/fan/i.test(normalizedLabel) && metrics.arrayFanRpm == null) {
        metrics.arrayFanRpm = Math.round(numericValue);
      }

      if ((/array fan/i.test(normalizedLabel) || /fan/i.test(normalizedLabel)) && metrics.arrayFanRpm == null) {
        metrics.arrayFanRpm = Math.round(numericValue);
      }

      if ((/cpu temp/i.test(normalizedLabel) || /package/i.test(normalizedLabel)) && metrics.cpuPackage == null) {
        metrics.cpuPackage = numericValue;
      }

      if ((/mb temp/i.test(normalizedLabel) || /motherboard/i.test(normalizedLabel)) && metrics.motherboard == null) {
        metrics.motherboard = numericValue;
      }

      if (/^core\s+\d+/i.test(label) || (/coretemp/i.test(normalizedChip) && /^core/i.test(normalizedLabel))) {
        metrics.coreTemperatures.push(numericValue);
      }
    }
  }

  return metrics;
}

function mergeThermalSources(cpuTemperature, thermalZones, sensorsData) {
  const validCoreTemps = Array.isArray(cpuTemperature.cores)
    ? cpuTemperature.cores.filter((value) => Number.isFinite(Number(value))).map(Number)
    : [];
  const sensorMetrics = extractSensorMetrics(sensorsData);
  const sensorCoreTemps = sensorMetrics.coreTemperatures.filter((value) => Number.isFinite(Number(value))).map(Number);
  const mergedCoreTemps = sensorCoreTemps.length ? sensorCoreTemps : validCoreTemps;
  const zoneByType = new Map(
    thermalZones.map((zone) => [String(zone.type || "").toLowerCase(), zone.temperature])
  );

  const cpuPackage =
    sensorMetrics.cpuPackage ||
    (Number.isFinite(Number(cpuTemperature.socket)) && Number(cpuTemperature.socket)) ||
    (Number.isFinite(Number(cpuTemperature.main)) && /cpu/i.test(String(cpuTemperature.mainName || "")) && Number(cpuTemperature.main)) ||
    zoneByType.get("x86_pkg_temp") ||
    (Number.isFinite(Number(cpuTemperature.max)) && Number(cpuTemperature.max)) ||
    (mergedCoreTemps.length ? average(mergedCoreTemps) : null);

  const motherboard =
    sensorMetrics.motherboard ||
    zoneByType.get("acpitz") ||
    (Number.isFinite(Number(cpuTemperature.main)) ? Number(cpuTemperature.main) : null);

  const maxCandidates = [
    cpuPackage,
    motherboard,
    ...mergedCoreTemps,
    ...thermalZones.map((zone) => zone.temperature)
  ].filter((value) => Number.isFinite(Number(value)));

  return {
    cpuPackage: Number.isFinite(Number(cpuPackage)) ? Number(Number(cpuPackage).toFixed(1)) : null,
    motherboard: Number.isFinite(Number(motherboard)) ? Number(Number(motherboard).toFixed(1)) : null,
    max: maxCandidates.length ? Number(Math.max(...maxCandidates).toFixed(1)) : null,
    coreAverage: mergedCoreTemps.length ? Number(average(mergedCoreTemps).toFixed(1)) : null,
    arrayFanRpm: Number.isFinite(Number(sensorMetrics.arrayFanRpm)) ? Math.round(sensorMetrics.arrayFanRpm) : null,
    cores: mergedCoreTemps.map((temperature, index) => ({
      core: index,
      temperature: Number(temperature.toFixed(1))
    })),
    zones: thermalZones
  };
}

function parseMeminfo(meminfo) {
  const values = {};
  for (const line of meminfo.split("\n")) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)/);
    if (match) {
      values[match[1]] = Number(match[2]) * 1024;
    }
  }

  const total = values.MemTotal || 0;
  const available = values.MemAvailable || values.MemFree || 0;
  const used = Math.max(total - available, 0);

  if (!total) {
    return null;
  }

  return {
    total: formatBytes(total),
    used: formatBytes(used),
    free: formatBytes(available),
    usagePercent: Number(((used / total) * 100).toFixed(2))
  };
}

function parseHostUptime(uptimeText) {
  const firstValue = Number(String(uptimeText || "").trim().split(/\s+/)[0]);
  return Number.isFinite(firstValue) ? firstValue : null;
}

function parseUnraidVersion(unraidVersionRaw, fallbackOsInfo) {
  const raw = String(unraidVersionRaw || "").trim();
  if (!raw) {
    return {
      distro: fallbackOsInfo.distro,
      release: fallbackOsInfo.release
    };
  }

  const versionMatch = raw.match(/version\s*=\s*["']?([^"'\s]+)["']?/i);
  const release = (versionMatch ? versionMatch[1] : raw).trim();

  return {
    distro: "Unraid",
    release
  };
}

function normalizeHostname(hostnameRaw, fallbackHostname) {
  const candidate = String(hostnameRaw || "").trim();
  const fallback = String(fallbackHostname || "").trim();
  const chosen = candidate || fallback;

  if (!chosen) {
    return "Unraid Server";
  }

  // Docker-style random hostnames are not useful in the UI.
  if (/^[a-f0-9]{12,}$/i.test(chosen)) {
    return "Unraid Server";
  }

  return chosen;
}

async function getHostMetadata(osInfo, fallbackUptime) {
  const [hostHostnameRaw, unraidVersionRaw, hostUptimeRaw, hostMeminfoRaw] = await Promise.all([
    safeReadText(HOST_HOSTNAME_PATH),
    safeReadText(HOST_UNRAID_VERSION_PATH),
    safeReadText(path.join(HOST_PROC_DIR, "uptime")),
    safeReadText(path.join(HOST_PROC_DIR, "meminfo"))
  ]);
  const parsedVersion = parseUnraidVersion(unraidVersionRaw, osInfo);

  return {
    hostname: normalizeHostname(hostHostnameRaw, osInfo.hostname),
    distro: parsedVersion.distro,
    release: parsedVersion.release,
    uptime: parseHostUptime(hostUptimeRaw) ?? fallbackUptime,
    memory: parseMeminfo(hostMeminfoRaw)
  };
}

async function getSystemStats() {
  const [currentLoad, mem, osInfo, cpu, time, networkStats, cpuTemperature, networkInterfaces, thermalZones, sensorsData] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.osInfo(),
    si.cpu(),
    si.time(),
    si.networkStats().catch(() => []),
    si.cpuTemperature().catch(() => ({})),
    si.networkInterfaces().catch(() => []),
    readThermalZones(),
    readSensorsData()
  ]);

  const hostMetadata = await getHostMetadata(osInfo, time.uptime);
  const memory = hostMetadata.memory || {
    total: formatBytes(mem.total),
    used: formatBytes(mem.used),
    free: formatBytes(mem.available),
    usagePercent: mem.total ? Number(((mem.used / mem.total) * 100).toFixed(2)) : 0
  };

  const networkStatsByIface = new Map(
    networkStats.map((item) => [String(item.iface || "").trim(), item])
  );
  const usableInterfaces = networkInterfaces.filter((item) => !item.internal);
  const thermal = mergeThermalSources(cpuTemperature, thermalZones, sensorsData);

  return {
    timestamp: new Date().toISOString(),
    os: {
      distro: hostMetadata.distro,
      release: hostMetadata.release,
      hostname: hostMetadata.hostname,
      platform: osInfo.platform,
      uptime: hostMetadata.uptime
    },
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      cores: cpu.cores,
      physicalCores: cpu.physicalCores,
      speed: cpu.speed,
      load: Number(currentLoad.currentLoad.toFixed(2)),
      perCoreLoad: currentLoad.cpus.map((core, index) => ({
        core: index,
        load: Number(core.load.toFixed(2))
      }))
    },
    memory,
    storage: [],
    network: networkStats.map((item) => ({
      iface: item.iface,
      rxBytes: formatBytes(item.rx_bytes),
      txBytes: formatBytes(item.tx_bytes),
      rxSec: formatBytes(item.rx_sec),
      txSec: formatBytes(item.tx_sec)
    })),
    thermal,
    networkHealth: usableInterfaces.map((item) => {
      const stats = networkStatsByIface.get(String(item.iface || "").trim()) || {};
      return {
        iface: item.iface,
        ip4: item.ip4 || null,
        ip6: item.ip6 || null,
        mac: item.mac || null,
        state: item.operstate || (item.up ? "up" : "down"),
        duplex: item.duplex || null,
        speed: item.speed || null,
        type: item.type || null,
        default: Boolean(item.default),
        rxSec: formatBytes(stats.rx_sec || 0),
        txSec: formatBytes(stats.tx_sec || 0)
      };
    })
  };
}

function detectNotificationLevel(title, message) {
  const text = `${title} ${message}`.toLowerCase();
  if (/(fail|failed|error|critical|corrupt|degraded)/.test(text)) {
    return "error";
  }

  if (/(warn|warning|parity|smart|rebuild|resync|check|offline|battery)/.test(text)) {
    return "warning";
  }

  return "info";
}

function encodeNotificationId(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64url");
}

function decodeNotificationId(value) {
  try {
    return Buffer.from(String(value || ""), "base64url").toString("utf8");
  } catch (_error) {
    return "";
  }
}

function parseNotificationTimestamp(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "number") {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const customMatch = String(value)
    .trim()
    .match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/);
  if (customMatch) {
    const [, day, month, year, hour, minute] = customMatch;
    const parsedCustom = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
    return Number.isNaN(parsedCustom.getTime()) ? null : parsedCustom.toISOString();
  }

  const parsed = new Date(String(value).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapNotifyImportance(importance, title, message) {
  const normalized = String(importance || "").trim().toLowerCase();
  if (normalized === "alert") {
    return "error";
  }

  if (normalized === "warning") {
    return "warning";
  }

  if (normalized === "normal") {
    return "info";
  }

  return detectNotificationLevel(title, message);
}

function sanitizeNotifyFileName(fileName) {
  const normalized = String(fileName || "").trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\") || !normalized.endsWith(".notify")) {
    return "";
  }

  return normalized;
}

async function getNotifyScriptNotifications() {
  const notifyBins = Array.from(
    new Set([
      NOTIFY_BIN,
      "/usr/local/emhttp/plugins/dynamix/scripts/notify",
      "/usr/local/emhttp/webGui/scripts/notify"
    ].filter(Boolean))
  );

  try {
    let stdout = "";
    let lastError = null;

    for (const notifyBin of notifyBins) {
      try {
        ({ stdout } = await execFileAsync(PHP_BIN, [...PHP_NOTIFY_ARGS, notifyBin, "get"], { timeout: 10000 }));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError && !stdout) {
      console.error("Notify script get failed:", lastError.message);
      return [];
    }

    const parsed = JSON.parse(String(stdout || "[]").trim() || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item, index) => {
        const fileName = sanitizeNotifyFileName(item.file);
        const title = String(item.subject || item.event || "Unraid notification").trim();
        const message = String(item.description || "").trim() || title;
        const read = Number(item.show || 0) !== 1;

        return {
          id: fileName ? encodeNotificationId(fileName) : `notify:${index}`,
          file: fileName || null,
          title,
          message,
          level: mapNotifyImportance(item.importance, title, message),
          timestamp: parseNotificationTimestamp(item.timestamp),
          source: "notify",
          event: String(item.event || "").trim() || null,
          link: String(item.link || "").trim() || null,
          read,
          canMarkRead: Boolean(fileName) && !read,
          canDelete: Boolean(fileName)
        };
      })
      .sort((left, right) => String(right.timestamp || "").localeCompare(String(left.timestamp || "")))
      .slice(0, 12);
  } catch (_error) {
    return [];
  }
}

function collectNotificationsFromValue(value, sourceName, acc = [], fileName = null) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectNotificationsFromValue(item, sourceName, acc, fileName));
    return acc;
  }

  if (!value || typeof value !== "object") {
    return acc;
  }

  const title = String(value.title || value.subject || value.event || value.name || "").trim();
  const message = String(value.message || value.description || value.text || value.details || "").trim();
  const timestamp = parseNotificationTimestamp(value.timestamp || value.time || value.date || value.datetime || value.created_at);

  const read =
    value.read === true ||
    value.seen === true ||
    String(value.status || "").toLowerCase() === "read";

  if (title || message) {
    acc.push({
      id: fileName ? encodeNotificationId(fileName) : `${sourceName}:${acc.length}`,
      title: title || "Unraid notification",
      message: message || title,
      level: detectNotificationLevel(title, message),
      timestamp,
      source: sourceName,
      read,
      canMarkRead: Boolean(fileName) && !read,
      canDelete: Boolean(fileName)
    });
  }

  for (const nestedValue of Object.values(value)) {
    if (nestedValue && typeof nestedValue === "object") {
      collectNotificationsFromValue(nestedValue, sourceName, acc, fileName);
    }
  }

  return acc;
}

async function getJsonNotificationsFromDirectory() {
  try {
    const entries = await fs.readdir(HOST_NOTIFICATIONS_DIR, { withFileTypes: true });
    const jsonFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name)
      .sort()
      .reverse();

    const notifications = [];
    for (const fileName of jsonFiles.slice(0, 6)) {
      try {
        const fullPath = path.join(HOST_NOTIFICATIONS_DIR, fileName);
        const raw = await fs.readFile(fullPath, "utf8");
        const parsed = JSON.parse(raw);
        collectNotificationsFromValue(parsed, fileName, notifications, fileName);
      } catch (_error) {
        continue;
      }
    }

    return notifications;
  } catch (_error) {
    return [];
  }
}

function parseSyslogNotifications(syslogRaw) {
  if (!syslogRaw) {
    return [];
  }

  return syslogRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /(warn|warning|error|critical|notify|parity|array|smart|ups|docker)/i.test(line))
    .slice(-12)
    .reverse()
    .map((line, index) => {
      const match = line.match(/^([A-Z][a-z]{2}\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(.*)$/);
      const message = match ? match[3] : line;
      const title = message.split(":")[0] || "System log";

      return {
        id: `syslog:${index}`,
        title: title.trim() || "System log",
        message: message.trim(),
        level: detectNotificationLevel(title, message),
        timestamp: null,
        source: "syslog",
        read: false,
        canMarkRead: false,
        canDelete: false
      };
    });
}

function dedupeNotifications(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.timestamp || ""}|${item.title}|${item.message}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function unreadNotifications(items) {
  return dedupeNotifications(items)
    .filter((item) => item && item.read !== true)
    .sort((left, right) => String(right.timestamp || "").localeCompare(String(left.timestamp || "")));
}

async function getUnraidNotifications() {
  const notifyScriptNotifications = await getNotifyScriptNotifications();
  if (notifyScriptNotifications.length) {
    return unreadNotifications(notifyScriptNotifications).slice(0, 12);
  }

  const jsonNotifications = await getJsonNotificationsFromDirectory();
  if (jsonNotifications.length) {
    return unreadNotifications(jsonNotifications).slice(0, 8);
  }

  return [];
}

async function resolveNotificationFilePath(notificationId) {
  const fileName = decodeNotificationId(notificationId);
  if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
    return null;
  }

  const fullPath = path.join(HOST_NOTIFICATIONS_DIR, fileName);
  try {
    await fs.access(fullPath);
    return fullPath;
  } catch (_error) {
    return null;
  }
}

async function archiveNotification(notificationId) {
  const fileName = sanitizeNotifyFileName(decodeNotificationId(notificationId));
  if (!fileName) {
    throw new Error("Notification file not found.");
  }

  const notifyBins = Array.from(
    new Set([
      NOTIFY_BIN,
      "/usr/local/emhttp/plugins/dynamix/scripts/notify",
      "/usr/local/emhttp/webGui/scripts/notify"
    ].filter(Boolean))
  );

  let lastError = null;
  for (const notifyBin of notifyBins) {
    try {
      await execFileAsync(PHP_BIN, [...PHP_NOTIFY_ARGS, notifyBin, "archive", fileName], { timeout: 10000 });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Failed to archive notification.");
}

function markNotificationObjectRead(value) {
  if (Array.isArray(value)) {
    return value.map((item) => markNotificationObjectRead(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next = { ...value };
  if ("read" in next || "seen" in next || "status" in next || "unread" in next) {
    next.read = true;
    next.seen = true;
    next.unread = false;
    next.status = "read";
  }

  for (const [key, nestedValue] of Object.entries(next)) {
    if (nestedValue && typeof nestedValue === "object") {
      next[key] = markNotificationObjectRead(nestedValue);
    }
  }

  return next;
}

async function markNotificationAsRead(notificationId) {
  try {
    await archiveNotification(notificationId);
    return;
  } catch (_error) {
    // Fall back to direct file mutation for older storage layouts.
  }

  const fullPath = await resolveNotificationFilePath(notificationId);
  if (!fullPath) {
    throw new Error("Notification file not found.");
  }

  const raw = await fs.readFile(fullPath, "utf8");
  const parsed = JSON.parse(raw);
  const updated = markNotificationObjectRead(parsed);
  await fs.writeFile(fullPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
}

async function deleteNotification(notificationId) {
  try {
    await archiveNotification(notificationId);
    return;
  } catch (_error) {
    // Fall back to direct file deletion for older storage layouts.
  }

  const fullPath = await resolveNotificationFilePath(notificationId);
  if (!fullPath) {
    throw new Error("Notification file not found.");
  }

  await fs.unlink(fullPath);
}

async function refreshNotificationsNow() {
  try {
    const value = await getUnraidNotifications();
    notificationsCache = {
      value,
      fetchedAt: Date.now(),
      promise: null
    };
    return value;
  } catch (error) {
    console.error("Notification refresh failed:", error.message);
    return notificationsCache.value || [];
  }
}

async function getCachedNotifications() {
  const now = Date.now();

  if (notificationsCache.value && now - notificationsCache.fetchedAt < NOTIFICATION_REFRESH_MS) {
    return notificationsCache.value;
  }

  if (notificationsCache.promise) {
    return notificationsCache.promise;
  }

  notificationsCache.promise = getUnraidNotifications()
    .then((value) => {
      notificationsCache = {
        value,
        fetchedAt: Date.now(),
        promise: null
      };
      return value;
    })
    .catch((error) => {
      notificationsCache.promise = null;
      console.error("Notification refresh failed:", error.message);
      return notificationsCache.value || [];
    });

  return notificationsCache.promise;
}

function parseMdstat(mdstat) {
  if (!mdstat) {
    return {
      summary: "Unavailable",
      status: "unknown",
      parity: { status: "unknown", message: "mdstat not available" },
      operation: null,
      raw: null
    };
  }

  const rawLines = mdstat.split("\n");
  const sections = [];
  let currentSection = null;

  for (const line of rawLines) {
    if (/^md\d+\s*:/.test(line)) {
      currentSection = { header: line.trim(), details: [] };
      sections.push(currentSection);
      continue;
    }

    if (currentSection && line.startsWith(" ")) {
      currentSection.details.push(line.trim());
    } else {
      currentSection = null;
    }
  }

  const arraySection = sections.find((section) => /active/i.test(section.header));
  if (!arraySection) {
    return {
      summary: "Healthy",
      status: "healthy",
      parity: { status: "healthy", message: "No active md sync detected" },
      operation: null,
      raw: mdstat
    };
  }

  const operationLine = arraySection.details.find((line) => /(recovery|resync|reshape|check|rebuild)/i.test(line));
  let operation = null;

  if (operationLine) {
    const percentMatch = operationLine.match(/=\s*([\d.]+)%/);
    const speedMatch = operationLine.match(/speed=([^\s]+)/);
    const finishMatch = operationLine.match(/finish=([^\s]+)/);
    const typeMatch = operationLine.match(/(recovery|resync|reshape|check|rebuild)/i);
    const progressPercent = percentMatch ? Number(percentMatch[1]) : null;

    if (progressPercent != null && progressPercent > 0 && progressPercent < 100) {
      operation = {
        type: typeMatch ? typeMatch[1].toLowerCase() : "sync",
        progressPercent,
        speed: speedMatch ? speedMatch[1] : null,
        eta: finishMatch ? finishMatch[1] : null,
        raw: operationLine
      };
    }
  }

  const degraded = [arraySection.header, ...arraySection.details].some(
    (line) => /\[_+U*|U*_+\]/.test(line) || /\[(\d+)\/(\d+)\]/.test(line)
  );

  let summary = "Healthy";
  let status = "healthy";
  if (operation) {
    summary = `${operation.type} in progress`;
    status = "working";
  } else if (degraded) {
    summary = "Attention needed";
    status = "warning";
  }

  return {
    summary,
    status,
    parity: {
      status,
      message: arraySection.header || "Array line not detected"
    },
    operation,
    raw: mdstat
  };
}

function parseUnraidMdDeviceMap(mdstat) {
  const assignments = new Map();
  if (!mdstat) {
    return assignments;
  }

  const lines = mdstat.split("\n");
  const values = {};

  for (const line of lines) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  for (let index = 0; index < 64; index += 1) {
    const deviceName = normalizeDeviceId(values[`rdevName.${index}`]);
    const status = values[`rdevStatus.${index}`];
    const diskNumber = Number(values[`diskNumber.${index}`]);

    if (!deviceName || !status || !/^DISK_/i.test(status)) {
      continue;
    }

    let role = null;
    let mount = null;
    let mdDevice = null;

    if (diskNumber === 0) {
      role = "Parity";
    } else if (Number.isFinite(diskNumber) && diskNumber > 0) {
      role = `Disk ${diskNumber}`;
      mount = `/mnt/disk${diskNumber}`;
      mdDevice = `md${diskNumber}p1`;
    }

    assignments.set(deviceName, {
      role,
      mount,
      mdDevice
    });
  }

  return assignments;
}

async function safeReadMdstat() {
  try {
    return await fs.readFile(MDSTAT_PATH, "utf8");
  } catch (_error) {
    return "";
  }
}

function extractSmartAttribute(table, id) {
  if (!Array.isArray(table)) {
    return null;
  }

  const attribute = table.find((item) => item.id === id);
  if (!attribute) {
    return null;
  }

  if (typeof attribute.raw?.value === "number") {
    return attribute.raw.value;
  }

  const parsed = Number(attribute.raw?.string);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeSmartWarnings(smartData) {
  if (!smartData) {
    return [];
  }

  const warnings = [];
  const table = smartData.ata_smart_attributes?.table || smartData.scsi_grown_defect_list;

  if (smartData.smart_status?.passed === false) {
    warnings.push("SMART self-assessment failed");
  }

  const reallocated = extractSmartAttribute(table, 5);
  const pending = extractSmartAttribute(table, 197);
  const offline = extractSmartAttribute(table, 198);

  if (Number.isFinite(reallocated) && reallocated > 0) {
    warnings.push(`${reallocated} reallocated sectors`);
  }

  if (Number.isFinite(pending) && pending > 0) {
    warnings.push(`${pending} pending sectors`);
  }

  if (Number.isFinite(offline) && offline > 0) {
    warnings.push(`${offline} offline uncorrectable sectors`);
  }

  return warnings;
}

async function getSmartReport(device) {
  if (!device || !device.startsWith("/dev/")) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(SMARTCTL_BIN, ["-a", "-j", device], { timeout: 10000 });
    const parsed = JSON.parse(stdout);
    const warnings = summarizeSmartWarnings(parsed);

    return {
      available: true,
      modelName:
        parsed.model_name ||
        parsed.model_family ||
        parsed.product ||
        parsed.vendor ||
        null,
      serial:
        parsed.serial_number ||
        parsed.logical_unit_id ||
        parsed.wwn?.naa ||
        null,
      userCapacityBytes:
        parsed.user_capacity?.bytes ??
        (parsed.user_capacity?.blocks && parsed.logical_block_size
          ? parsed.user_capacity.blocks * parsed.logical_block_size
          : null),
      deviceType:
        parsed.device?.type ||
        parsed.rotation_rate ||
        parsed.form_factor?.name ||
        null,
      passed: parsed.smart_status?.passed ?? null,
      temperature:
        parsed.temperature?.current ??
        parsed.nvme_smart_health_information_log?.temperature ??
        parsed.ata_smart_attributes?.temperature?.current ??
        null,
      warnings
    };
  } catch (_error) {
    return null;
  }
}

async function getSmartScanDevices() {
  try {
    const { stdout } = await execFileAsync(SMARTCTL_BIN, ["--scan-open"], { timeout: 10000 });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+#/, 1)[0].trim())
      .map((line) => line.split(/\s+/)[0])
      .filter((device) => device.startsWith("/dev/"));
  } catch (_error) {
    return [];
  }
}

async function getLsblkData() {
  try {
    const { stdout } = await execFileAsync(
      LSBLK_BIN,
      ["-J", "-b", "-o", "NAME,PATH,SIZE,MODEL,SERIAL,TYPE,MOUNTPOINTS"],
      { timeout: 10000 }
    );
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed.blockdevices) ? parsed.blockdevices : [];
  } catch (_error) {
    return [];
  }
}

function flattenLsblkDevices(devices) {
  const flat = [];

  for (const device of devices) {
    flat.push(device);
    if (Array.isArray(device.children) && device.children.length) {
      flat.push(...flattenLsblkDevices(device.children));
    }
  }

  return flat;
}

function mountpointsForLsblkDevice(lsblkDevice) {
  if (!lsblkDevice) {
    return [];
  }

  const ownMounts = Array.isArray(lsblkDevice.mountpoints)
    ? lsblkDevice.mountpoints.filter(Boolean)
    : lsblkDevice.mountpoint
      ? [lsblkDevice.mountpoint]
      : [];

  const childMounts = Array.isArray(lsblkDevice.children)
    ? lsblkDevice.children.flatMap((child) => mountpointsForLsblkDevice(child))
    : [];

  return Array.from(new Set([...ownMounts, ...childMounts]));
}

function formatDiskIdentity(device, layout, smart) {
  const devicePath = device.device || device.name || layout.device || "unknown";
  const deviceName = devicePath.replace(/^\/dev\//, "");
  const model =
    smart?.modelName ||
    device.model ||
    device.label ||
    layout.name ||
    layout.vendor ||
    deviceName;
  const serial = smart?.serial || device.serial || layout.serialNum || "";
  const sizeValue = device.size || layout.size || smart?.userCapacityBytes || 0;
  const sizeText = sizeValue ? formatBytes(sizeValue) : "";

  const parts = [model];
  if (serial && !model.includes(serial)) {
    parts.push(serial);
  }
  if (sizeText) {
    parts.push(sizeText);
  }

  return {
    label: parts.join(" - "),
    deviceName
  };
}

function normalizeDeviceId(value) {
  return String(value || "")
    .trim()
    .replace(/^\/dev\//, "")
    .replace(/^\/+/, "");
}

function toDevicePath(value) {
  const id = normalizeDeviceId(value);
  return id ? `/dev/${id}` : "";
}

function isTrackableBlockDevice(value) {
  const id = normalizeDeviceId(value);
  if (!id) {
    return false;
  }

  return !/^(loop|zram|ram|md)\d+/i.test(id);
}

function mergeCandidateDevice(existing, incoming) {
  if (!existing) {
    return incoming;
  }

  return {
    ...existing,
    ...incoming,
    label: incoming.label || existing.label || "",
    model: incoming.model || existing.model || "",
    protocol: incoming.protocol || existing.protocol || "",
    size: incoming.size || existing.size || 0
  };
}

function deviceMatchesFilesystem(fsName, deviceId) {
  const normalizedFs = normalizeDeviceId(fsName);
  const normalizedDevice = normalizeDeviceId(deviceId);

  if (!normalizedFs || !normalizedDevice) {
    return false;
  }

  return normalizedFs === normalizedDevice || new RegExp(`^${normalizedDevice}(p?\\d+)?$`, "i").test(normalizedFs);
}

async function getDiskInsights(storageMounts, mdAssignments = new Map()) {
  const [blockDevices, diskLayout, smartScanDevices, lsblkDevices] = await Promise.all([
    si.blockDevices().catch(() => []),
    si.diskLayout().catch(() => []),
    getSmartScanDevices(),
    getLsblkData()
  ]);

  const layoutByDevice = new Map();
  for (const disk of diskLayout) {
    if (disk.device) {
      layoutByDevice.set(normalizeDeviceId(disk.device), disk);
    }
  }

  const flatLsblk = flattenLsblkDevices(lsblkDevices);
  const lsblkByPath = new Map();
  for (const device of flatLsblk) {
    if (device.path) {
      lsblkByPath.set(device.path, device);
      lsblkByPath.set(normalizeDeviceId(device.path), device);
    }
    if (device.name) {
      lsblkByPath.set(normalizeDeviceId(device.name), device);
    }
  }

  const candidateMap = new Map();

  for (const device of blockDevices.filter((item) => item.type === "disk")) {
    const key = normalizeDeviceId(device.name || device.device);
    if (!isTrackableBlockDevice(key)) {
      continue;
    }

    candidateMap.set(
      key,
      mergeCandidateDevice(candidateMap.get(key), {
        device: toDevicePath(key),
        name: key,
        label: device.label || "",
        model: device.model || "",
        protocol: device.protocol || "",
        size: device.size || 0
      })
    );
  }

  for (const device of lsblkDevices.filter((item) => item.type === "disk")) {
    const key = normalizeDeviceId(device.path || device.name);
    if (!isTrackableBlockDevice(key)) {
      continue;
    }

    candidateMap.set(
      key,
      mergeCandidateDevice(candidateMap.get(key), {
        device: toDevicePath(key),
        name: key,
        label: "",
        model: device.model || "",
        protocol: "",
        size: Number(device.size || 0)
      })
    );
  }

  for (const device of smartScanDevices) {
    const key = normalizeDeviceId(device);
    if (!isTrackableBlockDevice(key)) {
      continue;
    }

    candidateMap.set(
      key,
      mergeCandidateDevice(candidateMap.get(key), {
        device: toDevicePath(key),
        name: key,
        label: "",
        model: "",
        protocol: "",
        size: 0
      })
    );
  }

  const disks = await Promise.all(
    Array.from(candidateMap.values()).map(async (device) => {
        const layout = layoutByDevice.get(normalizeDeviceId(device.name || device.device)) || {};
        const lsblkDevice = lsblkByPath.get(device.device || device.name);
        const smart = await getSmartReport(device.device || device.name);
        const mdAssignment = mdAssignments.get(normalizeDeviceId(device.name || device.device)) || null;
        const temperature = smart?.temperature ?? layout.temperature ?? null;
        const smartWarnings = smart?.warnings || [];
        const smartPassed = smart?.passed ?? (layout.smartStatus ? /ok|passed/i.test(layout.smartStatus) : null);
        const relatedMountpoints = Array.from(
          new Set([...(mdAssignment?.mount ? [mdAssignment.mount] : []), ...mountpointsForLsblkDevice(lsblkDevice)])
        );
        const relatedMounts = storageMounts.filter((mount) => {
          const fsName = String(mount.fs || "");
          return (
            [device.name, device.device, mdAssignment?.mdDevice].filter(Boolean).some((candidate) => deviceMatchesFilesystem(fsName, candidate)) ||
            relatedMountpoints.includes(mount.mount)
          );
        });
        const identity = formatDiskIdentity(device, layout, smart);
        const sizeBytes = device.size || layout.size || lsblkDevice?.size || smart?.userCapacityBytes || 0;
        const primaryMount = relatedMounts[0] || null;
        const bootHint =
          lsblkDevice?.children?.some((child) => child.label === "UNRAID" || mountpointsForLsblkDevice(child).includes("/boot")) ||
          false;

        let usage = null;
        if (primaryMount && Number.isFinite(primaryMount.size)) {
          usage = {
            mount: primaryMount.mount,
            used: formatBytes(primaryMount.used),
            available: formatBytes(primaryMount.available),
            usagePercent: Number(primaryMount.usagePercent || 0)
          };
        } else if (relatedMountpoints.length) {
          const usageStats = await getFilesystemUsageForPath(relatedMountpoints[0]);
          if (usageStats) {
            usage = {
              mount: relatedMountpoints[0],
              used: usageStats.used,
              available: usageStats.available,
              usagePercent: usageStats.usagePercent
            };
          }
        }

        return {
          device: device.name || device.device || "unknown",
          label: identity.label,
          deviceName: identity.deviceName,
          type: device.protocol || layout.type || "disk",
          filesystem: primaryMount?.type || relatedMounts[0]?.type || null,
          mdRole: mdAssignment?.role || null,
          bootHint,
          size: formatBytes(sizeBytes),
          mounts: Array.from(new Set([...relatedMounts.map((mount) => mount.mount), ...relatedMountpoints])),
          usage,
          temperature,
          smartPassed,
          smartWarnings,
          health: smartWarnings.length || smartPassed === false ? "warning" : smartPassed === true ? "healthy" : "unknown"
        };
      })
  );

  return disks.sort((a, b) => a.label.localeCompare(b.label));
}

async function getFilesystemUsageForPath(targetPath) {
  try {
    const stats = await fs.statfs(targetPath);
    const size = stats.bsize * stats.blocks;
    const available = stats.bsize * stats.bavail;
    const used = size - available;

    return {
      size: formatBytes(size),
      used: formatBytes(used),
      available: formatBytes(available),
      usagePercent: size ? Number(((used / size) * 100).toFixed(2)) : 0
    };
  } catch (_error) {
    return null;
  }
}

async function getDirectoryUsageForPath(targetPath) {
  try {
    const attempts = [
      { args: ["-sb", targetPath], multiplier: 1 },
      { args: ["-sk", targetPath], multiplier: 1024 }
    ];

    for (const attempt of attempts) {
      try {
        const { stdout } = await execFileAsync(DU_BIN, attempt.args, { timeout: SHARE_DU_TIMEOUT_MS });
        const units = Number(String(stdout || "").trim().split(/\s+/)[0]);
        if (Number.isFinite(units) && units >= 0) {
          return units * attempt.multiplier;
        }
      } catch (_error) {
        continue;
      }
    }

    return null;
  } catch (_error) {
    return null;
  }
}

async function getShareUsageForPath(sharePath) {
  const [filesystemUsage, directoryUsedBytes] = await Promise.all([
    getFilesystemUsageForPath(sharePath),
    getDirectoryUsageForPath(sharePath)
  ]);

  if (!filesystemUsage || directoryUsedBytes == null) {
    return null;
  }

  return {
    size: filesystemUsage.size,
    available: filesystemUsage.available,
    used: formatBytes(directoryUsedBytes),
    usagePercent: filesystemUsage.size ? Number(((directoryUsedBytes / filesystemUsage.size) * 100).toFixed(2)) : 0
  };
}

async function getShareInsights(configShares) {
  const insights = [];

  for (const share of configShares) {
    const normalized = normalizeShare(share);
    try {
      await fs.access(normalized.path);
    } catch (_error) {
      insights.push({
        ...normalized,
        available: false,
        error: "Share path not accessible from the container"
      });
      continue;
    }

    const usage = await getShareUsageForPath(normalized.path);
    if (!usage) {
      insights.push({
        ...normalized,
        available: false,
        error: `Could not determine share usage within ${Math.round(SHARE_DU_TIMEOUT_MS / 1000)}s`
      });
      continue;
    }

    insights.push({
      ...normalized,
      available: true,
      ...usage
    });
  }

  return insights;
}

function summarizeSmartAlerts(disks) {
  return disks
    .filter((disk) => Array.isArray(disk.smartWarnings) && disk.smartWarnings.length)
    .map((disk) => ({
      device: disk.device,
      label: disk.label,
      warnings: disk.smartWarnings
    }));
}

function summarizeCachePools(storageMounts) {
  return storageMounts
    .filter((mount) => /\/mnt\/cache/i.test(mount.mount) || /btrfs|zfs/i.test(mount.type || ""))
    .map((mount) => ({
      mount: mount.mount,
      fs: mount.fs,
      type: mount.type,
      size: mount.size,
      used: mount.used,
      available: mount.available,
      usagePercent: mount.usagePercent,
      status: mount.usagePercent >= 90 ? "warning" : "healthy"
    }));
}

function summarizeCachePoolsFromDisks(disks) {
  return disks
    .filter((disk) => Array.isArray(disk.mounts) && disk.mounts.some((mount) => /^\/mnt\/(cache|[^/]+)$/i.test(mount) && !/^\/mnt\/disk\d+$/i.test(mount) && mount !== "/boot"))
    .filter((disk) => disk.usage && Number.isFinite(disk.size))
    .map((disk) => ({
      mount: disk.mounts[0] || null,
      fs: disk.filesystem || "n/a",
      type: disk.type,
      size: Number(disk.size || 0),
      used: Number(disk.usage?.used || 0),
      available: Number(disk.usage?.available || 0),
      usagePercent: Number(disk.usage?.usagePercent || 0),
      status: Number(disk.usage?.usagePercent || 0) >= 90 ? "warning" : "healthy"
    }));
}

function prettifyMountLabel(mount) {
  const name = String(mount || "")
    .split("/")
    .filter(Boolean)
    .pop();

  if (!name) {
    return "Device";
  }

  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function classifyDeviceGroup(disk) {
  const mounts = Array.isArray(disk.mounts) ? disk.mounts : [];
  const arrayMount = mounts.find((mount) => /^\/mnt\/disk(\d+)$/i.test(mount));

  if (disk.bootHint || mounts.includes("/boot")) {
    return { key: "boot", label: "Flash" };
  }

  if (disk.mdRole) {
    return { key: "array", label: disk.mdRole };
  }

  if (arrayMount) {
    const match = arrayMount.match(/^\/mnt\/disk(\d+)$/i);
    return { key: "array", label: `Disk ${match[1]}` };
  }

  const poolMount = mounts.find((mount) => {
    if (!/^\/mnt\/[^/]+$/i.test(mount)) {
      return false;
    }

    return !/^\/mnt\/disk\d+$/i.test(mount) && !/^\/mnt\/user$/i.test(mount);
  });

  if (poolMount) {
    return { key: "pool", label: prettifyMountLabel(poolMount) };
  }

  return { key: "other", label: "Unassigned" };
}

function createDeviceSummaryRow(items, label) {
  const usageItems = items.filter((item) => Number.isFinite(item.usedBytes) && Number.isFinite(item.freeBytes));
  const sizeBytes = usageItems.reduce((sum, item) => sum + (item.sizeBytes || 0), 0);
  const usedBytes = usageItems.reduce((sum, item) => sum + (item.usedBytes || 0), 0);
  const freeBytes = usageItems.reduce((sum, item) => sum + (item.freeBytes || 0), 0);

  return {
    role: label,
    label: `${label} summary`,
    isSummary: true,
    count: items.length,
    sizeBytes,
    usedBytes,
    freeBytes,
    filesystem: usageItems.length ? "mixed" : "n/a",
    usagePercent: sizeBytes ? Number(((usedBytes / sizeBytes) * 100).toFixed(2)) : 0,
    health: "healthy"
  };
}

function summarizeDeviceGroups(disks) {
  const groupMap = new Map([
    ["array", { key: "array", title: "Array Devices", items: [] }],
    ["pool", { key: "pool", title: "Pool Devices", items: [] }],
    ["boot", { key: "boot", title: "Boot Device", items: [] }],
    ["other", { key: "other", title: "Other Devices", items: [] }]
  ]);

  const rows = disks.map((disk) => {
    const classification = classifyDeviceGroup(disk);
    return {
      groupKey: classification.key,
      role: classification.label,
      label: disk.label,
      deviceName: disk.deviceName,
      temperature: disk.temperature,
      spundown: Boolean(disk.spundown),
      rotational: Boolean(disk.rotational),
      status: disk.status || "",
      filesystem: disk.filesystem || "n/a",
      sizeBytes: Number(disk.size || 0),
      usedBytes: Number.isFinite(disk.usage?.used) ? Number(disk.usage.used) : null,
      freeBytes: Number.isFinite(disk.usage?.available) ? Number(disk.usage.available) : null,
      usagePercent: Number.isFinite(disk.usage?.usagePercent) ? Number(disk.usage.usagePercent) : null,
      health: disk.health,
      mounts: disk.mounts || [],
      smartPassed: disk.smartPassed,
      smartWarnings: disk.smartWarnings || [],
      isSummary: false
    };
  });

  const unmountedArrayCandidates = rows.filter(
    (row) => row.groupKey === "other" && (!row.mounts || row.mounts.length === 0) && row.deviceName !== "sda"
  );

  if (unmountedArrayCandidates.length === 1) {
    unmountedArrayCandidates[0].groupKey = "array";
    unmountedArrayCandidates[0].role = "Parity";
  }

  for (const row of rows) {
    groupMap.get(row.groupKey)?.items.push(row);
  }

  if (groupMap.get("array").items.length) {
    groupMap.get("array").items.sort((left, right) => {
      if (left.role === "Parity") {
        return -1;
      }
      if (right.role === "Parity") {
        return 1;
      }

      const leftDisk = Number((left.role.match(/\d+/) || [Number.MAX_SAFE_INTEGER])[0]);
      const rightDisk = Number((right.role.match(/\d+/) || [Number.MAX_SAFE_INTEGER])[0]);
      return leftDisk - rightDisk;
    });
  }

  if (groupMap.get("pool").items.length) {
    groupMap.get("pool").items.sort((left, right) => left.role.localeCompare(right.role));
  }

  if (groupMap.get("other").items.length) {
    groupMap.get("other").items.sort((left, right) => left.label.localeCompare(right.label));
  }

  for (const group of groupMap.values()) {
    if (group.items.length > 1 && group.key !== "boot") {
      group.summary = createDeviceSummaryRow(group.items, group.title.replace(/ Devices?$/, ""));
    } else {
      group.summary = null;
    }
  }

  return Array.from(groupMap.values()).filter((group) => group.items.length);
}

function getArrayUsagePercent(deviceGroups) {
  const arrayGroup = (deviceGroups || []).find((group) => group.key === "array");
  if (!arrayGroup) {
    return null;
  }

  if (arrayGroup.summary && Number.isFinite(arrayGroup.summary.usagePercent)) {
    return clampPercent(arrayGroup.summary.usagePercent);
  }

  const usageRows = (arrayGroup.items || []).filter(
    (item) => Number.isFinite(item.usedBytes) && Number.isFinite(item.sizeBytes) && item.sizeBytes > 0
  );

  if (!usageRows.length) {
    return null;
  }

  const totalSize = usageRows.reduce((sum, item) => sum + item.sizeBytes, 0);
  const totalUsed = usageRows.reduce((sum, item) => sum + item.usedBytes, 0);
  return totalSize ? clampPercent((totalUsed / totalSize) * 100) : null;
}

function recordHistoryPoint(seriesName, value, timestamp) {
  if (!Number.isFinite(value)) {
    return;
  }

  const series = metricsHistory[seriesName];
  if (!series) {
    return;
  }

  series.push({
    timestamp,
    value: Number(value.toFixed(2))
  });

  if (series.length > HISTORY_POINTS) {
    series.splice(0, series.length - HISTORY_POINTS);
  }
}

function captureMetricHistory(system, storageInsights) {
  const timestamp = new Date().toISOString();
  const now = Date.now();
  if (now - lastHistorySnapshotAt < Math.max(1000, UPDATE_INTERVAL_MS - 500)) {
    return;
  }

  lastHistorySnapshotAt = now;

  const totalNetworkThroughput = (system.network || []).reduce(
    (sum, item) => sum + Number(item.rxSec || 0) + Number(item.txSec || 0),
    0
  );

  recordHistoryPoint("cpuLoad", clampPercent(system.cpu?.load), timestamp);
  recordHistoryPoint("memoryUsage", clampPercent(system.memory?.usagePercent), timestamp);
  recordHistoryPoint("networkThroughput", totalNetworkThroughput, timestamp);

  const arrayUsage = getArrayUsagePercent(storageInsights?.deviceGroups);
  if (Number.isFinite(arrayUsage)) {
    recordHistoryPoint("arrayUsage", arrayUsage, timestamp);
  }
}

function getHistoryPayload() {
  return {
    cpuLoad: metricsHistory.cpuLoad,
    memoryUsage: metricsHistory.memoryUsage,
    networkThroughput: metricsHistory.networkThroughput,
    arrayUsage: metricsHistory.arrayUsage
  };
}

function buildDashboardPayload({ system, containers, config, storageInsights, notifications }) {
  captureMetricHistory(system, storageInsights);
  const history = getHistoryPayload();

  return {
    system: {
      ...system,
      history: {
        cpuLoad: history.cpuLoad,
        memoryUsage: history.memoryUsage,
        networkThroughput: history.networkThroughput
      }
    },
    containers,
    config: sanitizeConfigForClient(config),
    notifications,
    storageInsights: {
      ...storageInsights,
      history: {
        arrayUsage: history.arrayUsage
      }
    }
  };
}

function buildStoragePayload(storageInsights) {
  return {
    ...storageInsights,
    history: {
      arrayUsage: getHistoryPayload().arrayUsage
    }
  };
}

async function getStorageInsights() {
  const [mdstat, disksIniRaw] = await Promise.all([safeReadMdstat(), safeReadText(HOST_EMHTTP_DISKS_PATH)]);
  const disksFromUnraid = buildUnraidDiskInsights(disksIniRaw);
  const disks = disksFromUnraid;

  return {
    timestamp: new Date().toISOString(),
    array: parseMdstat(mdstat),
    cachePools: summarizeCachePoolsFromDisks(disksFromUnraid),
    disks,
    deviceGroups: summarizeDeviceGroups(disks),
    smartAlerts: summarizeSmartAlerts(disks)
  };
}

async function refreshStorageCacheNow() {
  try {
    const value = await getStorageInsights();

    storageInsightsCache = {
      value,
      fetchedAt: Date.now(),
      promise: null
    };

    return value;
  } catch (error) {
    console.error("Storage cache refresh failed:", error.message);
    return storageInsightsCache.value;
  }
}

function createStorageInsightsFallback(configShares) {
  return {
    timestamp: new Date().toISOString(),
    array: {
      summary: "Loading",
      status: "unknown",
      parity: { status: "unknown", message: "Storage details are still loading" },
      operation: null,
      raw: null
    },
    cachePools: [],
    disks: [],
    deviceGroups: [],
    smartAlerts: []
  };
}

async function getCachedStorageInsights() {
  const now = Date.now();

  if (storageInsightsCache.value && now - storageInsightsCache.fetchedAt < STORAGE_REFRESH_MS) {
    return storageInsightsCache.value;
  }

  if (storageInsightsCache.value) {
    if (!storageInsightsCache.promise) {
      storageInsightsCache.promise = getStorageInsights()
        .then((value) => {
          storageInsightsCache = {
            value,
            fetchedAt: Date.now(),
            promise: null
          };
          return value;
        })
        .catch((error) => {
          console.error("Background storage refresh failed:", error.message);
          storageInsightsCache.promise = null;
          return storageInsightsCache.value;
        });
    }

    return storageInsightsCache.value;
  }

  if (storageInsightsCache.promise) {
    return createStorageInsightsFallback([]);
  }

  storageInsightsCache.promise = getStorageInsights()
    .then((value) => {
      storageInsightsCache = {
        value,
        fetchedAt: Date.now(),
        promise: null
      };
      return value;
    })
    .catch((error) => {
      console.error("Initial storage refresh failed:", error.message);
      storageInsightsCache.promise = null;
      return createStorageInsightsFallback([]);
    });

  return createStorageInsightsFallback([]);
}

function resolveContainerState(containerInfo, stats) {
  const state = containerInfo.State || "unknown";
  const cpuDelta =
    (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta =
    (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
  const onlineCpus = stats.cpu_stats?.online_cpus || 1;

  let cpuPercent = 0;
  if (cpuDelta > 0 && systemDelta > 0) {
    cpuPercent = (cpuDelta / systemDelta) * onlineCpus * 100;
  }

  const memoryUsage = stats.memory_stats?.usage || 0;
  const memoryLimit = stats.memory_stats?.limit || 0;
  const memoryPercent = memoryLimit ? (memoryUsage / memoryLimit) * 100 : 0;

  return {
    id: containerInfo.Id,
    shortId: containerInfo.Id?.slice(0, 12),
    name: (containerInfo.Names?.[0] || "").replace(/^\//, ""),
    image: containerInfo.Image,
    state,
    status: containerInfo.Status,
    created: containerInfo.Created,
    ports: containerInfo.Ports || [],
    labels: containerInfo.Labels || {},
    networks: Object.keys(containerInfo.NetworkSettings?.Networks || stats.networks || {}),
    cpuPercent: Number(cpuPercent.toFixed(2)),
    memoryUsage: formatBytes(memoryUsage),
    memoryLimit: formatBytes(memoryLimit),
    memoryPercent: Number(memoryPercent.toFixed(2)),
    networkRx: formatBytes(
      Object.values(stats.networks || {}).reduce((sum, item) => sum + (item.rx_bytes || 0), 0)
    ),
    networkTx: formatBytes(
      Object.values(stats.networks || {}).reduce((sum, item) => sum + (item.tx_bytes || 0), 0)
    )
  };
}

async function getContainerStats() {
  try {
    const containers = await docker.listContainers({ all: true });

    const enriched = await Promise.all(
      containers.map(async (containerInfo) => {
        try {
          const stats = await docker.getContainer(containerInfo.Id).stats({ stream: false });
          return resolveContainerState(containerInfo, stats);
        } catch (error) {
          return {
            id: containerInfo.Id,
            shortId: containerInfo.Id?.slice(0, 12),
            name: (containerInfo.Names?.[0] || "").replace(/^\//, ""),
            image: containerInfo.Image,
            state: containerInfo.State || "unknown",
            status: containerInfo.Status,
            created: containerInfo.Created,
            ports: containerInfo.Ports || [],
            labels: containerInfo.Labels || {},
            networks: Object.keys(containerInfo.NetworkSettings?.Networks || {}),
            cpuPercent: 0,
            memoryUsage: 0,
            memoryLimit: 0,
            memoryPercent: 0,
            networkRx: 0,
            networkTx: 0,
            statsError: error.message
          };
        }
      })
    );

    return {
      timestamp: new Date().toISOString(),
      count: enriched.length,
      running: enriched.filter((container) => container.state === "running").length,
      containers: enriched.sort((a, b) => a.name.localeCompare(b.name))
    };
  } catch (error) {
    return {
      timestamp: new Date().toISOString(),
      count: 0,
      running: 0,
      containers: [],
      error: `Docker socket unavailable at ${DOCKER_SOCKET_PATH}: ${error.message}`
    };
  }
}

async function getCachedContainerStats() {
  const now = Date.now();

  if (containerStatsCache.value && now - containerStatsCache.fetchedAt < CONTAINER_REFRESH_MS) {
    return containerStatsCache.value;
  }

  if (containerStatsCache.promise) {
    return containerStatsCache.promise;
  }

  containerStatsCache.promise = getContainerStats()
    .then((value) => {
      containerStatsCache = {
        value,
        fetchedAt: Date.now(),
        promise: null
      };
      return value;
    })
    .catch((error) => {
      containerStatsCache.promise = null;
      throw error;
    });

  return containerStatsCache.promise;
}

function resetContainerStatsCache() {
  containerStatsCache = {
    value: null,
    fetchedAt: 0,
    promise: null
  };
}

async function refreshContainerStatsNow() {
  resetContainerStatsCache();
  return getCachedContainerStats();
}

function extractXmlTagValues(raw, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const values = [];
  let match = pattern.exec(String(raw || ""));
  while (match) {
    values.push(String(match[1] || "").trim());
    match = pattern.exec(String(raw || ""));
  }
  return values;
}

function extractXmlTagValue(raw, tagName) {
  return extractXmlTagValues(raw, tagName)[0] || "";
}

function parseDockerTemplateFile(raw, fileName) {
  const webUi = extractXmlTagValue(raw, "WebUI");
  const repository = extractXmlTagValue(raw, "Repository");
  const network = extractXmlTagValue(raw, "Network");
  const shell = extractXmlTagValue(raw, "Shell");
  const icon = extractXmlTagValue(raw, "Icon");
  const envMatches = Array.from(String(raw || "").matchAll(/<Config\b[^>]*Type="Variable"[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/Config>/gi));
  const pathMatches = Array.from(String(raw || "").matchAll(/<Config\b[^>]*Type="Path"[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/Config>/gi));
  const portMatches = Array.from(String(raw || "").matchAll(/<Config\b[^>]*Type="Port"[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/Config>/gi));

  return {
    fileName,
    name: extractXmlTagValue(raw, "Name") || fileName.replace(/\.xml$/i, ""),
    repository,
    webUi,
    network,
    shell,
    iconConfigured: Boolean(icon),
    env: envMatches.slice(0, 20).map((match) => ({
      name: String(match[1] || "").trim(),
      valueSummary: summarizeTemplateValuePresence(match[1], match[2])
    })),
    paths: pathMatches.slice(0, 20).map((match) => ({
      name: String(match[1] || "").trim(),
      value: String(match[2] || "").trim()
    })),
    ports: portMatches.slice(0, 20).map((match) => ({
      name: String(match[1] || "").trim(),
      value: String(match[2] || "").trim()
    }))
  };
}

async function getDockerTemplateSummaries() {
  const entries = await safeReadDir(HOST_DOCKER_TEMPLATES_DIR, { withFileTypes: true });
  const templates = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".xml")) {
      continue;
    }

    const fullPath = path.join(HOST_DOCKER_TEMPLATES_DIR, entry.name);
    const raw = await safeReadText(fullPath);
    if (!raw.trim()) {
      continue;
    }

    templates.push(parseDockerTemplateFile(raw, entry.name));
  }

  return templates.sort((left, right) => left.name.localeCompare(right.name));
}

async function getShareConfigSummaries() {
  const entries = await safeReadDir(HOST_SHARES_CONFIG_DIR, { withFileTypes: true });
  const shares = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".cfg")) {
      continue;
    }

    const fullPath = path.join(HOST_SHARES_CONFIG_DIR, entry.name);
    const raw = await safeReadText(fullPath);
    if (!raw.trim()) {
      continue;
    }

    const values = parseKeyValueConfig(raw);
    shares.push({
      fileName: entry.name,
      name: entry.name.replace(/\.cfg$/i, ""),
      include: summarizeBooleanLike(values.shareInclude),
      export: summarizeBooleanLike(values.shareExport),
      exportNfs: summarizeBooleanLike(values.shareExportNFS),
      security: values.shareSecurity || values.shareSec || "unset",
      cache: values.shareUseCache || "unset",
      floor: values.shareFloor || "unset",
      allocation: values.shareAllocator || "unset",
      splitLevel: values.shareSplitLevel || "unset",
      comments: values.shareComment || ""
    });
  }

  return shares.sort((left, right) => left.name.localeCompare(right.name));
}

function parseExports(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const parts = line.split(/\s+/).filter(Boolean);
      return {
        path: parts[0] || "",
        targets: parts.slice(1)
      };
    })
    .filter((entry) => entry.path);
}

async function getUserScriptSummaries() {
  const entries = await safeReadDir(HOST_USER_SCRIPTS_DIR, { withFileTypes: true });
  const scripts = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const basePath = path.join(HOST_USER_SCRIPTS_DIR, entry.name);
    const scriptRaw = await safeReadText(path.join(basePath, "script"));
    const descRaw = await safeReadText(path.join(basePath, "description"));
    const scheduleRaw = await safeReadText(path.join(basePath, "schedule"));
    scripts.push({
      name: entry.name,
      description: String(descRaw || "").trim(),
      schedule: String(scheduleRaw || "").trim() || "manual",
      hasScriptBody: Boolean(String(scriptRaw || "").trim())
    });
  }

  return scripts.sort((left, right) => left.name.localeCompare(right.name));
}

async function getPluginSummaries() {
  const entries = await safeReadDir(HOST_PLUGINS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      category: entry.name === "dynamix" ? "core" : "plugin"
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function getVmSummaries() {
  const entries = await safeReadDir(HOST_VM_CONFIG_DIR, { withFileTypes: true });
  const vms = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".xml")) {
      continue;
    }

    const raw = await safeReadText(path.join(HOST_VM_CONFIG_DIR, entry.name));
    if (!raw.trim()) {
      continue;
    }

    vms.push({
      fileName: entry.name,
      name: extractXmlTagValue(raw, "name") || entry.name.replace(/\.xml$/i, ""),
      memoryKiB: Number(extractXmlTagValue(raw, "memory")) || 0,
      vcpu: Number(extractXmlTagValue(raw, "vcpu")) || 0,
      diskSources: Array.from(String(raw || "").matchAll(/<source\s+file='([^']+)'/gi)).map((match) => match[1]).slice(0, 10),
      bridgeTargets: Array.from(String(raw || "").matchAll(/<source\s+bridge='([^']+)'/gi)).map((match) => match[1]).slice(0, 10)
    });
  }

  return vms.sort((left, right) => left.name.localeCompare(right.name));
}

async function findServiceContainer(serviceName) {
  const config = await readConfig();
  const service = (config.services || []).find(
    (item) => normalizedSearchValue(item.name) === normalizedSearchValue(serviceName)
  );

  if (!service) {
    const error = new Error(`Service "${serviceName}" is not defined in the dashboard config.`);
    error.statusCode = 404;
    throw error;
  }

  let containers;
  try {
    containers = await docker.listContainers({ all: true });
  } catch (error) {
    const nextError = new Error(`Docker socket unavailable at ${DOCKER_SOCKET_PATH}: ${error.message}`);
    nextError.statusCode = 503;
    throw nextError;
  }

  const bestMatch = containers
    .map((containerInfo) => ({
      containerInfo,
      score: serviceContainerMatchScore(service, containerInfo)
    }))
    .filter((item) => item.score >= 60)
    .sort((a, b) => b.score - a.score)[0];

  if (!bestMatch) {
    const error = new Error(`No Docker container matched service "${service.name}".`);
    error.statusCode = 404;
    throw error;
  }

  return {
    service,
    containerInfo: bestMatch.containerInfo,
    container: docker.getContainer(bestMatch.containerInfo.Id)
  };
}

async function getDashboardSnapshot() {
  const config = await readConfig();
  const [system, containers, notifications] = await Promise.all([
    getSystemStats(),
    getCachedContainerStats(),
    getCachedNotifications()
  ]);
  const storageInsights = await getCachedStorageInsights();

  return buildDashboardPayload({ system, containers, config, storageInsights, notifications });
}

app.use(ensureAuthenticated);
app.use(express.static(fsSync.existsSync(path.join(DIST_DIR, "index.html")) ? DIST_DIR : PUBLIC_DIR));

app.get("/api/auth/session", async (req, res) => {
  try {
    const config = await readConfig();
    const configured = oidcConfigured(config.auth);
    const authenticated = Boolean(req.session?.user);

    if (!authenticated && !configured && !requestIsLocal(req)) {
      return res.status(403).json({ error: "OIDC setup is only available from the local network until authentication is configured." });
    }

    return res.json({
      enabled: true,
      configured,
      authenticated,
      user: req.session?.user || null,
      auth: sanitizeAuthConfigForClient(config.auth)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/auth/login", async (req, res) => {
  try {
    const config = await readConfig();
    const auth = normalizeAuthConfig(config.auth);
    if (!oidcConfigured(auth)) {
      return res.status(400).send("OIDC is enabled but not fully configured.");
    }

    const { client, config: oidcClient } = await getOidcClient(auth);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const url = client.buildAuthorizationUrl(oidcClient, {
      client_id: auth.clientId,
      redirect_uri: auth.redirectUri,
      response_type: "code",
      scope: auth.scopes,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    });

    req.session.oidc = {
      state,
      nonce,
      codeVerifier
    };

    return res.redirect(url.toString());
  } catch (error) {
    return res.status(500).send(error.message);
  }
});

app.get("/api/auth/callback", async (req, res) => {
  try {
    const config = await readConfig();
    const auth = normalizeAuthConfig(config.auth);
    const pending = req.session?.oidc;

    if (!pending || !req.query.state || req.query.state !== pending.state) {
      return res.status(400).send("Invalid OIDC state.");
    }

    const { client, config: oidcClient } = await getOidcClient(auth);
    const currentUrl = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
    const tokenResponse = await client.authorizationCodeGrant(oidcClient, currentUrl, {
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      pkceCodeVerifier: pending.codeVerifier
    });
    const idTokenClaims = typeof tokenResponse.claims === "function" ? tokenResponse.claims() || {} : {};
    const userInfo = tokenResponse.access_token && idTokenClaims.sub
      ? await client.fetchUserInfo(oidcClient, tokenResponse.access_token, idTokenClaims.sub).catch(() => null)
      : null;
    const profile = buildUserProfile(idTokenClaims, userInfo);

    req.session.user = profile;
    req.session.idToken = tokenResponse.id_token || "";
    req.session.oidc = null;

    const destination = req.session.returnTo || "/";
    req.session.returnTo = null;
    return res.redirect(destination);
  } catch (error) {
    return res.status(500).send(error.message);
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const config = await readConfig();
    const auth = normalizeAuthConfig(config.auth);
    const logoutRedirect = auth.postLogoutRedirectUri || "/";
    const idTokenHint = req.session?.idToken || "";
    const metadata = oidcConfigured(auth) ? await getOidcMetadata(auth).catch(() => null) : null;

    req.session.destroy(() => {
      if (metadata?.end_session_endpoint) {
        const url = new URL(metadata.end_session_endpoint);
        if (idTokenHint) {
          url.searchParams.set("id_token_hint", idTokenHint);
        }
        if (logoutRedirect) {
          url.searchParams.set("post_logout_redirect_uri", logoutRedirect);
        }
        return res.json({ ok: true, redirectTo: url.toString() });
      }

      return res.json({ ok: true, redirectTo: logoutRedirect });
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/system", async (_req, res) => {
  try {
    res.json(await getSystemStats());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/containers", async (_req, res) => {
  try {
    res.json(await getCachedContainerStats());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/dashboard", async (_req, res) => {
  try {
    res.json(await getDashboardSnapshot());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/storage", async (_req, res) => {
  try {
    const system = await getSystemStats();
    const storageInsights = await getCachedStorageInsights();
    captureMetricHistory(system, storageInsights);
    res.json(buildStoragePayload(storageInsights));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/storage/refresh", requireWriteAccess, async (_req, res) => {
  try {
    const refreshed = await refreshStorageCacheNow();
    if (!refreshed) {
      return res.status(500).json({ error: "Storage refresh did not return data." });
    }

    const system = await getSystemStats();
    captureMetricHistory(system, refreshed);
    const payload = buildStoragePayload(refreshed);
    io.emit("storage:update", payload);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/services/:serviceName/power", requireWriteAccess, async (req, res) => {
  try {
    const desiredState = String(req.body?.state || "").trim().toLowerCase();
    if (!["start", "stop", "toggle"].includes(desiredState)) {
      return res.status(400).json({ error: 'Body "state" must be "start", "stop", or "toggle".' });
    }

    const { service, containerInfo, container } = await findServiceContainer(req.params.serviceName);
    const currentState = String(containerInfo.State || "unknown").toLowerCase();
    const action =
      desiredState === "toggle"
        ? currentState === "running"
          ? "stop"
          : "start"
        : desiredState;

    if (action === "stop" && serviceProtectedFromDisable(service)) {
      return res.status(403).json({ error: `${service.name} is protected and cannot be disabled from the dashboard.` });
    }

    if (action === "start" && currentState !== "running") {
      await container.start();
    }

    if (action === "stop" && currentState === "running") {
      await container.stop();
    }

    const containers = await refreshContainerStatsNow();
    const snapshot = await getDashboardSnapshot();
    io.emit("dashboard:update", snapshot);

    return res.json({
      ok: true,
      service: service.name,
      action,
      previousState: currentState,
      containers
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get("/api/config", async (_req, res) => {
  try {
    res.json(sanitizeConfigForClient(await readConfig()));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/notifications/:id/read", requireWriteAccess, async (req, res) => {
  try {
    await markNotificationAsRead(req.params.id);
    const notifications = await refreshNotificationsNow();
    io.emit("notifications:update", notifications);
    return res.json({ ok: true, notifications });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/notifications/:id", requireWriteAccess, async (req, res) => {
  try {
    await deleteNotification(req.params.id);
    const notifications = await refreshNotificationsNow();
    io.emit("notifications:update", notifications);
    return res.json({ ok: true, notifications });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

async function handleConfigWrite(req, res) {
  try {
    const validationError = validateConfig(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const config = await writeConfig(req.body);
    io.emit("config:update", sanitizeConfigForClient(config));
    return res.json(sanitizeConfigForClient(config));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

app.post("/api/config", requireWriteAccess, handleConfigWrite);
app.put("/api/config", requireWriteAccess, handleConfigWrite);

app.get("/api/wiki", async (_req, res) => {
  try {
    res.json(await readWiki());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/wiki/generate", requireWriteAccess, async (_req, res) => {
  try {
    const metadata = await gatherWikiMetadata();
    const wiki = await readWiki();
    const categoryDefs = DEFAULT_WIKI_CATEGORY_DEFINITIONS;

    const results = [];
    for (const def of categoryDefs) {
      try {
        const articles = await generateWikiCategory(def, metadata);
        results.push({ ...def, articles });
      } catch (categoryError) {
        const existing = wiki.categories.find((c) => c.id === def.id);
        results.push({
          ...def,
          articles: existing?.articles || [],
          error: categoryError.message
        });
      }
    }

    const updated = {
      categories: results,
      generatedAt: new Date().toISOString()
    };
    await writeWiki(updated);
    res.json({ ...updated, apiKeyConfigured: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/wiki/generate/:categoryId", requireWriteAccess, async (req, res) => {
  try {
    const categoryDef = DEFAULT_WIKI_CATEGORY_DEFINITIONS.find((def) => def.id === req.params.categoryId);
    if (!categoryDef) {
      return res.status(404).json({ error: `Unknown wiki category: ${req.params.categoryId}` });
    }

    const metadata = await gatherWikiMetadata();
    const articles = await generateWikiCategory(categoryDef, metadata);
    const wiki = await readWiki();

    const categoryIndex = wiki.categories.findIndex((c) => c.id === categoryDef.id);
    if (categoryIndex >= 0) {
      wiki.categories[categoryIndex] = { ...wiki.categories[categoryIndex], articles };
    } else {
      wiki.categories.push({ ...categoryDef, articles });
    }

    wiki.generatedAt = new Date().toISOString();
    await writeWiki(wiki);
    res.json({ ...wiki, apiKeyConfigured: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/wiki/article/:categoryId/:articleId", requireWriteAccess, async (req, res) => {
  try {
    const { categoryId, articleId } = req.params;
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required." });
    }

    const wiki = await readWiki();
    const category = wiki.categories.find((c) => c.id === categoryId);
    if (!category) {
      return res.status(404).json({ error: `Category not found: ${categoryId}` });
    }

    const article = (category.articles || []).find((a) => a.id === articleId);
    if (!article) {
      return res.status(404).json({ error: `Article not found: ${articleId}` });
    }

    article.title = String(title).trim();
    article.content = String(content).trim();
    article.editedAt = new Date().toISOString();
    await writeWiki(wiki);
    res.json({ ...wiki, apiKeyConfigured: Boolean(await getAnthropicApiKey()) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/wiki/category", requireWriteAccess, async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "Title is required." });
    const wiki = await readWiki();
    const id = `custom_${Date.now()}`;
    wiki.categories.push({ id, title: String(title).trim(), description: String(description || "").trim(), articles: [], custom: true });
    await writeWiki(wiki);
    res.json({ ...wiki, apiKeyConfigured: Boolean(await getAnthropicApiKey()) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/wiki/article/:categoryId", requireWriteAccess, async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { title, content } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "Title is required." });
    const wiki = await readWiki();
    const category = wiki.categories.find((c) => c.id === categoryId);
    if (!category) return res.status(404).json({ error: `Category not found: ${categoryId}` });
    if (!category.articles) category.articles = [];
    category.articles.push({
      id: `manual_${Date.now()}`,
      title: String(title).trim(),
      content: String(content || "").trim(),
      editedAt: new Date().toISOString()
    });
    await writeWiki(wiki);
    res.json({ ...wiki, apiKeyConfigured: Boolean(await getAnthropicApiKey()) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, async () => {
    try {
      await readConfig();
      if (socket.request.session?.user) {
        return next();
      }

      return next(new Error("Authentication required"));
    } catch (error) {
      return next(error);
    }
  });
});

io.on("connection", async (socket) => {
  try {
    socket.emit("dashboard:update", await getDashboardSnapshot());
  } catch (error) {
    socket.emit("dashboard:error", { error: error.message });
  }
});

setInterval(async () => {
  if (io.engine.clientsCount === 0) {
    return;
  }

  try {
    io.emit("dashboard:update", await getDashboardSnapshot());
  } catch (error) {
    io.emit("dashboard:error", { error: error.message });
  }
}, UPDATE_INTERVAL_MS);

setInterval(() => {
  void refreshStorageCacheNow();
}, STORAGE_REFRESH_MS);

ensureConfigFile()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Dashboard server listening on port ${PORT}`);
      void refreshStorageCacheNow();
    });
  })
  .catch((error) => {
    console.error("Failed to initialize dashboard configuration:", error);
    process.exit(1);
  });
