import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bell,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Gauge,
  HardDrive,
  Home,
  KeyRound,
  Layers3,
  LogOut,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Router,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SquareStack,
  StickyNote,
  Underline,
  ToggleLeft,
  ToggleRight,
  Trash2,
  TriangleAlert,
  Wifi
} from "lucide-react";
import { Component, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { advanceDemoDashboardPayload, buildDemoDashboardPayload, DEMO_AUTH_SESSION } from "./demoData";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "services", label: "Services", icon: Layers3 },
  { id: "storage", label: "Storage", icon: HardDrive },
  { id: "server-log", label: "Server Log", icon: StickyNote },
  { id: "network", label: "Hardware & Network", icon: Wifi },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "wiki", label: "Wiki", icon: BookOpen },
  { id: "settings", label: "Settings", icon: Settings }
];

const DEFAULT_DASHBOARD_GUIDE = [
  "Use Dashboard for live system overview, quick service controls, and storage summaries.",
  "Use Services to search the full app list and toggle supported containers on or off.",
  "Use Storage for full device details. Spun-down array drives may show state instead of temperature.",
  "Use Hardware & Network for host specs, thermal readings, and network interface details.",
  "Use Settings to manage OIDC, sidebar preferences, and the dashboard profile shown in the left rail.",
  "Use this Server Log for maintenance notes, outage timelines, and upgrade history."
];

const SERVICE_ICONS = {
  management: Gauge,
  media: Activity,
  network: Router,
  downloads: Network,
  security: ShieldCheck,
  storage: SquareStack
};

const RICH_TEXT_COLOR_SWATCHES = [
  { label: "Black", value: "#000000" },
  { label: "Gray", value: "#808080" },
  { label: "Silver", value: "#c0c0c0" },
  { label: "White", value: "#ffffff" },
  { label: "Maroon", value: "#800000" },
  { label: "Red", value: "#ff0000" },
  { label: "Purple", value: "#800080" },
  { label: "Fuchsia", value: "#ff00ff" },
  { label: "Green", value: "#008000" },
  { label: "Lime", value: "#00ff00" },
  { label: "Olive", value: "#808000" },
  { label: "Yellow", value: "#ffff00" },
  { label: "Navy", value: "#000080" },
  { label: "Blue", value: "#0000ff" },
  { label: "Teal", value: "#008080" },
  { label: "Aqua", value: "#00ffff" },
  { label: "Orange", value: "#ffa500" }
];

function normalizeRichTextColor(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }

  const swatchMatch = RICH_TEXT_COLOR_SWATCHES.find((color) => color.value === raw);
  if (swatchMatch) {
    return swatchMatch.value;
  }

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) {
    if (raw.length === 4) {
      return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
    }
    return raw;
  }

  const rgbMatch = raw.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgbMatch) {
    const channels = rgbMatch.slice(1).map((channel) => Number(channel));
    if (channels.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
      return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    }
  }

  const byName = RICH_TEXT_COLOR_SWATCHES.find((color) => color.label.toLowerCase() === raw);
  return byName?.value || "";
}

const KNOWN_SERVICE_ICON_SOURCES = {
  unraid: ["https://cdn.simpleicons.org/unraid/ff8a00"],
  pihole: ["https://cdn.simpleicons.org/pihole/ff8a00"],
  npm: ["https://cdn.simpleicons.org/nginxproxymanager/ff8a00"],
  nginxproxymanager: ["https://cdn.simpleicons.org/nginxproxymanager/ff8a00"],
  nginxproxymanagerofficial: ["https://cdn.simpleicons.org/nginxproxymanager/ff8a00"],
  duplicacy: ["https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicacy.svg"],
  sonarr: ["https://cdn.simpleicons.org/sonarr/ff8a00"],
  radarr: ["https://cdn.simpleicons.org/radarr/ff8a00"],
  prowlarr: ["https://cdn.simpleicons.org/prowlarr/ff8a00"],
  tdarr: ["https://cdn.simpleicons.org/tdarr/ff8a00"],
  sabnzbd: ["https://cdn.simpleicons.org/sabnzbd/ff8a00"],
  qbittorrent: ["https://cdn.simpleicons.org/qbittorrent/ff8a00"],
  qbit: ["https://cdn.simpleicons.org/qbittorrent/ff8a00"],
  jellyfin: ["https://cdn.simpleicons.org/jellyfin/ff8a00"],
  jellyseerr: ["https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyseerr.svg"],
  jellystat: ["https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellystat.svg"],
  jellysweep: ["https://cdn.jsdelivr.net/gh/selfhst/icons/svg/jellyfin.svg"],
  tinyauth: ["https://cdn.jsdelivr.net/gh/selfhst/icons/svg/tinyauth.svg"],
  pocketid: ["https://cdn.jsdelivr.net/gh/selfhst/icons/svg/pocket-id.svg"],
  portainer: ["https://cdn.simpleicons.org/portainer/ff8a00"],
  postgresql: ["https://cdn.simpleicons.org/postgresql/ff8a00"]
};

function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) {
    return "0 B";
  }

  const value = Number(bytes);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** index;
  return `${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatStorageBytes(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) {
    return "0 B";
  }

  const value = Number(bytes);
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1000)), units.length - 1);
  const scaled = value / 1000 ** index;
  return `${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatPercentOrUnknown(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : "--";
}

function formatUptime(seconds) {
  if (!Number.isFinite(Number(seconds))) {
    return "Unknown uptime";
  }

  const total = Number(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function formatTemp(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} C` : "--";
}

function driveTempStatus(drive) {
  const isArrayLike = /parity|disk\s*\d+/i.test(String(drive?.role || "")) || /parity/i.test(String(drive?.label || ""));

  if (drive?.spundown) {
    return "Spun Down";
  }

  if (Number.isFinite(Number(drive?.temperature)) && Number(drive.temperature) > 0) {
    return formatTemp(drive.temperature);
  }

  if (drive?.rotational && isArrayLike) {
    return "Spun Down";
  }

  return "Temp unavailable";
}

function formatRpm(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} RPM` : "--";
}

function formatLinkSpeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "--";
  }

  if (numeric >= 1000) {
    const gigabit = numeric / 1000;
    return `${Number.isInteger(gigabit) ? gigabit.toFixed(0) : gigabit.toFixed(1)} Gbps`;
  }

  return `${numeric} Mbps`;
}

function formatDateTime(value) {
  if (!value) {
    return "Recent";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recent";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function noteLooksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
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

      if (property === "color") {
        const normalizedColor = normalizeRichTextColor(value);
        if (normalizedColor) {
          return `color:${normalizedColor}`;
        }
      }

      return "";
    })
    .filter(Boolean)
    .join(";");
}

function sanitizeRichText(value) {
  const content = String(value || "").replace(/&nbsp;/gi, " ").replace(/&#160;/gi, " ").trim();
  if (!content) {
    return "";
  }

  if (!noteLooksLikeHtml(content)) {
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
    const colorValue = normalizeRichTextColor(String(colorMatch?.[2] ?? colorMatch?.[3] ?? colorMatch?.[4] ?? "").trim());
    if (tagName === "font" && colorValue) {
      sanitizedAttributes.push(`color="${colorValue}"`);
    }

    return sanitizedAttributes.length ? `<${tagName} ${sanitizedAttributes.join(" ")}>` : `<${tagName}>`;
  });

  return sanitized.trim();
}

function noteContentToHtml(value) {
  const content = sanitizeRichText(value);
  if (!content.trim()) {
    return "";
  }

  if (noteLooksLikeHtml(content)) {
    return content;
  }

  return escapeHtml(content).replace(/\r?\n/g, "<br />");
}

function richTextHasContent(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim().length > 0;
}

function dashboardGuideToHtml(value) {
  if (typeof value === "string" && value.trim()) {
    return noteContentToHtml(value);
  }

  if (Array.isArray(value) && value.length) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((entry) => `<p>${escapeHtml(entry)}</p>`)
      .join("");
  }

  return DEFAULT_DASHBOARD_GUIDE.map((entry) => `<p>${escapeHtml(entry)}</p>`).join("");
}

function profileDisplay(profile, user) {
  const displayName = profile?.displayName || user?.name || user?.preferredUsername || "Authenticated User";
  const title = profile?.title || user?.email || user?.preferredUsername || "Home Lab Operator";
  const avatarLabelSource = profile?.avatarLabel || displayName || title || "U";
  const avatarLabel = String(avatarLabelSource).trim().slice(0, 2).toUpperCase();

  return {
    displayName,
    title,
    avatarLabel
  };
}

function serviceHref(service) {
  const normalizedName = normalizedSearchValue(service?.name);
  if (normalizedName === "postgresql" || normalizedName === "postgres") {
    return "";
  }

  if (service?.url) {
    return service.url;
  }

  const path = service?.path ? `/${String(service.path).replace(/^\/+/, "")}` : "";
  if (!service?.port) {
    return `${window.location.origin}${path}`;
  }

  return `${window.location.protocol}//${window.location.hostname}:${service.port}${path}`;
}

function serviceInitials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "?";
}

function serviceIconSources(service) {
  if (service?.imageUrl) {
    return [service.imageUrl];
  }

  const knownIcons = serviceMatchTerms(service).flatMap((term) => KNOWN_SERVICE_ICON_SOURCES[term] || []);
  if (knownIcons.length) {
    return Array.from(new Set(knownIcons));
  }

  try {
    const url = new URL(serviceHref(service));
    const domain = url.hostname;
    return [
      `${url.origin}/favicon.ico`,
      `${url.origin}/favicon.png`,
      `${url.origin}/apple-touch-icon.png`,
      `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(domain)}`,
      `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`
    ];
  } catch (_error) {
    return [];
  }
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

  if (normalizedName === "qbittorrent") {
    names.add("qbit");
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

function inferServiceStatus(service, containers) {
  const list = containers?.containers || [];
  const terms = serviceMatchTerms(service);

  let bestMatch = null;
  let bestScore = 0;

  for (const container of list) {
    const name = normalizedSearchValue(container.name || "");
    const image = normalizedSearchValue(container.image || "");
    const labelValues = Object.values(container.labels || {}).map((v) => normalizedSearchValue(String(v)));

    for (const term of terms) {
      let score = 0;
      if (name === term) {
        score = 100;
      } else if (name.startsWith(term)) {
        score = 90;
      } else if (name.includes(term)) {
        score = 75;
      } else if (image.includes(term)) {
        score = 60;
      } else if (labelValues.some((label) => label.includes(term))) {
        score = 40;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = container;
      }
    }
  }

  const match = bestScore >= 60 ? bestMatch : null;

  if (!match) {
    return {
      label: "Unavailable",
      tone: "neutral",
      running: false,
      canToggle: false,
      containerName: ""
    };
  }

  if (String(match.state || "").toLowerCase() === "running") {
    return {
      label: "Active",
      tone: "success",
      running: true,
      canToggle: true,
      containerName: match.name || ""
    };
  }

  return {
    label: match.state || "Offline",
    tone: "warning",
    running: false,
    canToggle: true,
    containerName: match.name || ""
  };
}

function flattenDrives(storageInsights) {
  return (storageInsights?.deviceGroups || [])
    .flatMap((group) => group.items || [])
    .filter((item) => !item.isSummary)
    .map((item) => {
      const role = String(item.role || item.mdRole || "");
      const isParity = /parity/i.test(role) || /parity/i.test(String(item.label || ""));
      const usagePercent = Number.isFinite(Number(item.usagePercent)) ? Number(item.usagePercent) : 0;
      const temperature = Number.isFinite(Number(item.temperature)) && Number(item.temperature) > 0 ? Number(item.temperature) : null;
      let health = "Healthy";
      if (usagePercent >= 90 || (temperature != null && temperature >= 50)) {
        health = "Attention";
      } else if (usagePercent >= 75 || (temperature != null && temperature >= 44)) {
        health = "Warm";
      }

      return {
        ...item,
        isParity,
        usagePercent,
        temperature,
        spundown: Boolean(item.spundown),
        rotational: Boolean(item.rotational),
        health
      };
    });
}

function mobileNavLabel(item) {
  if (item.id === "network") {
    return (
      <>
        <span className="mobile-bottom-nav__line mobile-bottom-nav__line--nowrap">Hardware</span>
        <span className="mobile-bottom-nav__line">&amp;</span>
        <span className="mobile-bottom-nav__line mobile-bottom-nav__line--nowrap">Network</span>
      </>
    );
  }

  return item.label;
}

function useLocalStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? JSON.parse(stored) : initialValue;
    } catch (_error) {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {
      // Ignore storage write errors.
    }
  }, [key, value]);

  return [value, setValue];
}

function mergeHistory(currentHistory, nextHistory) {
  if (!currentHistory && !nextHistory) {
    return {};
  }

  const merged = { ...(currentHistory || {}) };
  for (const [key, value] of Object.entries(nextHistory || {})) {
    if (Array.isArray(value) && value.length) {
      merged[key] = value;
      continue;
    }

    if (!(key in merged)) {
      merged[key] = value;
    }
  }

  return merged;
}

function mergeDashboardState(current, payload) {
  const nextSystem = payload.system
    ? {
        ...(current.system || {}),
        ...payload.system,
        history: mergeHistory(current.system?.history, payload.system?.history)
      }
    : current.system;

  return {
    ...current,
    ...payload,
    system: nextSystem
  };
}

