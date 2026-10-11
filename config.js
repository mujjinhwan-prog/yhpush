// =====================================================================
//  VOY Push 설정 — 이 파일만 수정하면 됩니다
//  (페이지와 서비스워커가 함께 읽으므로 window 대신 self 를 사용)
// =====================================================================
self.PUSH_CONFIG = {
  // 잠금화면 알림에 표시되는 앱 이름은 manifest.json 의 "name" 도 같이 바꿔주세요
 APP_NAME: "YH Push",APP_NAME: "YH Push",

  // Supabase 대시보드 > Project Settings > API
  SUPABASE_URL: "https://iloybfyzbjslcvtpvctv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_UWOW8stjS7zwEzrNMdIphA_G1fuZssA",

  // setup.html 에서 만든 "공개키(Public Key)" — 개인키는 절대 여기에 넣지 마세요
  VAPID_PUBLIC_KEY: "BHpnmKBCEPCr9YehzeluvE_1Igh_GXnwnLt32dXpwHe62KxHzFv76GCnuRQVsIUGhLlpSgJmmRotUXKCGUR42jM",

  // 구독자가 고를 수 있는 그룹 (비워두면 [] → 그룹 선택칸이 숨겨짐)
  GROUPS: ["1팀", "2팀", "3팀", "4팀", "5팀", "본사"],

  // 알림 기본 아이콘 (icons 폴더의 파일을 교체하면 됩니다)
  DEFAULT_ICON: "icons/icon-192.png",
};
