import { createUpstashRedis } from "@upstash/redis";

export const redis = createUpstashRedis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});