function Badge({ tone = "neutral", children }) {
  const tones = {
    success: "bg-[rgba(63,185,80,0.14)] text-[var(--status-success)] border-[rgba(63,185,80,0.25)]",
    info: "bg-[rgba(47,129,247,0.14)] text-[var(--accent-blue)] border-[rgba(47,129,247,0.25)]",
    warning: "bg-[rgba(255,184,0,0.14)] text-[#f6c453] border-[rgba(246,196,83,0.22)]",
    neutral: "bg-white/5 text-[var(--text-muted)] border-white/10"
  };

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Card({ className = "", children }) {
  return <section className={`dashboard-card ${className}`}>{children}</section>;
}

class AppCrashBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[var(--bg-main)] px-5 py-8 text-[var(--text-primary)] lg:px-8">
          <div className="mx-auto max-w-3xl rounded-[30px] border border-[rgba(246,196,83,0.22)] bg-[rgba(246,196,83,0.12)] p-8 shadow-[0_20px_70px_rgba(0,0,0,0.22)]">
            <p className="text-sm uppercase tracking-[0.22em] text-[#f6c453]">Dashboard Error</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[var(--text-primary)]">The dashboard hit a frontend error.</h1>
            <p className="mt-4 text-base leading-7 text-[var(--text-secondary)]">
              Refresh the page after the latest deployment completes. If the problem persists, this message helps us avoid a silent black screen and keep the failure visible.
            </p>
            <pre className="mt-6 overflow-auto rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-[var(--text-primary)]">
              {String(this.state.error?.message || this.state.error || "Unknown frontend error")}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function ServiceFavicon({ service }) {
  const Icon = SERVICE_ICONS[String(service.category || "").toLowerCase()] || Layers3;
  const sources = useMemo(
    () => serviceIconSources(service),
    [service?.imageUrl, service?.url, service?.port, service?.path, service?.name]
  );
  const [index, setIndex] = useState(0);
  const [showFallback, setShowFallback] = useState(sources.length === 0);

  useEffect(() => {
    setIndex(0);
    setShowFallback(sources.length === 0);
  }, [sources]);

  const currentSource = sources[index];

  return (
    <div className="service-favicon-shell">
      {!showFallback && currentSource ? (
        <img
          src={currentSource}
          alt=""
          className="service-favicon-image"
          loading="lazy"
          onError={() => {
            if (index < sources.length - 1) {
              setIndex((current) => current + 1);
              return;
            }
            setShowFallback(true);
          }}
        />
      ) : (
        <div className="service-favicon-fallback" aria-hidden="true">
          {sources.length > 0 ? serviceInitials(service.name) : <Icon size={18} />}
        </div>
      )}
    </div>
  );
}

function Sparkline({ data, color, fill }) {
  const source = Array.isArray(data) && data.length ? data : Array.from({ length: 16 }, () => 0);
  const points = source.map((entry, index) => {
    if (entry && typeof entry === "object") {
      return {
        index,
        value: Number(entry.value || 0)
      };
    }

    return {
      index,
      value: Number(entry || 0)
    };
  });

  return (
    <div className="h-16 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.25} fill={`url(#${fill})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricCard({ title, value, detail, progress, chartData, color, fillId, footer }) {
  const sparklineData = Array.isArray(chartData) && chartData.length
    ? chartData
    : Array.from({ length: 16 }, (_item, index) => Math.max(6, Number(progress || 0) * (0.82 + (index % 4) * 0.06)));

  return (
    <Card className="flex h-full min-h-[208px] flex-col gap-4 p-5 xl:min-h-[216px]">
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_152px]">
        <div className="min-w-0">
          <p className="text-[0.92rem] text-[var(--text-muted)]">{title}</p>
          <p className="mt-5 text-[clamp(1.85rem,2.4vw,2.75rem)] font-semibold tracking-[-0.045em] text-[var(--text-primary)]">
            {value}
          </p>
        </div>
        <div className="flex min-h-[72px] items-center md:justify-end">
          <div className="w-full md:w-[152px]">
            <Sparkline data={sparklineData} color={color} fill={fillId} />
          </div>
        </div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.max(0, Math.min(progress || 0, 100))}%`,
            background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 55%, white))`
          }}
        />
      </div>
      <div className="space-y-1">
        <p className="text-[1.02rem] text-[var(--text-secondary)]">{detail}</p>
        {footer ? <p className="text-sm text-[var(--text-muted)]">{footer}</p> : null}
      </div>
    </Card>
  );
}

function Sidebar({ activePage, onPageChange, collapsed, onToggle, authSession, profile, onOpenProfile, onLogout }) {
  const user = authSession?.user || null;
  const display = profileDisplay(profile, user);
  const mobileNavRef = useRef(null);
  const [showMobileNavHint, setShowMobileNavHint] = useState(false);
  const dragStateRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
    captured: false
  });
  const recentlyDraggedMobileNavRef = useRef(false);
  const recentlyDraggedResetRef = useRef(null);

  useEffect(() => {
    const navElement = mobileNavRef.current;
    if (!navElement) {
      return undefined;
    }

    const updateOverflowState = () => {
      setShowMobileNavHint(navElement.scrollWidth - navElement.clientWidth > 8);
    };

    updateOverflowState();

    let resizeObserver;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateOverflowState);
      resizeObserver.observe(navElement);
    }

    window.addEventListener("resize", updateOverflowState);

    return () => {
      window.removeEventListener("resize", updateOverflowState);
      resizeObserver?.disconnect();
      if (recentlyDraggedResetRef.current) {
        window.clearTimeout(recentlyDraggedResetRef.current);
      }
    };
  }, []);

  function handleMobileNavPointerDown(event) {
    const navElement = mobileNavRef.current;
    const isDragPointer = event.pointerType === "mouse" || event.pointerType === "pen";
    const canScrollHorizontally = navElement ? navElement.scrollWidth - navElement.clientWidth > 8 : false;
    if (!navElement || !isDragPointer || event.button !== 0 || !canScrollHorizontally) {
      return;
    }

    dragStateRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: navElement.scrollLeft,
      moved: false,
      captured: false
    };
  }

  function handleMobileNavPointerMove(event) {
    const navElement = mobileNavRef.current;
    const dragState = dragStateRef.current;
    if (!navElement || !dragState.active || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) > 6) {
      dragState.moved = true;
      if (!dragState.captured) {
        navElement.setPointerCapture?.(event.pointerId);
        navElement.classList.add("mobile-bottom-nav--dragging");
        dragState.captured = true;
      }
      event.preventDefault();
    }
    navElement.scrollLeft = dragState.startScrollLeft - deltaX;
  }

  function handleMobileNavItemClick(event, itemId) {
    if (recentlyDraggedMobileNavRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    onPageChange(itemId);
  }

  function handleMobileNavPointerEnd(event) {
    const navElement = mobileNavRef.current;
    const dragState = dragStateRef.current;
    if (!navElement || !dragState.active || dragState.pointerId !== event.pointerId) {
      return;
    }
    const shouldSuppressClick = dragState.moved;

    dragStateRef.current = {
      active: false,
      pointerId: null,
      startX: 0,
      startScrollLeft: 0,
      moved: false,
      captured: false
    };

    if (dragState.captured) {
      navElement.classList.remove("mobile-bottom-nav--dragging");
      navElement.releasePointerCapture?.(event.pointerId);
    }

    if (shouldSuppressClick) {
      recentlyDraggedMobileNavRef.current = true;
      if (recentlyDraggedResetRef.current) {
        window.clearTimeout(recentlyDraggedResetRef.current);
      }
      recentlyDraggedResetRef.current = window.setTimeout(() => {
        recentlyDraggedMobileNavRef.current = false;
        recentlyDraggedResetRef.current = null;
      }, 140);
    }
  }

  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-white/6 bg-[var(--bg-sidebar)]/95 backdrop-blur lg:flex lg:flex-col ${
          collapsed ? "w-[92px]" : "w-[260px]"
        } transition-[width] duration-300`}
      >
        <div className="flex items-center justify-between px-6 pb-8 pt-8">
          <div className={collapsed ? "hidden" : "block"}>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">Server Manager</p>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-white/4 text-[var(--text-primary)] transition hover:border-white/15 hover:bg-white/7"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="flex-1 space-y-2 px-4">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.id === activePage;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onPageChange(item.id)}
                className={`group flex w-full items-center gap-3 rounded-2xl border-l-4 px-4 py-3 text-left transition ${
                  active
                    ? "border-[var(--accent-blue)] bg-[rgba(47,129,247,0.12)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:bg-white/4 hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon size={20} className="shrink-0" />
                {!collapsed ? <span className="text-lg">{item.label}</span> : null}
              </button>
            );
          })}
        </nav>

        {user ? (
          <div className="mt-auto border-t border-white/6 px-5 py-5">
            <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-[linear-gradient(135deg,#ffd173,#ff9a1f)] font-bold text-[#101010] shadow-[0_6px_18px_rgba(255,138,0,0.16)]">
                {display.avatarLabel}
              </div>
              {!collapsed ? (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[1.02rem] font-semibold text-[var(--text-primary)]">{display.displayName}</p>
                  <p className="truncate text-sm text-[var(--text-muted)]">{display.title}</p>
                </div>
              ) : null}
            </div>
            {!collapsed ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="flex-1 rounded-2xl border border-white/8 bg-white/5 px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-white/8"
                >
                  Profile
                </button>
                <button
                  type="button"
                  onClick={onLogout}
                  className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-white/8"
                >
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        </aside>

        <div className="mobile-bottom-nav-wrap lg:hidden">
          <nav
            ref={mobileNavRef}
            className="mobile-bottom-nav"
            onPointerDown={handleMobileNavPointerDown}
            onPointerMove={handleMobileNavPointerMove}
            onPointerUp={handleMobileNavPointerEnd}
            onPointerCancel={handleMobileNavPointerEnd}
            onPointerLeave={handleMobileNavPointerEnd}
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.id === activePage;

            return (
              <button
                key={item.id}
                type="button"
                onClick={(event) => handleMobileNavItemClick(event, item.id)}
                className={`mobile-bottom-nav__button flex flex-col items-center justify-center gap-1 rounded-2xl px-3 py-2 text-xs ${
                  active ? "mobile-bottom-nav__button--active text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                }`}
              >
                  <Icon size={18} />
                  <span
                    className={`mobile-bottom-nav__label ${
                      item.id === "dashboard" ? "mobile-bottom-nav__label--nowrap" : ""
                    } ${item.id === "network" ? "mobile-bottom-nav__label--stacked" : ""}`}
                  >
                    {mobileNavLabel(item)}
                  </span>
                </button>
              );
            })}
          </nav>
          {showMobileNavHint ? (
            <div className="mobile-bottom-nav-hint" aria-hidden="true">
              <span>Swipe left or right</span>
            </div>
          ) : null}
        </div>
      </>
  );
}

function Header({ activePage, live, onRefresh, refreshing, compact, onCompactToggle, system }) {
  const title =
    activePage === "dashboard"
      ? "Main Dashboard"
      : NAV_ITEMS.find((item) => item.id === activePage)?.label || "Dashboard";

  return (
    <header className="mb-8 flex flex-col gap-5 border-b border-white/8 pb-7 lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[clamp(2.15rem,2.6vw,3rem)] font-semibold tracking-[-0.055em] text-[var(--text-primary)]">{title}</h1>
          <Badge tone={live ? "success" : "warning"}>
            <span className={`status-pulse ${live ? "status-pulse--live" : "status-pulse--warn"}`} />
            {live ? "Live" : "Syncing"}
          </Badge>
        </div>
        <p className="max-w-3xl text-[0.97rem] text-[var(--text-muted)]">
          {system?.os?.hostname || "Server"} on {system?.os?.distro || "host OS"} {system?.os?.release || ""} with uptime{" "}
          {formatUptime(system?.os?.uptime)}.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 lg:pt-1">
        <button
          type="button"
          onClick={onCompactToggle}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-[0.98rem] text-[var(--text-primary)] transition hover:bg-white/7"
        >
          {compact ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          <span>{compact ? "Expanded View" : "Compact View"}</span>
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(91,99,118,0.42),rgba(46,52,66,0.55))] px-5 py-3 text-[1rem] text-[var(--text-primary)] transition hover:border-white/20 hover:bg-white/10 disabled:opacity-60"
        >
          <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
          <span>{refreshing ? "Refreshing" : "Refresh"}</span>
        </button>
      </div>
    </header>
  );
}

function ServiceCard({ service, status, enabled, onToggle, busy = false }) {
  const href = serviceHref(service);
  const protectedFromDisable = serviceProtectedFromDisable(service);
  const disableToggle = busy || !status.canToggle || (protectedFromDisable && status.running);
  const MotionTag = href ? motion.a : motion.div;

  return (
    <MotionTag
      layout
      className="group flex min-h-[112px] min-w-0 flex-col justify-between rounded-[20px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 transition hover:border-[rgba(47,129,247,0.22)] hover:bg-[rgba(47,129,247,0.07)]"
      whileHover={{ y: -3 }}
      transition={{ duration: 0.18 }}
      {...(href
        ? {
            href,
            target: "_blank",
            rel: "noreferrer"
          }
        : {})}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ServiceFavicon service={service} />
          <div className="min-w-0">
            <p className="break-words text-[1.05rem] font-medium tracking-[-0.03em] text-[var(--text-primary)]">{service.name}</p>
            <div className="mt-0.5 flex items-center gap-2 text-[0.9rem] text-[var(--text-muted)]">
              <span
                className={`inline-flex h-2.5 w-2.5 rounded-full ${
                  status.tone === "success"
                    ? "bg-[var(--status-success)] shadow-[0_0_14px_rgba(63,185,80,0.8)]"
                    : status.tone === "warning"
                      ? "bg-[#f6c453]"
                      : "bg-[var(--accent-blue)]"
                } ${status.tone === "success" ? "animate-pulse" : ""}`}
              />
              <span>{status.label}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            onToggle();
          }}
          className={`switch ${enabled ? "switch--on" : ""}`}
          aria-pressed={enabled}
          aria-label={`Toggle ${service.name}`}
          disabled={disableToggle}
        >
          <span />
        </button>
      </div>
      <div className="flex flex-col items-start gap-2 text-[0.9rem] text-[var(--text-secondary)] sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0 break-words">
          {busy
            ? "Updating container state..."
            : !href
              ? "No web UI available"
              : service.description || service.category || "Service endpoint"}
        </span>
        <span className="shrink-0 uppercase tracking-[0.18em] text-[var(--text-muted)]">{service.category || "General"}</span>
      </div>
    </MotionTag>
  );
}

