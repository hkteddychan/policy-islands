/* ============ 01 · DATA + helpers ============ */
const LANG = (new URLSearchParams(location.search).get('lang') === 'en') ? 'en' : 'zh';
const tr = (o) => (typeof o === 'string') ? o : (LANG === 'en' ? (o.en || o.zh) : o.zh);
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const RNG = mulberry(20261023);
const rnd = (a = 0, b = 1) => a + RNG() * (b - a);
// value noise + fbm
const PERM = new Uint8Array(512);
(function () { const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i; for (let i = 255; i > 0; i--) { const j = (RNG() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; })();
function vnoise(x, y) {
  const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const aa = PERM[PERM[xi] + yi] / 255, ba = PERM[PERM[xi + 1] + yi] / 255;
  const ab = PERM[PERM[xi] + yi + 1] / 255, bb = PERM[PERM[xi + 1] + yi + 1] / 255;
  return lerp(lerp(aa, ba, u), lerp(ab, bb, u), v);
}
function fbm(x, y) { let a = 0, amp = .5, f = 1; for (let i = 0; i < 4; i++) { a += amp * vnoise(x * f, y * f); f *= 2; amp *= .5; } return a; }

/* ---------- palette ---------- */
const PAL = {
  coral: 0xdb6a41, ink: 0x211d1d, cream: 0xfff8f4, yellow: 0xfcea8b, stone: 0xc5b5a7, green: 0x71806a,
  glass: 0x86a8a6, wood: 0xb48560, teal: 0x3e7c8c,
  plant: [0x9cc27a, 0x8db86f, 0x728f5f], pastel: [0xf2b5c6, 0x58a6a6, 0x6f7fb5],
  wall: 0xf4ebdd, eave: 0xa34e34, win: 0xa8c4c2, night: 0xffc777,
  metal: 0xc9c2b6
};

/* ---------- islands ---------- */
const ISLANDS = [
  { id: 'hub', no: '00', icon: '🏛️', name: { zh: '市政', en: 'Civic' }, color: 0xc5b5a7, ang: null,
    summary: { zh: '中央市政廳把六座政策島接在一起：所有跨部門文件、撥款同覆核都在這裡出發。', en: 'The central city hall links all six policy islands: cross-department paperwork, funding and sign-off all start here.' } },
  { id: 'transport', no: '01', icon: '🚌', name: { zh: '交通', en: 'Transport' }, color: 0xdb6a41, ang: -90,
    summary: { zh: '巴士、單車同步行網絡構成城市的血液。呢度決定幾多人 15 分鐘內到得到診所同學校。', en: 'Bus, cycling and walking networks are the city bloodstream — they decide how many people reach a clinic or school within 15 minutes.' } },
  { id: 'education', no: '02', icon: '📚', name: { zh: '教育', en: 'Education' }, color: 0x6f7fb5, ang: -30,
    summary: { zh: '學校、圖書館同技能證書島。每一張證書都會變成另一座島上面嘅工作機會。', en: 'Schools, libraries and skills certificates. Every certificate becomes a job opportunity on another island.' } },
  { id: 'health', no: '03', icon: '🏥', name: { zh: '醫療', en: 'Health' }, color: 0x58a6a6, ang: 30,
    summary: { zh: '社區診所、康復宿舍同長者照護預算。數據同物資每日都靠協作線送過嚟。', en: 'Community clinics, recovery housing and elder-care budgets — data and supplies arrive daily along the flows.' } },
  { id: 'housing', no: '04', icon: '🏠', name: { zh: '房屋', en: 'Housing' }, color: 0xb48560, ang: 90,
    summary: { zh: '屋邨、配額同社區農圃。住屋決定咩家庭幾多錢剩返俾交通同教育。', en: 'Estates, quotas and community gardens — housing decides how much of a family budget is left for transport and education.' } },
  { id: 'environment', no: '05', icon: '🌳', name: { zh: '環境', en: 'Environment' }, color: 0x71806a, ang: 150,
    summary: { zh: '河道、綠化同單車網絡。碳數據每日送入交通島，影響下一輪路線規劃。', en: 'Rivers, greening and the cycle network — carbon data lands on the transport island every day and shapes the next route plan.' } },
  { id: 'economy', no: '06', icon: '💰', name: { zh: '經濟', en: 'Economy' }, color: 0xf2b5c6, ang: 210,
    summary: { zh: '稅收、就業同市場攤位。經濟島的數字會變成其他五座島嘅撥款。', en: 'Tax, jobs and market stalls. Numbers here become budget lines on the other five islands.' } }
];

/* ---------- items (細項) ---------- */
const ITEMS = {
  'h1': { isl: 'hub', no: 1, name: { zh: '市政廳', en: 'City Hall' }, model: 'hall', active: [360, 1080], src: '市政署 2026 年報', freq: '每日',
    facts: [
      { v: '42', u: { zh: '項', en: '' }, k: { zh: '在跟政策', en: 'policies tracked' } },
      { v: '128', u: { zh: '億', en: 'bn' }, k: { zh: '年度公共開支', en: 'annual spend' } },
      { v: '6', u: { zh: '座', en: '' }, k: { zh: '對接政策島', en: 'islands linked' } }
    ],
    timeline: [
      { d: '2024 Q4', t: { zh: '市政廳完成電子收件箱整合', en: 'Electronic intake fully integrated' } },
      { d: '2025 Q3', t: { zh: '跨部門檔案交換平台啟用', en: 'Cross-department file exchange went live' } },
      { d: '2026 Q2', t: { zh: '覆核時限由 45 日縮至 21 日', en: 'Sign-off window cut from 45 to 21 days' } }
    ] },
  'h2': { isl: 'hub', no: 2, name: { zh: '巨型時鐘', en: 'Clock Tower' }, model: 'clock', active: [0, 1440], src: '市政署設施組 2026 統計', freq: '每日',
    facts: [
      { v: '24', u: { zh: '小時', en: 'h' }, k: { zh: '運作時段', en: 'hours running' } },
      { v: '6', u: { zh: '次', en: '' }, k: { zh: '每日整點報時', en: 'chimes per day' } }
    ],
    timeline: [{ d: '2025 Q1', t: { zh: '時鐘塔修復完成，重設統一時制', en: 'Tower restored, single time standard adopted' } }] },
  'h3': { isl: 'hub', no: 3, name: { zh: '市民舞台', en: 'Civic Stage' }, model: 'stage', active: [1080, 1320], src: '民政事務處 2026 季報', freq: '每月',
    facts: [
      { v: '1,200', u: { zh: '人', en: '' }, k: { zh: '最大容量', en: 'max capacity' } },
      { v: '18', u: { zh: '場', en: '' }, k: { zh: '每月公眾諮詢會', en: 'public forums / month' } }
    ],
    timeline: [{ d: '2025 Q4', t: { zh: '舞台改為政策發布與公眾質詢用途', en: 'Stage repurposed for policy briefings and Q&A' } }] },

  't1': { isl: 'transport', no: 1, name: { zh: '巴士總站', en: 'Bus Terminus' }, model: 'busstop', active: [300, 1320], src: '運輸署 2026 年報', freq: '每日',
    facts: [
      { v: '23', u: { zh: '站', en: '' }, k: { zh: '覆蓋巴士站', en: 'bus stops covered' } },
      { v: '8', u: { zh: '分鐘', en: 'min' }, k: { zh: '平均班距', en: 'average headway' } },
      { v: '68', u: { zh: '%', en: '' }, k: { zh: '公共交通使用率', en: 'public transport share' } }
    ],
    timeline: [
      { d: '2024 Q2', t: { zh: '首條跨境接駁線開通', en: 'First cross-boundary feeder route launched' } },
      { d: '2025 Q3', t: { zh: '全站加裝實時到站牌', en: 'Live arrival boards at every stop' } },
      { d: '2026 Q1', t: { zh: '高峰班次加密 15%', en: 'Peak frequency up 15%' } }
    ] },
  't2': { isl: 'transport', no: 2, name: { zh: '單車徑', en: 'Cycle Network' }, model: 'bike', active: [360, 1320], src: '運輸署單車網絡統計 2026', freq: '每週',
    facts: [
      { v: '31', u: { zh: '公里', en: 'km' }, k: { zh: '鋪設單車徑', en: 'cycle track built' } },
      { v: '4,200', u: { zh: '部', en: '' }, k: { zh: '每日單車流量', en: 'daily bike trips' } },
      { v: '12', u: { zh: '分鐘', en: 'min' }, k: { zh: '平均接駁時間', en: 'average transfer time' } }
    ],
    timeline: [
      { d: '2025 Q1', t: { zh: '單車徑與學校交通環接駁', en: 'Cycle track linked to school feeder loop' } },
      { d: '2026 Q2', t: { zh: '增設 900 個單車泊位', en: '900 new bike parking bays added' } }
    ] },
  't3': { isl: 'transport', no: 3, name: { zh: '交通亭', en: 'Transit Kiosk' }, model: 'pavilion', active: [300, 1380], src: '運輸署乘客服務季報 2026', freq: '每月',
    facts: [
      { v: '9', u: { zh: '座', en: '' }, k: { zh: '交滙亭', en: 'interchange kiosks' } },
      { v: '11', u: { zh: '種', en: '' }, k: { zh: '語言提示', en: 'languages announced' } }
    ],
    timeline: [{ d: '2026 Q3', t: { zh: '亭內加入實時行程規劃機', en: 'Real-time journey planner installed in kiosks' } }] },

  'e1': { isl: 'education', no: 1, name: { zh: '社區教室', en: 'Community Classroom' }, model: 'classroom', active: [480, 1080], src: '教育局社區學習統計 2026', freq: '每季',
    facts: [
      { v: '1,860', u: { zh: '人', en: '' }, k: { zh: '在讀學生', en: 'students enrolled' } },
      { v: '14', u: { zh: '間', en: '' }, k: { zh: '夜間自修室', en: 'evening study rooms' } },
      { v: '92', u: { zh: '%', en: '' }, k: { zh: '升學率', en: 'further-study rate' } }
    ],
    timeline: [
      { d: '2024 Q3', t: { zh: '夜校課程擴展至 14 間自修室', en: 'Evening classes expanded to 14 study rooms' } },
      { d: '2025 Q4', t: { zh: '引入跨島實習配對計劃', en: 'Cross-island internship matching introduced' } }
    ] },
  'e2': { isl: 'education', no: 2, name: { zh: '巨型書庫', en: 'Great Library' }, model: 'book', active: [540, 1260], src: '教育局圖書館年報 2026', freq: '每月',
    facts: [
      { v: '320', u: { zh: '萬冊', en: '' }, k: { zh: '館藏', en: 'volumes held' } },
      { v: '54', u: { zh: '間', en: '' }, k: { zh: '社區借閱點', en: 'community lending points' } }
    ],
    timeline: [{ d: '2025 Q2', t: { zh: '流動圖書車覆蓋偏遠社區', en: 'Mobile library vans reach remote communities' } }] },
  'e3': { isl: 'education', no: 3, name: { zh: '技能地球儀', en: 'Skills Globe' }, model: 'globe', active: [420, 1200], src: '教育局資歷認證季報 2026', freq: '每季',
    facts: [
      { v: '37', u: { zh: '項', en: '' }, k: { zh: '課程認證', en: 'certifications' } },
      { v: '76', u: { zh: '%', en: '' }, k: { zh: '完成率', en: 'completion rate' } }
    ],
    timeline: [{ d: '2026 Q1', t: { zh: '技能證書與經濟島職位系統互通', en: 'Skill certificates now link to economy island jobs' } }] },

  'm1': { isl: 'health', no: 1, name: { zh: '社區診所', en: 'Community Clinic' }, model: 'clinic', active: [480, 1260], src: '衞生署基層醫療年報 2026', freq: '每日',
    facts: [
      { v: '12', u: { zh: '間', en: '' }, k: { zh: '社區診所', en: 'community clinics' } },
      { v: '15', u: { zh: '分鐘', en: 'min' }, k: { zh: '平均輪候', en: 'average wait' } },
      { v: '41,000', u: { zh: '人次', en: '' }, k: { zh: '年度就診', en: 'visits per year' } }
    ],
    timeline: [
      { d: '2024 Q4', t: { zh: '跨島電子病歷互通試點', en: 'Cross-island e-record pilot launched' } },
      { d: '2025 Q3', t: { zh: '藥物配送納入夜診', en: 'Medication delivery added to night clinics' } }
    ] },
  'm2': { isl: 'health', no: 2, name: { zh: '康復宿舍', en: 'Recovery Housing' }, model: 'cottage', active: [0, 1440], src: '醫管局康復服務季報 2026', freq: '每月',
    facts: [
      { v: '86', u: { zh: '個', en: '' }, k: { zh: '宿位', en: 'beds' } },
      { v: '3', u: { zh: '個月', en: 'mo' }, k: { zh: '平均療程', en: 'average stay' } }
    ],
    timeline: [{ d: '2026 Q2', t: { zh: '與房屋島合辦長者安居單位', en: 'Joint elder housing units launched with housing island' } }] },
  'm3': { isl: 'health', no: 3, name: { zh: '健康站', en: 'Wellness Post' }, model: 'pavilion', active: [360, 1200], src: '衞生署社區健康統計 2026', freq: '每週',
    facts: [
      { v: '5', u: { zh: '站', en: '' }, k: { zh: '社區健康站', en: 'wellness posts' } },
      { v: '2,300', u: { zh: '人次', en: '' }, k: { zh: '年度免費篩查', en: 'free screenings / year' } }
    ],
    timeline: [{ d: '2025 Q4', t: { zh: '推廣高血壓與糖尿病篩查', en: 'Blood pressure and diabetes screening scaled up' } }] },

  'o1': { isl: 'housing', no: 1, name: { zh: '屋邨聯排', en: 'Estate Row' }, model: 'cottage', active: [0, 1440], src: '房屋署屋邨統計年報 2026', freq: '每月',
    facts: [
      { v: '2,640', u: { zh: '戶', en: '' }, k: { zh: '單位', en: 'units' } },
      { v: '31', u: { zh: '個月', en: 'mo' }, k: { zh: '平均輪候', en: 'average wait' } },
      { v: '2.4', u: { zh: '人', en: '' }, k: { zh: '平均戶人數', en: 'avg household size' } }
    ],
    timeline: [
      { d: '2024 Q2', t: { zh: '首批 640 單位入伙', en: 'First 640 units occupied' } },
      { d: '2026 Q1', t: { zh: '輪候時間首次降至 31 個月', en: 'Wait time falls to 31 months for the first time' } }
    ] },
  'o2': { isl: 'housing', no: 2, name: { zh: '屋邨球場', en: 'Estate Courts' }, model: 'court', active: [360, 1320], src: '康文署場地預約季報 2026', freq: '每週',
    facts: [
      { v: '8', u: { zh: '個', en: '' }, k: { zh: '球場', en: 'courts' } },
      { v: '2,700', u: { zh: '人次', en: '' }, k: { zh: '每月預約', en: 'bookings / month' } }
    ],
    timeline: [{ d: '2025 Q3', t: { zh: '場地預約系統與健康島共用', en: 'Booking system shared with the health island' } }] },
  'o3': { isl: 'housing', no: 3, name: { zh: '社區農圃', en: 'Community Garden' }, model: 'farm', active: [360, 1200], src: '房屋署社區農圃年報 2026', freq: '每季',
    facts: [
      { v: '96', u: { zh: '幅', en: '' }, k: { zh: '租出地段', en: 'allocated plots' } },
      { v: '1,120', u: { zh: '公斤', en: 'kg' }, k: { zh: '年度收成', en: 'produce per year' } }
    ],
    timeline: [{ d: '2026 Q1', t: { zh: '農圃剩餘送社區食堂', en: 'Surplus produce routed to community kitchens' } }] },

  'v1': { isl: 'environment', no: 1, name: { zh: '淨化河道', en: 'Clean River' }, model: 'bridge', active: [0, 1440], src: '環保署河道水質年報 2026', freq: '每日',
    facts: [
      { v: '18', u: { zh: '公里', en: 'km' }, k: { zh: '復綠河道', en: 'river restored' } },
      { v: '3.2', u: { zh: '噸', en: '' }, k: { zh: '每日減碳', en: 'CO2 cut per day' } },
      { v: '7', u: { zh: '座', en: '' }, k: { zh: '行人橋', en: 'footbridges' } }
    ],
    timeline: [
      { d: '2024 Q3', t: { zh: '河道復綠第一階段完成', en: 'River greening phase one completed' } },
      { d: '2026 Q2', t: { zh: '碳數據接入交通島規劃系統', en: 'Carbon data feeds the transport planning system' } }
    ] },
  'v2': { isl: 'environment', no: 2, name: { zh: '林蔭廣場', en: 'Shaded Plaza' }, model: 'court', active: [360, 1320], src: '環保署綠化統計 2026', freq: '每月',
    facts: [
      { v: '1,900', u: { zh: '棵', en: '' }, k: { zh: '新種樹木', en: 'trees planted' } },
      { v: '3.6', u: { zh: '°C', en: '°C' }, k: { zh: '降溫幅度', en: 'cooling effect' } }
    ],
    timeline: [{ d: '2025 Q2', t: { zh: '社區農圃與林蔭廣場合併管理', en: 'Community gardens merged under one green programme' } }] },
  'v3': { isl: 'environment', no: 3, name: { zh: '回收站', en: 'Recycling Point' }, model: 'pavilion', active: [300, 1320], src: '環保署回收統計季報 2026', freq: '每週',
    facts: [
      { v: '4,900', u: { zh: '噸', en: 't' }, k: { zh: '年度回收量', en: 'recycled per year' } },
      { v: '52', u: { zh: '%', en: '' }, k: { zh: '分類回收率', en: 'sorted recycling rate' } }
    ],
    timeline: [{ d: '2026 Q3', t: { zh: '玻璃回收接入經濟島回收商', en: 'Glass recycling linked to economy island dealers' } }] },

  'c1': { isl: 'economy', no: 1, name: { zh: '稅務大樓', en: 'Revenue House' }, model: 'coin', active: [480, 1140], src: '稅務局年報 2026', freq: '每月',
    facts: [
      { v: '1,240', u: { zh: '億', en: 'bn' }, k: { zh: '年度稅收', en: 'annual revenue' } },
      { v: '3.2', u: { zh: '%', en: '' }, k: { zh: '增長率', en: 'growth rate' } },
      { v: '9', u: { zh: '個月', en: 'mo' }, k: { zh: '平均退稅時間', en: 'refund turnaround' } }
    ],
    timeline: [
      { d: '2024 Q4', t: { zh: '電子報稅全面推行', en: 'Full e-filing rollout completed' } },
      { d: '2026 Q1', t: { zh: '退稅自動轉入房屋島配額評估', en: 'Refunds auto-feed housing quota assessment' } }
    ] },
  'c2': { isl: 'economy', no: 2, name: { zh: '工場與宿舍', en: 'Workshops & Hostels' }, model: 'cottage', active: [360, 1200], src: '勞工處就業統計 2026', freq: '每季',
    facts: [
      { v: '640', u: { zh: '個', en: '' }, k: { zh: '職位', en: 'jobs' } },
      { v: '74', u: { zh: '%', en: '' }, k: { zh: '本地聘用率', en: 'local hiring rate' } },
      { v: '48', u: { zh: '間', en: '' }, k: { zh: '僱員宿舍', en: 'hostel rooms' } }
    ],
    timeline: [{ d: '2025 Q4', t: { zh: '技能島證書直接對接職位', en: 'Education certificates now map directly to jobs' } }] },
  'c3': { isl: 'economy', no: 3, name: { zh: '市集攤位', en: 'Market Stalls' }, model: 'stall', active: [540, 1260], src: '食環署街市統計季報 2026', freq: '每週',
    facts: [
      { v: '210', u: { zh: '個', en: '' }, k: { zh: '攤位', en: 'stalls' } },
      { v: '1,050', u: { zh: '個', en: '' }, k: { zh: '檔口', en: 'vendors' } },
      { v: '4', u: { zh: '場', en: '' }, k: { zh: '每週墟市', en: 'markets per week' } }
    ],
    timeline: [{ d: '2026 Q2', t: { zh: '墟市食品空氣與碳排標準', en: 'Food market air and carbon standards applied' } }] }
};

/* ---------- flows (協作線) ---------- */
const FLOWS = [
  { id: 'f1', from: 'transport', to: 'education', kind: 'official', ev: 'A', updated: '2026 Q3', depts: 2, carry: { zh: '校車路線圖', en: 'school bus map' }, icon: 'bus',
    note: { zh: '交通局每學期按新校網更新校車路線，確保全校學生 15 分鐘內到校。', en: 'Transport updates school bus routes each term so every pupil is within 15 minutes of school.' } },
  { id: 'f2', from: 'education', to: 'health', kind: 'thematic', ev: 'B', updated: '2026 Q2', depts: 2, carry: { zh: '共享健康紀錄', en: 'shared health record' }, icon: 'cross',
    note: { zh: '學校健康組把學生病歷摘要送社區診所，轉介個案平均快 3 日。', en: 'School health teams send student case summaries to clinics — referral is 3 days faster.' } },
  { id: 'f3', from: 'health', to: 'housing', kind: 'official', ev: 'A', updated: '2026 Q2', depts: 3, carry: { zh: '社區診所名單', en: 'clinic directory' }, icon: 'building',
    note: { zh: '診所開位與長者宿位同步規劃，避免長者要跨區求醫。', en: 'Clinic slots and elder beds are planned together so nobody travels across districts for care.' } },
  { id: 'f4', from: 'housing', to: 'economy', kind: 'official', ev: 'A', updated: '2026 Q3', depts: 3, carry: { zh: '房屋配額數據', en: 'housing quota data' }, icon: 'home',
    note: { zh: '屋邨單位與工位數據互通，讓經濟島算出每個屋邨的就業承載力。', en: 'Unit and job counts are shared so the economy island can model employment capacity per estate.' } },
  { id: 'f5', from: 'economy', to: 'transport', kind: 'pending', ev: 'C', updated: '2026 Q1', depts: 2, carry: { zh: '隧道通行模型', en: 'tunnel traffic model' }, icon: 'coin',
    note: { zh: '隧道收費方案仍在評估，模型一旦確認就會變成交通島的路線改動。', en: 'The tunnel charging model is still under review; once confirmed it becomes a route change on the transport island.' } },
  { id: 'f6', from: 'environment', to: 'transport', kind: 'thematic', ev: 'B', updated: '2026 Q3', depts: 2, carry: { zh: '單車網絡規劃', en: 'cycle network plan' }, icon: 'bike',
    note: { zh: '環境島沿河道鋪設的單車徑直接接入交通島的接駁時間計算。', en: 'River-side cycle paths feed straight into the transport island transfer-time model.' } },
  { id: 'f7', from: 'transport', to: 'environment', kind: 'official', ev: 'A', updated: '2026 Q3', depts: 2, carry: { zh: '車流排放數據', en: 'traffic emission data' }, icon: 'bus',
    note: { zh: '每日車流數據回傳環境島，計算沿線空氣質素與碳排。', en: 'Daily traffic data flows back to the environment island for roadside air and carbon modelling.' } },
  { id: 'f8', from: 'education', to: 'economy', kind: 'thematic', ev: 'B', updated: '2026 Q2', depts: 3, carry: { zh: '技能證書', en: 'skills certificate' }, icon: 'book',
    note: { zh: '技能證書島的課程證書即時開放予經濟島的僱主查核。', en: 'Certificates issued on the skills island become instantly verifiable by employers on the economy island.' } },
  { id: 'f9', from: 'environment', to: 'housing', kind: 'official', ev: 'A', updated: '2026 Q1', depts: 2, carry: { zh: '綠化建築標準', en: 'green building standard' }, icon: 'tree',
    note: { zh: '新建屋苑必須符合降溫 3°C 標準，由環境島核發認證。', en: 'New estates must meet the 3°C cooling standard, certified by the environment island.' } },
  { id: 'f10', from: 'health', to: 'economy', kind: 'pending', ev: 'C', updated: '2026 Q2', depts: 3, carry: { zh: '醫療開支佔比', en: 'health spending share' }, icon: 'heart',
    note: { zh: '醫療局與經濟局正就「醫療開支佔比」的統計口徑對表；跨境醫療開支未計入前，暫不納入撥款模型。', en: 'Health and economy teams are aligning the definition of the health spending share; cross-boundary care is not counted yet, so it stays out of the funding model.' } },
  { id: 'f11', from: 'housing', to: 'education', kind: 'thematic', ev: 'B', updated: '2026 Q1', depts: 2, carry: { zh: '校舍需求清單', en: 'school demand list' }, icon: 'home',
    note: { zh: '屋邨入伙時間表直接決定教育島要加開幾多班。', en: 'Estate move-in schedules directly determine how many classes the education island opens.' } },
  { id: 'f12', from: 'economy', to: 'hub', kind: 'official', ev: 'A', updated: '2026 Q3', depts: 4, carry: { zh: '稅收影響估算', en: 'revenue impact note' }, icon: 'coin',
    note: { zh: '所有政策的財政影響估算都送市政廳覆核，先可以正式推行。', en: 'Every policy impact estimate is sent to city hall for sign-off before it can launch.' } }
];

/* 島的位置：中心市政 + 6 座環形島 */
const ISL_R = 22;             // 環島半徑
const ISL_POS = {};
ISLANDS.forEach((I, i) => {
  if (I.ang === null) { ISL_POS[I.id] = new THREE.Vector2(0, 0); return; }
  const a = I.ang * Math.PI / 180;
  ISL_POS[I.id] = new THREE.Vector2(Math.cos(a) * ISL_R, Math.sin(a) * ISL_R);
});
const ISL_BY_ID = {};
ISLANDS.forEach(I => ISL_BY_ID[I.id] = I);
