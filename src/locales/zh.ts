import type { StoryScripts } from '../story.ts'
import type { EchoTexts } from '../echoes.ts'
const zh = {
  htmlLang: 'zh-Hant',
  hint: '點一下開啟聲音・WASD / 方向鍵移動・點地面或地圖前往・拖曳 / Q E 轉視角・滾輪縮放・R 下雨・B 紀錄・M 開關地圖・閒置 4 秒自動巡遊',
  settings: { title: '設定', language: '語言', sound: '聲音' },
  mixer: { master: '總音量', music: '音樂', ambience: '環境', weather: '天氣', animals: '動物', robot: '機器人', echo: '故事', ui: '提示音', reset: '恢復預設' },
  goTo: (scene: string) => `前往${scene}`,
  credit: '地圖資料',
  scenes: { meadow: '草原', ximending: '廢土西門町' },
  minimap: { ximending: '西門町', hint: '點地圖讓機器人前往・M 開關地圖' },

  menu: { continue: '繼續', newGame: '新遊戲', confirm: '開始新遊戲會清除目前的紀錄（找到的遺物、聽過的錄音與故事進度）。', erase: '清除並開始', back: '返回' },

  loading: {
    aria: '載入中',
    city: { roads: '鋪設街道…', blocks: '蓋起街區…', street: '擺放街景…', shophouses: '填滿店屋…', merge: '合併模型…', grass: '讓植物長回街上…', flowers: '開出野花…', trees: '種下樹木…' },
    meadow: { ground: '鋪設草原…', grass: '讓植物長出來…' },
    routes: '規劃路線…',
    robot: '啟動機器人…',
    camera: '準備鏡頭…',
    shaders: '編譯著色器…',
    light: '點亮畫面…',
  },

  notebook: {
    radar: '雷達・點一下或按 B 打開紀錄',
    title: '紀錄',
    close: '關閉',
    unknown: '？？？',
    clue: (hint: string) => `線索：${hint}`,
    area: (place: string) => `大約在：${place}`,
    lead: '找到的東西和聽到的聲音，照遇到的先後記下來。點一格看看。',
    found: '找到一件東西',
    replay: '重聽',
    released: '這段聲音已經送走了。',
    sections: { things: '找到的東西', sounds: '聽到的聲音' },
  },

  echo: { detected: '偵測到異常音訊……', saved: '已存入紀錄' },

  // What DLV-06's transcript makes of each recording (see echoes.js for when each line shows).
  echoes: {
    R1: { place: '西寧南路與成都路口', lines: ['（警報）', '「又來了。」', '「今年第幾次？」', '「第三吧。走啦，電影要開始了。」'] },
    R2: { place: '峨眉街', lines: ['（水聲）'] },
    R3: { place: '漢中街', lines: ['（無線電）「……峨眉街，一名男性受困……」', '「……已由民眾救出，意識清楚……」'] },
    R4: { place: '紅樓前', lines: ['「那首歌叫什麼？」', '「〈紅樓之夜〉啦，唱片行老闆每天放。」', '「等清完，想再聽一次那首歌。」'] },
    R5: { place: '六號出口・成都路', lines: ['（廣播）「……綠洲遷居計畫……西門町列入第一期……」', '「……請於明年四月三十日前……最後一班列車……」'] },
    R6: { place: '武昌街・唱片行門口', lines: ['「還不走？」', '「最後一箱搬上樓就走。阿忠你先去。」', '「好啦，山上見！」'] },
    R7: { place: '武昌街・唱片行門口', lines: ['「六號出口，交給小麥。」', '「……麻煩你了。」', '「訂單已受理。」'] },
    R8: { place: '紅樓廣場', lines: ['「最後一圈！」', '「明天就沒有這裡了耶。」'] },
    R9: { place: '成都路', lines: ['「老闆！車要開了啦！」', '（腳步聲遠去）'] },
    R10: { place: '漢中街', lines: ['「小麥姐？妳要去哪——」', '（腳步聲遠去）'] },
    R11: { place: '六號出口', lines: ['「小麥？」', '「……小麥！」', '（關門提示音）', '（列車離站）'] },
    R12: { place: '六號出口・廣場', lines: ['「……阿聲？」'] },
    R13: { place: '峨眉街・沙包旁', lines: ['「路線受阻。」', '「重新規劃路線……」', '「路線受阻。」'] },
    R14: { place: '峨眉街', lines: ['（停電）', '「電量不足。」', '「訂單保留中……」'] },
  } satisfies EchoTexts,

  battery: { charging: '充電中', idle: '等待日照', full: '充電完成' },

  routine: {
    title: '今日排程',
    items: { selfcheck: '晨間自檢', sun: '曬太陽充電', greet: '問候顧客', pigeons: '清空配送路徑', crossing: '遵守交通號誌', lens: '清潔鏡頭', patrol: '巡邏外送路線' },
    times: { selfcheck: '06:00', sun: '06:30', greet: '07:10', pigeons: '07:40', crossing: '08:20', lens: '09:00', patrol: '09:30' },
    nudges: {
      sun: '電量 12%・需要日照充電',
      greet: '偵測到四足生物訊號・請靠近問候',
      pigeons: '配送路徑上有鴿群・請清空',
      crossing: '六號出口外有路口・號誌待命中',
      lens: '鏡頭髒污 62%・需要水',
      patrol: '外送路線尚有節點未抵達',
    },
    lines: {
      boot: '今日排程：7 項',
      selfcheck: ['輪組 OK・貨箱 OK・喇叭 OK', '外觀：苔蘚覆蓋 38%'],
      sun: ['太陽能板展開……電量 12% → 64%', '今天天氣很好。'],
      greet: ['偵測到顧客（四足）', '您好！今天想吃點什麼？'],
      cat: '顧客滿意度：無法評估',
      pigeons: (n: number) => `配送路徑已淨空（${n} 隻）`,
      crossing: ['號誌：無訊號・推定為綠燈', '通過。'],
      lens: ['鏡頭清潔中……', '謝謝雨。'],
      patrol: '巡邏完成・沿途店家：營業中 0／歇業 47',
    },
  },

  guide: {
    echoes: '音訊緩衝區有未讀取的片段・往雷達訊號最強的方向走',
    goal: (label: string) => `${label}・跟著雷達的訊號前往`,
  },

  companion: {
    adopted: ['……', '顧客未離開', '登錄為常客：一號顧客'],
    didYouHear: '……你也聽到了嗎？',
    remarks: ['電量 64%。今天天氣很好。', '一號顧客，請跟緊。', '前方路線暢通。我們走。', '今日里程：無法計算（四足）。'],
  },

  wishes: { delivered: '已送達。' },

  story: {
    next: '點一下繼續 ▸',
    close: '點一下關閉',
    toVillage: '前往草原村 ▸',
    lastRecording: '最後一段音訊',
    lastOrder: '最後一筆訂單',
    delivering: '配送中',
    wake: [
      { sys: 'DLV-06 外送機器人' },
      { sys: '系統重新啟動……' },
      { sys: '待機時間：31 年 2 個月' },
      { sys: '目前位置：西門町・峨眉街' },
      { sys: '城市網路：無回應' },
      { sys: '電量：12%' },
      { sys: '載入今日排程……' },
    ],
    order: [
      { sys: '今日排程：完成' },
      { sys: '載入下一筆排程……' },
      { sys: '錯誤：前一筆訂單尚未結案（2054-04-30 23:12 受理）', warn: true },
      { sys: '  寄件人：███████' },
      { sys: '  收件人：███████' },
      { sys: '  目的地：███████' },
      { sys: '讀取訂單紀錄……失敗' },
      { sys: '改為讀取音訊緩衝區……' },
      { sys: '音訊緩衝區：14 段損毀・需在原地點重新對齊' },
      { line: '記憶模組受損。附近的東西，還有附近的聲音，也許能讓它想起發生了什麼。' },
    ],
    interlude1: [
      { sys: '記憶校準：40%' },
      { sys: '2054-04-30 的音訊區塊開始可以讀取' },
      { line: '那一天，是最後一班捷運開走的日子。' },
    ],
    interlude2: [
      { sys: '音訊緩衝區：剩餘 1 段' },
      { sys: '位置指紋：西門町・峨眉街' },
      { line: '最後一段錄音的位置，是它醒來的地方。' },
    ],
    restored: [
      { sys: '音訊來源：DLV-06' },
      { sys: '停機位置：西門町・峨眉街' },
      { sys: '與目的地距離：280 m' },
      { sys: '訂單資料還原' },
      { sys: '  寄件人：阿聲（聲聲唱片）' },
      { sys: '  收件人：小麥' },
      { sys: '  目的地：捷運西門站 6 號出口', warn: true },
    ],
    exit6: [
      { sys: '抵達：捷運西門站 6 號出口' },
      { sys: '收件人：小麥 —— 不在現場' },
      { sys: '已逾時：31 年' },
      { line: '貨箱裡是一封信。' },
      { letter: '小麥：\n對不起，沒趕上最後一班車。\n等店裡收好，我就上山去找你。\n到時候，再一起聽那首歌。\n—— 阿聲' },
      { sys: '查詢收件人新地址……' },
      { sys: '綠洲遷居計畫・第一期安置地：草原村' },
      { sys: '重新規劃路線　距離 38 公里' },
      { line: '它轉過身，往山的方向出發。' },
    ],
    village: [
      { sys: '抵達：草原村' },
      { sys: '訂單狀態：配送中' },
      { sys: '音訊網路：無訊號' },
      { line: '這裡很安靜。只有一段熟悉的旋律。' },
    ],
    farewell: [
      { sys: '抵達：小麥 收' },
      { sys: '收件人狀態：已註銷（2085-03-21）' },
      { sys: '訂單狀態：無法送達', warn: true },
      { play: { label: '播放音訊檔 R11', id: 'R11', then: 'song' } },
      { sys: '投遞：信件 ×1' },
      { sys: '訂單狀態：已送達 ✓', warn: true },
      { sys: 'DLV-06：感謝您的耐心等候。' },
      { sys: '清除音訊緩衝區？' },
      { choice: { key: 'released', options: [{ label: '是', value: true }, { label: '否', value: false }] } },
    ],
    newOrder: [
      { sys: '收到新訂單' },
      { sys: '  寄件人：小麥' },
      { sys: '  收件人：阿聲' },
      { sys: '  內容：信件 31 封' },
      { sys: '  目的地：查詢中……' },
      { sys: 'DLV-06：收到。' },
    ],
  } satisfies StoryScripts,

  // What each relic's card says: only what is there to see, nobody's conclusions.
  relics: {
    ticket: { name: '電影票根', hint: '電影街的騎樓下', story: '日昇戲院的午夜場，7 排 12 號。背面有鉛筆字：「留給阿聲」。散場時河堤的警報響了，大家笑著說「又來了」。那年夏天，警報響了九次。' },
    bubbleTea: { name: '珍奶杯', hint: '漢中街徒步區', story: '半糖少冰。店門口貼著告示：「因淹水保險調漲，飲品一律加價五元。」杯身用麥克筆寫著「凱」。' },
    vinyl: { name: '黑膠唱片', hint: '武昌街往東', story: '〈紅樓之夜〉。封套上印著「聲聲唱片」，內側有原子筆字：「等搬到山上，第一個放給小麥聽。」' },
    neon: { name: '霓虹燈管', hint: '峨眉街', story: '白鷺颱風那一夜，淡水河漫過了河堤。峨眉街的招牌一盞一盞熄掉，那是四十年來第一次全暗。水停在一樓半的高度。' },
    cassette: { name: '卡帶', hint: '紅樓附近', story: '「西門 MIX ’52」。標籤上手寫曲目，第一首是〈紅樓之夜〉。角落寫著：「清淤第 21 天，錄音：凱」。' },
    sneaker: { name: '球鞋', hint: '新世界大樓那頭', story: '店重新開張的那一週，政府公布了「綠洲遷居計畫」，西門町列入第一期。這雙鞋只穿過一次。' },
    noodleBowl: { name: '麵線碗', hint: '總是排著隊的那個攤子', story: '阿忠麵線最後一天營業。攤子上貼著：「山上見，到時候再煮給你們吃。」碗底刻著四個字：「謝 阿聲 52」。' },
    skateboard: { name: '滑板', hint: '成都路', story: '板底貼滿貼紙，最新的一張寫著「4/30 最後一晚」。輪子卡著乾掉的泥。' },
    flipPhone: { name: '折疊手機', hint: '西寧南路', story: '螢幕裂了。最後一封收到的簡訊，22:50，寄件人小麥：「我在六號出口等你。」草稿匣裡有一則沒送出的回覆：「店裡收不完，我請外送機器人先把信送過去。」' },
    card: { name: '悠悠卡', hint: '六號出口附近', story: '餘額 37 元。最後一筆紀錄：2054-04-30 23:38，西門站，進站。' },
    pocketWatch: { name: '懷錶', hint: '磚拱門下', story: '指針停在 23:40。錶背刻著：「給小麥」。' },
    oldKey: { name: '舊鑰匙', hint: '鐵門旁', story: '鑰匙圈上掛著一塊小木牌：「聲聲唱片・備用」。' },
    tinCar: { name: '鐵皮小車', hint: '飼料箱附近', story: '掉漆掉得很嚴重。車底用歪歪扭扭的字寫著「禾」。旁邊的飼料箱上，貼著一張「阿忠麵線」的舊貼紙。' },
    letter: { name: '一疊信', hint: '村子裡的攤子旁', story: '用橡皮筋綁著，共 31 封。收件人都是「阿聲」，地址都是西門町武昌街的舊店，全部沒有貼郵票。最上面夾著一張紙條，字跡跟信不一樣：「如果有一天那台機器人來了，請交給它。——小麥姐交代的，禾」。最後一封的日期是 2085 年 2 月，字比其他封都歪。' },
    musicBox: { name: '音樂盒', hint: '小木屋旁', story: '發條是滿的。底座貼著一張便條：「每天傍晚六點。——禾」。打開會響起〈紅樓之夜〉。' },
  },
}

// The shape every locale fills in; en must match it key for key.
export type Locale = typeof zh

export default zh
