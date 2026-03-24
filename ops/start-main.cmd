@echo off
cd /d D:\code\CodexMob
if not exist .next\BUILD_ID (
  call npm run build >> D:\code\CodexMob\.run-main-build.log 2>&1
)
set NODE_ENV=production
set PORT=3000
npm run start >> D:\code\CodexMob\.run-main.log 2>&1
