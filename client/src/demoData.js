export const DEMO_AUTH_SESSION = {
  enabled: false,
  configured: true,
  authenticated: true,
  user: {
    name: "Demo Operator",
    email: "demo@example.com",
    preferredUsername: "demo"
  },
  auth: {
    enabled: false,
    providerName: "Demo Mode",
    issuer: "",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    postLogoutRedirectUri: "",
    scopes: "openid profile email"
  }
};

function withHistoryPoint(history = [], value = 0, max = 24) {
  const next = [...history, { value: Number(value) }];
  return next.slice(Math.max(next.length - max, 0));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function buildDemoDashboardPayload() {
  const now = new Date().toISOString();

  return {
    config: {
      services: [
        { name: "Nginx Proxy Manager", category: "Management", favorite: true, port: "81", path: "", description: "Reverse proxy and SSL", url: "https://npm.demo.local", imageUrl: "" },
        { name: "Pihole", category: "Network", favorite: true, port: "80", path: "", description: "DNS filtering", url: "https://pihole.demo.local", imageUrl: "" },
        { name: "Radarr", category: "Media", favorite: true, port: "7878", path: "", description: "Movie automation", url: "https://radarr.demo.local", imageUrl: "" },
        { name: "Sonarr", category: "Media", favorite: true, port: "8989", path: "", description: "TV automation", url: "https://sonarr.demo.local", imageUrl: "" },
        { name: "Prowlarr", category: "Media", favorite: false, port: "9696", path: "", description: "Indexer manager", url: "https://prowlarr.demo.local", imageUrl: "" },
        { name: "qBittorrent", category: "Downloads", favorite: false, port: "8080", path: "", description: "Torrent client", url: "https://qbittorrent.demo.local", imageUrl: "" },
        { name: "SABnzbd", category: "Downloads", favorite: false, port: "8085", path: "", description: "Usenet downloads", url: "https://sabnzbd.demo.local", imageUrl: "" },
        { name: "Jellyfin", category: "Media", favorite: true, port: "8096", path: "", description: "Media streaming", url: "https://jellyfin.demo.local", imageUrl: "" },
        { name: "Portainer", category: "Management", favorite: true, port: "9443", path: "", description: "Container management", url: "https://portainer.demo.local", imageUrl: "" },
        { name: "PostgreSQL", category: "Storage", favorite: false, port: "5432", path: "", description: "Database service", url: "", imageUrl: "" }
      ],
      auth: {
        enabled: false,
        providerName: "Demo Mode",
        issuer: "",
        clientId: "PUBLIC_DEMO_CLIENT_ID",
        clientSecret: "PUBLIC_DEMO_CLIENT_SECRET",
        redirectUri: "",
        postLogoutRedirectUri: "",
        scopes: "openid profile email"
      },
      profile: {
        displayName: "Demo Operator",
        title: "Vercel Demo",
        avatarLabel: "DO"
      },
      integrations: {
        anthropicApiKeyConfigured: false,
        anthropicApiKey: ""
      },
      notes: [
        {
          id: "demo-note-1",
          title: "Demo environment",
          content: "This Vercel deployment runs in read-only demo mode with synthetic live telemetry.",
          createdAt: now,
          updatedAt: now
        }
      ],
      dashboardGuide: [
        "This public demo runs in read-only mode.",
        "Live host telemetry is simulated for presentation.",
        "Container control and persistent config edits are disabled in demo mode."
      ],
      shares: [
        { name: "media", path: "/demo/media" },
        { name: "downloads", path: "/demo/downloads" },
        { name: "backups", path: "/demo/backups" }
      ]
    },
    system: {
      os: {
        hostname: "demo-host",
        distro: "Unraid",
        release: "6.12.8",
        uptime: 182340
      },
      cpu: {
        brand: "AMD Ryzen 7 5800X",
        manufacturer: "AMD",
        physicalCores: 8,
        cores: 16,
        speed: 3.8,
        temperature: 42,
        load: 19.2
      },
      memory: {
        total: 68719476736,
        used: 25165824000,
        active: 21474836480,
        free: 43553652736,
        usagePercent: 36.6
      },
      network: [
        {
          iface: "eth0",
          rxSec: 4718592,
          txSec: 2621440,
          state: "up",
          speed: 2500
        }
      ],
      networkHealth: [
        {
          iface: "eth0",
          ip4: "192.168.1.20",
          ip6: "",
          type: "wired",
          mac: "00:11:22:33:44:55",
          speed: 2500,
          duplex: "full",
          state: "up",
          default: true,
          rxSec: 4718592,
          txSec: 2621440
        }
      ],
      thermal: {
        cpuPackage: 42,
        motherboard: 35,
        coreAverage: 40,
        arrayFanRpm: 920,
        max: 44
      },
      history: {
        cpuLoad: Array.from({ length: 24 }, (_v, i) => ({ value: 20 + Math.sin(i / 2) * 7 })),
        memoryUsage: Array.from({ length: 24 }, (_v, i) => ({ value: 37 + Math.cos(i / 3) * 3 })),
        networkThroughput: Array.from({ length: 24 }, (_v, i) => ({ value: 4 + Math.sin(i / 4) * 1.2 })),
        arrayUsage: Array.from({ length: 24 }, (_v, i) => ({ value: 63 + Math.cos(i / 6) * 1.3 }))
      }
    },
    containers: {
      count: 10,
      running: 8,
      containers: [
        { id: "demo-1", name: "nginx-proxy-manager", image: "jc21/nginx-proxy-manager", state: "running", labels: {} },
        { id: "demo-2", name: "pihole", image: "pihole/pihole", state: "running", labels: {} },
        { id: "demo-3", name: "radarr", image: "lscr.io/linuxserver/radarr", state: "running", labels: {} },
        { id: "demo-4", name: "sonarr", image: "lscr.io/linuxserver/sonarr", state: "running", labels: {} },
        { id: "demo-5", name: "prowlarr", image: "lscr.io/linuxserver/prowlarr", state: "running", labels: {} },
        { id: "demo-6", name: "qbittorrent", image: "lscr.io/linuxserver/qbittorrent", state: "exited", labels: {} },
        { id: "demo-7", name: "sabnzbd", image: "lscr.io/linuxserver/sabnzbd", state: "running", labels: {} },
        { id: "demo-8", name: "jellyfin", image: "lscr.io/linuxserver/jellyfin", state: "running", labels: {} },
        { id: "demo-9", name: "portainer", image: "portainer/portainer-ce", state: "running", labels: {} },
        { id: "demo-10", name: "postgresql", image: "postgres", state: "exited", labels: {} }
      ]
    },
    storageInsights: {
      timestamp: now,
      smartAlerts: [],
      array: {
        status: "healthy",
        summary: "Array healthy with parity protected",
        parity: {
          message: "Parity check completed successfully"
        },
        operation: null
      },
      deviceGroups: [
        {
          key: "array",
          title: "Array",
          summary: {
            totalBytes: 8000000000000,
            usedBytes: 5040000000000,
            freeBytes: 2960000000000,
            usagePercent: 63
          },
          items: [
            {
              label: "disk1",
              deviceName: "/dev/sdb",
              role: "disk1",
              sizeBytes: 4000000000000,
              usedBytes: 2480000000000,
              freeBytes: 1520000000000,
              usagePercent: 62,
              temperature: 36,
              rotational: true,
              spundown: false
            },
            {
              label: "disk2",
              deviceName: "/dev/sdc",
              role: "disk2",
              sizeBytes: 4000000000000,
              usedBytes: 2560000000000,
              freeBytes: 1440000000000,
              usagePercent: 64,
              temperature: 37,
              rotational: true,
              spundown: false
            },
            {
              label: "parity",
              deviceName: "/dev/sdd",
              role: "parity",
              sizeBytes: 4000000000000,
              usedBytes: 0,
              freeBytes: 0,
              usagePercent: 0,
              temperature: 35,
              rotational: true,
              spundown: false
            }
          ]
        },
        {
          key: "pool",
          title: "Cache Pool",
          summary: {
            totalBytes: 2000000000000,
            usedBytes: 820000000000,
            freeBytes: 1180000000000,
            usagePercent: 41
          },
          items: [
            {
              label: "cache",
              deviceName: "/dev/nvme0n1",
              role: "cache",
              sizeBytes: 2000000000000,
              usedBytes: 820000000000,
              freeBytes: 1180000000000,
              usagePercent: 41,
              temperature: 44,
              rotational: false,
              spundown: false
            }
          ]
        }
      ],
      shares: [
        { name: "media", path: "/demo/media", total: 8000000000000, used: 5040000000000, free: 2960000000000, usagePercent: 63 },
        { name: "downloads", path: "/demo/downloads", total: 1000000000000, used: 420000000000, free: 580000000000, usagePercent: 42 },
        { name: "backups", path: "/demo/backups", total: 2000000000000, used: 390000000000, free: 1610000000000, usagePercent: 19.5 }
      ]
    },
    notifications: [
      {
        id: "demo-notification-1",
        subject: "Demo Mode",
        message: "This deployment is running with synthetic telemetry and read-only controls.",
        severity: "info",
        timestamp: now
      }
    ],
    wiki: {
      generatedAt: now,
      apiKeyConfigured: false,
      categories: [
        {
          id: "system",
          title: "System",
          description: "Demo system overview",
          custom: false,
          articles: [
            {
              id: "system-overview",
              title: "System Overview",
              content: "## Demo Overview\nThis is a read-only Vercel demo instance.\n\n- Live host telemetry is simulated\n- Docker power controls are disabled\n- Private deployment remains outside public Git",
              generatedAt: now
            }
          ]
        }
      ]
    }
  };
}

export function advanceDemoDashboardPayload(current) {
  const base = current || buildDemoDashboardPayload();
  const now = new Date().toISOString();

  const currentCpu = Number(base.system?.cpu?.load || 20);
  const currentMem = Number(base.system?.memory?.usagePercent || 37);
  const currentNet = Number(base.system?.network?.[0]?.rxSec || 4000000);
  const currentArray = Number(base.storageInsights?.deviceGroups?.find((g) => g.key === "array")?.summary?.usagePercent || 63);

  const cpuLoad = clamp(currentCpu + (Math.random() - 0.5) * 6, 7, 78);
  const memUsage = clamp(currentMem + (Math.random() - 0.5) * 1.2, 28, 66);
  const netRx = clamp(currentNet + (Math.random() - 0.45) * 1200000, 900000, 9000000);
  const netTx = clamp(netRx * (0.45 + Math.random() * 0.25), 400000, 5000000);
  const arrayUsage = clamp(currentArray + (Math.random() - 0.5) * 0.18, 62, 64.5);

  const totalMemory = Number(base.system?.memory?.total || 68719476736);
  const usedMemory = Math.round((memUsage / 100) * totalMemory);

  const nextSystem = {
    ...base.system,
    cpu: {
      ...base.system?.cpu,
      load: Number(cpuLoad.toFixed(1)),
      temperature: clamp(38 + cpuLoad * 0.2, 34, 65)
    },
    memory: {
      ...base.system?.memory,
      usagePercent: Number(memUsage.toFixed(1)),
      used: usedMemory,
      free: Math.max(totalMemory - usedMemory, 0)
    },
    network: [
      {
        ...(base.system?.network?.[0] || {}),
        rxSec: Math.round(netRx),
        txSec: Math.round(netTx)
      }
    ],
    networkHealth: (base.system?.networkHealth || []).map((item, index) => {
      if (index !== 0) {
        return item;
      }
      return {
        ...item,
        rxSec: Math.round(netRx),
        txSec: Math.round(netTx)
      };
    }),
    history: {
      ...(base.system?.history || {}),
      cpuLoad: withHistoryPoint(base.system?.history?.cpuLoad, Number(cpuLoad.toFixed(2))),
      memoryUsage: withHistoryPoint(base.system?.history?.memoryUsage, Number(memUsage.toFixed(2))),
      networkThroughput: withHistoryPoint(base.system?.history?.networkThroughput, Number((netRx / 1048576).toFixed(2))),
      arrayUsage: withHistoryPoint(base.system?.history?.arrayUsage, Number(arrayUsage.toFixed(2)))
    }
  };

  const nextStorageInsights = {
    ...(base.storageInsights || {}),
    timestamp: now,
    deviceGroups: (base.storageInsights?.deviceGroups || []).map((group) => {
      if (group.key !== "array") {
        return group;
      }
      const total = Number(group.summary?.totalBytes || 8000000000000);
      const used = Math.round((arrayUsage / 100) * total);
      return {
        ...group,
        summary: {
          ...group.summary,
          usedBytes: used,
          freeBytes: Math.max(total - used, 0),
          usagePercent: Number(arrayUsage.toFixed(2))
        }
      };
    })
  };

  return {
    ...base,
    system: nextSystem,
    storageInsights: nextStorageInsights
  };
}