function StorageItem({ drive }) {
  const tone = drive.health === "Healthy" ? "success" : drive.health === "Warm" ? "warning" : "info";
  const sizeText = drive.sizeBytes != null ? formatStorageBytes(drive.sizeBytes) : drive.size || "--";
  const isArrayLike = /parity|disk\s*\d+/i.test(String(drive?.role || "")) || /parity/i.test(String(drive?.label || ""));
  const tempLabel =
    isArrayLike && (!Number.isFinite(Number(drive?.temperature)) || Number(drive.temperature) <= 0)
      ? "Spun Down"
      : driveTempStatus(drive);

  return (
    <div className="min-w-0 rounded-[20px] border border-white/7 bg-white/3 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-lg font-medium text-[var(--text-primary)]">{drive.label}</p>
          <p className="break-words text-sm text-[var(--text-muted)]">{drive.deviceName || drive.role || "Drive"}</p>
        </div>
        <div className="shrink-0">
          <Badge tone={tone}>{drive.health}</Badge>
        </div>
      </div>
      {drive.isParity ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/8 bg-[rgba(255,138,0,0.08)] px-3 py-2 text-sm text-[var(--text-secondary)]">
            Dedicated parity disk used for array protection
          </div>
          <div className="flex flex-col gap-2 text-sm text-[var(--text-secondary)] sm:flex-row sm:items-center sm:justify-between">
            <span>{sizeText} capacity</span>
            <span>{tempLabel}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="h-2 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#2F81F7,#65a8ff)]"
              style={{ width: `${Math.max(0, Math.min(drive.usagePercent || 0, 100))}%` }}
            />
          </div>
          <div className="flex flex-col gap-2 text-sm text-[var(--text-secondary)] sm:flex-row sm:items-center sm:justify-between">
            <span>{formatStorageBytes(drive.usedBytes)} used</span>
            <span>{formatStorageBytes(drive.freeBytes)} free</span>
          </div>
          <div className="flex flex-col gap-2 text-sm text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
            <span>{formatPercent(drive.usagePercent)}</span>
            <span>{tempLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationCard({ notification }) {
  const warning = /warn|fail|error|crit/i.test(`${notification?.severity || ""} ${notification?.subject || ""}`);

  return (
    <div className="rounded-[22px] border border-white/8 bg-white/3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
              warning ? "bg-[rgba(246,196,83,0.14)] text-[#f6c453]" : "bg-[rgba(47,129,247,0.14)] text-[var(--accent-blue)]"
            }`}
          >
            {warning ? <TriangleAlert size={20} /> : <Bell size={20} />}
          </div>
          <div>
            <p className="text-lg font-medium text-[var(--text-primary)]">{notification.subject || "Server event"}</p>
            <p className="text-sm text-[var(--text-muted)]">{formatDateTime(notification.timestamp || notification.date)}</p>
          </div>
        </div>
        <Badge tone={warning ? "warning" : "info"}>{notification.severity || "Info"}</Badge>
      </div>
      <p className="mt-4 text-[var(--text-secondary)]">{notification.message || "No details available."}</p>
    </div>
  );
}

function PageSection({ title, description, children, action, className = "" }) {
  return (
    <Card className={`p-6 ${className}`}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[1.72rem] font-semibold tracking-[-0.045em] text-[var(--text-primary)]">{title}</h2>
          <p className="mt-2 text-[0.98rem] text-[var(--text-muted)]">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function normalizeServiceDraft(services) {
  return (services || []).map((service) => ({
    name: service.name || "",
    description: service.description || "",
    category: service.category || "General",
    favorite: Boolean(service.favorite),
    port: service.port || "",
    path: service.path || "",
    url: service.url || "",
    imageUrl: service.imageUrl || ""
  }));
}

function ServiceEditor({ draft, setDraft, saving, onSave }) {
  function updateService(index, field, value) {
    setDraft((current) =>
      current.map((service, serviceIndex) =>
        serviceIndex === index ? { ...service, [field]: value } : service
      )
    );
  }

  function addService() {
    setDraft((current) => [
      ...current,
      {
        name: "",
        description: "",
        category: "General",
        favorite: false,
        port: "",
        path: "",
        url: "",
        imageUrl: ""
      }
    ]);
  }

  function removeService(index) {
    setDraft((current) => current.filter((_, serviceIndex) => serviceIndex !== index));
  }

  return (
    <div className="mt-6 space-y-4 rounded-[24px] border border-white/8 bg-white/3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">Edit Services</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Update names, categories, links, and favorites used by the dashboard.</p>
        </div>
        <button
          type="button"
          onClick={addService}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)]"
        >
          <Plus size={16} />
          <span>Add Service</span>
        </button>
      </div>

      <div className="space-y-4">
        {draft.map((service, index) => (
          <div key={`${service.name}-${index}`} className="rounded-[20px] border border-white/8 bg-[rgba(255,255,255,0.03)] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-lg font-medium text-[var(--text-primary)]">{service.name || `Service ${index + 1}`}</p>
              <button
                type="button"
                onClick={() => removeService(index)}
                className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(246,196,83,0.18)] bg-[rgba(246,196,83,0.08)] px-3 py-2 text-sm text-[#f6c453]"
              >
                <Trash2 size={15} />
                <span>Remove</span>
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="service-field xl:col-span-1">
                <span>Name</span>
                <input value={service.name} onChange={(event) => updateService(index, "name", event.target.value)} />
              </label>
              <label className="service-field xl:col-span-1">
                <span>Category</span>
                <input value={service.category} onChange={(event) => updateService(index, "category", event.target.value)} />
              </label>
              <label className="service-field xl:col-span-1">
                <span>Port</span>
                <input value={service.port} onChange={(event) => updateService(index, "port", event.target.value)} />
              </label>
              <label className="service-field xl:col-span-1">
                <span>Path</span>
                <input value={service.path} onChange={(event) => updateService(index, "path", event.target.value)} />
              </label>
              <label className="service-field md:col-span-2 xl:col-span-2">
                <span>Description</span>
                <input value={service.description} onChange={(event) => updateService(index, "description", event.target.value)} />
              </label>
              <label className="service-field md:col-span-2 xl:col-span-2">
                <span>Full URL</span>
                <input value={service.url} onChange={(event) => updateService(index, "url", event.target.value)} />
              </label>
              <label className="service-field md:col-span-2 xl:col-span-3">
                <span>Image URL</span>
                <input value={service.imageUrl} onChange={(event) => updateService(index, "imageUrl", event.target.value)} />
              </label>
              <label className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-[var(--text-primary)] xl:col-span-1">
                <input
                  type="checkbox"
                  checked={service.favorite}
                  onChange={(event) => updateService(index, "favorite", event.target.checked)}
                />
                <span>Show in quick status</span>
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[rgba(47,129,247,0.18)] px-5 py-3 text-[var(--text-primary)] disabled:opacity-60"
        >
          <Save size={16} />
          <span>{saving ? "Saving..." : "Save Services"}</span>
        </button>
      </div>
    </div>
  );
}

function NotesPanel({
  notes,
  dashboardGuide,
  onSaveNotes,
  onSaveDashboardGuide,
  savingNotes,
  savingDashboardGuide,
  maxVisible = null,
  onOpenAll = null
}) {
  const [draft, setDraft] = useState("");
  const [editingNoteIndex, setEditingNoteIndex] = useState(null);
  const [editingNoteContent, setEditingNoteContent] = useState("");
  const [editingGuide, setEditingGuide] = useState(false);
  const [guideDraft, setGuideDraft] = useState("");
  const visibleNotes = maxVisible ? (notes || []).slice(0, maxVisible) : notes || [];
  const guideHtml = dashboardGuideToHtml(dashboardGuide);

  useEffect(() => {
    if (!editingGuide) {
      setGuideDraft(guideHtml);
    }
  }, [editingGuide, guideHtml]);

  async function handleAddNote() {
    if (!richTextHasContent(draft)) {
      return;
    }

    const content = draft.trim();
    const saved = await onSaveNotes([{ content, createdAt: new Date().toISOString() }, ...(notes || [])]);
    if (saved) {
      setDraft("");
    }
  }

  async function handleDeleteNote(index) {
    await onSaveNotes((notes || []).filter((_note, noteIndex) => noteIndex !== index));
  }

  function handleEditNote(index) {
    setEditingNoteIndex(index);
    setEditingNoteContent(String(notes?.[index]?.content || ""));
  }

  function handleCancelEditNote() {
    setEditingNoteIndex(null);
    setEditingNoteContent("");
  }

  async function handleSaveEditedNote(index) {
    if (!richTextHasContent(editingNoteContent)) {
      return;
    }

    const content = editingNoteContent.trim();
    const saved = await onSaveNotes(
      (notes || []).map((note, noteIndex) => (
        noteIndex === index
          ? {
              ...note,
              content
            }
          : note
      ))
    );

    if (saved) {
      handleCancelEditNote();
    }
  }

  async function handleSaveGuide() {
    if (!richTextHasContent(guideDraft)) {
      return;
    }

    const nextGuide = guideDraft.trim();
    const saved = await onSaveDashboardGuide(nextGuide);
    if (saved) {
      setEditingGuide(false);
    }
  }

  return (
    <PageSection
      title="Server Log"
      description="Capture quick operator notes, maintenance entries, and reminders directly on the dashboard."
      action={<Badge tone="info">{(notes || []).length} entries</Badge>}
    >
        <div className="space-y-6">
        <div className="space-y-4">
          <div className="service-field">
            <span>New Log Entry</span>
            <RichTextEditor
              value={draft}
              onChange={setDraft}
              minHeightClass="min-h-[160px]"
              placeholder="Document maintenance, outages, upgrades, or quick reminders..."
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleAddNote}
              disabled={savingNotes || !richTextHasContent(draft)}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[rgba(255,138,0,0.18)] px-5 py-3 text-[var(--text-primary)] disabled:opacity-60"
            >
              <Plus size={16} />
              <span>{savingNotes ? "Saving..." : "Add Entry"}</span>
            </button>
          </div>
        </div>

          <div className="space-y-3">
            <div className="z-10 rounded-[22px] border border-[rgba(255,138,0,0.24)] bg-[linear-gradient(180deg,rgba(255,138,0,0.12),rgba(255,138,0,0.05))] p-4 shadow-[0_10px_28px_rgba(0,0,0,0.18)] xl:sticky xl:top-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-center sm:text-left">
                  <p className="text-sm uppercase tracking-[0.16em] text-[var(--accent-blue)]">Dashboard Guide</p>
                  <p className="mt-3 text-[1rem] font-medium text-[var(--text-primary)]">How to use this dashboard</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingGuide((current) => !current);
                    if (editingGuide) {
                      setGuideDraft(guideHtml);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/8 bg-white/6 px-3 py-2 text-sm text-[var(--text-primary)] transition hover:bg-white/10"
                  aria-label={editingGuide ? "Close guide editor" : "Edit dashboard guide"}
                >
                  <Pencil size={15} />
                  <span>{editingGuide ? "Close" : "Edit"}</span>
                </button>
              </div>
              {editingGuide ? (
                <div className="mt-4 space-y-3">
                  <RichTextEditor
                    value={guideDraft}
                    onChange={setGuideDraft}
                    minHeightClass="min-h-[180px]"
                    placeholder="Explain how to use this dashboard..."
                    contentClassName="dashboard-guide-editor"
                  />
                  <div className="flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingGuide(false);
                        setGuideDraft(guideHtml);
                      }}
                      className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)] transition hover:bg-white/8"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveGuide}
                      disabled={savingDashboardGuide || !richTextHasContent(guideDraft)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[rgba(255,138,0,0.18)] px-4 py-2.5 text-sm text-[var(--text-primary)] disabled:opacity-60"
                    >
                      <Save size={15} />
                      <span>{savingDashboardGuide ? "Saving..." : "Save Guide"}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="server-log-content dashboard-guide-content mt-3 text-center text-sm leading-6 text-[var(--text-secondary)] sm:text-left"
                  dangerouslySetInnerHTML={{ __html: guideHtml }}
                />
              )}
            </div>
          </div>
          {(notes || []).length ? (
            visibleNotes.map((note, index) => (
              <div key={`${note.createdAt || "note"}-${index}`} className="rounded-[22px] border border-white/8 bg-white/3 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0 flex-1">
                  <p className="text-sm uppercase tracking-[0.14em] text-[var(--text-muted)]">{formatDateTime(note.createdAt)}</p>
                  {editingNoteIndex === index ? (
                    <div className="mt-3 space-y-3">
                      <RichTextEditor
                        value={editingNoteContent}
                        onChange={setEditingNoteContent}
                        minHeightClass="min-h-[140px]"
                        placeholder="Update this log entry..."
                      />
                      <div className="flex flex-wrap justify-end gap-3">
                        <button
                            type="button"
                            onClick={handleCancelEditNote}
                            className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)] transition hover:bg-white/8"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEditedNote(index)}
                            disabled={savingNotes || !richTextHasContent(editingNoteContent)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[rgba(255,138,0,0.18)] px-4 py-2.5 text-sm text-[var(--text-primary)] disabled:opacity-60"
                          >
                            <Save size={15} />
                            <span>{savingNotes ? "Saving..." : "Save Entry"}</span>
                          </button>
                      </div>
                    </div>
                  ) : (
                      <div
                        className="server-log-content mt-3 break-words text-[1rem] leading-7 text-[var(--text-primary)]"
                        dangerouslySetInnerHTML={{ __html: noteContentToHtml(note.content) }}
                      />
                  )}
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2 sm:justify-start">
                    <button
                      type="button"
                      onClick={() => handleEditNote(index)}
                      disabled={savingNotes}
                      className="rounded-2xl border border-white/8 bg-white/5 p-2 text-[var(--text-muted)] transition hover:bg-white/8 hover:text-[var(--text-primary)] disabled:opacity-60"
                      aria-label="Edit note"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteNote(index)}
                      disabled={savingNotes}
                      className="rounded-2xl border border-white/8 bg-white/5 p-2 text-[var(--text-muted)] transition hover:bg-white/8 hover:text-[var(--text-primary)] disabled:opacity-60"
                      aria-label="Delete note"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-white/2 p-5 text-[var(--text-muted)]">
              No server log entries yet. Use this space for maintenance notes, troubleshooting context, and change tracking.
            </div>
          )}
          {onOpenAll ? (
            <button
              type="button"
              onClick={onOpenAll}
              className="px-1 text-left text-base text-[var(--accent-blue)] transition hover:text-[var(--text-primary)]"
            >
              View All Entries
            </button>
          ) : null}
          {maxVisible && (notes || []).length > maxVisible ? (
            <p className="px-1 text-sm text-[var(--text-muted)]">
              Showing the {maxVisible} most recent entries. Older notes remain saved in the dashboard config.
            </p>
          ) : null}
        </div>
      </PageSection>
  );
}

function DashboardPage({
  data,
  pendingServiceActions,
  onToggleService,
  onOpenStorage,
  onOpenServerLog,
  onSaveNotes,
  onSaveDashboardGuide,
  savingNotes,
  savingDashboardGuide
}) {
  const services = data.config?.services || [];
  const system = data.system || {};
  const storageInsights = data.storageInsights || {};
  const notes = data.config?.notes || [];
  const dashboardGuide = data.config?.dashboardGuide || DEFAULT_DASHBOARD_GUIDE;
  const totalRx = (system.network || []).reduce((sum, item) => sum + Number(item.rxSec || 0), 0);
  const totalTx = (system.network || []).reduce((sum, item) => sum + Number(item.txSec || 0), 0);
  const arrayGroup = (storageInsights.deviceGroups || []).find((group) => group.key === "array");
  const poolGroup = (storageInsights.deviceGroups || []).find((group) => group.key === "pool");
  const visibleServices = services.slice(0, 6);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-[2rem] font-semibold tracking-[-0.05em] text-[var(--text-primary)]">System Overview</h2>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <MetricCard
          title="CPU Load"
          value={formatPercent(system.cpu?.load)}
          detail={`${system.cpu?.brand || "Processor"} • ${system.cpu?.cores || 0} cores`}
          progress={system.cpu?.load}
          chartData={system.history?.cpuLoad}
          color="#3FB971"
          fillId="cpuSpark"
          footer="Realtime processor trend"
        />
        <MetricCard
          title="Memory Usage"
          value={formatPercent(system.memory?.usagePercent)}
          detail={`${formatBytes(system.memory?.used)} / ${formatBytes(system.memory?.total)}`}
          progress={system.memory?.usagePercent}
          chartData={system.history?.memoryUsage}
          color="#E5B846"
          fillId="memorySpark"
          footer="Allocated active memory"
        />
        <MetricCard
          title="Network Throughput"
          value={`${formatBytes(totalRx)}/s`}
          detail={`${formatBytes(totalTx)}/s up across ${(system.network || []).length || 0} interface(s)`}
          progress={Math.min((totalRx / 2500000) * 100, 100)}
          chartData={system.history?.networkThroughput}
          color="#4A93F8"
          fillId="networkSpark"
          footer="Downstream activity"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <PageSection
          title="Quick Status: Services"
          description="Launch into your core stack with live status and watch toggles."
          className="xl:col-span-8"
        >
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {visibleServices.map((service) => {
              const status = inferServiceStatus(service, data.containers);
              return (
                <ServiceCard
                  key={service.name}
                  service={service}
                  status={status}
                  enabled={status.running}
                  busy={Boolean(pendingServiceActions[service.name])}
                  onToggle={() => onToggleService(service)}
                />
              );
            })}
          </div>
        </PageSection>

        <Card className="xl:col-span-4 p-6">
          <div className="mb-5">
            <h2 className="text-[1.72rem] font-semibold tracking-[-0.045em] text-[var(--text-primary)]">Quick Status: Storage Summary</h2>
          </div>
          <div className="space-y-6">
            <div>
              <div className="mb-2 flex flex-col gap-2 text-lg text-[var(--text-primary)] sm:flex-row sm:items-center sm:justify-between">
                <span>Array</span>
                <span className="text-[var(--text-secondary)]">
                  {formatStorageBytes(arrayGroup?.summary?.usedBytes)} used • {formatStorageBytes(arrayGroup?.summary?.freeBytes)} free
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#2F81F7,#58A6FF)]"
                  style={{ width: `${Math.max(0, Math.min(arrayGroup?.summary?.usagePercent || 0, 100))}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-2 flex flex-col gap-2 text-lg text-[var(--text-primary)] sm:flex-row sm:items-center sm:justify-between">
                <span>Cache Pool</span>
                <span className="text-[var(--text-secondary)]">
                  {formatStorageBytes(poolGroup?.summary?.usedBytes)} used • {formatStorageBytes(poolGroup?.summary?.freeBytes)} free
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#3FB950,#6ad47a)]"
                  style={{ width: `${Math.max(0, Math.min(poolGroup?.summary?.usagePercent || 0, 100))}%` }}
                />
              </div>
            </div>
            <div className="border-t border-white/8 pt-5">
              <p className="text-[var(--text-secondary)]">Drive health cards stay minimized here to keep the dashboard summary focused.</p>
            </div>
            <div className="border-t border-white/8 pt-5">
              <button
                type="button"
                onClick={onOpenStorage}
                className="text-base text-[var(--accent-blue)] transition hover:text-[var(--text-primary)]"
              >
                View All Storage
              </button>
            </div>
          </div>
        </Card>
      </div>

      <NotesPanel
        notes={notes}
        dashboardGuide={dashboardGuide}
        onSaveNotes={onSaveNotes}
        onSaveDashboardGuide={onSaveDashboardGuide}
        savingNotes={savingNotes}
        savingDashboardGuide={savingDashboardGuide}
        maxVisible={3}
        onOpenAll={onOpenServerLog}
      />
    </div>
  );
}

function ServerLogPage({ data, onSaveNotes, onSaveDashboardGuide, savingNotes, savingDashboardGuide }) {
  return (
    <NotesPanel
      notes={data.config?.notes || []}
      dashboardGuide={data.config?.dashboardGuide || DEFAULT_DASHBOARD_GUIDE}
      onSaveNotes={onSaveNotes}
      onSaveDashboardGuide={onSaveDashboardGuide}
      savingNotes={savingNotes}
      savingDashboardGuide={savingDashboardGuide}
    />
  );
}

function RichTextEditor({ value, onChange, placeholder, minHeightClass = "min-h-[140px]", contentClassName = "" }) {
  const editorRef = useRef(null);
  const savedRangeRef = useRef(null);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState("#ffffff");

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    // Skip DOM update while the editor is focused — onInput keeps value in sync
    // during active editing. Overwriting innerHTML while focused resets the cursor.
    if (document.activeElement === editor) {
      return;
    }

    const nextHtml = noteContentToHtml(value);
    const currentHtml = editor.innerHTML.replace(/&nbsp;/gi, " ").replace(/&#160;/gi, " ");
    if (currentHtml !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
  }, [value]);

  useEffect(() => {
    if (!colorMenuOpen) {
      return undefined;
    }

    function handleDocumentMouseDown(event) {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }

      if (editor.contains(event.target)) {
        return;
      }

      const toolbar = editor.closest(".rich-text-editor-shell");
      if (toolbar?.contains(event.target)) {
        return;
      }

      setColorMenuOpen(false);
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, [colorMenuOpen]);

  function emitChange() {
    onChange(sanitizeRichText(editorRef.current?.innerHTML || ""));
  }

  function saveSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer;
    if (editor.contains(commonAncestor) || commonAncestor === editor) {
      savedRangeRef.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    const selection = window.getSelection();
    if (!selection || !savedRangeRef.current) {
      return false;
    }

    selection.removeAllRanges();
    selection.addRange(savedRangeRef.current);
    return true;
  }

  function runCommand(command, commandValue = null) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    restoreSelection();
    document.execCommand(command, false, commandValue);
    saveSelection();
    emitChange();
  }

  function handleEditorFocus() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    if (!richTextHasContent(editor.innerHTML)) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      savedRangeRef.current = range.cloneRange();
    }
  }

  function applyTextColor(colorValue) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    if (!restoreSelection()) {
      handleEditorFocus();
    }
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("foreColor", false, colorValue);
    saveSelection();
    setSelectedColor(colorValue);
    setColorMenuOpen(false);
    emitChange();
  }

  return (
    <div className="rich-text-editor-shell space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-white/8 bg-black/15 p-3">
        {[
          { label: "B", action: () => runCommand("bold"), title: "Bold" },
          { label: "I", action: () => runCommand("italic"), title: "Italic" },
          { label: <Underline size={15} />, action: () => runCommand("underline"), title: "Underline" },
          { label: "UL", action: () => runCommand("insertUnorderedList"), title: "Bullet list" },
          { label: "OL", action: () => runCommand("insertOrderedList"), title: "Numbered list" },
          { label: <AlignLeft size={15} />, action: () => runCommand("justifyLeft"), title: "Align left" },
          { label: <AlignCenter size={15} />, action: () => runCommand("justifyCenter"), title: "Align center" },
          { label: <AlignRight size={15} />, action: () => runCommand("justifyRight"), title: "Align right" }
        ].map((item) => (
          <button
            key={item.title}
            type="button"
            title={item.title}
            onMouseDown={(event) => {
              event.preventDefault();
              item.action();
            }}
            className="inline-flex h-9 min-w-9 items-center justify-center rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-[var(--text-primary)] transition hover:bg-white/10"
          >
            {item.label}
          </button>
        ))}

        <div className="relative">
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              saveSelection();
              setColorMenuOpen((current) => !current);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-[var(--text-primary)] transition hover:bg-white/10"
            aria-haspopup="true"
            aria-expanded={colorMenuOpen}
          >
            <span>Color</span>
            <span className="h-4 w-4 rounded-full border border-white/12" style={{ backgroundColor: selectedColor }} />
          </button>
          {colorMenuOpen ? (
            <div className="absolute left-0 top-full z-20 mt-2 w-[248px] rounded-[18px] border border-white/8 bg-[rgba(11,11,12,0.96)] p-3 shadow-[0_18px_45px_rgba(0,0,0,0.38)] backdrop-blur">
              <div className="grid grid-cols-4 gap-2">
                {RICH_TEXT_COLOR_SWATCHES.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    title={color.label}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyTextColor(color.value);
                    }}
                    className={`flex h-10 items-center justify-center rounded-xl border text-[0.68rem] font-medium uppercase tracking-[0.08em] transition ${
                      selectedColor === color.value
                        ? "border-[rgba(255,138,0,0.6)] bg-white/10 text-[var(--text-primary)]"
                        : "border-white/8 bg-white/5 text-[var(--text-secondary)] hover:bg-white/10"
                    }`}
                  >
                    <span className="h-4 w-4 rounded-full border border-black/20" style={{ backgroundColor: color.value }} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            runCommand("removeFormat");
          }}
          className="inline-flex h-9 items-center justify-center rounded-xl border border-white/8 bg-white/5 px-3 text-sm text-[var(--text-primary)] transition hover:bg-white/10"
        >
          Clear
        </button>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emitChange}
        onFocus={handleEditorFocus}
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
        onBlur={saveSelection}
        className={`rich-text-editor ${contentClassName} ${minHeightClass} w-full rounded-[20px] border border-white/9 bg-white/4 px-4 py-4 text-[var(--text-primary)] outline-none transition focus:border-[rgba(255,138,0,0.48)] focus:shadow-[0_0_0_3px_rgba(255,138,0,0.14)]`}
      />
    </div>
  );
}

