# VOY 알림 (VOY Push) — 설정 가이드

휴대폰 잠금화면에 **앱 아이콘 + 제목 + 내용** 형태의 알림을 보내고, 누르면 지정한 링크로 이동하는 시스템입니다.
GitHub Pages + Supabase 무료 플랜만으로 동작합니다.

```
voypush/
├─ index.html        구독 페이지 (직원들이 접속해서 "알림 받기")
├─ admin.html        관리자 발송 페이지 (제목·내용·링크 입력 → 보내기)
├─ setup.html        키 생성기 (최초 1회)
├─ sw.js             서비스워커 (알림 표시 / 클릭 시 링크 이동)
├─ config.js         ★ 설정값 (여기만 수정)
├─ manifest.json     앱 이름·아이콘 (홈 화면 설치용)
├─ icons/            ★ 아이콘 교체
└─ supabase/
   ├─ schema.sql                 DB 테이블
   └─ functions/push/index.ts    발송 서버 (Edge Function)
```

---

## 1. 아이콘 교체 (icons 폴더)

| 파일 | 크기 | 용도 |
|---|---|---|
| `icon-192.png` | 192×192 | 앱 아이콘, 안드로이드 알림 아이콘 |
| `icon-512.png` | 512×512 | 앱 아이콘 (고해상도) |
| `apple-touch-icon.png` | 180×180 | **아이폰 홈 화면·잠금화면 알림 아이콘** (투명 배경 X, 꽉 찬 사각형) |
| `badge-72.png` | 72×72 | 안드로이드 상단바 작은 아이콘 (**흰색 실루엣 + 투명 배경**) |

파일 이름을 그대로 유지한 채 덮어쓰면 됩니다.

## 2. GitHub에 올리기

1. 새 저장소 생성 (예: `voypush`) → 폴더 내용 전체 업로드 (`supabase` 폴더는 올려도 무방)
2. Settings → Pages → Branch `main` / root → Save
3. (선택) Custom domain: `push.ourclinic.kr` → DNS에 CNAME `mujjinhwan-prog.github.io` 추가
4. **Enforce HTTPS 체크** (푸시는 HTTPS에서만 동작)

## 3. 키 만들기

배포된 주소의 `/setup.html` 을 PC 크롬에서 열고 **키 만들기** → 3개 값을 메모장에 보관

- `VAPID_PUBLIC_KEY` — 공개키 (config.js에도 넣음)
- `VAPID_PRIVATE_KEY` — 개인키 (**Supabase에만**, GitHub 금지)
- `ADMIN_KEY` — 관리자 비밀번호

## 4. Supabase 설정

기존 프로젝트를 써도 되고 새로 만들어도 됩니다.

1. **SQL Editor** → `supabase/schema.sql` 내용 붙여넣기 → Run
2. **Edge Functions** → *Deploy a new function* → *Via Editor*
   - 함수 이름: **`push`** (정확히)
   - `supabase/functions/push/index.ts` 내용 전체 붙여넣기 → Deploy
3. 함수 상세 → **Details/Settings** → **Enforce JWT Verification 끄기** → Save
4. **Edge Functions → Secrets** 에 4개 추가

   | Name | Value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | 3번의 공개키 |
   | `VAPID_PRIVATE_KEY` | 3번의 개인키 |
   | `VAPID_SUBJECT` | `mailto:본인이메일` |
   | `ADMIN_KEY` | 3번의 관리자 키 |

## 5. config.js 수정 → 다시 커밋

```js
APP_NAME: "VOY 알림",
SUPABASE_URL: "https://xxxx.supabase.co",          // Project Settings > API
SUPABASE_ANON_KEY: "eyJ... 또는 sb_publishable_...",
VAPID_PUBLIC_KEY: "B... (공개키)",
GROUPS: ["1팀","2팀","3팀","4팀","5팀","본사"],      // 필요 없으면 []
```

잠금화면 굵은 글씨(앱 이름)를 바꾸려면 `manifest.json` 의 `name`, `short_name` 과
`index.html` 의 `apple-mobile-web-app-title` 도 같이 바꾸세요.

## 6. 휴대폰에서 구독

**아이폰 (iOS 16.4 이상)**
1. Safari로 `https://push.ourclinic.kr` 접속
2. 공유 버튼 → **홈 화면에 추가**
3. 홈 화면의 아이콘으로 열기 → **알림 받기** → 허용
4. **테스트 알림 받기**로 확인

**안드로이드** — Chrome(또는 삼성 인터넷)으로 접속 → 알림 받기 → 허용 (설치는 선택)

> 카카오톡으로 링크를 공유하면 카톡 내부 브라우저로 열리는데, 페이지가 자동으로 "기본 브라우저로 열기" 버튼을 보여줍니다.

## 7. 발송

`/admin.html` → ADMIN_KEY 입력 → 제목·내용·링크·대상 입력 → **보내기**(두 번 클릭)
보낸 알림별 성공/실패/클릭 수가 기록되고, 만료된 구독은 자동으로 정리됩니다.

---

## 알아둘 점

- **아이폰 알림 아이콘은 항상 홈 화면 앱 아이콘**입니다 (알림마다 바꿀 수 없음, iOS 정책). 안드로이드는 알림마다 아이콘·큰 이미지를 바꿀 수 있습니다.
- 아이폰은 홈 화면에 추가한 뒤에만 알림이 옵니다. 앱을 삭제하면 구독도 사라집니다.
- 휴대폰이 꺼져 있으면 최대 24시간 동안 보관했다가 켜질 때 전달됩니다.
- 비용: Supabase 무료 플랜 Edge Function 월 50만 회 호출 — 수백 명 규모 공지에는 충분합니다.
- `setup.html` 은 키를 만든 뒤 지워도 됩니다. 키를 다시 만들면 기존 구독자 전원이 재구독해야 합니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| "설정 실패: Failed to fetch" | config.js의 SUPABASE_URL / 함수 이름 `push` / JWT Verification 꺼짐 |
| 401 관리자 키 오류 | Secrets의 ADMIN_KEY와 입력값 일치 여부 (앞뒤 공백) |
| 발송 성공 0, 실패 다수 | VAPID 공개키가 config.js와 Secret에서 **같은 값**인지 |
| 아이폰에서 "알림 받기" 버튼이 안 보임 | Safari로 홈 화면에 추가했는지, iOS 16.4 이상인지 |
| 아이콘이 안 바뀜 | 홈 화면 앱 삭제 후 다시 추가 (iOS는 설치 시점 아이콘 고정) |
