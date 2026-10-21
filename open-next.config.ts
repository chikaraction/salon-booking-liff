// OpenNext(Cloudflare)の設定。全ページが動的で ISR/SSG を使わないので、
// 既定(incrementalCache・tagCache・queue すべて dummy)のまま使う
// (node_modules/@opennextjs/cloudflare/dist/api/config.js)。
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