function ServicesPage({ data, pendingServiceActions, onToggleService, onSaveServices, savingServices }) {
  const services = data.config?.services || [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => normalizeServiceDraft(services));
  const [search, setSearch] = useState("");

  const filteredServices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...services]
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" }))
      .filter((service) => {
        if (!query) {
          return true;
        }

        return [service.name, service.description, service.category]
          .some((value) => String(value || "").toLowerCase().includes(query));
      });
  }, [search, services]);

  useEffect(() => {
    if (!editing) {
      setDraft(normalizeServiceDraft(services));
    }
  }, [editing, services]);

  function handleToggleEditor() {
    setEditing((current) => {
      const next = !current;
      if (!next) {
        setDraft(normalizeServiceDraft(services));
      }
      return next;
    });
  }

  async function handleSaveServices(nextDraft) {
    const saved = await onSaveServices(nextDraft);
    if (saved) {
      setDraft(normalizeServiceDraft(saved.services || nextDraft));
      setEditing(false);
    }
  }

  return (
    <PageSection
      title="Services"
      description="Interactive launch grid for the services running across your home server."
      action={
        <div className="flex items-center gap-3">
          <Badge tone="info">{services.length} services</Badge>
          <button
            type="button"
            onClick={handleToggleEditor}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)]"
          >
            <Pencil size={15} />
            <span>{editing ? "Close Editor" : "Edit Services"}</span>
          </button>
        </div>
      }
    >
      <div className="mb-5">
        <label className="service-field">
          <span>Search Services</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by service, category, or description..."
          />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {filteredServices.map((service) => {
          const status = inferServiceStatus(service, data.containers);
          return (
            <ServiceCard
              key={service.name}
              service={service}
              status={status}
              enabled={status.running}
              busy={Boolean(pendingServiceActions[service.name])}
              onToggle={() => onToggleService(service)}
            />
          );
        })}
      </div>
      {!filteredServices.length ? <p className="mt-4 text-[var(--text-muted)]">No services matched your search.</p> : null}
      {editing ? <ServiceEditor draft={draft} setDraft={setDraft} saving={savingServices} onSave={handleSaveServices} /> : null}
    </PageSection>
  );
}

