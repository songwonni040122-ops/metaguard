#!/usr/bin/env bash
# MetaGuard → Vercel 배포. .env.local 의 환경변수를 프로덕션에 등록하고 배포한다.
# 사용법:  VERCEL_TOKEN=xxxxx bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

: "${VERCEL_TOKEN:?VERCEL_TOKEN 환경변수를 설정하세요 (https://vercel.com/account/tokens)}"
V() { npx vercel --token "$VERCEL_TOKEN" --yes "$@"; }

echo "▶ 프로젝트 링크(없으면 생성)…"
V link --project metaguard >/dev/null

echo "▶ 환경변수 등록(production)…"
while IFS='=' read -r k val; do
  case "$k" in ''|\#*) continue;; esac
  [ -z "${val:-}" ] && { echo "  · $k (빈 값, 건너뜀)"; continue; }
  V env rm "$k" production >/dev/null 2>&1 || true
  printf '%s' "$val" | V env add "$k" production >/dev/null
  echo "  · $k ✓"
done < .env.local

echo "▶ 프로덕션 배포…"
V deploy --prod
echo "✅ 완료"
