# Meadow Bot

斜俯視角的微縮療癒場景：小外送機器人在兩個場景裡漫遊。three.js + Vite，所有模型都是程式生成，音效全部用 Web Audio 即時合成。

- **草原**：紅磚牆、石板廣場與花草間的鄉村。
- **廢土西門町**（`?scene=ximending`）：依 OpenStreetMap 真實街道與建物輪廓重建的西門町（紅樓到 6 號出口一帶），數十年無人之後已長成草原：柏油龜裂、大片消失，鋪面只剩石磚碎片，多數樓只剩階梯狀斷牆和騎樓柱，6 號出口外的彩虹斑馬線褪色但還認得出來。從捷運西門站 6 號出口出發。

```bash
npm install
npm run dev
```

## 操作

- WASD / 方向鍵：移動
- 點地面：前往該位置
- 閒置 4 秒：自動巡遊
- 右下角按鈕：切換場景、開關聲音（瀏覽器需要先點一下才會出聲）

## 地圖資料

西門町的街道、建物輪廓與樓層數、捷運出口位置來自 OpenStreetMap，存成 `src/data/ximending.json`，執行時不需連網。重新抓取：

```bash
node scripts/fetch-ximending.mjs
```

地圖資料 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，以 ODbL 授權。

## 結構

| 檔案 | 內容 |
|---|---|
| `src/main.js` | 渲染器、依 `?scene=` 載入場景、鏡頭跟拍、場景切換 |
| `src/meadow.js` | 草原場景：佈景、草與花的分布規則、巡遊路線、光線 |
| `src/meadow-terrain.js` | 草原地形高度、草地 / 泥土路 / 乾草區 / 廣場分區 |
| `src/ximending.js` | 廢土西門町場景：把 OSM 資料轉成建物、補齊空地店屋、倒下的高樓、捷運出口、電視牆、廢車、植被與揚塵 |
| `src/city-ground.js` | 依真實道路繪製的地面：shader 逐像素畫出龜裂的柏油板塊、殘存的石磚碎片與泥土，CPU 端同一套規則決定草長在哪；褪色的彩虹斑馬線 |
| `src/city.js` | 依 OSM 輪廓長出的樓（臨街騎樓）、騎樓店屋、沿樓層階梯斷裂的空殼 / 倒塌 / 傾斜殘樓、瓦礫與鋼筋、直式招牌、橫倒的高樓、依區塊合併的靜態網格 |
| `src/city-props.js` | 廢車、路燈、紅樓的拱窗與八角屋頂、捷運出口雨棚、碎裂的電視牆 |
| `src/cutaway.js` | 鏡頭與機器人之間的建物以抖動透明挖空，避免擋住機器人 |
| `src/terrain.js` | 共用的亂數、雜訊，與目前場景的地形高度 |
| `src/vegetation.js` | 草叢（InstancedMesh + 風擺 shader）、小花、蘆葦、魯冰花、常春藤，以及由上千片葉枝組成的樹與灌木 |
| `src/bricks.js` | 圓角磚牆（沿曲線掃掠 + 程式磚紋與青苔 shader）、磚柱、整塊拱形涵洞、倒塌牆塊 |
| `src/props.js` | 草原的拱門磚房、石板廣場、落葉碎石、木桶、電線桿、柵欄、鐵門、帆布攤位、燈串、小木屋等 |
| `src/animals.js` | 會吃草的牛、四處嗅聞的狐狸、會啄地亂走的雞、散步的村民（只出現在草原） |
| `src/robot.js` | 六輪外送機器人模型、操控、巡遊 |
| `src/collision.js` | 2D 膠囊碰撞、植被避開障礙物用的佔用格 |
| `src/post.js` | AO（n8ao）→ Bloom、移軸景深、ACES 調色 → SMAA |
| `src/weathering.js` | 共用的做舊 shader：髒污、牆腳泥垢、積灰、褪色、木紋、鏽斑、雨痕，以及凹凸起伏 |
| `src/graffiti.js` | Canvas 即時繪製的噴漆塗鴉貼花：滴痕簽名（tag）與粗描邊泡泡字（piece） |
| `src/audio.js` | 風聲、樹葉、鳥叫、牛叫、雞叫、馬達聲、音樂盒旋律 |
| `scripts/fetch-ximending.mjs` | 從 Overpass API 抓取西門町 OSM 資料並轉成本地公尺座標 |