function StoragePage({ data }) {
  const storageInsights = data.storageInsights || {};
  const drives = flattenDrives(storageInsights);
  const smartAlerts = storageInsights.smartAlerts || [];
  const refreshedNote = storageInsights.timestamp
    ? `Last refreshed ${formatDateTime(storageInsights.timestamp)}.`
    : "Storage data loading…";

  if (!storageInsights.timestamp) {
    return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <PageSection className="min-w-0" title="Storage" description="Drive-level capacity, thermal state, and array health.">
          <p className="text-[var(--text-muted)]">Loading storage data…</p>
        </PageSection>
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
      <PageSection
        className="min-w-0"
        title="Storage"
        description={`Drive-level capacity, thermal state, and array health. ${refreshedNote}`}
        action={<Badge tone={smartAlerts.length ? "warning" : "success"}>{smartAlerts.length ? `${smartAlerts.length} alerts` : "Healthy"}</Badge>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {drives.map((drive) => (
            <StorageItem key={`${drive.label}-${drive.deviceName}`} drive={drive} />
          ))}
        </div>
      </PageSection>

      <div className="min-w-0 space-y-6">
        <PageSection className="min-w-0" title="Array Health" description={storageInsights.array?.parity?.message || "Parity and sync state."}>
          <div className="space-y-4">
            <div className="flex flex-col gap-2 text-lg text-[var(--text-primary)] sm:flex-row sm:items-center sm:justify-between">
              <span>{storageInsights.array?.summary || "Array status"}</span>
              <Badge tone={storageInsights.array?.status === "healthy" ? "success" : "info"}>
                {storageInsights.array?.status || "Unknown"}
              </Badge>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#2F81F7,#58A6FF)]"
                style={{ width: `${Math.max(0, Math.min(storageInsights.array?.operation?.progressPercent || 0, 100))}%` }}
              />
            </div>
            <p className="text-[var(--text-secondary)]">
              {storageInsights.array?.operation
                ? `${storageInsights.array.operation.type} ${formatPercent(storageInsights.array.operation.progressPercent)} • speed ${
                    storageInsights.array.operation.speed || "unknown"
                  } • eta ${storageInsights.array.operation.eta || "unknown"}`
                : "No active sync work detected."}
            </p>
          </div>
        </PageSection>

        <PageSection className="min-w-0" title="SMART Warnings" description="Drive-level warnings and unusual conditions.">
          <div className="space-y-3">
            {smartAlerts.length ? (
              smartAlerts.map((alert) => (
                <div key={alert.label} className="rounded-2xl border border-white/8 bg-white/3 p-4">
                  <p className="font-medium text-[var(--text-primary)]">{alert.label}</p>
                  <p className="mt-2 text-[var(--text-secondary)]">{(alert.warnings || []).join(", ")}</p>
                </div>
              ))
            ) : (
              <p className="text-[var(--text-muted)]">No SMART warnings detected.</p>
            )}
          </div>
        </PageSection>
      </div>
    </div>
  );
}

function NetworkPage({ data }) {
  const interfaces = data.system?.networkHealth || [];
  const temps = data.system?.thermal || {};
  const cpu = data.system?.cpu || {};
  const memory = data.system?.memory || {};
  const os = data.system?.os || {};
  const hardwareStats = [
    { label: "Host", value: os.hostname || "Unraid Server", detail: [os.distro, os.release].filter(Boolean).join(" ") || "Host OS" },
    { label: "Processor", value: cpu.brand || "Unknown CPU", detail: [cpu.manufacturer, cpu.speed ? `${cpu.speed} GHz base` : null].filter(Boolean).join(" • ") || "CPU details unavailable" },
    { label: "Core Layout", value: cpu.physicalCores ? `${cpu.physicalCores} physical / ${cpu.cores || cpu.physicalCores} total` : cpu.cores ? `${cpu.cores} cores` : "--", detail: Number.isFinite(Number(cpu.load)) ? `Live load ${formatPercentOrUnknown(cpu.load)}` : "Load data unavailable" },
    {
      label: "Memory",
      value: memory.used && memory.total ? `${formatBytes(memory.used)} / ${formatBytes(memory.total)}` : memory.total ? formatBytes(memory.total) : "--",
      detail: Number.isFinite(Number(memory.usagePercent)) ? `${formatPercentOrUnknown(memory.usagePercent)} in use` : "Usage data unavailable"
    },
    { label: "Uptime", value: formatUptime(os.uptime), detail: "Host operating time" },
    { label: "Interfaces", value: `${interfaces.length}`, detail: interfaces.length === 1 ? "external adapter detected" : "external adapters detected" }
  ];

  return (
    <div className="space-y-6">
      <PageSection title="Hardware Snapshot" description="Host identity, processor, memory, uptime, and adapter count.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {hardwareStats.map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/8 bg-white/3 p-4">
              <p className="text-sm uppercase tracking-[0.16em] text-[var(--text-muted)]">{item.label}</p>
              <p className="mt-3 text-lg font-semibold text-[var(--text-primary)]">{item.value}</p>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">{item.detail}</p>
            </div>
          ))}
        </div>
      </PageSection>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <PageSection title="Thermals" description="Core hardware temperatures from the host sensors.">
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { label: "CPU Package", value: temps.cpuPackage },
              { label: "Motherboard", value: temps.motherboard },
              { label: "CPU Core Avg", value: temps.coreAverage },
              { label: "Array Fan", value: formatRpm(temps.arrayFanRpm) },
              { label: "Peak Sensor", value: temps.max }
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/8 bg-white/3 p-4">
                <p className="text-sm uppercase tracking-[0.16em] text-[var(--text-muted)]">{item.label}</p>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
                  {item.label === "Array Fan" ? item.value : formatTemp(item.value)}
                </p>
              </div>
            ))}
          </div>
        </PageSection>

        <PageSection title="Interface Inventory" description="External adapters, addressing, route role, and live throughput.">
          <div className="space-y-4">
            {interfaces.length ? (
              interfaces.map((item) => (
                <div key={item.iface} className="rounded-2xl border border-white/8 bg-white/3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xl font-medium text-[var(--text-primary)]">{item.iface || "Interface"}</p>
                      <p className="mt-1 text-[var(--text-secondary)]">
                        {[item.ip4 || item.ip6 || "No IP", formatLinkSpeed(item.speed), item.duplex || null]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    </div>
                    <Badge tone={String(item.state || "").toLowerCase() === "up" ? "success" : "warning"}>
                      {item.state || "unknown"}
                    </Badge>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {[
                      { label: "Adapter Type", value: item.type || "--" },
                      { label: "MAC Address", value: item.mac || "--" },
                      { label: "IPv4 Address", value: item.ip4 || "--" },
                      { label: "IPv6 Address", value: item.ip6 || "--" },
                      { label: "Link Speed", value: formatLinkSpeed(item.speed) },
                      { label: "Default Route", value: item.default ? "Primary interface" : "Not default route" }
                    ].map((detail) => (
                      <div key={detail.label} className="rounded-2xl border border-white/6 bg-black/10 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{detail.label}</p>
                        <p className="mt-2 break-all text-sm text-[var(--text-primary)]">{detail.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-[var(--text-muted)]">
                    <span>{formatBytes(item.rxSec || 0)}/s down</span>
                    <span>{formatBytes(item.txSec || 0)}/s up</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[var(--text-muted)]">No external interfaces detected.</p>
            )}
          </div>
        </PageSection>
      </div>
    </div>
  );
}

function NotificationsPage({ data }) {
  const items = data.notifications || [];

  return (
    <PageSection
      title="Notifications"
      description="Unread host alerts and important events from your server."
      action={<Badge tone={items.length ? "info" : "neutral"}>{items.length} unread</Badge>}
    >
      <div className="space-y-4">
        {items.length ? items.map((notification, index) => <NotificationCard key={notification.id || index} notification={notification} />) : (
          <p className="text-[var(--text-muted)]">No unread notifications.</p>
        )}
      </div>
    </PageSection>
  );
}

function markdownToHtml(md) {
  if (!md) return "";
  let html = String(md)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  html = html.replace(/^```(\w*)\n([\s\S]*?)```$/gm, (_match, _lang, code) =>
    `<pre class="my-4 overflow-x-auto rounded-2xl border border-white/6 bg-black/30 p-5 font-mono text-sm leading-relaxed text-[var(--text-secondary)]"><code>${code.trimEnd()}</code></pre>`
  );
  html = html.replace(/^### (.+)$/gm, '<h3 class="wiki-heading-3 mt-7 mb-2 text-[1.05rem] font-semibold text-[var(--text-primary)]" id="$1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="wiki-heading-2 mt-9 mb-3 text-[1.35rem] font-semibold tracking-[-0.02em] text-[var(--text-primary)]" id="$1">$1</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, '<code class="rounded-md bg-white/8 px-1.5 py-0.5 text-[0.85em] font-mono text-[var(--accent-blue)]">$1</code>');
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-5 list-decimal text-[var(--text-secondary)] leading-relaxed">$1</li>');
  html = html.replace(/^- (.+)$/gm, '<li class="ml-5 list-disc text-[var(--text-secondary)] leading-relaxed">$1</li>');
  html = html.replace(/((?:<li class="ml-5 list-decimal[^>]*>.*<\/li>\n?)+)/g, (match) => `<ol class="my-3 space-y-1.5">${match}</ol>`);
  html = html.replace(/((?:<li class="ml-5 list-disc[^>]*>.*<\/li>\n?)+)/g, (match) => `<ul class="my-3 space-y-1.5">${match}</ul>`);
  html = html.replace(/\n{2,}/g, '</p><p class="text-[var(--text-secondary)] leading-[1.75] mb-4">');
  html = `<p class="text-[var(--text-secondary)] leading-[1.75] mb-4">${html}</p>`;
  html = html.replace(/<p[^>]*>\s*(<h[23][^>]*>)/g, "$1");
  html = html.replace(/(<\/h[23]>)\s*<\/p>/g, "$1");
  html = html.replace(/<p[^>]*>\s*(<[uo]l[^>]*>)/g, "$1");
  html = html.replace(/(<\/[uo]l>)\s*<\/p>/g, "$1");
  html = html.replace(/<p[^>]*>\s*(<pre[^>]*>)/g, "$1");
  html = html.replace(/(<\/pre>)\s*<\/p>/g, "$1");
  html = html.replace(/<p[^>]*>\s*<\/p>/g, "");
  return html;
}

function extractHeadings(content) {
  if (!content) return [];
  return Array.from(String(content).matchAll(/^##\s+(.+)$/gm)).map((m) => m[1].trim());
}

function wikiTimeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function WikiArticleRow({ article, categoryId, categoryTitle, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border border-white/4 bg-white/[0.015] px-4 py-3.5 text-left transition-colors hover:border-white/10 hover:bg-white/[0.04]"
    >
      <FileText className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
      <span className="min-w-0 flex-1 truncate text-[0.95rem] text-[var(--text-primary)]">{article.title}</span>
      {article.generatedAt && (
        <span className="shrink-0 text-xs text-[var(--text-muted)]">{wikiTimeAgo(article.editedAt || article.generatedAt)}</span>
      )}
    </button>
  );
}

function WikiIndexView({ categories, search, setSearch, activeFilter, setActiveFilter, generating, generatingCategory, apiKeyConfigured, onGenerateAll, onGenerateCategory, onOpenArticle, onNewArticle, onNewCategory, error, generatedAt }) {
  const allArticleCount = categories.reduce((sum, c) => sum + (c.articles?.length || 0), 0);
  const hasContent = allArticleCount > 0;
  const filtered = activeFilter === "all" ? categories : categories.filter((c) => c.id === activeFilter);
  const searchLower = search.toLowerCase().trim();

  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false);
  const [newCatTitle, setNewCatTitle] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [savingNewCat, setSavingNewCat] = useState(false);

  async function handleSaveNewCategory(e) {
    e.preventDefault();
    if (!newCatTitle.trim()) return;
    setSavingNewCat(true);
    try {
      await onNewCategory({ title: newCatTitle.trim(), description: newCatDesc.trim() });
      setNewCatTitle("");
      setNewCatDesc("");
      setShowNewCategoryForm(false);
    } finally {
      setSavingNewCat(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">Knowledge Base</p>
        <h1 className="mt-2 text-[2.4rem] font-bold leading-[1.1] tracking-[-0.04em] text-[var(--text-primary)]">Server Wiki.</h1>
        <p className="mt-3 max-w-xl text-[1.05rem] leading-relaxed text-[var(--text-secondary)]">
          AI-generated documentation tailored to your server's configuration, services, and infrastructure.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search documentation..."
              className="service-field w-full pl-11"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {generatedAt && (
              <span className="hidden text-xs text-[var(--text-muted)] sm:inline">
                Last generated {wikiTimeAgo(generatedAt)}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowNewCategoryForm((v) => !v)}
              className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:border-white/20 hover:text-[var(--text-primary)]"
            >
              <Plus className="h-3.5 w-3.5" />
              New Category
            </button>
            <button
              type="button"
              onClick={onGenerateAll}
              disabled={generating || !apiKeyConfigured}
              className="flex items-center gap-2 rounded-xl bg-[var(--accent-blue)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} />
              {generating ? "Generating..." : hasContent ? "Regenerate All" : "Generate Wiki"}
            </button>
          </div>
        </div>
      </div>

      {showNewCategoryForm && (
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">New Category</h3>
          <form onSubmit={handleSaveNewCategory} className="space-y-3">
            <input
              type="text"
              value={newCatTitle}
              onChange={(e) => setNewCatTitle(e.target.value)}
              placeholder="Category name"
              className="service-field w-full"
              autoFocus
            />
            <input
              type="text"
              value={newCatDesc}
              onChange={(e) => setNewCatDesc(e.target.value)}
              placeholder="Description (optional)"
              className="service-field w-full"
            />
            <div className="flex gap-2">
              <button type="submit" disabled={savingNewCat || !newCatTitle.trim()} className="flex items-center gap-2 rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                <Save className="h-3.5 w-3.5" />{savingNewCat ? "Saving..." : "Create Category"}
              </button>
              <button type="button" onClick={() => { setShowNewCategoryForm(false); setNewCatTitle(""); setNewCatDesc(""); }} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-[var(--text-secondary)]">
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      {error && (
        <div className="rounded-2xl border border-[rgba(246,196,83,0.22)] bg-[rgba(246,196,83,0.12)] px-4 py-3 text-sm text-[var(--text-primary)]">
          {error}
        </div>
      )}
      {!apiKeyConfigured && (
        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-[var(--text-secondary)]">
          Add your Anthropic API key in <strong>Settings → Integrations</strong> to enable wiki generation.
        </div>
      )}

      {hasContent && (
        <div className="flex flex-wrap gap-2">
          {[{ id: "all", title: "All Modules" }, ...categories.filter((c) => (c.articles?.length || 0) > 0)].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveFilter(item.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeFilter === item.id
                  ? "bg-[var(--accent-blue)] text-white"
                  : "border border-white/10 text-[var(--text-secondary)] hover:border-white/20 hover:text-[var(--text-primary)]"
              }`}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {filtered.map((category) => {
          let articles = category.articles || [];
          if (searchLower) {
            articles = articles.filter(
              (a) => a.title.toLowerCase().includes(searchLower) || (a.content || "").toLowerCase().includes(searchLower)
            );
          }
          if (searchLower && !articles.length) return null;
          if (!searchLower && !articles.length && !generating && !category.custom) return null;
          const isCategoryGenerating = generatingCategory === category.id;

          return (
            <Card key={category.id} className="flex min-w-0 flex-col overflow-hidden p-0">
              <div className="border-b border-white/6 px-5 pt-5 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[1.1rem] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{category.title}</h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onNewArticle(category)}
                      className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-secondary)]"
                      title="New article"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    {!category.custom && (
                      <button
                        type="button"
                        onClick={() => onGenerateCategory(category.id)}
                        disabled={generating || !!generatingCategory || !apiKeyConfigured}
                        className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-secondary)] disabled:opacity-50"
                        title="Regenerate"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isCategoryGenerating ? "animate-spin" : ""}`} />
                      </button>
                    )}
                  </div>
                </div>
                {category.description && (
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{category.description}</p>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                {articles.map((article) => (
                  <WikiArticleRow
                    key={article.id}
                    article={article}
                    categoryId={category.id}
                    categoryTitle={category.title}
                    onOpen={() => onOpenArticle(category, article)}
                  />
                ))}
                {!articles.length && (
                  <p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                    {searchLower ? "No matching articles." : "No articles yet."}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {!hasContent && !generating && apiKeyConfigured && (
        <div className="py-12 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-[var(--text-muted)]" />
          <p className="mt-4 text-lg text-[var(--text-secondary)]">No wiki content yet.</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Click "Generate Wiki" to create documentation from your server's current state.</p>
        </div>
      )}
    </div>
  );
}

function WikiArticleView({ article, category, onBack, onSave }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(article.title);
  const [content, setContent] = useState(article.content);
  const [saving, setSaving] = useState(false);
  const contentRef = useRef(null);

  useEffect(() => {
    setTitle(article.title);
    setContent(article.content);
    setEditing(false);
  }, [article.id, article.title, article.content]);

  const headings = useMemo(() => extractHeadings(article.content), [article.content]);

  function scrollToHeading(heading) {
    if (!contentRef.current) return;
    const el = contentRef.current.querySelector(`[id="${heading}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/wiki/article/${category.id}/${article.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content })
      });
      if (res.ok) {
        setEditing(false);
        if (onSave) onSave(await res.json());
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Wiki</span>
        <ChevronRight className="h-3 w-3 text-[var(--text-muted)]" />
        <span>{category.title}</span>
      </button>

      <div className="grid gap-6 xl:grid-cols-[1fr_220px]">
        <Card className="p-6 lg:p-8">
          <div className="mb-6">
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{category.title}</span>
            {editing ? (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="service-field mt-3 w-full text-2xl font-bold"
              />
            ) : (
              <h1 className="mt-3 text-[2rem] font-bold leading-[1.15] tracking-[-0.035em] text-[var(--text-primary)]">{article.title}</h1>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
              {article.generatedAt && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Generated {wikiTimeAgo(article.generatedAt)}
                </span>
              )}
              {article.editedAt && (
                <span className="flex items-center gap-1.5">
                  <Pencil className="h-3 w-3" />
                  Edited {wikiTimeAgo(article.editedAt)}
                </span>
              )}
            </div>
          </div>

          {editing ? (
            <div className="space-y-4">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={24}
                className="service-field w-full font-mono text-sm leading-relaxed"
                placeholder="Markdown content..."
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white">
                  <Save className="h-3.5 w-3.5" />{saving ? "Saving..." : "Save"}
                </button>
                <button type="button" onClick={() => { setEditing(false); setTitle(article.title); setContent(article.content); }} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-[var(--text-secondary)]">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div ref={contentRef}>
              <div className="wiki-article-body" dangerouslySetInnerHTML={{ __html: markdownToHtml(article.content) }} />
              <div className="mt-8 border-t border-white/6 pt-4">
                <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                  <Pencil className="h-3.5 w-3.5" />Edit Article
                </button>
              </div>
            </div>
          )}
        </Card>

        {headings.length > 1 && !editing && (
          <div className="hidden xl:block">
            <div className="sticky top-6">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">On This Page</p>
              <nav className="mt-3 space-y-1">
                {headings.map((heading) => (
                  <button
                    key={heading}
                    type="button"
                    onClick={() => scrollToHeading(heading)}
                    className="block w-full truncate border-l-2 border-white/8 py-1.5 pl-3 text-left text-[0.82rem] text-[var(--text-muted)] transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--text-primary)]"
                  >
                    {heading}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WikiCreateArticleView({ category, onBack, onSave }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/wiki/article/${category.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content })
      });
      if (res.ok) {
        onSave(await res.json());
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to save article.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Wiki</span>
        <ChevronRight className="h-3 w-3 text-[var(--text-muted)]" />
        <span>{category.title}</span>
      </button>

      <Card className="p-6 lg:p-8">
        <div className="mb-6">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{category.title}</span>
          <h1 className="mt-3 text-[1.4rem] font-bold leading-[1.15] tracking-[-0.025em] text-[var(--text-primary)]">New Article</h1>
        </div>
        {error && (
          <div className="mb-4 rounded-2xl border border-[rgba(246,196,83,0.22)] bg-[rgba(246,196,83,0.12)] px-4 py-3 text-sm text-[var(--text-primary)]">
            {error}
          </div>
        )}
        <div className="space-y-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Article title"
            className="service-field w-full text-lg font-semibold"
            autoFocus
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="service-field w-full font-mono text-sm leading-relaxed"
            placeholder="Write your article in Markdown..."
          />
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={saving || !title.trim()} className="flex items-center gap-2 rounded-xl bg-[var(--accent-blue)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              <Save className="h-3.5 w-3.5" />{saving ? "Saving..." : "Save Article"}
            </button>
            <button type="button" onClick={onBack} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-[var(--text-secondary)]">
              Cancel
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function WikiPage({ data, demoMode = false }) {
  const [wiki, setWiki] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generatingCategory, setGeneratingCategory] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeArticle, setActiveArticle] = useState(null);
  const [creatingArticle, setCreatingArticle] = useState(null);

  useEffect(() => {
    if (demoMode) {
      setWiki(data?.wiki || { categories: [], generatedAt: null, apiKeyConfigured: false });
      return;
    }

    fetch("/api/wiki")
      .then((res) => res.json())
      .then(setWiki)
      .catch(() => {});
  }, [data?.wiki, demoMode]);

  async function generateAll() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/wiki/generate", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Generation failed (${res.status})`);
      }
      setWiki(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function generateCategory(categoryId) {
    setGeneratingCategory(categoryId);
    setError(null);
    try {
      const res = await fetch(`/api/wiki/generate/${categoryId}`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Generation failed (${res.status})`);
      }
      setWiki(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingCategory(null);
    }
  }

  async function createCategory({ title, description }) {
    const res = await fetch("/api/wiki/category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description })
    });
    if (res.ok) {
      setWiki(await res.json());
    } else {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Failed to create category.");
    }
  }

  const categories = wiki?.categories || [];
  const apiKeyConfigured = wiki?.apiKeyConfigured ?? false;

  if (creatingArticle) {
    return (
      <WikiCreateArticleView
        category={creatingArticle.category}
        onBack={() => setCreatingArticle(null)}
        onSave={(updated) => { setWiki(updated); setCreatingArticle(null); }}
      />
    );
  }

  if (activeArticle) {
    const currentCategory = categories.find((c) => c.id === activeArticle.categoryId);
    const currentArticle = currentCategory?.articles?.find((a) => a.id === activeArticle.articleId);

    if (currentCategory && currentArticle) {
      return (
        <WikiArticleView
          article={currentArticle}
          category={currentCategory}
          onBack={() => setActiveArticle(null)}
          onSave={(updated) => {
            setWiki(updated);
          }}
        />
      );
    }
  }

  return (
    <WikiIndexView
      categories={categories}
      search={search}
      setSearch={setSearch}
      activeFilter={activeFilter}
      setActiveFilter={setActiveFilter}
      generating={generating}
      generatingCategory={generatingCategory}
      apiKeyConfigured={apiKeyConfigured}
      onGenerateAll={generateAll}
      onGenerateCategory={generateCategory}
      onOpenArticle={(category, article) => setActiveArticle({ categoryId: category.id, articleId: article.id })}
      onNewArticle={(category) => setCreatingArticle({ category })}
      onNewCategory={createCategory}
      error={error}
      generatedAt={wiki?.generatedAt}
    />
  );
}

function SettingsPage({
  compact,
  onCompactToggle,
  data,
  authSession,
  onSaveAuthSettings,
  savingAuthSettings,
  onSaveProfile,
  savingProfileSettings,
  onSaveIntegrations,
  savingIntegrations,
  onLogout
}) {
  const running = data.containers?.running || 0;
  const count = data.containers?.count || 0;
  const [authDirty, setAuthDirty] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authDraft, setAuthDraft] = useState(() => ({
    enabled: false,
    providerName: "Pocket ID",
    issuer: "",
    clientId: "",
    clientSecret: "",
    redirectUri: `${window.location.origin}/api/auth/callback`,
    postLogoutRedirectUri: window.location.origin,
    scopes: "openid profile email"
  }));
  const [profileDraft, setProfileDraft] = useState(() => ({
    displayName: "",
    title: "Home Lab Operator",
    avatarLabel: ""
  }));
  const [integrationsDirty, setIntegrationsDirty] = useState(false);
  const [integrationsDraft, setIntegrationsDraft] = useState(() => ({
    anthropicApiKey: ""
  }));
  const previewProfile = profileDisplay(profileDraft, authSession?.user);

  useEffect(() => {
    if (profileDirty) {
      return;
    }

    const profile = data.config?.profile || {};
    setProfileDraft({
      displayName: profile.displayName || authSession?.user?.name || authSession?.user?.preferredUsername || "",
      title: profile.title || authSession?.user?.email || authSession?.user?.preferredUsername || "Home Lab Operator",
      avatarLabel: profile.avatarLabel || ""
    });
  }, [authSession?.user?.email, authSession?.user?.name, authSession?.user?.preferredUsername, data.config?.profile, profileDirty]);

  useEffect(() => {
    if (authDirty) {
      return;
    }

    const auth = data.config?.auth || authSession?.auth || {};
    setAuthDraft({
      enabled: true,
      providerName: auth.providerName || "Pocket ID",
      issuer: auth.issuer || "",
      clientId: auth.clientId || "",
      clientSecret: auth.clientSecret || "",
      redirectUri: auth.redirectUri || `${window.location.origin}/api/auth/callback`,
      postLogoutRedirectUri: auth.postLogoutRedirectUri || window.location.origin,
      scopes: auth.scopes || "openid profile email"
    });
    setAuthMessage("");
  }, [authDirty, authSession?.auth, data.config?.auth]);

  useEffect(() => {
    if (integrationsDirty) return;
    const integrations = data.config?.integrations || {};
    setIntegrationsDraft({
      anthropicApiKey: integrations.anthropicApiKey || ""
    });
  }, [data.config?.integrations, integrationsDirty]);

  const anthropicKeyConfigured = data.config?.integrations?.anthropicApiKeyConfigured ?? false;
  const authConfigured = Boolean(authSession?.configured);
  const authRequiredComplete = Boolean(
    authDraft.providerName.trim() &&
      authDraft.issuer.trim() &&
      authDraft.clientId.trim() &&
      authDraft.clientSecret.trim() &&
      authDraft.redirectUri.trim()
  );
  const authSaveLabel = "Save OIDC Settings";

  function applyProviderPreset(providerName) {
    const services = data.config?.services || [];
    const match = services.find((service) => String(service.name || "").toLowerCase() === providerName.toLowerCase());
    setAuthDirty(true);
    setAuthMessage("");
    setAuthDraft((current) => ({
      ...current,
      providerName,
      issuer: match?.url || current.issuer,
      redirectUri: current.redirectUri || `${window.location.origin}/api/auth/callback`,
      postLogoutRedirectUri: current.postLogoutRedirectUri || window.location.origin,
      scopes: current.scopes || "openid profile email"
    }));
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3">
        <PageSection title="Profile" description="Control how your signed-in identity is presented inside the dashboard.">
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
            <p className="text-sm uppercase tracking-[0.16em] text-[var(--text-muted)]">Sidebar Preview</p>
              <div className="mt-4 rounded-[24px] border border-white/8 bg-white/4 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ffb04d,#ff8a00)] font-bold text-[#161616]">
                    {previewProfile.avatarLabel}
                </div>
                <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-[var(--text-primary)]">{previewProfile.displayName}</p>
                    <p className="truncate text-sm text-[var(--text-muted)]">{previewProfile.title}</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-[var(--text-secondary)]">
                These values appear in the lower-left account panel when you are signed in through OIDC.
              </p>
            </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="service-field">
                <span>Display Name</span>
                <input
                  value={profileDraft.displayName}
                  onChange={(event) => {
                    setProfileDirty(true);
                    setProfileDraft((current) => ({ ...current, displayName: event.target.value }));
                  }}
                />
              </label>
              <label className="service-field">
                <span>Avatar Label</span>
                <input
                  maxLength={2}
                  value={profileDraft.avatarLabel}
                  onChange={(event) => {
                    setProfileDirty(true);
                    setProfileDraft((current) => ({ ...current, avatarLabel: event.target.value.toUpperCase() }));
                  }}
                />
              </label>
              <label className="service-field md:col-span-2">
                <span>Profile Title</span>
                <input
                  value={profileDraft.title}
                  onChange={(event) => {
                    setProfileDirty(true);
                    setProfileDraft((current) => ({ ...current, title: event.target.value }));
                  }}
                />
              </label>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-medium text-[var(--text-primary)]">Save dashboard profile</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">This is local profile presentation inside the app, separate from your identity provider.</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const saved = await onSaveProfile(profileDraft);
                  if (saved) {
                    setProfileDirty(false);
                  }
                }}
                disabled={savingProfileSettings}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[rgba(255,138,0,0.18)] px-5 py-3 text-[var(--text-primary)] disabled:opacity-60"
              >
                <Save size={16} />
                <span>{savingProfileSettings ? "Saving..." : "Save Profile"}</span>
              </button>
            </div>
          </div>
        </PageSection>

        <PageSection title="Display" description="Client-side dashboard preferences for this browser.">
          <div className="space-y-4">
            <button
              type="button"
              onClick={onCompactToggle}
              className="flex w-full items-center justify-between rounded-2xl border border-white/8 bg-white/3 px-5 py-4 text-left"
            >
              <div>
                <p className="text-lg font-medium text-[var(--text-primary)]">Compact Sidebar</p>
                <p className="mt-1 text-[var(--text-secondary)]">Switch between the 260px expanded rail and a compact icon rail.</p>
              </div>
              <span className={`switch ${compact ? "switch--on" : ""}`} aria-hidden="true">
                <span />
              </span>
            </button>
          </div>
        </PageSection>

        <PageSection title="System Snapshot" description="Quick configuration and runtime status.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
              <p className="text-sm uppercase tracking-[0.16em] text-[var(--text-muted)]">Containers</p>
              <p className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
                {running}/{count}
              </p>
              <p className="mt-2 text-[var(--text-secondary)]">Running / total Docker workloads</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
              <p className="text-sm uppercase tracking-[0.16em] text-[var(--text-muted)]">Services Defined</p>
              <p className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[var(--text-primary)]">
                {(data.config?.services || []).length}
              </p>
              <p className="mt-2 text-[var(--text-secondary)]">Saved launch targets in dashboard config</p>
            </div>
          </div>
        </PageSection>
      </div>

      <PageSection
        title="Authentication"
        description="Secure the dashboard with an existing OIDC provider such as TinyAuth or Pocket ID."
        action={
          authSession?.authenticated ? (
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)]"
            >
              <LogOut size={16} />
              <span>Log Out</span>
            </button>
          ) : null
        }
      >
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-lg font-medium text-[var(--text-primary)]">OIDC Protection</p>
                  <p className="mt-1 text-[var(--text-secondary)]">Complete the provider settings and save them. OIDC is required to use the dashboard.</p>
                </div>
                <Badge tone="success">Required</Badge>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <Badge tone="success">Enabled</Badge>
                <Badge tone={authConfigured ? "info" : "warning"}>{authConfigured ? "Configured" : "Needs setup"}</Badge>
                {authDirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
                {authSession?.authenticated ? <Badge tone="success">{authSession.user?.name || "Authenticated"}</Badge> : null}
              </div>
              <div className="mt-4 rounded-2xl border border-white/8 bg-black/15 px-4 py-3 text-sm text-[var(--text-secondary)]">
                1. Enter issuer, client ID, client secret, and redirect URI.
                <br />
                2. OIDC remains required for all dashboard access.
                <br />
                3. Use the save button below to apply the change.
              </div>
              {!authRequiredComplete ? (
                <p className="mt-3 text-sm text-[#f6c453]">Provider details are incomplete, so OIDC cannot be enabled until those fields are filled in.</p>
              ) : null}
              {authMessage ? <p className="mt-3 text-sm text-[var(--text-secondary)]">{authMessage}</p> : null}
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
              <p className="text-lg font-medium text-[var(--text-primary)]">Provider Presets</p>
              <p className="mt-1 text-[var(--text-secondary)]">Use your existing service URLs as a starting point.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={() => applyProviderPreset("Tinyauth")} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)]">
                  TinyAuth
                </button>
                <button type="button" onClick={() => applyProviderPreset("Pocket ID")} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)]">
                  Pocket ID
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="service-field">
                <span>Provider Name</span>
                <input value={authDraft.providerName} onChange={(event) => {
                  setAuthDirty(true);
                  setAuthDraft((current) => ({ ...current, providerName: event.target.value }));
                }} />
              </label>
              <label className="service-field">
                <span>Scopes</span>
                <input value={authDraft.scopes} onChange={(event) => {
                  setAuthDirty(true);
                  setAuthDraft((current) => ({ ...current, scopes: event.target.value }));
                }} />
              </label>
              <label className="service-field md:col-span-2">
                <span>Issuer URL</span>
                <input value={authDraft.issuer} onChange={(event) => {
                  setAuthDirty(true);
                  setAuthDraft((current) => ({ ...current, issuer: event.target.value }));
                }} />
              </label>
              <label className="service-field">
                <span>Client ID</span>
                <input value={authDraft.clientId} onChange={(event) => {
                  setAuthDirty(true);
                  setAuthDraft((current) => ({ ...current, clientId: event.target.value }));
                }} />
              </label>
              <label className="service-field">
                <span>Client Secret</span>
                <input type="password" value={authDraft.clientSecret} onChange={(event) => {
                  setAuthDirty(true);
                  setAuthDraft((current) => ({ ...current, clientSecret: event.target.value }));
                }} />
              </label>
              <label className="service-field md:col-span-2">
                <span>Redirect URI</span>
                <input value={authDraft.redirectUri} onChange={(event) => {
                  setAuthDirty(true);
                  setAuthDraft((current) => ({ ...current, redirectUri: event.target.value }));
                }} />
              </label>
              <label className="service-field md:col-span-2">
                <span>Post Logout Redirect URI</span>
                <input value={authDraft.postLogoutRedirectUri} onChange={(event) => {
                  setAuthDirty(true);
                  setAuthDraft((current) => ({ ...current, postLogoutRedirectUri: event.target.value }));
                }} />
              </label>
            </div>

            <div className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(255,138,0,0.12)] text-[var(--accent-blue)]">
                  <KeyRound size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-medium text-[var(--text-primary)]">Save authentication settings</p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">Unauthenticated users will be redirected to your provider before they can use the dashboard.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!authRequiredComplete) {
                    setAuthMessage("Fill in the issuer, client ID, client secret, and redirect URI before saving.");
                    return;
                  }

                  const saved = await onSaveAuthSettings(authDraft);
                  if (saved) {
                    setAuthDirty(false);
                    setAuthMessage("OIDC settings saved.");
                  }
                }}
                disabled={savingAuthSettings}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[rgba(255,138,0,0.18)] px-5 py-3 text-[var(--text-primary)] disabled:opacity-60"
              >
                <Save size={16} />
                <span>{savingAuthSettings ? "Saving..." : authSaveLabel}</span>
              </button>
            </div>
          </div>
        </div>
      </PageSection>

      <PageSection title="Integrations" description="External API keys used by dashboard features like the server wiki.">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-lg font-medium text-[var(--text-primary)]">Anthropic API Key</p>
                <p className="mt-1 text-[var(--text-secondary)]">Required for AI-powered wiki generation. Get a key from console.anthropic.com.</p>
              </div>
              <Badge tone={anthropicKeyConfigured ? "success" : "warning"}>{anthropicKeyConfigured ? "Configured" : "Not set"}</Badge>
            </div>
          </div>

          <label className="service-field">
            <span>API Key</span>
            <input
              type="password"
              value={integrationsDraft.anthropicApiKey}
              onChange={(event) => {
                setIntegrationsDirty(true);
                setIntegrationsDraft((current) => ({ ...current, anthropicApiKey: event.target.value }));
              }}
              placeholder={anthropicKeyConfigured ? "••••••••" : "sk-ant-..."}
            />
          </label>

          <div className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgba(255,138,0,0.12)] text-[var(--accent-blue)]">
                <KeyRound size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-base font-medium text-[var(--text-primary)]">Save integration settings</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">The API key is stored securely in your server config and never exposed to the browser.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                const saved = await onSaveIntegrations(integrationsDraft);
                if (saved) setIntegrationsDirty(false);
              }}
              disabled={savingIntegrations}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[rgba(255,138,0,0.18)] px-5 py-3 text-[var(--text-primary)] disabled:opacity-60"
            >
              <Save size={16} />
              <span>{savingIntegrations ? "Saving..." : "Save Integrations"}</span>
            </button>
          </div>
        </div>
      </PageSection>
    </div>
  );
}

function SetupPage({ data, authSession, onSaveAuthSettings, savingAuthSettings }) {
  const [authDirty, setAuthDirty] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authDraft, setAuthDraft] = useState(() => ({
    enabled: true,
    providerName: "Pocket ID",
    issuer: "",
    clientId: "",
    clientSecret: "",
    redirectUri: `${window.location.origin}/api/auth/callback`,
    postLogoutRedirectUri: window.location.origin,
    scopes: "openid profile email"
  }));

  useEffect(() => {
    if (authDirty) {
      return;
    }

    const auth = data.config?.auth || authSession?.auth || {};
    setAuthDraft({
      enabled: true,
      providerName: auth.providerName || "Pocket ID",
      issuer: auth.issuer || "",
      clientId: auth.clientId || "",
      clientSecret: auth.clientSecret || "",
      redirectUri: auth.redirectUri || `${window.location.origin}/api/auth/callback`,
      postLogoutRedirectUri: auth.postLogoutRedirectUri || window.location.origin,
      scopes: auth.scopes || "openid profile email"
    });
    setAuthMessage("");
  }, [authDirty, authSession?.auth, data.config?.auth]);

  const authRequiredComplete = Boolean(
    authDraft.providerName.trim() &&
      authDraft.issuer.trim() &&
      authDraft.clientId.trim() &&
      authDraft.clientSecret.trim() &&
      authDraft.redirectUri.trim()
  );

  function applyProviderPreset(providerName) {
    const services = data.config?.services || [];
    const match = services.find((service) => String(service.name || "").toLowerCase() === providerName.toLowerCase());
    setAuthDirty(true);
    setAuthMessage("");
    setAuthDraft((current) => ({
      ...current,
      providerName,
      issuer: match?.url || current.issuer,
      redirectUri: current.redirectUri || `${window.location.origin}/api/auth/callback`,
      postLogoutRedirectUri: current.postLogoutRedirectUri || window.location.origin,
      scopes: current.scopes || "openid profile email"
    }));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-sm uppercase tracking-[0.22em] text-[var(--accent-blue)]">Initial Setup</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[var(--text-primary)]">Configure OIDC before entering the dashboard</h1>
            <p className="mt-4 text-base leading-7 text-[var(--text-secondary)]">
              This dashboard now requires OIDC authentication. Complete the provider settings below, save them, and you will be sent to sign in before the full dashboard loads.
            </p>
          </div>
          <Badge tone="warning">Setup required</Badge>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            "Use a provider you already run, such as TinyAuth or Pocket ID.",
            "Set the redirect URI to this dashboard's /api/auth/callback endpoint.",
            "After saving, login becomes the only path into the dashboard."
          ].map((item) => (
            <div key={item} className="rounded-2xl border border-white/8 bg-white/3 p-4 text-sm leading-6 text-[var(--text-secondary)]">
              {item}
            </div>
          ))}
        </div>
      </div>

      <PageSection title="OIDC Setup" description="Only the authentication setup flow is available until OIDC is configured.">
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-lg font-medium text-[var(--text-primary)]">Authentication Provider</p>
                <p className="mt-1 text-[var(--text-secondary)]">Enter your issuer details, client credentials, and callback URLs.</p>
              </div>
              <Badge tone="success">OIDC required</Badge>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <Badge tone="warning">Unauthenticated</Badge>
              <Badge tone={authRequiredComplete ? "info" : "warning"}>{authRequiredComplete ? "Ready to save" : "Needs setup"}</Badge>
              {authDirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
            </div>
            {authMessage ? <p className="mt-4 text-sm text-[var(--text-secondary)]">{authMessage}</p> : null}
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
            <p className="text-lg font-medium text-[var(--text-primary)]">Provider Presets</p>
            <p className="mt-1 text-[var(--text-secondary)]">Use your existing service URLs as a starting point.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={() => applyProviderPreset("Tinyauth")} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)]">
                TinyAuth
              </button>
              <button type="button" onClick={() => applyProviderPreset("Pocket ID")} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-[var(--text-primary)]">
                Pocket ID
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="service-field">
              <span>Provider Name</span>
              <input value={authDraft.providerName} onChange={(event) => {
                setAuthDirty(true);
                setAuthDraft((current) => ({ ...current, providerName: event.target.value }));
              }} />
            </label>
            <label className="service-field">
              <span>Scopes</span>
              <input value={authDraft.scopes} onChange={(event) => {
                setAuthDirty(true);
                setAuthDraft((current) => ({ ...current, scopes: event.target.value }));
              }} />
            </label>
            <label className="service-field md:col-span-2">
              <span>Issuer URL</span>
              <input value={authDraft.issuer} onChange={(event) => {
                setAuthDirty(true);
                setAuthDraft((current) => ({ ...current, issuer: event.target.value }));
              }} />
            </label>
            <label className="service-field">
              <span>Client ID</span>
              <input value={authDraft.clientId} onChange={(event) => {
                setAuthDirty(true);
                setAuthDraft((current) => ({ ...current, clientId: event.target.value }));
              }} />
            </label>
            <label className="service-field">
              <span>Client Secret</span>
              <input type="password" value={authDraft.clientSecret} onChange={(event) => {
                setAuthDirty(true);
                setAuthDraft((current) => ({ ...current, clientSecret: event.target.value }));
              }} />
            </label>
            <label className="service-field md:col-span-2">
              <span>Redirect URI</span>
              <input value={authDraft.redirectUri} onChange={(event) => {
                setAuthDirty(true);
                setAuthDraft((current) => ({ ...current, redirectUri: event.target.value }));
              }} />
            </label>
            <label className="service-field md:col-span-2">
              <span>Post Logout Redirect URI</span>
              <input value={authDraft.postLogoutRedirectUri} onChange={(event) => {
                setAuthDirty(true);
                setAuthDraft((current) => ({ ...current, postLogoutRedirectUri: event.target.value }));
              }} />
            </label>
          </div>

          {!authRequiredComplete ? (
            <div className="rounded-2xl border border-[rgba(246,196,83,0.22)] bg-[rgba(246,196,83,0.12)] px-4 py-3 text-sm text-[var(--text-primary)]">
              Fill in the issuer, client ID, client secret, and redirect URI before saving setup.
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-white/8 bg-white/3 p-4">
            <button
              type="button"
              onClick={async () => {
                if (!authRequiredComplete) {
                  setAuthMessage("Fill in the issuer, client ID, client secret, and redirect URI before saving.");
                  return;
                }

                const saved = await onSaveAuthSettings(authDraft);
                if (saved) {
                  setAuthDirty(false);
                  setAuthMessage("OIDC settings saved. Redirecting to sign in...");
                }
              }}
              disabled={savingAuthSettings}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-[rgba(255,138,0,0.18)] px-5 py-3 text-[var(--text-primary)] disabled:opacity-60"
            >
              <Save size={16} />
              <span>{savingAuthSettings ? "Saving..." : "Save Setup"}</span>
            </button>
          </div>
        </div>
      </PageSection>
    </div>
  );
}

export default function App() {
  const [activePage, setActivePage] = useLocalStorageState("dashboard-active-page", "dashboard");
  const [collapsed, setCollapsed] = useLocalStorageState("dashboard-sidebar-collapsed", false);
  const [pendingServiceActions, setPendingServiceActions] = useState({});
  const [savingServices, setSavingServices] = useState(false);
  const [savingAuthSettings, setSavingAuthSettings] = useState(false);
  const [savingProfileSettings, setSavingProfileSettings] = useState(false);
  const [savingIntegrations, setSavingIntegrations] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingDashboardGuide, setSavingDashboardGuide] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [authSession, setAuthSession] = useState({
    enabled: false,
    configured: false,
    authenticated: false,
    user: null,
    auth: null
  });
  const [data, setData] = useState({
    config: { services: [], auth: {}, dashboardGuide: DEFAULT_DASHBOARD_GUIDE },
    system: {},
    storageInsights: {},
    containers: {},
    notifications: []
  });

  const contentOffset = collapsed ? "lg:ml-[92px]" : "lg:ml-[260px]";

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(""), 3000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      if (mounted) {
        setBootstrapping(true);
      }

      try {
        const sessionResponse = await fetch("/api/auth/session");
        const sessionPayload = sessionResponse.ok ? await sessionResponse.json() : null;
        if (sessionPayload && mounted) {
          setAuthSession(sessionPayload);
        }

        if (sessionPayload && !sessionPayload.configured) {
          const configResponse = await fetch("/api/config");
          const configPayload = configResponse.ok ? await configResponse.json() : null;
          if (!configResponse.ok) {
            throw new Error("OIDC is required and must be configured locally before the dashboard can be used.");
          }

          if (mounted) {
            setActivePage("settings");
            setData((current) => ({
              ...current,
              config: {
                ...current.config,
                ...configPayload
              }
            }));
            setError("OIDC setup is required before the dashboard can be used. Complete the authentication settings below.");
          }
          return;
        }

        const response = await fetch("/api/dashboard");
        if (!response.ok) {
          throw new Error(`Dashboard request failed (${response.status})`);
        }

        const payload = await response.json();
        if (mounted) {
          setDemoMode(false);
          setData((current) => mergeDashboardState(current, payload));
          setError("");
        }
      } catch (nextError) {
        if (mounted) {
          setDemoMode(true);
          setLive(false);
          setAuthSession(DEMO_AUTH_SESSION);
          setData((current) => mergeDashboardState(current, buildDemoDashboardPayload()));
          setError("Demo mode enabled: live API endpoints are unavailable on this deployment.");
        }
      } finally {
        if (mounted) {
          setBootstrapping(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      mounted = false;
    };
  }, [setActivePage]);

  useEffect(() => {
    if (demoMode) {
      setLive(false);
      return undefined;
    }

    if (!authSession.configured || !authSession.authenticated) {
      setLive(false);
      return undefined;
    }

    const socket = io();
    socket.on("connect", () => setLive(true));
    socket.on("disconnect", () => setLive(false));
    socket.on("dashboard:update", (payload) => {
      setData((current) => mergeDashboardState(current, payload));
      setError("");
    });
    socket.on("config:update", (config) => {
      setData((current) => ({ ...current, config }));
    });
    socket.on("storage:update", (storageInsights) => {
      setData((current) => ({ ...current, storageInsights }));
    });
    socket.on("notifications:update", (notifications) => {
      setData((current) => ({ ...current, notifications }));
    });
    socket.on("dashboard:error", (payload) => {
      setError(payload?.error || "Dashboard update failed.");
    });

    return () => {
      socket.close();
    };
  }, [authSession.authenticated, authSession.configured, demoMode]);

  useEffect(() => {
    if (!demoMode) {
      return undefined;
    }

    setLive(true);
    const timer = setInterval(() => {
      setData((current) => advanceDemoDashboardPayload(current));
    }, 3000);

    return () => clearInterval(timer);
  }, [demoMode]);

  async function handleRefresh() {
    if (demoMode) {
      setRefreshing(true);
      setData((current) => advanceDemoDashboardPayload(current));
      setError("");
      setSuccessMessage("Demo data refreshed.");
      setRefreshing(false);
      return;
    }

    setRefreshing(true);

    try {
      const [dashboardResponse, storageResponse] = await Promise.all([
        fetch("/api/dashboard"),
        fetch("/api/storage/refresh", { method: "POST", headers: { "Content-Type": "application/json" } })
      ]);

      if (!dashboardResponse.ok) {
        throw new Error(`Dashboard request failed (${dashboardResponse.status})`);
      }

      const nextDashboard = await dashboardResponse.json();
      const nextStorage = storageResponse.ok ? await storageResponse.json() : null;

      setData((current) => ({
        ...mergeDashboardState(current, nextDashboard),
        storageInsights: nextStorage || nextDashboard.storageInsights || current.storageInsights
      }));
      setError("");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function saveAuthSettings(auth) {
    setSavingAuthSettings(true);

    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notes: data.config?.notes || [],
          dashboardGuide: data.config?.dashboardGuide || DEFAULT_DASHBOARD_GUIDE,
          shares: data.config?.shares || [],
          services: data.config?.services || [],
          auth,
          profile: data.config?.profile || {}
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save authentication settings.");
      }

      setData((current) => ({
        ...current,
        config: payload
      }));
      const sessionResponse = await fetch("/api/auth/session");
      if (sessionResponse.ok) {
        const nextSession = await sessionResponse.json();
        setAuthSession(nextSession);
        if (nextSession.configured && !nextSession.authenticated) {
          window.location.href = "/api/auth/login";
          return payload;
        }
      }
      setError("");
      return payload;
    } catch (nextError) {
      setError(nextError.message);
      return null;
    } finally {
      setSavingAuthSettings(false);
    }
  }

  async function logout() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const payload = await response.json();
      window.location.href = payload.redirectTo || "/";
    } catch (_error) {
      window.location.href = "/";
    }
  }

  async function toggleService(service) {
    const status = inferServiceStatus(service, data.containers);
    if (!status.canToggle) {
      setError(`No Docker container matched service "${service.name}".`);
      return;
    }

    if (serviceProtectedFromDisable(service) && status.running) {
      setError(`${service.name} is protected and cannot be disabled from the dashboard.`);
      return;
    }

    setPendingServiceActions((current) => ({
      ...current,
      [service.name]: true
    }));

    try {
      const nextState = status.running ? "stop" : "start";
      const response = await fetch(`/api/services/${encodeURIComponent(service.name)}/power`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ state: nextState })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Failed to ${nextState} ${service.name}.`);
      }

      if (payload.containers) {
        setData((current) => ({
          ...current,
          containers: payload.containers
        }));
      }
      setError("");
      setSuccessMessage(`${service.name} ${nextState === "start" ? "started" : "stopped"}.`);
    } catch (nextError) {
      setSuccessMessage("");
      setError(nextError.message);
    } finally {
      setPendingServiceActions((current) => ({
        ...current,
        [service.name]: false
      }));
    }
  }

  async function saveServices(services) {
    setSavingServices(true);

    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notes: data.config?.notes || [],
          dashboardGuide: data.config?.dashboardGuide || DEFAULT_DASHBOARD_GUIDE,
          shares: data.config?.shares || [],
          services,
          auth: data.config?.auth || {},
          profile: data.config?.profile || {}
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save services.");
      }

      setData((current) => ({
        ...current,
        config: payload
      }));
      setError("");
      return payload;
    } catch (nextError) {
      setError(nextError.message);
      return null;
    } finally {
      setSavingServices(false);
    }
  }

  async function saveProfileSettings(profile) {
    setSavingProfileSettings(true);

    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notes: data.config?.notes || [],
          dashboardGuide: data.config?.dashboardGuide || DEFAULT_DASHBOARD_GUIDE,
          shares: data.config?.shares || [],
          services: data.config?.services || [],
          auth: data.config?.auth || {},
          profile
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save profile settings.");
      }

      setData((current) => ({
        ...current,
        config: payload
      }));
      setError("");
      return payload;
    } catch (nextError) {
      setError(nextError.message);
      return null;
    } finally {
      setSavingProfileSettings(false);
    }
  }

  async function saveIntegrations(integrations) {
    setSavingIntegrations(true);

    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notes: data.config?.notes || [],
          dashboardGuide: data.config?.dashboardGuide || DEFAULT_DASHBOARD_GUIDE,
          shares: data.config?.shares || [],
          services: data.config?.services || [],
          auth: data.config?.auth || {},
          profile: data.config?.profile || {},
          integrations
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save integration settings.");
      }

      setData((current) => ({
        ...current,
        config: payload
      }));
      setError("");
      return payload;
    } catch (nextError) {
      setError(nextError.message);
      return null;
    } finally {
      setSavingIntegrations(false);
    }
  }

  async function saveNotes(notes) {
    setSavingNotes(true);

    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notes,
          dashboardGuide: data.config?.dashboardGuide || DEFAULT_DASHBOARD_GUIDE,
          shares: data.config?.shares || [],
          services: data.config?.services || [],
          auth: data.config?.auth || {},
          profile: data.config?.profile || {}
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save notes.");
      }

      setData((current) => ({
        ...current,
        config: payload
      }));
      setError("");
      return payload;
    } catch (nextError) {
      setError(nextError.message);
      return null;
    } finally {
      setSavingNotes(false);
    }
  }

  async function saveDashboardGuide(dashboardGuide) {
    setSavingDashboardGuide(true);

    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notes: data.config?.notes || [],
          dashboardGuide,
          shares: data.config?.shares || [],
          services: data.config?.services || [],
          auth: data.config?.auth || {},
          profile: data.config?.profile || {}
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save dashboard guide.");
      }

      setData((current) => ({
        ...current,
        config: payload
      }));
      setError("");
      return payload;
    } catch (nextError) {
      setError(nextError.message);
      return null;
    } finally {
      setSavingDashboardGuide(false);
    }
  }

  const setupMode = !bootstrapping && !authSession.configured && !authSession.authenticated;
  const visiblePage = setupMode
    ? "settings"
    : NAV_ITEMS.some((item) => item.id === activePage)
      ? activePage
      : "dashboard";

  const page = useMemo(() => {
    if (setupMode) {
      return (
        <SetupPage
          data={data}
          authSession={authSession}
          onSaveAuthSettings={saveAuthSettings}
          savingAuthSettings={savingAuthSettings}
        />
      );
    }

    switch (visiblePage) {
      case "services":
        return (
          <ServicesPage
            data={data}
            pendingServiceActions={pendingServiceActions}
            onToggleService={toggleService}
            onSaveServices={saveServices}
            savingServices={savingServices}
          />
        );
      case "storage":
        return <StoragePage data={data} />;
      case "network":
        return <NetworkPage data={data} />;
      case "server-log":
        return (
          <ServerLogPage
            data={data}
            onSaveNotes={saveNotes}
            onSaveDashboardGuide={saveDashboardGuide}
            savingNotes={savingNotes}
            savingDashboardGuide={savingDashboardGuide}
          />
        );
      case "notifications":
        return <NotificationsPage data={data} />;
      case "wiki":
        return <WikiPage data={data} demoMode={demoMode} />;
      case "settings":
        return (
          <SettingsPage
            compact={collapsed}
            onCompactToggle={() => setCollapsed((value) => !value)}
            data={data}
            authSession={authSession}
            onSaveAuthSettings={saveAuthSettings}
            savingAuthSettings={savingAuthSettings}
            onSaveProfile={saveProfileSettings}
            savingProfileSettings={savingProfileSettings}
            onSaveIntegrations={saveIntegrations}
            savingIntegrations={savingIntegrations}
            onLogout={logout}
          />
        );
      default:
        return (
          <DashboardPage
            data={data}
            pendingServiceActions={pendingServiceActions}
            onToggleService={toggleService}
            onOpenStorage={() => setActivePage("storage")}
            onOpenServerLog={() => setActivePage("server-log")}
            onSaveNotes={saveNotes}
            onSaveDashboardGuide={saveDashboardGuide}
            savingNotes={savingNotes}
            savingDashboardGuide={savingDashboardGuide}
          />
        );
    }
  }, [
    activePage,
    authSession,
    collapsed,
    data,
    pendingServiceActions,
    savingAuthSettings,
    savingDashboardGuide,
    savingNotes,
    savingIntegrations,
    savingProfileSettings,
    savingServices,
    setupMode,
    visiblePage
  ]);

  const bootPage = (
    <div className="min-h-screen bg-[var(--bg-main)] px-5 py-8 text-[var(--text-primary)] lg:px-8">
      <div className="mx-auto max-w-3xl rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-8 shadow-[0_20px_70px_rgba(0,0,0,0.22)]">
        <p className="text-sm uppercase tracking-[0.22em] text-[var(--accent-blue)]">Loading</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-[var(--text-primary)]">Loading dashboard session</h1>
        <p className="mt-4 text-base leading-7 text-[var(--text-secondary)]">
          Finalizing authentication and loading your dashboard state.
        </p>
      </div>
    </div>
  );

  return (
    <AppCrashBoundary>
    {bootstrapping ? bootPage : (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-primary)]">
      {setupMode ? null : (
        <Sidebar
          activePage={activePage}
          onPageChange={setActivePage}
          collapsed={collapsed}
          onToggle={() => setCollapsed((value) => !value)}
          authSession={authSession}
          profile={data.config?.profile}
          onOpenProfile={() => setActivePage("settings")}
          onLogout={logout}
        />
      )}

      <main className={`${setupMode ? "" : contentOffset} min-h-screen px-5 pb-5 pt-5 transition-[margin] duration-300 lg:px-8 lg:pb-8 lg:pt-7`}>
        <div className="dashboard-shell">
          <div className="app-surface min-h-[calc(100dvh-2.5rem)] rounded-[34px] border border-white/6 p-6 pb-[calc(7.5rem+env(safe-area-inset-bottom))] lg:min-h-[calc(100vh-2.5rem)] lg:p-7 lg:pb-7 xl:p-8 xl:pb-8">
          {setupMode ? null : (
            <Header
              activePage={activePage}
              live={live}
              onRefresh={handleRefresh}
              refreshing={refreshing}
              compact={collapsed}
              onCompactToggle={() => setCollapsed((value) => !value)}
              system={data.system}
            />
          )}

          {error ? (
            <div className="mb-6 rounded-2xl border border-[rgba(246,196,83,0.22)] bg-[rgba(246,196,83,0.12)] px-4 py-3 text-[var(--text-primary)]">
              {error}
            </div>
          ) : null}
          {successMessage ? (
            <div className="mb-6 rounded-2xl border border-[rgba(63,185,80,0.22)] bg-[rgba(63,185,80,0.12)] px-4 py-3 text-[var(--text-primary)]">
              {successMessage}
            </div>
          ) : null}

          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {page}
            </motion.div>
          </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
    )}
    </AppCrashBoundary>
  );
}
