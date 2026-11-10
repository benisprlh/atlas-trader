declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ANALYST_API_KEY?: string;
    ANALYST_API_URL?: string;
    ANALYST_MODEL?: string;
  }
}
