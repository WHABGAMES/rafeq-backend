/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║                    RAFIQ PLATFORM - Configuration                              ║
 * ║                                                                                ║
 * ║  📌 هذا الملف يجمع كل Environment Variables في مكان واحد                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

export default () => ({
  // ═══════════════════════════════════════════════════════════════════════════════
  // 🌍 APPLICATION
  // ═══════════════════════════════════════════════════════════════════════════════
  app: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    apiBaseUrl: process.env.API_BASE_URL || 'https://api.rafeq.ai',
    frontendUrl: process.env.FRONTEND_URL || 'https://rafeq.ai',
    secret: process.env.APP_SECRET || 'default-secret-change-me',
    
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isStaging: process.env.NODE_ENV === 'staging',
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🗄️ DATABASE (PostgreSQL)
  // ═══════════════════════════════════════════════════════════════════════════════
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'rafiq_db',
    username: process.env.DB_USERNAME || 'rafiq_user',
    password: process.env.DB_PASSWORD || 'rafiq_secure_password_123',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true',
    ssl: process.env.DB_SSL === 'true',
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔴 REDIS
  // ═══════════════════════════════════════════════════════════════════════════════
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔐 JWT
  // ═══════════════════════════════════════════════════════════════════════════════
  jwt: {
    secret: process.env.JWT_SECRET || 'jwt-secret-change-me',
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛒 SALLA
  // ═══════════════════════════════════════════════════════════════════════════════
  salla: {
    clientId: process.env.SALLA_CLIENT_ID || '',
    clientSecret: process.env.SALLA_CLIENT_SECRET || '',
    webhookSecret: process.env.SALLA_WEBHOOK_SECRET || '',
    oauthCallbackUrl: process.env.SALLA_OAUTH_CALLBACK_URL || 'https://api.rafeq.ai/api/stores/salla/callback',
    redirectUri: process.env.SALLA_OAUTH_CALLBACK_URL || 'https://api.rafeq.ai/api/stores/salla/callback',
    apiUrl: process.env.SALLA_API_URL || 'https://api.salla.dev/admin/v2',
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🏪 ZID
  // ═══════════════════════════════════════════════════════════════════════════════
  zid: {
    clientId: process.env.ZID_CLIENT_ID || '',
    clientSecret: process.env.ZID_CLIENT_SECRET || '',
    webhookSecret: process.env.ZID_WEBHOOK_SECRET || '',
    oauthCallbackUrl: process.env.ZID_OAUTH_CALLBACK_URL || 'https://api.rafeq.ai/api/stores/zid/callback',
    redirectUri: process.env.ZID_OAUTH_CALLBACK_URL || 'https://api.rafeq.ai/api/stores/zid/callback',
    apiUrl: process.env.ZID_API_URL || 'https://api.zid.sa/v1',
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📱 WHATSAPP
  // ═══════════════════════════════════════════════════════════════════════════════
  whatsapp: {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎮 DISCORD
  // ═══════════════════════════════════════════════════════════════════════════════
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    applicationId: process.env.DISCORD_APPLICATION_ID || '',
    publicKey: process.env.DISCORD_PUBLIC_KEY || '',
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🤖 AI (OpenAI)
  // ═══════════════════════════════════════════════════════════════════════════════
  ai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '1000', 10),
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 💳 BILLING
  // ═══════════════════════════════════════════════════════════════════════════════
  billing: {
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || '',
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    },
    moyasar: {
      secretKey: process.env.MOYASAR_SECRET_KEY || '',
      publishableKey: process.env.MOYASAR_PUBLISHABLE_KEY || '',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📧 EMAIL
  // ═══════════════════════════════════════════════════════════════════════════════
  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromName: process.env.SMTP_FROM_NAME || 'Rafiq Platform',
    fromEmail: process.env.SMTP_FROM_EMAIL || 'noreply@rafeq.ai',
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📊 MONITORING
  // ═══════════════════════════════════════════════════════════════════════════════
  monitoring: {
    sentryDsn: process.env.SENTRY_DSN || '',
    logLevel: process.env.LOG_LEVEL || 'debug',
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🔒 SECURITY
  // ═══════════════════════════════════════════════════════════════════════════════
  security: {
    corsOrigins: (process.env.CORS_ORIGINS || 'https://rafeq.ai,https://www.rafeq.ai')
      .split(',')
      .map((origin) => origin.trim()),
    rateLimitTtl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 📁 STORAGE
  // ═══════════════════════════════════════════════════════════════════════════════
  storage: {
    type: process.env.STORAGE_TYPE || 'local',
    s3: {
      endpoint: process.env.S3_ENDPOINT || '',
      bucket: process.env.S3_BUCKET || '',
      accessKey: process.env.S3_ACCESS_KEY || '',
      secretKey: process.env.S3_SECRET_KEY || '',
      region: process.env.S3_REGION || 'us-east-1',
    },
  },
});
