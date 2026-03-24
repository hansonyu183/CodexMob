@echo off
cd /d D:\code\CodexMob
set NEXT_BASE_PATH=/dev
set NEXT_DIST_DIR=.next-dev
if not exist .next-dev\BUILD_ID (
  call npm run build >> D:\code\CodexMob\.run-dev-build.log 2>&1
)
set NODE_ENV=production
set PORT=3001
npm run start >> D:\code\CodexMob\.run-dev3001.log 2>&1
