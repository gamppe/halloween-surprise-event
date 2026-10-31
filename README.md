# 🎃 할로윈 깜짝 이벤트

디스코드 계정당 한 번, 누구나 플링코(공 5개)를 하고 점수 상위 20명이 선물을 받는 GitHub Pages 사이트.

- 결과는 Supabase DB 함수(`play()`)가 서버에서 랜덤으로 정함 → 클라이언트 조작 불가
- 참가 마감 20:50 KST, 순위 공개 21:00 KST (`event_config` 테이블에서 변경)
- 동점은 먼저 플레이한 사람이 상위
- `?demo`를 붙이면 저장 없이 데모 플레이

## 선물

| 등수 | 선물 |
|---|---|
| 1 | 데바데 DLC |
| 2–3 | 골드바렌 |
| 4–9 | 새콤달콤 |
| 10–20 | 츄파춥스 |

## 설정

1. Supabase 프로젝트 생성 → SQL Editor에서 `supabase/schema.sql` 실행
2. Discord Developer Portal에서 앱 생성 → OAuth2 Redirect에 `https://<project>.supabase.co/auth/v1/callback` 추가
3. Supabase Authentication → Providers → Discord에 Client ID/Secret 입력
4. Supabase Authentication → URL Configuration의 Site URL을 `https://gamppe.github.io/halloween-surprise-event/`로
5. `config.js`에 Supabase URL과 anon key 입력

## 운영

- 참가자 확인: Supabase Table Editor → `players`
- 시간 변경: `update event_config set close_at = '...', reveal_at = '...';`
