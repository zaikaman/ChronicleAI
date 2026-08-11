import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, 'apps', 'api', '.env');
const srcDir = path.join(projectRoot, 'workflows', 'keeperhub');
const dstDir = path.join(projectRoot, 'workflows', 'keeperhub-ready');

// Parse .env
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envContent.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const match = trimmed.match(/^([^=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
}

const telegramChatId = env.TELEGRAM_INGEST_CHAT_ID || env.TELEGRAM_CHAT_ID || '';
const deskWalletAddress = env.DESK_WALLET_ADDRESS || '';
const chronicleRegistryAddress = env.CHRONICLE_REGISTRY_ADDRESS || '';
const chronicleApiOrigin = env.CHRONICLE_API_ORIGIN || '';
const marketplaceBridgeSecret = env.KEEPERHUB_MARKETPLACE_BRIDGE_SECRET || '';

console.log('Values from apps/api/.env:');
console.log(`- TELEGRAM_INGEST_CHAT_ID: ${telegramChatId}`);
console.log(`- DESK_WALLET_ADDRESS: ${deskWalletAddress}`);
console.log(`- CHRONICLE_REGISTRY_ADDRESS: ${chronicleRegistryAddress}`);
console.log(`- CHRONICLE_API_ORIGIN: ${chronicleApiOrigin}`);
console.log(`- KEEPERHUB_MARKETPLACE_BRIDGE_SECRET: ${marketplaceBridgeSecret ? '[configured]' : '[missing]'}`);

if (!fs.existsSync(dstDir)) {
  fs.mkdirSync(dstDir, { recursive: true });
}

const files = fs.readdirSync(srcDir);
let processedCount = 0;

for (const file of files) {
  const srcFilePath = path.join(srcDir, file);
  const dstFilePath = path.join(dstDir, file);
  
  if (fs.statSync(srcFilePath).isDirectory()) continue;
  
  let content = fs.readFileSync(srcFilePath, 'utf-8');
  
  if (file.endsWith('.json') || file.endsWith('.md')) {
    if (telegramChatId) {
      content = content.replaceAll('YOUR_TELEGRAM_INGEST_CHAT_ID', telegramChatId);
    }
    if (deskWalletAddress) {
      content = content.replaceAll('0x0000000000000000000000000000000000000001', deskWalletAddress);
    }
    if (chronicleRegistryAddress) {
      content = content.replaceAll('YOUR_CHRONICLE_REGISTRY_ADDRESS', chronicleRegistryAddress);
    }
    if (chronicleApiOrigin) {
      content = content.replaceAll('YOUR_CHRONICLE_API_ORIGIN', chronicleApiOrigin.replace(/\/$/, ''));
    }
    if (marketplaceBridgeSecret) {
      content = content.replaceAll('YOUR_KEEPERHUB_MARKETPLACE_BRIDGE_SECRET', marketplaceBridgeSecret);
    }
  }
  
  fs.writeFileSync(dstFilePath, content, 'utf-8');
  processedCount++;
}

console.log(`Successfully processed ${processedCount} files in workflows/keeperhub-ready.`);
